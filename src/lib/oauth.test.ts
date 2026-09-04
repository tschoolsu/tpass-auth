import { describe, it, expect } from "vitest";
import {
  decodeFlow,
  encodeFlow,
  flowCookieName,
  flowsToEvict,
  isAllowedRedirect,
  OAUTH_FLOW_MAX,
  OAUTH_FLOW_PREFIX,
} from "./oauth";

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
