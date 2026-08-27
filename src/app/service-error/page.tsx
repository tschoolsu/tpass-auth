// /service-error：authorize 因為「串接設定不對」而擋下時導來這裡。
// 原本這三種情況是直接回裸文字 400（"Unknown service" 之類），使用者只看到白底一行英文。
//
// 為什麼用導向而不是在 route handler 裡回 HTML：route handler 回不了 JSX，硬回 HTML 就
// 拿不到 layout 的字體與 Tailwind。而 authorize 一定是瀏覽器的頂層導航（SSO 流程的一步），
// 從來不是 server-to-server 呼叫，所以損失 400 狀態碼沒有實質代價。
//
// ⚠️ 這一頁的讀者是**撞到的學生**，不是串接的工程師（B4）。
// 「去 tpass-registry 開 PR」那種指示已經移到 authorize route 的 server log
// （見 api/auth/authorize/route.ts 的 reject()）——會看 log 的人才需要它。
import type { Metadata } from "next";
import { ErrorPage } from "@/components/ErrorPage";

export const metadata: Metadata = { title: "服務串接有問題 — T-Pass" };

// 每個 code 對應 authorize 裡的一道檢查。文案一律「說明現況 + 告訴他能做什麼」，
// 不解釋內部機制，也不要求學生去修任何東西。
const REASONS: Record<string, { title: string; message: string }> = {
  "unknown-service": {
    title: "這個服務還沒開通",
    message:
      "T-Pass 目前不認得你要前往的服務，所以沒辦法讓你登入。這是設定還沒完成，不是你的操作有問題——把這頁回報給數位部，他們補上設定就會恢復。",
  },
  "invalid-redirect": {
    title: "這個連結不安全，已經幫你擋下",
    message:
      "你點的連結想把登入資訊送到 T-Pass 生態系以外的地方，已被擋下。如果這個連結是別人傳給你的，請不要再點；如果是校內服務的正常入口，請回報給數位部。",
  },
  "invalid-next": {
    title: "這個連結的轉跳位址不合法",
    message:
      "登入完成後要前往的位址不是校內服務的頁面，已被擋下。請改從門戶大廳進入該服務；如果是從校內連結點過來的，請回報給數位部。",
  },
};

const FALLBACK = {
  title: "無法前往這個服務",
  message:
    "T-Pass 沒辦法讓你登入這個服務。這是服務端的設定問題，不是你的操作造成的——請從門戶大廳再試一次，或把這頁回報給數位部。",
};

export default async function ServiceErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const r = (reason && REASONS[reason]) || FALLBACK;
  return (
    <ErrorPage
      code="400 BAD REQUEST"
      title={r.title}
      message={r.message}
      // hint 給的是「回報時附上這個代號」，不是排錯指示。
      hint={`回報時附上這個代號：${reason || "unknown"}`}
    />
  );
}
