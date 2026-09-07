// A2-1：lib/session.ts 的金鑰配對自檢只掛在「第一次簽章」前，但健康檢查與根路徑都不會
// 觸發簽章，貼錯金鑰的部署照樣過健康檢查，要等第一個真人跑完 Google callback 才炸。
//
// Next 在 server 開始處理請求前呼叫 register() 一次。這裡 throw 之後（Next 16.3 實測）
// **行程不會退出**：server 永遠 prepare 不完，之後每個請求（含 / 與 JWKS）都回 500。
// deploy.sh 的健康檢查只認 <500，所以部署會判定失敗；但 pm2 會顯示 online、不會重啟，
// 失敗後要人手動回滾（deploy.sh 沒有自動回滾）。背景與 double-check 見 session.ts。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureKeyPairMatches } = await import("./lib/session");
  await ensureKeyPairMatches();
}
