// A4-1：金鑰輪替時 JWT_PRIVATE_KEY 與 JWT_PUBLIC_KEY 貼錯（只改一邊、貼錯把），
// auth 過去會照常啟動、照常簽票，但簽出的 token 沒有任何公鑰驗得過——
// 七個消費端同時全面登入失敗，auth 自己沒有任何錯誤訊號。
// 這裡驗證：第一次簽章前的自檢會抓到「私鑰與公鑰不是同一組」並丟出明確錯誤。
import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { TEST_PRIVATE_KEY_PEM, TEST_PUBLIC_KEY_PEM } from "../../tests/helpers/test-keys";

/** 用指定的 JWT_PRIVATE_KEY / JWT_PUBLIC_KEY 重新載入 lib/session.ts；其餘 env 沿用 unit-setup 的假值。 */
async function importSessionWithKeys(privateKeyPem: string, publicKeyPem: string) {
  const prevPriv = process.env.JWT_PRIVATE_KEY;
  const prevPub = process.env.JWT_PUBLIC_KEY;
  process.env.JWT_PRIVATE_KEY = privateKeyPem;
  process.env.JWT_PUBLIC_KEY = publicKeyPem;
  vi.resetModules();
  try {
    return await import("./session");
  } finally {
    process.env.JWT_PRIVATE_KEY = prevPriv;
    process.env.JWT_PUBLIC_KEY = prevPub;
  }
}

describe("session：啟動期自檢私鑰與公鑰是否同一組金鑰對", () => {
  it("私鑰 A + 不相干的公鑰 B → 簽章時 throw 明確錯誤", async () => {
    const other = generateKeyPairSync("ed25519");
    const otherPublicPem = other.publicKey
      .export({ type: "spki", format: "pem" })
      .toString();

    const { signAuthSession } = await importSessionWithKeys(
      TEST_PRIVATE_KEY_PEM,
      otherPublicPem,
    );

    await expect(
      signAuthSession({ sub: "s1", email: "a@school.test", name: "A" }),
    ).rejects.toThrow(/JWT_PRIVATE_KEY 與 JWT_PUBLIC_KEY 不是同一組金鑰對/);
  });

  it("私鑰 A + 公鑰 A（相符）→ 正常簽出 token", async () => {
    const { signAuthSession } = await importSessionWithKeys(
      TEST_PRIVATE_KEY_PEM,
      TEST_PUBLIC_KEY_PEM,
    );

    await expect(
      signAuthSession({ sub: "s1", email: "a@school.test", name: "A" }),
    ).resolves.toEqual(expect.any(String));
  });
});
