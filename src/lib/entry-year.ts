// 入學屆別（民國學年度）的計算。**零依賴純函數**——不 import server-only、不讀 env，
// 才能被 vitest 直接測。屆別是身分屬性，真相在此 repo（Subject.entryYearOverride），
// 經 JWT 的 entryYear claim 派發給各服務。
//
// 為什麼存「屆別」不存「年級」：屆別設定一次就永久正確，年級每年 8 月都要重標一輪。

// 民國學年度下限。比這更早的值一律當作打錯字。
export const MIN_ENTRY_YEAR = 100;

// 學校信箱前三碼＝民國入學學年度（如 1140001@... → 114）。
// 老師／職務帳號沒有數字前綴 → null。
export function parseEntryYearFromEmail(email: string): number | null {
  const m = email.match(/^(\d{3})/);
  return m ? Number(m[1]) : null;
}

// 現在的民國學年度。學年度每年 8 月跳新（8/1 起算新學年）。
export function currentAcademicYear(now: Date = new Date()): number {
  const roc = now.getFullYear() - 1911;
  return now.getMonth() + 1 >= 8 ? roc : roc - 1;
}

// 這個人實際上算哪一屆：人工覆寫優先，沒有就照信箱推。
// 休學復學者 email 沿用、學號前綴不變，就是靠 override 修正。
export function effectiveEntryYear(
  email: string,
  override: number | null,
): number | null {
  return override ?? parseEntryYearFromEmail(email);
}

// 管理介面輸入驗證。+1 是為了容納開學前就先建好的新生。
export function isValidEntryYear(value: number, now: Date = new Date()): boolean {
  return (
    Number.isInteger(value) &&
    value >= MIN_ENTRY_YEAR &&
    value <= currentAcademicYear(now) + 1
  );
}
