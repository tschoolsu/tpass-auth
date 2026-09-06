// 所有 token 邏輯集中於此：簽 / 驗 / 讀 session、把 Google profile 映射成 claims。
import "server-only";
import { cookies } from "next/headers";
import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  importSPKI,
  type CryptoKey,
} from "jose";
import { authConfig } from "@/config/auth";
import { permissionsFor, overviewFor } from "@/lib/permissions/resolve";
import { findSubjectByEmail } from "@/lib/permissions/repo";
import type { PermissionEntry, PermissionMap } from "@/lib/permissions/types";
import type { Subject } from "@/generated/prisma/client";
import { effectiveEntryYear } from "@/lib/entry-year";

// T-Pass 對接合約：簽進 JWT 的身分內容。
// permissions：Phase 4 新 claim，role+restriction 雙欄本體（見 lib/permissions/types.ts），
// 是唯一的授權真相（Phase 7 已移除 groups 相容層）。
// 一般服務 token 只帶自己一把 key（最小揭露）；大廳 token（AUTH_OVERVIEW_SERVICE_IDS）帶全服務 map。
export interface TPassClaims {
  sub: string;
  email: string;
  name: string;
  permissions: PermissionMap;
  // 民國入學學年度。只在 per-service token 出現，且只在算得出來時出現
  // （老師／職務帳號沒有屆別 → 整個 claim 省略）。消費端據此算年級。
  entryYear?: number | null;
  iat: number;
  exp: number;
}

// 身分本體（不含 permissions / iat / exp）：Google profile 映射出來的穩定識別。
export type TPassIdentity = Pick<TPassClaims, "sub" | "email" | "name">;

// Google userinfo endpoint 回傳的（我們用到的）欄位。
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  email_verified?: boolean;
}

// PEM → CryptoKey 是 async，不能在 module top-level 同步做。
// 用 module 級 cached promise 各載入一次。
let privateKeyPromise: Promise<CryptoKey> | null = null;
let publicKeysPromise: Promise<Map<string, CryptoKey>> | null = null;

function getPrivateKey(): Promise<CryptoKey> {
  privateKeyPromise ??= importPKCS8(authConfig.jwt.privateKeyPem, "EdDSA");
  return privateKeyPromise;
}

// 依 kid 索引的公鑰表：平常只有一把（目前簽章用的），
// 輪替期間會多一把舊鑰，讓舊鑰簽出、尚未過期的 token 在整段 TTL 內仍驗得過。
async function loadPublicKeys(): Promise<Map<string, CryptoKey>> {
  const entries = await Promise.all(
    authConfig.jwt.publicKeys.map(
      async ({ kid, pem }) => [kid, await importSPKI(pem, "EdDSA")] as const,
    ),
  );
  return new Map(entries);
}

function getPublicKeys(): Promise<Map<string, CryptoKey>> {
  publicKeysPromise ??= loadPublicKeys();
  return publicKeysPromise;
}

// 公鑰表也給 JWKS route 用。
export { getPublicKeys };

// audience 命名慣例（契約 v2）：每個服務一個 aud=tpass:<serviceId>，token 只在該服務有效。
export const serviceAudience = (serviceId: string) => `tpass:${serviceId}`;

// auth 自己登入態的 audience（host-only cookie 裡那顆）。
const AUTH_SELF_AUDIENCE = serviceAudience("auth");

