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
