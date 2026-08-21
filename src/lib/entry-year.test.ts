import { describe, it, expect } from "vitest";
import {
  parseEntryYearFromEmail,
  currentAcademicYear,
  effectiveEntryYear,
  isValidEntryYear,
} from "./entry-year";

describe("parseEntryYearFromEmail", () => {
  it("取信箱開頭三碼當民國入學學年度", () => {
    expect(parseEntryYearFromEmail("1140001@example.edu.tw")).toBe(114);
  });

  it("老師／職務帳號沒有數字前綴 → null", () => {
    expect(parseEntryYearFromEmail("teacher@example.edu.tw")).toBeNull();
  });

  it("前綴不足三碼 → null", () => {
    expect(parseEntryYearFromEmail("11@example.edu.tw")).toBeNull();
  });
});

describe("currentAcademicYear", () => {
  it("8 月 1 日起算新學年度", () => {
    expect(currentAcademicYear(new Date(2025, 7, 1))).toBe(114);
  });

  it("7 月 31 日仍屬前一學年度", () => {
    expect(currentAcademicYear(new Date(2025, 6, 31))).toBe(113);
  });
});

describe("effectiveEntryYear", () => {
  it("沒有覆寫時用信箱推算", () => {
    expect(effectiveEntryYear("1140001@example.edu.tw", null)).toBe(114);
  });

  it("有覆寫時覆寫優先（休學復學：114 屆改算 115 屆）", () => {
    expect(effectiveEntryYear("1140001@example.edu.tw", 115)).toBe(115);
  });

  it("信箱推不出、也沒覆寫 → null", () => {
    expect(effectiveEntryYear("teacher@example.edu.tw", null)).toBeNull();
  });

  it("信箱推不出但有覆寫 → 用覆寫", () => {
    expect(effectiveEntryYear("teacher@example.edu.tw", 114)).toBe(114);
  });
});

describe("isValidEntryYear", () => {
  const now = new Date(2025, 8, 1); // 民國 114 學年度

  it("接受合理的民國學年度", () => {
    expect(isValidEntryYear(114, now)).toBe(true);
  });

  it("接受下一學年度（開學前先建好的新生）", () => {
    expect(isValidEntryYear(115, now)).toBe(true);
  });

  it("拒絕過遠的未來", () => {
    expect(isValidEntryYear(116, now)).toBe(false);
  });

  it("拒絕小於下限的值", () => {
    expect(isValidEntryYear(99, now)).toBe(false);
  });

  it("拒絕非整數", () => {
    expect(isValidEntryYear(114.5, now)).toBe(false);
  });
});
