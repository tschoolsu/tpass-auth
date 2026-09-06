// A1-11：AUTH_BASE_URL 打錯（漏了子網域、抄到別的網域）不該悄悄跑起來——
// 發出去的 redirect_uri／cookie／JWKS url 全部繞著它建，錯了要在啟動時就 throw，
// 不要等部署後才被使用者回報「登入轉圈圈」。
// 本機／測試用 loopback（127.0.0.1／localhost）不受這條限制，那是開發與整合測試
// 慣用的跑法，不代表設定錯誤。
import { describe, it, expect, vi } from "vitest";

/** 用指定的 AUTH_BASE_URL 重新載入 config/auth.ts；其餘 env 沿用 unit-setup 的假值。 */
async function importAuthConfig(baseUrl: string) {
  const prev = process.env.AUTH_BASE_URL;
  process.env.AUTH_BASE_URL = baseUrl;
  vi.resetModules();
  try {
    return await import("./auth");
  } finally {
    process.env.AUTH_BASE_URL = prev;
  }
}

describe("authConfig：AUTH_BASE_URL 的 host 必須落在 AUTH_ALLOWED_HOST_SUFFIX 底下（fail-fast）", () => {
  it("host 既不落在 suffix 底下、也不是 loopback → 啟動時直接 throw", async () => {
    await expect(importAuthConfig("https://auth.other-domain.example")).rejects.toThrow(
      /AUTH_BASE_URL/,
    );
  });

  it("host 落在 AUTH_ALLOWED_HOST_SUFFIX 底下 → 正常載入", async () => {
    const suffix = process.env.AUTH_ALLOWED_HOST_SUFFIX!;
    await expect(importAuthConfig(`https://auth.${suffix}`)).resolves.toBeDefined();
  });

  it("host 等於 suffix 本身（沒有子網域前綴）也算落在底下 → 正常載入", async () => {
    const suffix = process.env.AUTH_ALLOWED_HOST_SUFFIX!;
    await expect(importAuthConfig(`https://${suffix}`)).resolves.toBeDefined();
  });

  it("loopback（127.0.0.1／localhost，本機與整合測試的跑法）不受 suffix 限制", async () => {
    await expect(importAuthConfig("http://127.0.0.1:3900")).resolves.toBeDefined();
    await expect(importAuthConfig("http://localhost:3000")).resolves.toBeDefined();
  });
});
