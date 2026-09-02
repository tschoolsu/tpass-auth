// 權限資料存取層：簽章路徑與 panel 都不直接碰 Prisma，只透過這裡。
// email 一律小寫正規化——Subject.email 存的也是小寫，查找鍵才對得上。
import "server-only";
import { prisma } from "@/lib/db";
import type { Grant, Prisma, Subject } from "@/generated/prisma/client";

export function findGrant(email: string, serviceId: string): Promise<Grant | null> {
  return prisma.grant.findFirst({
    where: { serviceId, subject: { email: email.toLowerCase() } },
  });
}

export function findAllGrants(email: string): Promise<Grant[]> {
  return prisma.grant.findMany({
    where: { subject: { email: email.toLowerCase() } },
  });
}

// ── panel 用查詢（Phase 2）──────────────────────────────────────────────

export function findSubjectByEmail(email: string): Promise<Subject | null> {
  return prisma.subject.findUnique({ where: { email: email.toLowerCase() } });
}

export type SubjectWithGrants = Subject & { grants: Grant[] };

export function findSubjectWithGrants(email: string): Promise<SubjectWithGrants | null> {
  return prisma.subject.findUnique({
    where: { email: email.toLowerCase() },
    include: { grants: true },
  });
}

export function createSubject(email: string): Promise<Subject> {
  return prisma.subject.create({ data: { email: email.toLowerCase() } });
}

// 刪除 Subject：底下的 Grant 靠 schema 的 onDelete: Cascade 一起消失，不必手動先刪。
export function deleteSubjectById(id: string): Promise<Subject> {
  return prisma.subject.delete({ where: { id } });
}

// 登入成功時呼叫（callback/google/route.ts）：回填 sub/name、更新 lastSeenAt。
// email 是查找鍵——panel 可能已經先用 email 建過 Subject（人還沒登入過），
// 這裡用 upsert 讓「先建後登入」與「先登入後被管理」兩條路徑收斂成同一筆 row。
export function upsertSubjectOnLogin(input: {
  email: string;
  sub: string;
  name: string;
}): Promise<Subject> {
  const email = input.email.toLowerCase();
  return prisma.subject.upsert({
    where: { email },
    create: { email, sub: input.sub, name: input.name, lastSeenAt: new Date() },
    update: { sub: input.sub, name: input.name, lastSeenAt: new Date() },
  });
}

// 人員列表：文字搜尋（email ∪ name）＋服務/狀態篩選＋分頁。
//
// status 的四個值都是「在某個服務身上」的條件：帶 serviceId 就限定該服務，不帶就是任一服務。
// 管制類（warning/ban）只算**生效中**的——過期的管制只是 DB 欄位還沒被下次編輯覆蓋，
// 語意上已經解除了（判斷沿用下方 restrictionStats 的同一條）。
export type SubjectStatusFilter = "admin" | "moderator" | "warning" | "ban";