// 以指定 audience／TTL 簽 JWT（共用簽章邏輯；aud 決定這顆 token 在哪裡有效）。
// ttlSeconds 拆成參數而非共用一顆設定：auth 登入態（session）與 per-service token
// 生命週期語意不同——session 要撐住整段瀏覽（太短會逼使用者頻繁重登 Google），
// per-service token 要短（換票成本低，縮小外洩窗口）。
// maxExp（選填）：exp 不得超過的上限（Unix 秒）。per-service token 用它把 exp 貼著
// auth 登入態自己的 exp（A2-4）——登入態已經快過期時，per-service 票不該還套用
// 完整 TTL，那等於變相延長了使用者的有效登入時間。用同一個 now 算 exp 與比較上限，
// 避免 signServiceToken 端另外算一次 now 導致極端情況下 off-by-one 秒。
async function sign(
  claims: Omit<TPassClaims, "exp" | "iat">,
  audience: string,
  ttlSeconds: number,
  maxExp?: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = maxExp !== undefined ? Math.min(now + ttlSeconds, maxExp) : now + ttlSeconds;
  const privateKey = await getPrivateKey();
  const payload: Record<string, unknown> = {
    email: claims.email,
    name: claims.name,
    permissions: claims.permissions,
  };
  // 算不出屆別（老師／職務帳號）就整個省略，不要塞 null 進 payload。
  if (typeof claims.entryYear === "number") payload.entryYear = claims.entryYear;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "EdDSA", kid: authConfig.jwt.signingKid })
    .setSubject(claims.sub)
    .setIssuer(authConfig.jwt.issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);
}

// v2：簽 auth 自己的登入態（host-only cookie 用）。只存身份，permissions 一律空——
// 授權是「每個服務不同」的章，等 authorize 發 per-service token 時才依服務查；
// 身分票本身不帶授權（登入態不是拿來對任何服務決定權限的）。
// TTL 用 sessionTtlSeconds（長，預設 12h）：這是使用者「還算登入」的期間，
// 太短會逼使用者對每個服務都重跑一次 Google OAuth。
export const signAuthSession = (identity: TPassIdentity) =>
  sign({ ...identity, permissions: {} }, AUTH_SELF_AUDIENCE, authConfig.jwt.sessionTtlSeconds);

// v2：簽 per-service token。aud=tpass:<id>，只在該服務有效——
// 單一服務被攻破或子網域被接管，拿到的 token 在其他服務一律驗不過。
// TTL 用 ttlSeconds（短，預設 45min）：per-service token 換發成本低（有 auth session
// 就能重簽），故意設短以縮小外洩窗口，也是權限變更（ban/降級）的生效延遲上限。
//
// permissions（Phase 4）：一般服務只塞自己一把 key（最小揭露，別服務的 reason 不外洩）；
// 若 serviceId ∈ AUTH_OVERVIEW_SERVICE_IDS（大廳／門戶）→ 塞全服務 map（含 "auth"），
// 這是 portal 顯示 ban/warning 徽章與「權限管理」卡的資料來源。
export interface SignServiceTokenOptions {
  /** authorize 熱路徑已經查過的 auth 登入態 exp；per-service token 的 exp 不得超過它（A2-4）。 */
  sessionExp?: number;
  /**
   * authorize 熱路徑已經替這個 (email, serviceId) 查過的權限——只在非 overview 服務時
   * 會被用到（overview 服務要的是全服務 map，跟這裡是不同查詢，沒得重用）。
   * 省一次 permissionsFor（A2-5：同一組 (email, service) 一次 authorize 不必查兩次）。
   */
  perm?: PermissionEntry;
  /**
   * authorize 熱路徑（getSessionForAuthorize）已經查過的 Subject，重用來算 entryYearOverride，
   * 省一次 findSubjectByEmail。傳 null 代表「查過了、查失敗或沒有這筆」，一樣不再查一次
   * （維持跟原本 fail-open 一致的降級語意）；不傳（undefined）才會自己查一次。
   */
  subject?: Subject | null;
}

export async function signServiceToken(
  identity: TPassIdentity,
  serviceId: string,
  options: SignServiceTokenOptions = {},
): Promise<string> {
  const isOverview = authConfig.overviewServiceIds.includes(serviceId);
  const permissions: PermissionMap = isOverview
    ? await overviewFor(identity.email)
    : { [serviceId]: options.perm ?? (await permissionsFor(identity.email, serviceId)) };
  // 屆別：DB 覆寫優先，沒有就照 email 推。
  // fail-open：這個查詢失敗不該讓整個發證流程掛掉——permissionsFor 與 getSession
  // 面對 DB 故障都是降級處理，簽章路徑不能為了一個顯示用欄位就變成硬依賴 DB。
  // 查不到就當作沒有覆寫、照 email 推：語意等同舊 token，消費端本來就會 fallback。
  let entryYearOverride: number | null;
  if (options.subject !== undefined) {
    entryYearOverride = options.subject?.entryYearOverride ?? null;
  } else {
    entryYearOverride = null;
    try {
      const subject = await findSubjectByEmail(identity.email);
      entryYearOverride = subject?.entryYearOverride ?? null;
    } catch (err) {
      console.error(`[session] entryYearOverride 查詢失敗，降級為照 email 推算（fail-open）：`, err);
    }
  }
  const entryYear = effectiveEntryYear(identity.email, entryYearOverride);
  return sign(
    { ...identity, permissions, entryYear },
    serviceAudience(serviceId),
    authConfig.jwt.ttlSeconds,
    options.sessionExp,
  );
}

