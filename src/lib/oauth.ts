// Arctic Google client（薄層 OAuth），login 與 callback 共用同一個設定來源。
import "server-only";
import { Google } from "arctic";
import { authConfig } from "@/config/auth";

export const google = new Google(
  authConfig.google.clientId,
  authConfig.google.clientSecret,
  authConfig.google.redirectUri,
);

// redirect_uri 白名單比對（安全關鍵，防 Open Redirect）。
// 必須是 host === base 或 host 以 '.'+base 結尾；
// 不可用裸 hostname.endsWith(base)，否則 evil-localhost / localhost.attacker.com 會通過。
export function isAllowedRedirect(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  const base = authConfig.allowedHostSuffix;
  return host === base || host.endsWith("." + base);
}

// ── 進行中的 OAuth 流程 ────────────────────────────────────────────────
//
// 一條流程一顆 cookie，名稱帶 state：`oauth_flow_<state>`。
//
// 為什麼不是固定名稱的三顆 cookie（舊做法）：那樣同一個瀏覽器只能有**一條**進行中的
// 登入流程。使用者同時開 portal、form、vote 三個分頁（或等 Google 太久又按了一次登入），
// 後開的流程會把先開的 state/verifier 蓋掉，先回來的那個分頁必然撞上
// 「Invalid OAuth state」黑畫面。人一多，有人剛好開兩個分頁的機率接近 1，
// 看起來就像「同時登入會爆」。tests/integration/oauth-state.test.ts 守著這件事。
//
// CSRF 防護不變：state 由伺服器產生、不可預測，且對應的 cookie 是 HttpOnly、
// 綁在這個瀏覽器上。攻擊者拿自己的 state 誘導受害者回 callback 時，受害者瀏覽器
// 沒有那顆 cookie，一樣擋下。
export const OAUTH_FLOW_PREFIX = "oauth_flow_";
/** 同時最多保留幾條進行中的流程；超過就淘汰最舊的，避免狂點登入把 cookie header 撐爆。 */
export const OAUTH_FLOW_MAX = 6;
/** 一條流程的有效期。使用者在 Google 那邊選帳號、輸密碼、過 2FA 可能不只 10 分鐘。 */
export const OAUTH_FLOW_TTL_SECONDS = 900;

export interface OAuthFlow {
  /** PKCE code verifier。 */
  v: string;
  /** 登入完成後要導回的網址（已過白名單）。 */
  r: string;
  /** 發起時間（Unix 秒），用來淘汰最舊的流程。 */
  t: number;
}

export function flowCookieName(state: string): string {
  return OAUTH_FLOW_PREFIX + state;
}

export function encodeFlow(flow: OAuthFlow): string {
  return JSON.stringify(flow);
}

export function decodeFlow(raw: string | undefined): OAuthFlow | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthFlow;
    if (typeof parsed?.v !== "string" || typeof parsed?.r !== "string") return null;
    return { v: parsed.v, r: parsed.r, t: typeof parsed.t === "number" ? parsed.t : 0 };
  } catch {
    return null;
  }
}

/**
 * 從現有 cookie 挑出該淘汰的流程名稱：保留最新的 keep 條，其餘（含解不開的）回傳。
 * 純函式，方便單元測試。
 */
export function flowsToEvict(
  cookies: { name: string; value: string }[],
  keep = OAUTH_FLOW_MAX - 1,
): string[] {
  const flows = cookies
    .filter((c) => c.name.startsWith(OAUTH_FLOW_PREFIX))
    .map((c) => ({ name: c.name, t: decodeFlow(c.value)?.t ?? 0 }))
    .sort((a, b) => b.t - a.t);
  return flows.slice(Math.max(0, keep)).map((f) => f.name);
}

// 舊版（單一流程）的 cookie 名稱。保留只為了部署當下「正在進行中」的登入不要整批壞掉；
// 等所有人的舊 cookie 都過期（≤10 分鐘）之後可以連同 callback 裡的相容分支一起刪。
export const OAUTH_COOKIES = {
  state: "oauth_state",
  verifier: "oauth_verifier",
  redirect: "oauth_redirect",
} as const;
