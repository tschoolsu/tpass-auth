// 「Invalid OAuth state」黑畫面的重現與回歸測試。
//
// 症狀（2026 年，多人同時登入時）：使用者從 Google 回來看到黑底白字的 400 Invalid OAuth state。
// 本質不是併發量的問題，而是**同一個瀏覽器只能有一條進行中的登入流程**：
// login 把 state/verifier 寫在固定名稱的 cookie 上，第二條流程一開始就把第一條蓋掉，
// 第一條回來時 `state !== cookieState`。
//
// 什麼時候會有第二條流程？非常日常：
//   - 同時開了 portal、form、vote 三個分頁，每個都未登入 → 三條 authorize→login
//   - 等 Google 太久又回頭按了一次登入
//   - 手機上點連結、切出去、再點一次
// 人一多，「有人剛好開了兩個分頁」的機率就接近 1，看起來就像「同時登入會爆」。
import { describe, it, expect, beforeAll } from "vitest";
import { Browser } from "../helpers/browser";
import { APP_URL, HOST_SUFFIX, PORTAL_URL } from "../helpers/env";

/** 從 login 的 302 取出 Google 授權網址裡的 state。 */
function stateOf(res: Response): string {
  const location = res.headers.get("location");
  expect(location, "login 沒有導向 Google").toBeTruthy();
  const url = new URL(location!);
  const state = url.searchParams.get("state");
  expect(state, "Google 授權網址裡沒有 state").toBeTruthy();
  return state!;
}

/** 模擬「從 Google 回來」：帶著 code 與 state 打 callback。 */
function callback(browser: Browser, state: string, code = "fake-auth-code") {
  return browser.fetch(
    `/api/auth/callback/google?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
  );
}

describe("Google OAuth 的 state 處理", () => {
  beforeAll(async () => {
    const res = await fetch(`${APP_URL}/.well-known/jwks.json`);
    expect(res.status, "測試 auth 實例沒起來").toBe(200);
  });

  it("單一流程：state 帶回來時能通過 state 檢查", async () => {
    const browser = new Browser();
    const login = await browser.fetch(`/api/auth/login?redirect_uri=${encodeURIComponent(PORTAL_URL)}`);
    const state = stateOf(login);

    const res = await callback(browser, state);
    // 我們沒有真的去 Google 換 code，所以一定失敗——但**不該是** state 檢查失敗。
    // state 檢查過了才會走到「換 token」那一步，那一步的失敗是導回 /?error=oauth。
    expect(res.status, "state 檢查沒過（回了 400 Invalid OAuth state）").not.toBe(400);
    expect(res.headers.get("location")).toContain("error=oauth");
  });

  it("兩個分頁同時登入：先開的那個分頁回來時不該壞掉", async () => {
    const browser = new Browser(); // 同一個瀏覽器＝同一個 cookie jar

    // 分頁 A 先開始（例如點了 portal 的登入）
    const loginA = await browser.fetch(`/api/auth/login?redirect_uri=${encodeURIComponent(PORTAL_URL)}`);
    const stateA = stateOf(loginA);

    // 分頁 B 隨後開始（例如另一個分頁的 vote 也要登入）
    const loginB = await browser.fetch(
      `/api/auth/login?redirect_uri=${encodeURIComponent(`http://vote.${HOST_SUFFIX}/`)}`,
    );
    const stateB = stateOf(loginB);
    expect(stateA).not.toBe(stateB);

    // 使用者在分頁 A 完成 Google 登入，先回來的是 A
    const resA = await callback(browser, stateA);
    expect(
      resA.status,
      "分頁 A 回來時被判 Invalid OAuth state——這就是使用者看到的黑畫面",
    ).not.toBe(400);

    // 接著分頁 B 也回來，同樣不該壞
    const resB = await callback(browser, stateB);
    expect(resB.status, "分頁 B 回來時被判 Invalid OAuth state").not.toBe(400);
  });

  it("五個分頁同時登入：每一條都要能通過 state 檢查", async () => {
    const browser = new Browser();
    const states: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await browser.fetch(
        `/api/auth/login?redirect_uri=${encodeURIComponent(`http://svc${i}.${HOST_SUFFIX}/`)}`,
      );
      states.push(stateOf(res));
    }
    expect(new Set(states).size, "每條流程的 state 應該都不同").toBe(5);

    const results = await Promise.all(states.map((s) => callback(browser, s)));
    const broken = results.filter((r) => r.status === 400).length;
    expect(broken, `${broken}/5 條流程撞上 Invalid OAuth state`).toBe(0);
  });

  it("並行發起的登入流程也不會互相蓋掉", async () => {
    const browser = new Browser();
    const logins = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        browser.fetch(`/api/auth/login?redirect_uri=${encodeURIComponent(`http://p${i}.${HOST_SUFFIX}/`)}`),
      ),
    );
    const states = logins.map(stateOf);
    const results = await Promise.all(states.map((s) => callback(browser, s)));
    expect(results.filter((r) => r.status === 400).length).toBe(0);
  });

  it("偽造的 state（沒經過 login）一律擋下——CSRF 防護還在", async () => {
    const browser = new Browser();
    await browser.fetch(`/api/auth/login?redirect_uri=${encodeURIComponent(PORTAL_URL)}`);

    const res = await callback(browser, "attacker-made-up-state");
    expect(res.status, "來路不明的 state 竟然通過了 state 檢查").toBe(400);
  });

  it("完全沒跑過 login 就直接打 callback：擋下", async () => {
    const browser = new Browser();
    const res = await callback(browser, "whatever");
    expect(res.status).toBe(400);
  });

  it("缺 code 或缺 state 一律擋下", async () => {
    const browser = new Browser();
    const login = await browser.fetch(`/api/auth/login?redirect_uri=${encodeURIComponent(PORTAL_URL)}`);
    const state = stateOf(login);

    expect((await browser.fetch(`/api/auth/callback/google?state=${state}`)).status).toBe(400);
    expect((await browser.fetch(`/api/auth/callback/google?code=x`)).status).toBe(400);
  });

  it("放太久的登入流程會過期（使用者停在 Google 畫面太久）", async () => {
    const browser = new Browser();
    const login = await browser.fetch(`/api/auth/login?redirect_uri=${encodeURIComponent(PORTAL_URL)}`);
    const state = stateOf(login);

    // 把這條流程的所有 cookie 都往前調 20 分鐘，模擬使用者在 Google 那邊卡很久。
    for (const name of browser.names()) browser.ageCookie(name, 1200);

    const res = await callback(browser, state);
    expect(res.status, "過期的流程應該被擋下（而不是放行）").toBe(400);
  });
});
