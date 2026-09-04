// `server-only` 在非 RSC 打包環境 import 會直接報錯（那正是它的用途）。
// 單元／整合測試在 Node 裡直接 import lib，所以把它 alias 成這個空模組。
// alias 只存在於測試設定，正式環境的保護不受影響。
export {};