// 用公鑰驗章。安全關鍵：必鎖 algorithms 防 alg confusion（公鑰被當對稱密鑰偽造 token）。
// 失敗一律回 null，不把 error throw 給呼叫端。
// audience 必填：驗哪一張票由呼叫端明講，不給預設值——預設值只會讓人忘記傳而驗錯對象。
//
// 選鑰嚴格依 header 的 kid：認不得的 kid 直接失敗，不做「試過每一把」的 fallback。
// 那種 fallback 會讓「舊鑰已下架」變成驗得過，輪替就永遠收不了尾。
export async function verifySession(
  token: string,
  audience: string,
): Promise<TPassClaims | null> {
  try {
    const keys = await getPublicKeys();
    const { payload } = await jwtVerify(
      token,
      async (header) => {
        const key = header.kid ? keys.get(header.kid) : undefined;
        if (!key) throw new Error(`unknown kid: ${header.kid ?? "(缺 kid)"}`);
        return key;
      },
      {
        algorithms: ["EdDSA"],
        issuer: authConfig.jwt.issuer,
        audience,
      },
    );
    return {
      sub: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
      permissions: (payload.permissions as PermissionMap | undefined) ?? {},
      entryYear: typeof payload.entryYear === "number" ? payload.entryYear : null,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch {
    return null;
  }
}

// 讀 auth 目前的登入態＋順便查一次 Subject（sessionsValidFrom 撤銷檢查要用）。
// getSession 與 getSessionForAuthorize 共用這支，避免同一個 email 在同一次請求裡
// 被 findSubjectByEmail 查兩次（A2-5）。
// Phase 3 補強：驗章成功後再比對 Subject.sessionsValidFrom——ban 時 panel 會把它設為 now()，
// 早於這個時間簽出的 auth session 一律視同未登入（被 ban 者換不到任何新的 per-service 票）。
// 只查 Subject 表（輕量、無 join），DB 掛掉 fail-open：查詢失敗不影響既有登入態。
async function loadSessionAndSubject(): Promise<
  { claims: TPassClaims; subject: Subject | null } | null
> {
  const jar = await cookies();
  const own = jar.get(authConfig.sessionCookieName)?.value;
  if (!own) return null;
  const claims = await verifySession(own, AUTH_SELF_AUDIENCE);
  if (!claims) return null;

  let subject: Subject | null = null;
  try {
    subject = await findSubjectByEmail(claims.email);
    if (subject?.sessionsValidFrom && claims.iat < Math.floor(subject.sessionsValidFrom.getTime() / 1000)) {
      return null;
    }
  } catch (err) {
    console.error(`[session] sessionsValidFrom 查詢失敗，降級為信任既有 token（fail-open）：`, err);
  }

  return { claims, subject };
}

export async function getSession(): Promise<TPassClaims | null> {
  const result = await loadSessionAndSubject();
  return result?.claims ?? null;
}

// authorize 熱路徑專用：跟 getSession 一樣驗登入態，但把順便查到的 Subject 一併回傳，
// 讓呼叫端可以轉手塞給 signServiceToken（省掉它自己再查一次 findSubjectByEmail）。
export async function getSessionForAuthorize(): Promise<
  { claims: TPassClaims; subject: Subject | null } | null
> {
  return loadSessionAndSubject();
}

// 把 Google profile 映射成 T-Pass 身份（不含權限——權限在發 per-service token 時才查）。
export function resolveClaims(profile: GoogleProfile): TPassIdentity {
  return {
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
  };
}
