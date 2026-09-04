// GET /api/auth/callback/google — Google 授權後跳回，換 token、發 T-Pass 通行證。
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/config/auth";
import {
  google,
  isAllowedRedirect,
  decodeFlow,
  flowCookieName,
  OAUTH_COOKIES,
} from "@/lib/oauth";
import {
  resolveClaims,
  signAuthSession,
  type GoogleProfile,
} from "@/lib/session";
import { upsertSubjectOnLogin } from "@/lib/permissions/repo";

export const runtime = "nodejs";

const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

// 登入失敗時導回登入頁並帶錯誤碼。
function fail(reason: string) {
  return NextResponse.redirect(
    new URL(`/?error=${reason}`, authConfig.baseUrl),
  );
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");

  if (!code || !state) {
    return new NextResponse("Invalid OAuth state", { status: 400 });
  }

  // CSRF 防護：這條流程的 cookie（名稱帶 state）必須存在於這個瀏覽器。
  // state 由伺服器產生且不可預測，攻擊者拿自己的 state 誘導受害者回來時，
  // 受害者瀏覽器沒有對應的 cookie，一樣擋下。
  //
  // 一條流程一顆 cookie 的用意是讓多分頁同時登入不互相蓋掉——舊版用固定名稱，
  // 後開的流程會覆蓋先開的，先回來的分頁必然看到「Invalid OAuth state」。
  const flow = decodeFlow(request.cookies.get(flowCookieName(state))?.value);

  // 相容分支：部署當下已經在進行中的登入流程用的是舊版三顆固定 cookie。
  // 等舊 cookie 全部過期（≤10 分鐘）之後可以連同 lib/oauth.ts 的 OAUTH_COOKIES 一起刪。
  const legacyState = request.cookies.get(OAUTH_COOKIES.state)?.value;
  const legacyVerifier = request.cookies.get(OAUTH_COOKIES.verifier)?.value;
  const legacy =
    !flow && legacyState === state && legacyVerifier
      ? { v: legacyVerifier, r: request.cookies.get(OAUTH_COOKIES.redirect)?.value ?? "", t: 0 }
      : null;

  const resolved = flow ?? legacy;
  if (!resolved) {
    return new NextResponse("Invalid OAuth state", { status: 400 });
  }
  const codeVerifier = resolved.v;
  const storedRedirect = resolved.r;

  // redirect_uri 在 login 時已驗過，這裡再驗一次（cookie 可能被竄改），不合法則回門戶大廳。
  const redirectTarget =
    storedRedirect && isAllowedRedirect(storedRedirect)
      ? storedRedirect
      : authConfig.portalUrl;

  // 用 codeVerifier 換 token。
  let accessToken: string;
  try {
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    accessToken = tokens.accessToken();
  } catch {
    return fail("oauth");
  }

  // 取使用者資料：打 userinfo endpoint（不手動解 id_token）。
  let profile: GoogleProfile;
  try {
    const res = await fetch(GOOGLE_USERINFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return fail("oauth");
    profile = (await res.json()) as GoogleProfile;
  } catch {
    return fail("oauth");
  }

  // Email 網域過濾（安全關鍵）：必須是已驗證信箱，且網域相符。
  // 用 '@'+domain 比對，避免 evilchen.zone 這種後綴繞過。
  const email = profile.email?.toLowerCase() ?? "";
  if (
    !profile.email_verified ||
    !email.endsWith("@" + authConfig.allowedEmailDomain)
  ) {
    return fail("domain");
  }

  const claims = resolveClaims(profile);

  // 回填 Subject（email/sub/name/lastSeenAt）：非阻斷，DB 寫入失敗只 log，登入照常完成——
  // 這只是權限系統的輔助資料（讓 panel 認得出這個人已登入過），不是登入本身的必要條件。
  try {
    await upsertSubjectOnLogin({ email: claims.email, sub: claims.sub, name: claims.name });
  } catch (err) {
    console.error("[callback] upsert Subject 失敗（非阻斷，登入照常完成）：", err);
  }

  const response = NextResponse.redirect(redirectTarget);

  // v2：auth 自己的登入態，host-only（不設 Domain）——只有 auth 網域收得到。
  response.cookies.set(authConfig.sessionCookieName, await signAuthSession(claims), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // TTL 用 sessionTtlSeconds——跟 signAuthSession 簽的 exp 對齊，
    // 不能沿用 per-service 的 ttlSeconds（否則 cookie 45min 就先於 JWT 過期消失）。
    maxAge: authConfig.jwt.sessionTtlSeconds,
    secure: authConfig.cookieSecure,
  });

  // 清掉這條流程的暫存 cookie（其他分頁還沒回來的流程不動它們，各自 TTL 到期自然消失）。
  response.cookies.delete(flowCookieName(state));
  // 舊版固定名稱的三顆，順手一併清掉。
  response.cookies.delete(OAUTH_COOKIES.state);
  response.cookies.delete(OAUTH_COOKIES.verifier);
  response.cookies.delete(OAUTH_COOKIES.redirect);
  return response;
}
