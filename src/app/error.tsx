"use client";
// auth 的錯誤邊界（B4）。沒有它 → DB 連不上或 server action 拋例外時，
// 使用者在登入流程中途看到的是 Next 預設英文白畫面。
import { useEffect } from "react";
import { ErrorPage } from "@/components/ErrorPage";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 例外原文只進 console（＝主機 pm2 log），不進畫面：裡面可能有連線字串等內部細節。
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <ErrorPage
      code="500 ERROR"
      title="登入服務暫時出了點問題"
      message="這不是你的操作造成的。可以先按「再試一次」；如果一直失敗，請回報給數位部。"
      hint={error.digest ? `回報時附上這個代號：${error.digest}` : undefined}
      onRetry={reset}
    />
  );
}
