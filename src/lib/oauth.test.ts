import { describe, it, expect, vi } from "vitest";
import {
  decodeFlow,
  encodeFlow,
  flowCookieName,
  flowsToEvict,
  isAllowedRedirect,
  safeNextPath,
  OAUTH_FLOW_MAX,
  OAUTH_FLOW_PREFIX,
} from "./oauth";

/** 用指定的 AUTH_BASE_URL（決定 authConfig.cookieSecure）重新載入 lib/oauth.ts。 */
async function importOauthWith(baseUrl: string) {
  const prev = process.env.AUTH_BASE_URL;
  process.env.AUTH_BASE_URL = baseUrl;
  vi.resetModules();
  try {
    return await import("./oauth");
  } finally {
    process.env.AUTH_BASE_URL = prev;
  }
}

const BASE_URL = "http://auth.lvh.me:3000";

describe("進行中的 OAuth 流程（一條流程一顆 cookie）", () => {
  it("cookie 名稱帶 state，不同流程互不覆蓋", () => {
    expect(flowCookieName("abc")).toBe(`${OAUTH_FLOW_PREFIX}abc`);
    expect(flowCookieName("abc")).not.toBe(flowCookieName("abd"));
  });

  it("編碼後解得回來", () => {
    const flow = { v: "verifier-123", r: "https://portal.example/cb", t: 1_700_000_000 };
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
  });

  it("解不開的內容一律當作沒有這條流程（不要半信半疑地放行）", () => {
    expect(decodeFlow(undefined)).toBeNull();
    expect(decodeFlow("")).toBeNull();
    expect(decodeFlow("not json")).toBeNull();
    expect(decodeFlow(JSON.stringify({ v: 1, r: 2 }))).toBeNull();
    expect(decodeFlow(JSON.stringify({ v: "ok" }))).toBeNull(); // 缺 r
  });

  it("超過上限時淘汰最舊的，留下最新的幾條", () => {
    const cookies = Array.from({ length: 10 }, (_, i) => ({
      name: flowCookieName(`s${i}`),
      value: encodeFlow({ v: "v", r: "r", t: i }),
    }));
    const evicted = flowsToEvict(cookies);
    expect(evicted.length).toBe(10 - (OAUTH_FLOW_MAX - 1));
    // 留下來的必須是 t 最大的那幾條
    expect(evicted).toContain(flowCookieName("s0"));
    expect(evicted).not.toContain(flowCookieName("s9"));
  });

  it("沒超過上限就不動任何東西", () => {
    const cookies = [
      { name: flowCookieName("a"), value: encodeFlow({ v: "v", r: "r", t: 1 }) },
      { name: flowCookieName("b"), value: encodeFlow({ v: "v", r: "r", t: 2 }) },
    ];
    expect(flowsToEvict(cookies)).toEqual([]);
  });

  it("不碰其他 cookie（登入態、語言偏好之類的）", () => {
    const cookies = [
      { name: "tpass_auth_session", value: "jwt" },
      { name: "unrelated", value: "x" },
      ...Array.from({ length: 10 }, (_, i) => ({
        name: flowCookieName(`s${i}`),
        value: encodeFlow({ v: "v", r: "r", t: i }),
      })),
    ];
    const evicted = flowsToEvict(cookies);
    expect(evicted.every((n) => n.startsWith(OAUTH_FLOW_PREFIX))).toBe(true);
  });

  it("壞掉的流程 cookie 優先被淘汰（t 當 0）", () => {
    const cookies = [
      { name: flowCookieName("broken"), value: "garbage" },
      ...Array.from({ length: OAUTH_FLOW_MAX }, (_, i) => ({
        name: flowCookieName(`ok${i}`),
        value: encodeFlow({ v: "v", r: "r", t: 100 + i }),
      })),
    ];
    expect(flowsToEvict(cookies)).toContain(flowCookieName("broken"));
  });
});

