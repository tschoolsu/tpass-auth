// 用測試私鑰簽出「auth 自己的登入態」，讓測試跳過 Google OAuth 直接進到已登入狀態。
//
// 格式必須與 src/lib/session.ts 的 signAuthSession 完全一致（aud=tpass:auth、permissions 空、
// sub/email/name），否則 getSession 驗不過。這是刻意的重複——測試若跟著 import 正式程式碼，
// 就測不到「正式程式碼把格式改壞了」。
import { SignJWT, importPKCS8 } from "jose";
import { TEST_KID, TEST_PRIVATE_KEY_PEM } from "./test-keys";
import { EMAIL_DOMAIN, ISSUER, SESSION_TTL_SECONDS } from "./env";

export interface TestUser {
  email: string;
  name?: string;
  sub?: string;
  /** 相對現在的有效秒數；給負數就是過期的登入態。 */
  ttlSeconds?: number;
  /** 覆寫 iat，用來測 ban 的 sessionsValidFrom 撤銷。 */
  issuedAt?: number;
}

let keyPromise: Promise<CryptoKey> | null = null;
function privateKey() {
  keyPromise ??= importPKCS8(TEST_PRIVATE_KEY_PEM, "EdDSA") as Promise<CryptoKey>;
  return keyPromise;
}

export async function signAuthSession(user: TestUser): Promise<string> {
  const now = user.issuedAt ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, name: user.name ?? user.email.split("@")[0], permissions: {} })
    .setProtectedHeader({ alg: "EdDSA", kid: TEST_KID })
    .setSubject(user.sub ?? `sub-${user.email}`)
    .setIssuer(ISSUER)
    .setAudience("tpass:auth")
    .setIssuedAt(now)
    .setExpirationTime(now + (user.ttlSeconds ?? SESSION_TTL_SECONDS))
    .sign(await privateKey());
}

export const STUDENT: TestUser = { email: `s114001@${EMAIL_DOMAIN}`, name: "學生甲" };
export const STUDENT_B: TestUser = { email: `s114002@${EMAIL_DOMAIN}`, name: "學生乙" };
export const TEACHER: TestUser = { email: `teacher@${EMAIL_DOMAIN}`, name: "老師" };
