"use server";
// 後台唯一的寫入口。全走 server actions，不開 REST 管理端點。
// 每支都自己重新呼叫 requireAuthModerator/requireAuthAdmin——layout 只負責畫面，
// 擋不住有人直接呼叫這支函式（例如繞過 UI 直接打 server action 的網路請求）。
import { revalidatePath } from "next/cache";
import {
  requireAuthAdmin,
  requireAuthModerator,
  ForbiddenError,
  type AdminActor,
} from "@/lib/admin-guard";
import { authConfig } from "@/config/auth";
import {
  findSubjectByEmail,
  findSubjectWithGrants,
  createSubject as createSubjectRow,
  deleteSubjectById,
  findGrantByServiceAndSubject,
  upsertGrant,
  touchSessionsValidFrom,
  setEntryYearOverride,
  findSubjectsByEmails,
  createSubjectsIfMissing,
  findGrantsBySubjectIds,
  applyRoleChanges,
  type RoleChangeOp,
} from "@/lib/permissions/repo";
import { recordAudit } from "@/lib/audit";
import {
  parseEmailList,
  isValidEmail,
  normalizeEmail,
  MAX_EMAILS,
} from "@/lib/permissions/parse-emails";
import type { Restriction, Role } from "@/lib/permissions/types";
import { isValidEntryYear, MIN_ENTRY_YEAR, currentAcademicYear } from "@/lib/entry-year";

export type ActionResult = { ok: true } | { ok: false; error: string };

const ROLES: readonly Role[] = ["admin", "moderator", "default"];
const RESTRICTIONS: readonly Restriction[] = ["none", "warning", "ban"];
const ROLE_RANK: Record<Role, number> = { default: 0, moderator: 1, admin: 2 };

function validServiceId(serviceId: string): boolean {
  return serviceId === "auth" || authConfig.serviceIds.includes(serviceId);
}

// admin-guard 的 requireAuth* 是 throw ForbiddenError——那對 layout/page 是對的（Next 接得住）。
// 但 server action 的呼叫端是 client 元件裡的 startTransition：throw 過去只會變成一個沒有訊息的
// unhandled rejection，畫面就停在「處理中…」不動。所以 action 這條路徑一律先過這層，
// 把「權限不足」變成一個能顯示給人看的回值。
async function gate(
  require: () => Promise<AdminActor>,
): Promise<{ actor: AdminActor } | { error: string }> {
  try {
    return { actor: await require() };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    throw err; // 其他錯誤（DB 掛了之類）不該被偽裝成權限問題，交給 error.tsx
  }
}

// ── deleteSubject ────────────────────────────────────────────────────
// 刪人＝連他在所有服務的 Grant 一起消失（schema onDelete: Cascade）。
// ⚠️ 這是「清空紀錄」不是「封鎖」：被 ban 的人刪掉就等於解除 ban，之後他再登入
// 會被 upsertSubjectOnLogin 建成一筆全新的乾淨 Subject。要擋人請用 ban，不要用刪除。
// 只有 admin 能刪；擋掉兩種會鎖死自己的情況（總管、自己）。
export async function deleteSubjectAction(emailRaw: string): Promise<ActionResult> {
  const g = await gate(requireAuthAdmin);
  if ("error" in g) return { ok: false, error: g.error };
  const { session } = g.actor;

  const email = normalizeEmail(emailRaw);
  if (authConfig.superadmins.includes(email)) {
    return { ok: false, error: "此帳號是生態總管（AUTH_SUPERADMINS），不在 DB 裡，無法刪除" };
  }
  if (email === session.email.toLowerCase()) {
    return { ok: false, error: "不可刪除自己" };
  }

  const subject = await findSubjectWithGrants(email);
  if (!subject) return { ok: false, error: "找不到這位使用者" };

  // 先把要消失的內容快照起來——刪完就查不到了，稽核只剩這一份底稿。
  const before = {
    name: subject.name,
    grants: subject.grants.map((g) => ({
      serviceId: g.serviceId,
      role: g.role,
      restriction: g.restriction,
      reason: g.reason,
      expiresAt: g.expiresAt?.toISOString() ?? null,
    })),
  };

  await deleteSubjectById(subject.id);

  await recordAudit({
    actorEmail: session.email,
    targetEmail: email,
    serviceId: "auth",
    action: "subject.delete",
    before,
    after: null,
  });

  // 一次刪掉的 Grant 可能橫跨多個服務，逐頁列舉容易漏——整個 /admin 子樹一起失效。
  revalidatePath("/admin", "layout");
  return { ok: true };
}

