// GET /api/auth/authorize?service=<id>&redirect_uri=<消費端 callback>&next=<站內路徑>
// 契約 v2 的核心：有 auth 登入態就簽一顆 aud=tpass:<id> 的 per-service token，
// 用自動送出的 form POST 交給消費端 callback（token 不進 URL / Referer / 瀏覽器歷史）；
// 沒有登入態就先走既有 Google OAuth，回來再繼續（redirect_uri 指回本 route）。
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/config/auth";
import { isAllowedRedirect } from "@/lib/oauth";
import { getSession, signServiceToken } from "@/lib/session";
import { permissionsFor } from "@/lib/permissions/resolve";

export const runtime = "nodejs";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const serviceId = params.get("service") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  const next = params.get("next") ?? "/";

  // 這三道檢查失敗時，撞到的一定是**人**（authorize 是瀏覽器頂層導航），
  // 所以導去 on-brand 的說明頁而不是回裸文字——原本使用者只看得到白底一行英文。
  // reason 只帶固定代號，不回吐使用者送進來的值（避免把反射內容塞進頁面）。
  //
  // 排錯指示走 log、不走畫面（B4）：撞到這一頁的是學生，需要指示的是串接的部員。
  const FIX_HINT: Record<string, string> = {
    "unknown-service":
      "把這個服務 id 登記進 tpass-registry 的 services.json（開 PR），merge 後重新部署 auth 即生效。",
    "invalid-redirect":
      "redirect_uri 必須位於 AUTH_ALLOWED_HOST_SUFFIX 的網域底下（scheme 與 port 也要對）。",
    "invalid-next": "next 必須是以單一斜線開頭的站內路徑，例如 /dashboard。",
  };
  const reject = (reason: string) => {
    console.warn(
      `[authorize] 擋下一次授權請求：${reason}\n` +
        `  service=${serviceId} redirect_uri=${redirectUri} next=${next}\n` +
        `  串接者：${FIX_HINT[reason] || "檢查 authorize 的 service / redirect_uri / next 三個參數。"}`,
    );
    const url = new URL("/service-error", authConfig.baseUrl);
    url.searchParams.set("reason", reason);
    return NextResponse.redirect(url);
  };

  // 服務白名單：不認識的 service id 一律拒絕（env 驅動，新增服務只改 env）。
  if (!authConfig.serviceIds.includes(serviceId)) {
    return reject("unknown-service");
  }
  // callback 位址必須在生態系根網域白名單內（同 login 的 Open Redirect 防線）。
  if (!redirectUri || !isAllowedRedirect(redirectUri)) {
    return reject("invalid-redirect");
  }
  // next 只能是站內路徑（消費端 callback 會拿它做最後跳轉，不能被塞外部網址）。
  if (!next.startsWith("/") || next.startsWith("//")) {
    return reject("invalid-next");
  }

  const session = await getSession();
  if (!session) {
    // 沒登入 → 走既有 OAuth，完成後回到本 route 再發 token。
    const backHere = new URL("/api/auth/authorize", authConfig.baseUrl);
    backHere.searchParams.set("service", serviceId);
    backHere.searchParams.set("redirect_uri", redirectUri);
    backHere.searchParams.set("next", next);
    const login = new URL("/api/auth/login", authConfig.baseUrl);
    login.searchParams.set("redirect_uri", backHere.toString());
    return NextResponse.redirect(login);
  }

  // ban 攔截：查該人在這個服務的權限，read===false（restriction=ban 且未過期）就不簽 token，
  // 直接導去 /denied——reason 絕不放進這裡的 query string，/denied 自己憑 session 重查。
  const perm = await permissionsFor(session.email, serviceId);
  if (!perm.read) {
    const denied = new URL("/denied", authConfig.baseUrl);
    denied.searchParams.set("service", serviceId);
    return NextResponse.redirect(denied);
  }

  // 重簽新 token（丟掉舊 exp，讓 per-service token 拿到完整 TTL）。
  // permissions 由 signServiceToken 依 serviceId 查（DB），不從 auth 登入態帶（登入態 permissions 恆空）。
  const token = await signServiceToken(
    {
      sub: session.sub,
      email: session.email,
      name: session.name,
    },
    serviceId,
  );

  // form_post：token 走 POST body，不落 URL。JS 自動送出；無 JS 給一顆按鈕。
  const html = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><title>T-Pass 轉導中…</title></head>
<body onload="document.forms[0].submit()">
<form method="post" action="${escapeHtml(redirectUri)}">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<input type="hidden" name="next" value="${escapeHtml(next)}">
<noscript><button type="submit">繼續前往服務</button></noscript>
</form>
</body></html>`;
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}
