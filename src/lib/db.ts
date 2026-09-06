// Prisma client 單例。Next dev/HMR 下避免每次重載都新建連線。
import "server-only";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// 共用型別：交易內／交易外都能吃的 db handle。repo.ts / audit.ts 的寫入函式
// 一律用這個當第一或第二參數的型別，讓呼叫端能選擇「直接寫」或「包進呼叫端自己的交易」。
export type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

// Prisma 7 的連線池就是 pg 的 Pool，預設沒有任何逾時。這裡明確給上限：
// 依賴變慢時 request 會失敗而不是無限排隊把整台服務拖垮（準則見 tpass-ops handbook〈資料庫〉）。
//
// statement_timeout 與 connectionTimeoutMillis 收斂到同量級的 5 秒（原本 30 秒）：
// 發證路徑（authorize）全是點查詢，正常幾毫秒內就有答案；30 秒只在「已拿到連線、
// 查詢被鎖卡住」時讓人白等，快速失敗交給既有的 fail-open 降級（見
// permissions/resolve.ts 的 degraded()）比讓使用者轉圈 30 秒更好。
// statement_timeout 是逐一 statement 計時，不是整筆交易的下限——批次操作
// （如 applyRoleChanges）裡的每個 upsert／createMany 各自是毫秒級的單一
// statement，5 秒對它們一樣寬裕，不受這裡影響。
const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  options: "-c statement_timeout=5000",
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
