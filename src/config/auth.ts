// 設定中心：所有可變設定一律從這裡讀（process.env）。
// 換驗證對象 / 上線開跨子網域 = 只改環境變數，其他檔案只 import 這個物件。
import "server-only";
import { consumerServiceIds } from "@/lib/registry";

// 必填 env：缺任何一個就在啟動時明確報出，不默默用 undefined 跑下去。
// 服務白名單刻意不在這裡——它來自 tpass-registry（見下方 serviceIds）。
const REQUIRED = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_BASE_URL",
  "AUTH_ALLOWED_HOST_SUFFIX",
  "AUTH_ALLOWED_EMAIL_DOMAIN",
  "PORTAL_URL",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "JWT_ISSUER",
  "JWT_TTL_SECONDS",
  "DATABASE_URL",
  "AUTH_SUPERADMINS",
] as const;

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(
    `[config/auth] 缺少必填環境變數：${missing.join(", ")}（請檢查 .env.local）`,
  );
}

// 簽章用的 kid。未設 env 時沿用舊值——既有部署不改任何東西，行為完全不變。
const signingKid = process.env.JWT_KID || "tpass-key-1";

// JWKS 要公開的公鑰清單。平常只有一把（目前簽章用的那把）；輪替期間
// （JWT_PREV_PUBLIC_KEY 與 JWT_PREV_KID 都設了）再加上舊鑰供驗章 overlap，
// 讓「舊鑰簽出、尚未過期」的 token 在整段 TTL 內仍驗得過。兩者皆未設 = 與輪替前一致。
//
// 為什麼 kid 一定要跟著走：消費端用 jose 的 createRemoteJWKSet，是**依 header 的 kid**
// 從 JWKS 選鑰的。兩把公鑰共用同一個 kid 會讓消費端選錯鑰而驗不過。
const publicKeys: { kid: string; pem: string }[] = [
  { kid: signingKid, pem: process.env.JWT_PUBLIC_KEY! },
];
if (process.env.JWT_PREV_PUBLIC_KEY && process.env.JWT_PREV_KID) {
  if (process.env.JWT_PREV_KID === signingKid) {
    throw new Error(
      "[config/auth] JWT_PREV_KID 不可與 JWT_KID 相同——消費端依 kid 選鑰，撞名會選錯把。",
    );
  }
  publicKeys.push({
    kid: process.env.JWT_PREV_KID,
    pem: process.env.JWT_PREV_PUBLIC_KEY,
  });
}

// auth 登入態 TTL 預設 12h：選填 env，沒設就用這個（不像 per-service TTL 那樣逼你想清楚）。
const DEFAULT_SESSION_TTL_SECONDS = 43200;

const baseUrl = process.env.AUTH_BASE_URL!;

// A1-11：AUTH_BASE_URL 打錯（漏了子網域、抄到別的網域）不該悄悄跑起來——cookie／
// redirect_uri／JWKS url 全部繞著它建，錯了要在啟動時就 throw，不要等部署後才被
// 使用者回報「登入轉圈圈」。本機／整合測試用 loopback（127.0.0.1／localhost）跑，
// 那是開發慣用的跑法，不代表設定錯誤，不受這條限制。
{
  const baseUrlHost = new URL(baseUrl).hostname;
  const suffix = process.env.AUTH_ALLOWED_HOST_SUFFIX!;
  const isLoopback = baseUrlHost === "localhost" || baseUrlHost === "127.0.0.1" || baseUrlHost === "::1";
  const isUnderSuffix = baseUrlHost === suffix || baseUrlHost.endsWith("." + suffix);
  if (!isLoopback && !isUnderSuffix) {
    throw new Error(
      `[config/auth] AUTH_BASE_URL 的 host（${baseUrlHost}）不在 AUTH_ALLOWED_HOST_SUFFIX（${suffix}）底下`,
    );
  }
}

export const authConfig = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    // Google Cloud 後台登記的 redirect URI 必須與此完全一致。
    redirectUri: `${baseUrl}/api/auth/callback/google`,
  },
  baseUrl,
  // 由 origin 是否為 https 推導 Secure：localhost(http) 不設，正式(https) 必設。
  // 所有 cookie（auth 自己的 session、OAuth state 暫存）共用這個推導值。
  cookieSecure: baseUrl.startsWith("https://"),
  // v2：auth 自己的登入態，host-only（不設 Domain）——只有 auth 網域收得到，
  // 縮小外洩半徑：任何子網域被攻破都拿不到這顆 cookie。
  sessionCookieName: "tpass_auth_session",
  // v2：可申請 per-service token 的服務 id 白名單，來自 tpass-registry（唯一真相）。
  // 每個服務拿到的 token aud=tpass:<id>，只在該服務有效——單一服務被攻破不再等於全生態淪陷。
  // ⚠️ 刻意不吃 env override：主機上那把手寫的舊清單會靜默蓋掉 registry，
  //    正是這次要消滅的「登記了卻沒生效」那類 bug。要改白名單就改 registry。
  serviceIds: consumerServiceIds,
  // 逃生門：生態總管，恆為所有服務 admin、不進 DB、DB 掛掉照樣有效。
  // 逗號分隔 email；一律小寫正規化（跟 Subject.email 查找鍵一致）。
  superadmins: process.env.AUTH_SUPERADMINS!
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  // Phase 4：哪些服務的 per-service token 帶「全服務 permissions map」而非只有自己一把 key。
  // 目前只有大廳（portal）需要——顯示各服務 ban/warning 徽章與「權限管理」卡。
  // 選填，預設 ["portal"]；逗號分隔。
  overviewServiceIds: (process.env.AUTH_OVERVIEW_SERVICE_IDS ?? "portal")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // /denied 頁「申訴」按鈕的連結；選填，未設就不顯示該按鈕。
  appealUrl: process.env.AUTH_APPEAL_URL || undefined,
  // redirect_uri 白名單的根網域。比對時用 host === base || host.endsWith('.'+base)。
  allowedHostSuffix: process.env.AUTH_ALLOWED_HOST_SUFFIX!,
  // 只放行此 email 網域（不含 @）。
  allowedEmailDomain: process.env.AUTH_ALLOWED_EMAIL_DOMAIN!.toLowerCase(),
  // 門戶大廳網址。auth 本身不是使用者的目的地——被單獨訪問（沒帶 redirect_uri）時，
  // 登入完就把人送回門戶，而不是停在 auth 自己頁面。env 驅動，絕不寫死網域。
  portalUrl: process.env.PORTAL_URL!,
  jwt: {
    privateKeyPem: process.env.JWT_PRIVATE_KEY!,
    // 目前簽章用的 kid，與 JWKS 公開的公鑰清單（輪替期間會有兩把）。
    signingKid,
    publicKeys,
    issuer: process.env.JWT_ISSUER!,
    ttlSeconds: Number(process.env.JWT_TTL_SECONDS!),
    // auth 自己登入態的 TTL（長，選填）：這是「還算登入」的期間，跟 per-service
    // token 的 45min 語意不同——太短會逼使用者對每個服務都重跑一次 Google OAuth。
    sessionTtlSeconds: Number(
      process.env.AUTH_SESSION_TTL_SECONDS ?? DEFAULT_SESSION_TTL_SECONDS,
    ),
  },
} as const;

export type AuthConfig = typeof authConfig;
