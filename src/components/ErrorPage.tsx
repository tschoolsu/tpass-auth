// 使用者看得到的錯誤畫面（authorize 的設定錯誤、404）。
// AGENTS.md 的分工：auth 的可見畫面統一在 auth 維護，不推給消費端——
// 但 authorize 的幾個 400 原本是回裸文字，使用者只會看到白底一行英文。
//
// hint 是給**撞到的人**看的補充線索（例如「回報時附上這個代號」）。
// ⚠️ 給串接工程師的排錯指示不放這裡——那些走 server log（見 api/auth/authorize 的 reject()）。
// 這一頁的讀者是學生（B4）。
import { ShieldAlert } from "lucide-react";
// 出口網址走 lib/exit-links（build 時由 PORTAL_URL 注入），不 import server-only 的 config
// ——這樣同一個元件也能被 error.tsx（client component）用。
import { FEEDBACK_URL, PORTAL_URL } from "@/lib/exit-links";

export function ErrorPage({
  code,
  title,
  message,
  hint,
  onRetry,
}: {
  code: string;
  title: string;
  message: string;
  hint?: string;
  // 有傳才顯示「再試一次」（error.tsx 的 reset）。
  onRetry?: () => void;
}) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border-2 border-foreground bg-card p-6 shadow-[4px_4px_0_0_var(--color-foreground)] sm:p-8">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-foreground bg-tone-orange-bg text-tone-orange-text shadow-[3px_3px_0_0_var(--color-foreground)]">
            <ShieldAlert className="h-7 w-7" />
          </span>
          <p className="mt-5 font-mono text-xs font-bold uppercase tracking-widest text-muted-foreground">
            T-PASS // {code}
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{title}</h1>
          <p className="mt-3 font-medium text-muted-foreground">{message}</p>
          {hint && (
            <p className="mt-4 rounded-md border-2 border-foreground bg-muted px-3 py-2 font-mono text-xs font-bold text-foreground">
              {hint}
            </p>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center rounded-xl border-2 border-foreground bg-primary px-4 py-2 font-bold text-primary-foreground shadow-[3px_3px_0_0_var(--color-foreground)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-foreground)] active:translate-y-0 active:shadow-[2px_2px_0_0_var(--color-foreground)]"
              >
                再試一次
              </button>
            )}
            <a
              href={PORTAL_URL}
              className="inline-flex items-center justify-center rounded-xl border-2 border-foreground bg-card px-4 py-2 font-bold text-foreground shadow-[3px_3px_0_0_var(--color-foreground)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_0_var(--color-foreground)] active:translate-y-0 active:shadow-[2px_2px_0_0_var(--color-foreground)]"
            >
              回門戶大廳
            </a>
          </div>
          {/* 回報管道（B5）。撞到錯誤的人是最有資訊的人，這裡是唯一能把資訊送回來的路。 */}
          <p className="mt-5 text-sm font-medium text-muted-foreground">
            還是不行？{" "}
            <a
              href={FEEDBACK_URL}
              className="font-bold text-foreground underline decoration-2 underline-offset-4 hover:text-primary"
            >
              回報給數位部
            </a>
          </p>
        </div>
      </div>
    </main>
  );
}
