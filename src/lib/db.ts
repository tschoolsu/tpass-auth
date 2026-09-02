// Prisma client 單例。Next dev/HMR 下避免每次重載都新建連線。
import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 的連線池就是 pg 的 Pool，預設沒有任何逾時。這裡明確給上限：
// 依賴變慢時 request 會失敗而不是無限排隊把整台服務拖垮（準則見 tpass-ops handbook〈資料庫〉）。
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  options: "-c statement_timeout=30000",
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