// ── saveGrant ────────────────────────────────────────────────────────
export interface SaveGrantInput {
  email: string;
  serviceId: string;
  role: Role;
  restriction: Restriction;
  reason: string;
  // datetime-local 字串（"2026-08-01T12:00"）或空字串／null＝不設到期。
  expiresAt: string | null;
}

export async function saveGrant(input: SaveGrantInput): Promise<ActionResult> {
  const g = await gate(requireAuthModerator);
  if ("error" in g) return { ok: false, error: g.error };
  const { session, perm } = g.actor;

  const email = normalizeEmail(input.email);
  const serviceId = input.serviceId;
  const reason = input.reason.trim();

  // ── 輸入驗證（白名單，不信任前端傳來的字面值）──
  if (!validServiceId(serviceId)) return { ok: false, error: "不明的服務 id" };
  if (!ROLES.includes(input.role)) return { ok: false, error: "不明的角色" };
  if (!RESTRICTIONS.includes(input.restriction)) return { ok: false, error: "不明的管制狀態" };
  if (input.restriction !== "none" && !reason) {
    return { ok: false, error: "警告／禁止瀏覽必須填寫原因" };
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "到期時間格式錯誤" };
    expiresAt = d;
  }

  // ── 業務規則：不可對 superadmin 做任何變更 ──
  if (authConfig.superadmins.includes(email)) {
    return { ok: false, error: "此帳號是生態總管（AUTH_SUPERADMINS），不可調整" };
  }

  // 沒建過就順手建。「Subject row 存不存在」是我們的資料模型細節，不是使用者該先處理的
  // 前置步驟——過去這裡回「請先建立」，等於把機械限制推給人做一次多餘的來回。
  // 人不必登入過（先建、先給權限，等他來），登入時 upsertSubjectOnLogin 會回填 sub/name。
  if (!isValidEmail(email)) return { ok: false, error: "email 格式不正確" };
  const subject = (await findSubjectByEmail(email)) ?? (await createSubjectRow(email));

  const existing = await findGrantByServiceAndSubject(subject.id, serviceId);
  const currentRole: Role = (existing?.role as Role | undefined) ?? "default";

  // ── 業務規則：moderator 不可改 role ──
  if (perm.role !== "admin" && input.role !== currentRole) {
    return { ok: false, error: "版主只能調整管制狀態，不能調整角色" };
  }

  // ── 業務規則：不可調低自己在 auth 的角色（防鎖門）──
  if (
    serviceId === "auth" &&
    email === session.email.toLowerCase() &&
    ROLE_RANK[input.role] < ROLE_RANK[currentRole]
  ) {
    return { ok: false, error: "不可調低自己在 auth 的角色，會鎖住管理面板" };
  }

  const before = existing
    ? {
        role: existing.role,
        restriction: existing.restriction,
        reason: existing.reason,
        expiresAt: existing.expiresAt?.toISOString() ?? null,
      }
    : null;

  const grant = await upsertGrant({
    subjectId: subject.id,
    serviceId,
    role: input.role,
    restriction: input.restriction,
    reason: input.restriction === "none" ? null : reason,
    expiresAt,
    updatedBy: session.email,
  });

  const after = {
    role: grant.role,
    restriction: grant.restriction,
    reason: grant.reason,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
  };

  // ban 生效：Subject.sessionsValidFrom 設為 now()——讓被 ban 者的 auth 登入態立刻死亡
  // （getSession 會拒絕早於此時間 iat 的 token），不必等現有 session 自然過期才失去 SSO 能力。
  if (input.restriction === "ban") {
    await touchSessionsValidFrom(subject.id);
  }

  // ── 稽核：依實際變動內容分開記，一次存檔可能同時觸發多種 action ──
  // 用「目前有效值」比較（沒有 existing row 時等同 default/none），不是「有沒有 existing row」——
  // 否則對從沒被動過的人存一次全預設值也會生出假的 role.change 稽核噪音。
  const currentRestriction = existing?.restriction ?? "none";
  const roleChanged = currentRole !== grant.role;
  const restrictionChanged = currentRestriction !== grant.restriction;
  const onlyMetaChanged =
    !roleChanged &&
    !restrictionChanged &&
    existing !== null &&
    (existing.reason !== grant.reason ||
      existing.expiresAt?.getTime() !== grant.expiresAt?.getTime());

  const auditActions: string[] = [];
  if (roleChanged) auditActions.push("role.change");
  if (restrictionChanged) {
    auditActions.push(grant.restriction === "none" ? "restriction.clear" : "restriction.set");
  }
  if (onlyMetaChanged) auditActions.push("grant.edit");

  for (const action of auditActions) {
    await recordAudit({
      actorEmail: session.email,
      targetEmail: email,
      serviceId,
      action,
      before,
      after,
    });
  }

  revalidatePath(`/admin/people/${encodeURIComponent(email)}`);
  revalidatePath("/admin/people");
  revalidatePath(`/admin/services/${serviceId}`);
  revalidatePath("/admin/audit");
  revalidatePath("/admin");

  return { ok: true };
}

