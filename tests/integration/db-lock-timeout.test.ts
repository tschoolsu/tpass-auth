// U-2：DB 卡住時，authorize 要快速 fail-open，不能讓使用者等到全域 30 秒逾時。
// 用外部 pg 連線把 Subject 鎖住（模擬「已拿到連線、查詢卡住」的情境），
// 打一次 authorize，斷言回應時間遠短於舊的 30 秒全域逾時。
//
// 門檻 15 秒：authorize 一次會依序打 2 次會 join 到 Subject 的查詢（getSession 的
// findSubjectByEmail、permissionsFor 的 findGrant；A2-5 之後 signServiceToken 重用
// 這兩筆結果，不再各自查），每支都各自 try/catch fail-open，鎖住時是**依序**各卡滿
// 一次 5 秒 statement_timeout 才降級到下一支 ≈ 10 秒（U-2 只改 statement_timeout 時
// 是 4 次 ≈ 20 秒、門檻 25 秒）。15 秒留約 50% 緩衝；若門檻又被打破，代表有人在
// authorize 熱路徑加回了第三次 Subject 查詢。
import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "pg";
import { Browser } from "../helpers/browser";
import { resetDb } from "../helpers/db";
import { signAuthSession, STUDENT } from "../helpers/session";
import { SESSION_COOKIE, HOST_SUFFIX, TEST_DATABASE_URL } from "../helpers/env";

describe("DB 卡住時 authorize 要快速 fail-open", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("Subject 被鎖住時，authorize 在 25 秒內回應且仍發出票", async () => {
    const locker = new Client({ connectionString: TEST_DATABASE_URL });
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query('LOCK TABLE "Subject" IN ACCESS EXCLUSIVE MODE');

    try {
      const browser = new Browser();
      browser.set(SESSION_COOKIE, await signAuthSession(STUDENT));

      const params = new URLSearchParams({
        service: "vote",
        redirect_uri: `http://vote.${HOST_SUFFIX}/api/auth/callback`,
        next: "/",
      });

      // 安全網：就算門檻斷言以外的地方出了回歸，也不要讓這個請求真的卡到全域
      // 30 秒 × 4 那麼久——28 秒硬中斷，確保下面的 finally 一定會準時把鎖放掉，
      // 不會拖累同一個檔案（fileParallelism:false）後面的測試。
      const start = Date.now();
      const res = await browser.fetch(`/api/auth/authorize?${params}`, {
        signal: AbortSignal.timeout(28_000),
      });
      const elapsed = Date.now() - start;
      const body = await res.text();

      expect(
        elapsed,
        `authorize 花了 ${elapsed}ms 才回應（DB 被鎖時應快速 fail-open，而不是等到舊的 30 秒 × 4 全域逾時）`,
      ).toBeLessThan(15_000);
      // 不只要「沒 500」——降級成 302 導回登入頁也會過那種弱斷言，測不到「有沒有真的發出票」。
      // fail-open 的重點是即使查不到 Grant／entryYear 也照樣簽出（預設權限的）token。
      expect(res.status).toBe(200);
      expect(body).toContain('name="token"');
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
    }
  });
});