describe("isAllowedRedirect（Open Redirect 防線）", () => {
  // 這支讀 authConfig.allowedHostSuffix，測試環境由 vitest setup 前的 env 決定；
  // 這裡只驗「明顯該擋的形狀一定擋」，不依賴特定網域設定。
  it("非 http/https 一律擋", () => {
    expect(isAllowedRedirect("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirect("data:text/html,<script>")).toBe(false);
    expect(isAllowedRedirect("file:///etc/passwd")).toBe(false);
  });

  it("不是網址的字串一律擋", () => {
    expect(isAllowedRedirect("")).toBe(false);
    expect(isAllowedRedirect("//evil.example/cb")).toBe(false);
    expect(isAllowedRedirect("/relative/path")).toBe(false);
  });
});

describe("isAllowedRedirect（A1-7：正式環境只放行 https）", () => {
  // authConfig.cookieSecure（= AUTH_BASE_URL 是不是 https）就是這個 codebase 對「正式」
  // 的既有定義（見 config/auth.ts 對 cookieSecure 的註解），本機／測試 baseUrl 是 http
  // 時維持兩者皆放行——不然這個檔案上面那些用 http fixture 的測試全部會被自己的修正擋下。
  it("正式（baseUrl 是 https）：http 的 redirect_uri 被擋，票不會被明文 form POST 出去", async () => {
    const { isAllowedRedirect: prodIsAllowed } = await importOauthWith("https://auth.tpass.test");
    expect(prodIsAllowed("http://vote.tpass.test/callback")).toBe(false);
    expect(prodIsAllowed("https://vote.tpass.test/callback")).toBe(true);
  });

  it("本機／測試（baseUrl 是 http）：http 的 redirect_uri 照常放行", async () => {
    const { isAllowedRedirect: devIsAllowed } = await importOauthWith("http://localhost:3000");
    expect(devIsAllowed("http://vote.tpass.test/callback")).toBe(true);
  });
});

describe("safeNextPath（A4-1 補修：next 輸出正規化路徑並擋 //）", () => {
  // origin 比對這一關會通過（`..`／反斜線／百分號編碼被正規化收斂後，
  // pathname 變成 `//evil.example`，但這個結果仍落在站內 origin），
  // 必須靠「輸出不可以 `//` 開頭」這第二道關卡擋下。
  it("正規化後 pathname 收斂成 // 開頭的變體，一律視為不合法", () => {
    const evil = [
      "/..//evil.example",
      "/./..//evil.example",
      "/a/../..//evil.example",
      "/../\\evil.example",
      "/%2e%2e//evil.example",
      "/..\\/evil.example",
    ];
    for (const next of evil) {
      expect(safeNextPath(next, BASE_URL), `next=${next} 沒被擋`).toBe("");
    }
  });

  it("一般的 .. 路徑正常收斂", () => {
    expect(safeNextPath("/a/../b", BASE_URL)).toBe("/b");
  });

  it("看起來像但不是 // 開頭的路徑照樣放行", () => {
    expect(safeNextPath("/...//x", BASE_URL)).toBe("/...//x");
  });

  it("保留 query string 與 hash", () => {
    expect(safeNextPath("/e/abc?x=1#y", BASE_URL)).toBe("/e/abc?x=1#y");
  });

  it("是不動點：對輸出再跑一次結果不變", () => {
    const inputs = ["/a/../b", "/...//x", "/e/abc?x=1#y", "/dashboard"];
    for (const x of inputs) {
      const once = safeNextPath(x, BASE_URL);
      expect(safeNextPath(once, BASE_URL)).toBe(once);
    }
  });

  it("跑出站內 origin 的一律擋", () => {
    expect(safeNextPath("https://evil.example", BASE_URL)).toBe("");
    expect(safeNextPath("evil", BASE_URL)).toBe("");
  });

  it("不是以單一 / 開頭一律擋", () => {
    expect(safeNextPath("//evil.example", BASE_URL)).toBe("");
    expect(safeNextPath("relative", BASE_URL)).toBe("");
  });
});
