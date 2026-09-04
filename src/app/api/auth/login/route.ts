// GET /api/auth/login — 啟動 Google OAuth 流程。
import { NextResponse, type NextRequest } from "next/server";
import { generateState, generateCodeVerifier } from "arctic";
import { authConfig } from "@/config/auth";
import {
  google,
  isAllowedRedirect,
  encodeFlow,
  flowCookieName,
  flowsToEvict,
  OAUTH_FLOW_TTL_SECONDS,
} from "@/lib/oauth";

export const runtime = "nodejs";

// 短效暫存 cookie：HttpOnly + SameSite=Lax。
// 必 Lax 不可 Strict——Strict 時從 Google 跳回瀏覽器不會帶這些 cookie，登入會壞。
const tempCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: OAUTH_FLOW_TTL_SECONDS,
  secure: authConfig.cookieSecure,
};

export async function GET(request: NextRequest) {
  // 登入成功後要導回哪裡。外部傳入的值要過白名單（防 Open Redirect）；
  // 沒帶（被單獨訪問）就用信任的預設值＝門戶大廳，不必也不該被 suffix 白名單擋。
  const requested = request.nextUrl.searchParams.get("redirect_uri");
  if (requested && !isAllowedRedirect(requested)) {
    return new NextResponse("Invalid redirect_uri", { status: 400 });
  }
  const redirectUri = requested ?? authConfig.portalUrl;

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const authUrl = google.createAuthorizationURL(state, codeVerifier, [
    "openid",
    "email",
    "profile",
  ]);
  // 讓 Google 帳號選擇器只顯示本網域帳號（UX 過濾）。真正的安全閘門仍是
  // callback 端的 email 網域驗證——hd 只是提示，不可當作唯一防線。
  authUrl.searchParams.set("hd", authConfig.allowedEmailDomain);

  const response = NextResponse.redirect(authUrl);

  // 一條流程一顆 cookie（名稱帶 state），多個分頁同時登入才不會互相蓋掉——
  // 這正是「Invalid OAuth state」黑畫面的成因，見 lib/oauth.ts 的說明。
  response.cookies.set(
    flowCookieName(state),
    encodeFlow({ v: codeVerifier, r: redirectUri, t: Math.floor(Date.now() / 1000) }),
    tempCookieOptions,
  );

  // 狂點登入不該把 cookie header 撐爆：超過上限就淘汰最舊的幾條。
  for (const name of flowsToEvict(request.cookies.getAll())) {
    response.cookies.delete(name);
  }

  return response;
}