// ── saveEntryYear ────────────────────────────────────────────────────
// 入學屆別覆寫。休學復學者 email 沿用、學號前綴不變，年級會多算一級（休學兩年直接算不出來），
// 這裡讓管理者把他改算到正確的一屆。存屆別不存年級——設定一次就永久正確，
// 不必每年 8 月把所有例外重標一輪。
// 版主可用：這是身分資料的更正，不是授權變更。
export interface SaveEntryYearInput {
  email: string;
  entryYear: number | null; // null = 恢復成照 email 推算
}

export async function saveEntryYear(input: SaveEntryYearInput): Promise<ActionResult> {
  const g = await gate(requireAuthModerator);
  if ("error" in g) return { ok: false, error: g.error };
  const { session } = g.actor;

  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: "email 格式不正確" };

  // 與 saveGrant 同一條規則：總管不進 DB，改了也沒有意義。
  if (authConfig.superadmins.includes(email)) {
    return { ok: false, error: "此帳號是生態總管（AUTH_SUPERADMINS），不可調整" };
  }

  if (input.entryYear !== null && !isValidEntryYear(input.entryYear)) {
    return {
      ok: false,
      error: `入學學年度必須是 ${MIN_ENTRY_YEAR}～${currentAcademicYear() + 1} 之間的民國學年度`,
    };
  }

  // 沿用 saveGrant 的做法：沒建過就順手建，不要把「row 存不存在」推給人先處理。
  const subject = (await findSubjectByEmail(email)) ?? (await createSubjectRow(email));
  const before = { entryYearOverride: subject.entryYearOverride };

  if (subject.entryYearOverride === input.entryYear) {
    return { ok: true }; // 沒變動就不寫、不記稽核，避免假紀錄
  }

  await setEntryYearOverride(subject.id, input.entryYear);

  await recordAudit({
    actorEmail: session.email,
    targetEmail: email,
    serviceId: "auth",
    action: input.entryYear === null ? "entryYear.clear" : "entryYear.set",
    before,
    after: { entryYearOverride: input.entryYear },
  });

  revalidatePath(`/admin/people/${encodeURIComponent(email)}`);
  revalidatePath("/admin/audit");
  return { ok: true };
}

// ── 批次授權（/admin/bulk）────────────────────────────────────────────
// 貼一批 email、勾服務、選角色。**只改 role，不碰管制**——批次 ban 要填原因、要二次確認、
// 還會即時砍掉對方 SSO 登入態，一次對 30 個人做手滑代價太大，那條路維持單人操作。

export interface BulkGrantInput {
  emailsRaw: string;
  serviceIds: string[];
  role: Role;
}

export interface BulkChange {
  email: string;
  serviceId: string;
  from: Role;
  to: Role;
  // 原本就沒有 Grant row（≠ 有一筆 role=default）。只為了讓稽核的 before 與 saveGrant 同語意。
  isNewGrant: boolean;
}
export interface BulkSkip {
  email: string;
  serviceId: string;
  role: Role;
}
export interface BulkBlocked {
  email: string;
  serviceId: string | null; // null = 整個 email 都不處理（格式錯／總管）
  reason: string;
}

export interface BulkPreview {
  changes: BulkChange[];
  unchanged: BulkSkip[];
  blocked: BulkBlocked[];
  newSubjectCount: number; // 這批裡目前還不存在的人數
}

export type BulkPreviewResult =
  | ({ ok: true } & BulkPreview)
  | { ok: false; error: string };

export type BulkApplyResult =
  | { ok: true; appliedCount: number; createdSubjectCount: number }
  | { ok: false; error: string };

