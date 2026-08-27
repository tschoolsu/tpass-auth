// 錯誤頁的「出口」網址。error.tsx 是 client component，讀不到 server-only 的 config，
// 所以值由 next.config.ts 在 build 時把既有的 PORTAL_URL 注入成 NEXT_PUBLIC_PORTAL_URL
// ——刻意不新增任何一顆需要人上主機去填的 env（值與 authConfig.portalUrl 同源）。
//
// ⚠️ 這裡只能直接寫 process.env.NEXT_PUBLIC_XXX（Next 是字面替換，解構會拿到 undefined）。
const portal = (process.env.NEXT_PUBLIC_PORTAL_URL || "").replace(/\/+$/, "");

export const PORTAL_URL = portal || "/";
// 全平台唯一的回報入口（B5）；真正的目的地由 portal 的 /feedback 決定，這裡不必知道。
export const FEEDBACK_URL = portal ? `${portal}/feedback` : "/";
