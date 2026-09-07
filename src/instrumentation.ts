// A2-1（殘留缺口，第 2 輪駁回意見）：lib/session.ts 的金鑰配對自檢只掛在「第一次簽章」
// 前——但 auth 的健康檢查與根路徑都不會觸發簽章，貼錯金鑰的部署照樣過健康檢查，要等
// 第一個真人跑完 Google callback 才炸，auth 自己在部署當下沒有任何錯誤訊號。
//
// Next 官方保證：register() 在新 server instance 啟動時呼叫一次，且必須在 server
// 開始處理任何請求之前完成（可以是 async）。這裡把同一顆金鑰自檢掛在這，配對錯誤時
// throw 出去會讓整個 server 起不來——deploy.sh 的健康檢查 30 秒內只會拿到連線被拒，
// 判定部署失敗，跟 config/auth.ts 的 AUTH_BASE_URL fail-fast 是同一個「一部署就炸、
// 不必等真人觸發」的等級，而不只是「簽章時 throw」。
//
// 只在 nodejs runtime 做：這支自檢用得到 Node 的 PEM import，edge runtime 沒有意義
// （本專案目前也沒有任何 edge route），照官方文件的建議寫法用 NEXT_RUNTIME 分流。
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureKeyPairMatches } = await import("./lib/session");
  await ensureKeyPairMatches();
}
