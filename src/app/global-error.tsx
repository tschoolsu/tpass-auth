"use client";
// 連 root layout 都炸掉時的最後一道防線（B4）。這一層取代整個 <html>，
// 拿不到 layout 的字體與 Tailwind，所以樣式一律 inline——這裡的目標不是好看，
// 是「不要出現英文白畫面」。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-TW">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fff",
          color: "#111",
          fontFamily: "system-ui, -apple-system, 'Noto Sans TC', sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "28rem", border: "2px solid #111", borderRadius: "1rem", padding: "1.5rem", boxShadow: "4px 4px 0 0 #111" }}>
          <p style={{ margin: 0, fontFamily: "ui-monospace, monospace", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.1em" }}>
            T-PASS // 500 ERROR
          </p>
          <h1 style={{ margin: "0.25rem 0 0", fontSize: "1.5rem", fontWeight: 800 }}>T-Pass 登入服務暫時無法運作</h1>
          <p style={{ marginTop: "0.75rem", lineHeight: 1.7 }}>
            這不是你的操作造成的。可以先重新整理；如果一直是這一頁，請回報給數位部。
          </p>
          {error.digest && (
            <p style={{ marginTop: "1rem", fontFamily: "ui-monospace, monospace", fontSize: "0.75rem" }}>
              錯誤代碼 {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: "1.25rem", border: "2px solid #111", borderRadius: "0.75rem", padding: "0.5rem 1rem", fontWeight: 700, background: "#fff", cursor: "pointer", boxShadow: "3px 3px 0 0 #111" }}
          >
            再試一次
          </button>
        </div>
      </body>
    </html>
  );
}
