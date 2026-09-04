// 單元測試前置：src/config/auth.ts 在 import 當下就會檢查必填 env 並 throw，
// 所以任何 import 到它的純函式測試都需要先有一組值。這些全是假的，只為了讓模組載入得起來。
const FAKE_ENV: Record<string, string> = {
  GOOGLE_CLIENT_ID: "unit-test",
  GOOGLE_CLIENT_SECRET: "unit-test",
  AUTH_BASE_URL: "http://localhost:3000",
  AUTH_ALLOWED_HOST_SUFFIX: "tpass.test",
  AUTH_ALLOWED_EMAIL_DOMAIN: "school.test",
  PORTAL_URL: "http://portal.tpass.test/",
  JWT_PRIVATE_KEY: "unit-test",
  JWT_PUBLIC_KEY: "unit-test",
  JWT_ISSUER: "https://auth.tpass.test",
  JWT_TTL_SECONDS: "2700",
  DATABASE_URL: "postgresql://unit@localhost:5432/unit",
  AUTH_SUPERADMINS: "boss@school.test",
};

for (const [key, value] of Object.entries(FAKE_ENV)) {
  process.env[key] ??= value;
}
