// 測試資料庫工具。整合測試需要在 auth 的 DB 裡放 Subject/Grant 來驗權限，
// 但測試 process 不經過 Next，所以自己開一條連線，不共用 src/lib/db.ts 的單例。
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client";
import { TEST_DATABASE_URL } from "./env";

const adapter = new PrismaPg({ connectionString: TEST_DATABASE_URL, max: 5 });
export const prisma = new PrismaClient({ adapter });

/**
 * 清空測試庫。先確認連的真的是測試庫——接錯庫的 TRUNCATE 會清掉權限真相，
 * 這種錯誤只能靠事前擋。
 */
export async function resetDb(): Promise<void> {
  if (!TEST_DATABASE_URL.includes("t_auth_test")) {
    throw new Error(`拒絕清庫：連線字串不是測試庫（${TEST_DATABASE_URL}）`);
  }
  const [{ current_database }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database()",
  );
  if (current_database !== "t_auth_test") {
    throw new Error(`拒絕清庫：連線指向 ${current_database}，不是 t_auth_test`);
  }
  await prisma.$executeRawUnsafe(`TRUNCATE "AuditLog", "Grant", "Subject" RESTART IDENTITY CASCADE`);
}

/** 建一個人並給他在某服務的角色／管制。 */
export async function grant(opts: {
  email: string;
  serviceId: string;
  role?: "admin" | "moderator" | "default";
  restriction?: "none" | "warning" | "ban";
  reason?: string;
  expiresAt?: Date | null;
  sessionsValidFrom?: Date | null;
}) {
  const subject = await prisma.subject.upsert({
    where: { email: opts.email },
    update: opts.sessionsValidFrom !== undefined ? { sessionsValidFrom: opts.sessionsValidFrom } : {},
    create: {
      email: opts.email,
      sub: `sub-${opts.email}`,
      name: opts.email.split("@")[0],
      sessionsValidFrom: opts.sessionsValidFrom ?? null,
    },
  });
  await prisma.grant.upsert({
    where: { subjectId_serviceId: { subjectId: subject.id, serviceId: opts.serviceId } },
    update: {
      role: opts.role ?? "default",
      restriction: opts.restriction ?? "none",
      reason: opts.reason ?? null,
      expiresAt: opts.expiresAt ?? null,
      updatedBy: "test",
    },
    create: {
      subjectId: subject.id,
      serviceId: opts.serviceId,
      role: opts.role ?? "default",
      restriction: opts.restriction ?? "none",
      reason: opts.reason ?? null,
      expiresAt: opts.expiresAt ?? null,
      updatedBy: "test",
    },
  });
  return subject;
}