export async function listSubjects(opts: {
  query?: string;
  serviceId?: string;
  status?: SubjectStatusFilter;
  page: number;
  pageSize: number;
}): Promise<{ subjects: SubjectWithGrants[]; total: number }> {
  const and: Prisma.SubjectWhereInput[] = [];

  const q = opts.query?.trim();
  if (q) {
    and.push({
      OR: [
        // email 欄位一律存小寫，所以比對前先降；name 是 Google 原樣回填的，要 insensitive。
        { email: { contains: q.toLowerCase() } },
        { name: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  if (opts.status) {
    const grant: Prisma.GrantWhereInput =
      opts.status === "admin" || opts.status === "moderator"
        ? { role: opts.status }
        : {
            restriction: opts.status,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          };
    if (opts.serviceId) grant.serviceId = opts.serviceId;
    and.push({ grants: { some: grant } });
  } else if (opts.serviceId) {
    // 只選了服務沒選狀態＝「這個服務裡有故事的人」，跟 listGrantsForService 同一條定義。
    and.push({
      grants: {
        some: {
          serviceId: opts.serviceId,
          OR: [{ role: { not: "default" } }, { restriction: { not: "none" } }],
        },
      },
    });
  }

  const where: Prisma.SubjectWhereInput = and.length > 0 ? { AND: and } : {};
  const [subjects, total] = await Promise.all([
    prisma.subject.findMany({
      where,
      include: { grants: true },
      orderBy: { email: "asc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.subject.count({ where }),
  ]);
  return { subjects, total };
}

export function countSubjects(): Promise<number> {
  return prisma.subject.count();
}

// 建立或更新一筆 Grant（saveGrant action 唯一寫入口）。
export function upsertGrant(input: {
  subjectId: string;
  serviceId: string;
  role: string;
  restriction: string;
  reason: string | null;
  expiresAt: Date | null;
  updatedBy: string;
}): Promise<Grant> {
  return prisma.grant.upsert({
    where: { subjectId_serviceId: { subjectId: input.subjectId, serviceId: input.serviceId } },
    create: {
      subjectId: input.subjectId,
      serviceId: input.serviceId,
      role: input.role,
      restriction: input.restriction,
      reason: input.reason,
      expiresAt: input.expiresAt,
      updatedBy: input.updatedBy,
    },
    update: {
      role: input.role,
      restriction: input.restriction,
      reason: input.reason,
      expiresAt: input.expiresAt,
      updatedBy: input.updatedBy,
    },
  });
}

// ban 時呼叫（saveGrant）：把 Subject.sessionsValidFrom 設為 now()——早於這個時間簽出的
// auth session 全部失效，被 ban 者的 SSO 態立刻死亡，換不到任何新的 per-service 票
// （已發出去的舊票仍活到各自 TTL，見 session.ts getSession 的比對邏輯）。
export function touchSessionsValidFrom(subjectId: string): Promise<Subject> {
  return prisma.subject.update({
    where: { id: subjectId },
    data: { sessionsValidFrom: new Date() },
  });
}

// 設定／清除入學屆別覆寫。null＝恢復成照 email 推算。
export function setEntryYearOverride(
  subjectId: string,
  value: number | null,
): Promise<Subject> {
  return prisma.subject.update({
    where: { id: subjectId },
    data: { entryYearOverride: value },
  });
}

export function findGrantByServiceAndSubject(
  subjectId: string,
  serviceId: string,
): Promise<Grant | null> {
  return prisma.grant.findUnique({
    where: { subjectId_serviceId: { subjectId, serviceId } },
  });
}

// ── 批次授權用（/admin/bulk）─────────────────────────────────────────────
// 一次 200 人 × 6 服務，逐筆查會是 1200 次往返——批次路徑一律整批撈。

export function findSubjectsByEmails(emails: string[]): Promise<Subject[]> {
  return prisma.subject.findMany({
    where: { email: { in: emails.map((e) => e.toLowerCase()) } },
  });
}

// 先把缺的 Subject 補齊（已存在的靠 email unique + skipDuplicates 略過）。
// 回傳新建筆數，只為了讓 action 能回報「新增了幾個人」。
// 這步在 applyRoleChanges 的交易**之外**——createMany 不回傳 id，拿不到 id 就沒辦法建 Grant。
// 交易之後失敗會留下沒有任何 Grant 的 Subject，語意上等同「不存在的人」（權限全 default），
// 無害；下次同一批重跑會被 skipDuplicates 接住。
export async function createSubjectsIfMissing(emails: string[]): Promise<number> {
  const { count } = await prisma.subject.createMany({
    data: emails.map((email) => ({ email: email.toLowerCase() })),
    skipDuplicates: true,
  });
  return count;
}

export function findGrantsBySubjectIds(
  subjectIds: string[],
  serviceIds: string[],
): Promise<Grant[]> {
  return prisma.grant.findMany({
    where: { subjectId: { in: subjectIds }, serviceId: { in: serviceIds } },
  });
}

export interface RoleChangeOp {
  subjectId: string;
  serviceId: string;
  role: string;
  // 稽核用：這筆變更的當事人與前後值（before 沒有 Grant 時＝null）。
  targetEmail: string;
  before: Prisma.InputJsonValue | null;
}

// 批次套用角色變更：所有 upsert 與稽核寫入包成**一筆交易**，全成功或全不動。
// 半套用的名單比沒套用更難收拾——不知道停在哪一筆，稽核也只寫到一半。
//
// ⚠️ 這裡刻意只寫 `role`，不碰 restriction / reason / expiresAt。不要為了「少一支路徑」
// 改用上面的 upsertGrant：那支會連管制欄位一起寫，而批次路徑只知道角色，傳什麼管制值
// 都是瞎猜——傳 "none" 就等於把被 ban 的人默默解 ban。保證來自這裡碰不到那三個欄位，
// 不是來自呼叫端記得帶回原值。
export function applyRoleChanges(input: {
  ops: RoleChangeOp[];
  actorEmail: string;
}): Promise<unknown[]> {
  const actorEmail = input.actorEmail.toLowerCase();
  return prisma.$transaction([
    ...input.ops.map((op) =>
      prisma.grant.upsert({
        where: { subjectId_serviceId: { subjectId: op.subjectId, serviceId: op.serviceId } },
        create: {
          subjectId: op.subjectId,
          serviceId: op.serviceId,
          role: op.role,
          updatedBy: actorEmail,
        },
        update: { role: op.role, updatedBy: actorEmail },
      }),
    ),
    prisma.auditLog.createMany({
      data: input.ops.map((op) => ({
        actorEmail,
        targetEmail: op.targetEmail.toLowerCase(),
        serviceId: op.serviceId,
        action: "role.change",
        before: op.before ?? undefined,
        after: { role: op.role },
      })),
    }),
  ]);
}

export type GrantWithSubject = Grant & { subject: Subject };

// 服務視角：這個服務裡「有故事」的 Grant（角色非 default 或管制非 none）。
// 到期的管制仍會回傳（原始 DB 值）——由呼叫端用 toEntry 判斷是否已失效。
export function listGrantsForService(serviceId: string): Promise<GrantWithSubject[]> {
  return prisma.grant.findMany({
    where: {
      serviceId,
      OR: [{ role: { not: "default" } }, { restriction: { not: "none" } }],
    },
    include: { subject: true },
    orderBy: { updatedAt: "desc" },
  });
}

// 總覽統計：各服務 admin/moderator 數（角色不受到期影響，不用篩 expiresAt）。
export function roleStats() {
  return prisma.grant.groupBy({
    by: ["serviceId", "role"],
    where: { role: { not: "default" } },
    _count: true,
  });
}

// 總覽統計：目前「生效中」的管制數（warning/ban），過期的不算——
// 過期只是 DB 欄位還沒被下次編輯覆蓋，語意上已經解除了。
export function restrictionStats() {
  const now = new Date();
  return prisma.grant.groupBy({
    by: ["restriction"],
    where: {
      restriction: { not: "none" },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    _count: true,
  });
}

export function listRecentAuditLogs(limit: number) {
  return prisma.auditLog.findMany({ orderBy: { at: "desc" }, take: limit });
}

export async function listAuditLogs(opts: {
  targetEmail?: string;
  serviceId?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.AuditLogWhereInput = {
    ...(opts.targetEmail ? { targetEmail: opts.targetEmail.trim().toLowerCase() } : {}),
    ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
  };
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { at: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { logs, total };
}
