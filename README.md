# T-Pass SSO 發證服務（tpass-auth）

TSchool 生態系的中央登入服務：跑 Google OAuth 確認身分 → 對白名單服務簽發
per-service EdDSA JWT（`aud=tpass:<id>`，契約 v2）→ 公開 JWKS 公鑰。
**全生態唯一持有簽章私鑰的服務**；消費端只拿公鑰本地驗章，不回呼本服務。

| 項目 | 值 |
| --- | --- |
| 服務 id | `auth`（tpass-ops `services.json`） |
| 本機網址 | `https://auth.lvh.me:3000` |
| 正式網址 | `https://auth.tschoolsu.org` |
| 資料庫 | PostgreSQL（Prisma 7 + `@prisma/adapter-pg`；Subject / Grant / AuditLog，權限真相） |
| 對接合約 | **`INTEGRATION.md`（本 repo，權威）** |

## 開發

一律從上層 tpass-ops repo 啟動：

```bash
# 上層目錄
scripts/tpass dev auth      # 或 tpass dev（全部服務）
scripts/tpass check auth    # push 前：lint + tsc --noEmit
```

單獨跑本服務：`pnpm dev`（package.json 已設好 HTTPS + `auth.lvh.me:3000`；auth **不加**
`NODE_TLS_REJECT_UNAUTHORIZED`——要驗 Google 真憑證）。env 必填清單以 `src/config/auth.ts` 的 `REQUIRED` 為準
（範本 `.env.example`）；EdDSA 金鑰用 `node scripts/gen-keys.mjs` 產（不落盤、不進 git）。

資料庫：`DATABASE_URL` 指向本機 Postgres 後 `pnpm exec prisma migrate dev` 套用 `prisma/migrations`
（改 schema 也用它產新 migration，不要 `db push`）；client 由 `postinstall` 的 `prisma generate` 產到
`src/generated/prisma`（gitignored）。舊站一次性灌權限：`pnpm db:seed`（讀 `AUTH_GROUPS`）。

## 測試

```bash
pnpm test              # 單元（純函式），CI 跑的是這份
```

整合與壓力測試需要本機 PostgreSQL 與一次 `pnpm build`（打的是 production server，不是 dev）。
第一次要先建測試庫：

```bash
psql "postgresql://t_auth@localhost:5432/postgres" -c "CREATE DATABASE t_auth_test OWNER t_auth"
DATABASE_URL="postgresql://t_auth@localhost:5432/t_auth_test" pnpm exec prisma migrate deploy
```

之後：

```bash
pnpm build
pnpm test:integration                 # OAuth 流程、發證、授權邊界、/admin 外洩
pnpm stress --reporter=verbose        # 同時灌爆登入，數字印在 console
BURST_USERS=3000 BURST_CONCURRENCY=800 pnpm stress
```

測試怎麼繞過 Google：`tests/helpers/` 用**測試專用金鑰**（`test-keys.ts`，不是任何真實環境的
私鑰）啟動一個 auth 實例，然後自己簽 auth 登入態。Google 那一段跳過，其餘（驗章、權限查詢、
簽 per-service token、DB）全部是真的在跑。

- `tests/integration/oauth-state.test.ts` — 多分頁同時登入的 state 處理（見下方「已知坑」）
- `tests/integration/authorize.test.ts` — 發證正確性、服務／redirect 白名單、ban、JWKS、/admin 守門
- `tests/integration/admin-leak.test.ts` — /admin 不得把後台資料送給沒有權限的人
- `tests/stress/login-burst.test.ts` — 登入尖峰灌爆，全程盯 RSS（pm2 門檻 1G、V8 heap 384MB）

⚠️ 這些測試會清空 `t_auth_test`。`tests/helpers/db.ts` 有雙重防護，連錯庫會直接拒絕執行。

### 已知坑：多分頁同時登入

進行中的 OAuth 流程曾經存在**固定名稱**的 cookie（`oauth_state` / `oauth_verifier`），
所以同一個瀏覽器只能有一條登入流程——同時開三個服務的分頁、或等 Google 太久又按一次登入，
後開的流程會蓋掉先開的，先回來的分頁必定看到「Invalid OAuth state」黑畫面。人一多，
有人剛好開兩個分頁的機率接近 1，看起來就像「同時登入會爆」。

現在改成**一條流程一顆 cookie**（`oauth_flow_<state>`），並在超過上限時淘汰最舊的。
CSRF 防護不變（state 仍由伺服器產生、綁在 HttpOnly cookie 上）。
`tests/integration/oauth-state.test.ts` 與 `src/lib/oauth.test.ts` 守著這件事。

## 結構速記

- `src/app/api/auth/login` — 啟動 Google OAuth（state + PKCE，arctic）
- `src/app/api/auth/callback/google` — 換 token、驗 email 網域、簽 session
- `src/app/api/auth/authorize` — **契約 v2 核心**：對白名單服務簽 per-service token（form_post 交付）
- `src/app/api/auth/logout` — 清 auth 自己的 session cookie（v1 共用 cookie 已於 2026-07-13 移除），可帶 `redirect_uri` 導回消費端
- `src/app/.well-known/jwks.json` — 公鑰（kid 支援輪替）
- `src/lib/session.ts` — 簽/驗章集中地；`src/config/auth.ts` — 全 env 驅動設定

## 安全紅線

私鑰只存在 `.env.local` 的 `JWT_PRIVATE_KEY`；服務白名單派生自 `../tpass-registry/services.json`（`src/config/auth.ts` 的 `serviceIds`，刻意不吃 env override）；
`redirect_uri` 一律過 `isAllowedRedirect` 白名單。細節與威脅模型見
`INTEGRATION.md` 與上層 `docs/SECURITY-REVIEW.md`。
