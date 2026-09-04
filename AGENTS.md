<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## auth 的定位：發證 + 權限真相，不是業務服務

auth 的職責邊界是三件事，**不多不少**：

1. **發證**：跑 Google OAuth 確認身分、簽 per-service EdDSA JWT、公開 JWKS。唯一持有私鑰者。
2. **權限真相**：`permissions` claim 的資料來源——DB（Prisma：`Subject` / `Grant` / `AuditLog`）
   記著每個人在每個服務的 role / restriction，簽 token 時查它。
3. **權限管理介面**：`/admin` panel，管權限用。

**不要在 auth 裡加任何業務功能**（問卷、跨屆代傳、申訴那類東西屬於消費端，不屬於發證端）。
`/admin` 也不例外——它是「管這套權限系統」的介面，不是「TSchool 平台的後台」。

**讀權限只走窄介面**：簽章路徑（`signServiceToken`）與 `/denied` 都只透過
`src/lib/permissions/resolve.ts` 的 `permissionsFor(email, serviceId)` / `overviewFor(email)`
兩支函式查權限，不直接碰 Prisma client 或 `src/lib/permissions/repo.ts`——這兩支函式已經包好
superadmin 短路與 fail-open 降級，繞過它們等於重新引入一次這些邊界情況的 bug。
`/admin` 的 server actions 是例外：它的工作就是**寫** Grant/Subject/AuditLog，本來就得直接呼叫
`src/lib/permissions/repo.ts` 的 CRUD 函式；但每支 action 仍須自己呼叫
`requireAuthModerator()` / `requireAuthAdmin()`，不能只靠 layout 擋。

**`/admin` 的每個 page 也一樣**：第一行必須是 `if (!(await canViewPanel())) return null;`，
而且要在任何 DB 查詢之前。layout 擋的是「畫面」不是「執行」——Next 並行渲染 layout 與 page，
layout 回 Forbidden 時 page 早就查完 DB，那些資料會跟著進 RSC payload 送到瀏覽器，
view-source 就看得到。曾經因此把全站權限狀態與稽核紀錄（含 actor／target email 與管制理由）
送給任何一個登入使用者。`tests/integration/admin-leak.test.ts` 守著這件事。

## auth 不是使用者的目的地（UI 設計說明）

auth 只是發證服務，不是門戶。使用者理想上只會看到 **Google 自己的登入介面**，而不是 tauth 的頁面：

- **已登入**者連到 auth 根路徑 → `page.tsx` 直接 `redirect(portalUrl)`，導回門戶大廳。
- **未登入**者連到根路徑 → 顯示 auth 自己的登入頁（一顆「使用學校 Google 帳號登入」按鈕）。
- **登入失敗 / 網域不符**（`callback/google/route.ts` 的 `fail()`）→ `redirect('/?error=oauth|domain')`，
  回到 `page.tsx` 顯示錯誤 banner。

因此登入頁與錯誤頁是使用者**可能看到的少數 tauth 畫面**。它們一律維護成 **light-only Neobrutalism**
（與 `tpass-portal/docs/design.md` 一致：`border-2 border-foreground` + hard offset shadow、OKLCH token、light body），
色彩 token 移植在本專案 `src/app/globals.css`。**不要**把「處理 auth 錯誤 / 登入」的 UI 推給各消費端自行實作——
那違反「消費端只驗章、不碰發證 UI」的分工紅線；auth 的可見畫面就在 auth 這裡統一維護。

## 生態系地圖在上層

本 repo 是 **tpass 生態系**的發證端（id：`auth`）。整個生態系的地圖、跨服務規範、
`services.json` 註冊表、`tpass` CLI 與部署流程，都在上層 **tpass-ops** repo 的
`AGENTS.md` 與 `docs/`。對接合約以本 repo `INTEGRATION.md` 為權威。

- 本機啟動：`pnpm dev`（package.json 已設好 HTTPS + `auth.lvh.me:3000`）。★ auth **不加** `NODE_TLS_REJECT_UNAUTHORIZED`——它要驗 Google 的真憑證。