// 預覽與套用共用同一支分類函式——畫面上看到什麼，套用就做什麼。
// 兩邊各算一次的話，中間任何一條規則改動都會讓「預覽」變成謊話。
async function classify(
  input: BulkGrantInput,
  actorEmail: string,
): Promise<BulkPreviewResult> {
  if (!ROLES.includes(input.role)) return { ok: false, error: "不明的角色" };

  const serviceIds = [...new Set(input.serviceIds)];
  if (serviceIds.length === 0) return { ok: false, error: "請至少勾選一個服務" };
  if (!serviceIds.every(validServiceId)) return { ok: false, error: "不明的服務 id" };

  const { valid, invalid } = parseEmailList(input.emailsRaw);
  if (valid.length === 0 && invalid.length === 0) {
    return { ok: false, error: "請貼上至少一個 email" };
  }
  if (valid.length > MAX_EMAILS) {
    return { ok: false, error: `一次最多 ${MAX_EMAILS} 個 email（目前 ${valid.length} 個），請分批貼上` };
  }

  const blocked: BulkBlocked[] = invalid.map((raw) => ({
    email: raw,
    serviceId: null,
    reason: "email 格式不正確",
  }));

  // 整個 email 就不處理的情況，跟 saveGrant 用同一條規則（superadmin 不進 DB，改了也沒意義）。
  const targets = valid.filter((email) => {
    if (authConfig.superadmins.includes(email)) {
      blocked.push({ email, serviceId: null, reason: "生態總管（AUTH_SUPERADMINS），不可調整" });
      return false;
    }
    return true;
  });

  const subjects = await findSubjectsByEmails(targets);
  const subjectByEmail = new Map(subjects.map((s) => [s.email, s]));
  const grants = await findGrantsBySubjectIds(
    subjects.map((s) => s.id),
    serviceIds,
  );
  const grantKey = (subjectId: string, serviceId: string) => `${subjectId} ${serviceId}`;
  const grantByKey = new Map(grants.map((g) => [grantKey(g.subjectId, g.serviceId), g]));

  const changes: BulkChange[] = [];
  const unchanged: BulkSkip[] = [];

  for (const email of targets) {
    const subject = subjectByEmail.get(email);
    for (const serviceId of serviceIds) {
      const existing = subject ? grantByKey.get(grantKey(subject.id, serviceId)) : undefined;
      const from: Role = (existing?.role as Role | undefined) ?? "default";

      // 防鎖門：跟 saveGrant 同一條——不可調低自己在 auth 的角色，否則按下去就把自己關在外面。
      if (serviceId === "auth" && email === actorEmail && ROLE_RANK[input.role] < ROLE_RANK[from]) {
        blocked.push({ email, serviceId, reason: "不可調低自己在 auth 的角色，會鎖住管理面板" });
        continue;
      }

      if (from === input.role) {
        unchanged.push({ email, serviceId, role: from });
        continue;
      }
      changes.push({ email, serviceId, from, to: input.role, isNewGrant: !existing });
    }
  }

  return {
    ok: true,
    changes,
    unchanged,
    blocked,
    newSubjectCount: targets.filter((e) => !subjectByEmail.has(e)).length,
  };
}

export async function previewBulkGrant(input: BulkGrantInput): Promise<BulkPreviewResult> {
  // 批次只改 role，而版主本來就不能改 role——整個功能 admin only，不另立一套判斷。
  const g = await gate(requireAuthAdmin);
  if ("error" in g) return { ok: false, error: g.error };
  return classify(input, g.actor.session.email.toLowerCase());
}

export async function applyBulkGrant(input: BulkGrantInput): Promise<BulkApplyResult> {
  const g = await gate(requireAuthAdmin);
  if ("error" in g) return { ok: false, error: g.error };
  const actorEmail = g.actor.session.email.toLowerCase();

  const preview = await classify(input, actorEmail);
  if (!preview.ok) return preview;
  if (preview.changes.length === 0) return { ok: false, error: "沒有任何需要變更的項目" };

  // 補齊缺的 Subject，然後重查一次拿 id（createMany 不回傳 id）。
  const emails = [...new Set(preview.changes.map((c) => c.email))];
  const createdSubjectCount = await createSubjectsIfMissing(emails);
  const subjects = await findSubjectsByEmails(emails);
  const idByEmail = new Map(subjects.map((s) => [s.email, s.id]));

  const ops: RoleChangeOp[] = preview.changes.map((c) => ({
    subjectId: idByEmail.get(c.email)!,
    serviceId: c.serviceId,
    role: c.to,
    targetEmail: c.email,
    // 與 saveGrant 的稽核同語意：本來就沒有 Grant row 時記 null，不要謊稱「原本是 default」。
    before: c.isNewGrant ? null : { role: c.from },
  }));

  await applyRoleChanges({ ops, actorEmail });

  // 一次橫跨多服務多人，逐頁列舉遲早漏——整棵 /admin 子樹一起失效。
  revalidatePath("/admin", "layout");

  return { ok: true, appliedCount: ops.length, createdSubjectCount };
}
