// 整合測試的固定設定。所有 port、網址、資料庫集中在這裡，測試檔不自己拼字串。
import path from "node:path";
import { TEST_KID, TEST_PRIVATE_KEY_PEM, TEST_PUBLIC_KEY_PEM } from "./test-keys";

export const TEST_PORT = 3900;
export const APP_URL = `http://127.0.0.1:${TEST_PORT}`;

// redirect_uri 白名單的根網域。測試用的消費端網址都掛在它底下——
// isAllowedRedirect 只比對 hostname，不會真的去連，所以不需要這些主機存在。
export const HOST_SUFFIX = "tpass.test";
export const PORTAL_URL = `http://portal.${HOST_SUFFIX}/`;
export const EMAIL_DOMAIN = "school.test";

export const ISSUER = "https://auth.tpass.test";
export const SESSION_COOKIE = "tpass_auth_session";
export const TTL_SECONDS = 2700;
export const SESSION_TTL_SECONDS = 43200;

export const SUPERADMIN_EMAIL = `boss@${EMAIL_DOMAIN}`;

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://t_auth@localhost:5432/t_auth_test";

// 測試 server 的 pid / log 落地位置（.next 已被 gitignore）。
export const APP_PID_FILE = ".next/.test-app.pid";
export const APP_LOG_FILE = ".next/.test-app.log";

/** 跑測試 auth 實例要吃的一整包 env。Google 憑證是假的——測試不會真的走到 Google。 */
export function testEnv(): Record<string, string> {
  return {
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    AUTH_BASE_URL: APP_URL,
    AUTH_ALLOWED_HOST_SUFFIX: HOST_SUFFIX,
    AUTH_ALLOWED_EMAIL_DOMAIN: EMAIL_DOMAIN,
    PORTAL_URL,
    JWT_PRIVATE_KEY: TEST_PRIVATE_KEY_PEM,
    JWT_PUBLIC_KEY: TEST_PUBLIC_KEY_PEM,
    JWT_KID: TEST_KID,
    JWT_ISSUER: ISSUER,
    JWT_TTL_SECONDS: String(TTL_SECONDS),
    AUTH_SESSION_TTL_SECONDS: String(SESSION_TTL_SECONDS),
    DATABASE_URL: TEST_DATABASE_URL,
    AUTH_SUPERADMINS: SUPERADMIN_EMAIL,
    // 服務白名單來自並排的 tpass-registry（public repo），與正式環境同一份。
    TPASS_REGISTRY_PATH: path.resolve(process.cwd(), "..", "tpass-registry", "services.json"),
  };
}
