// U-2：DB 卡住時，authorize 要快速 fail-open，不能讓使用者等到全域 30 秒逾時。
// 用外部 pg 連線把 Subject 鎖住（模擬「已拿到連線、查詢卡住」的情境），
// 打一次 authorize，斷言回應時間遠短於舊的 30 秒全域逾時。
//
// 門檻是 25 秒而不是最初設想的 10 秒：authorize 一次會依序打 4 次會 join 到
// Subject 的查詢（getSession 的 findSubjectByEmail、permissionsFor 的 findGrant
// ×2、signServiceToken 補 entryYearOverride 的 findSubjectByEmail），每支都各自
// try/catch fail-open，鎖住時是**依序**各卡滿一次 statement_timeout 才降級到下一
// 支——4 支好棒 × 5 秒 statement_timeout ≈ 20 秒，是這次「只改 statement_timeout
// 一個全域參數」能做到的下限（實測 4 次樣本 20.4～20.7 秒，25 秒留約 20% 緩衝）。
// 要壓到 10 秒得動 authorize 的呼叫序（去重複的 permissionsFor、合併查詢），
// 那是另一個問題，不在這次 U-2 的範圍內（見 fix 的 commit message）。
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
      ).toBeLessThan(25_000);
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
