// 稽核紀錄：panel 每次改權限都呼叫這支。「誰把我 ban 的」必然吵，
// 一張表一次 insert 是最便宜的保險。
import "server-only";
import { prisma, type PrismaClientOrTx } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export interface RecordAuditInput {
  actorEmail: string;
  targetEmail: string;
  serviceId: string;
  action: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

export function recordAudit(input: RecordAuditInput, db: PrismaClientOrTx = prisma) {
  return db.auditLog.create({
    data: {
      actorEmail: input.actorEmail.toLowerCase(),
      targetEmail: input.targetEmail.toLowerCase(),
      serviceId: input.serviceId,
      action: input.action,
      before: input.before ?? undefined,
      after: input.after ?? undefined,
    },
  });
}
