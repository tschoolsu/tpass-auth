// A2-1（殘留缺口，第 2 輪駁回意見）：session.ts 的自檢只在「第一次簽章」前跑，
// 但 auth 的健康檢查（deploy.sh 打 /）與根路徑 page.tsx 都不會觸發簽章——
// 貼錯金鑰的部署照樣過健康檢查，要等第一個真人跑完 Google callback 才炸，
// auth 自己在部署當下仍然沒有任何錯誤訊號。
//
// 這裡驗證：Next 的 instrumentation.ts register() hook（官方保證「必須在 server
// 開始處理任何請求之前完成」）會在啟動當下就做同一個金鑰配對檢查，配對錯誤時
// 直接 throw，讓整個 server 起不來（deploy.sh 的健康檢查 30 秒內只會拿到連線被拒，
// 判定部署失敗），而不是留到簽章當下才發現。
import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { TEST_PRIVATE_KEY_PEM, TEST_PUBLIC_KEY_PEM } from "../tests/helpers/test-keys";

/**
 * 用指定的 JWT_PRIVATE_KEY / JWT_PUBLIC_KEY / NEXT_RUNTIME 跑一次 register()。
 * register() 內部是 `await import("./lib/session")`（lazy，避免把 Node-only 的東西
 * 拉進 edge bundle）——這顆動態 import 只有在呼叫 register() 當下才會真的觸發
 * `@/config/auth` 的 module eval（config 把 process.env 的值烤進 authConfig），
 * 所以 env 必須撐到 register() 真的跑完才能還原，不能像單純 import 那樣提早收回。
 */
async function runRegisterWith(
  privateKeyPem: string,
  publicKeyPem: string,
  nextRuntime: string | undefined,
): Promise<void> {
  const prevPriv = process.env.JWT_PRIVATE_KEY;
  const prevPub = process.env.JWT_PUBLIC_KEY;
  const prevRuntime = process.env.NEXT_RUNTIME;
  process.env.JWT_PRIVATE_KEY = privateKeyPem;
  process.env.JWT_PUBLIC_KEY = publicKeyPem;
  if (nextRuntime === undefined) delete process.env.NEXT_RUNTIME;
  else process.env.NEXT_RUNTIME = nextRuntime;
  vi.resetModules();
  try {
    const { register } = await import("./instrumentation");
    await register();
  } finally {
    process.env.JWT_PRIVATE_KEY = prevPriv;
    process.env.JWT_PUBLIC_KEY = prevPub;
    if (prevRuntime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = prevRuntime;
  }
}

describe("instrumentation：register() 在 server 開始處理請求前做金鑰自檢", () => {
  it("nodejs runtime、私鑰 A + 不相干的公鑰 B → register() 直接 throw", async () => {
    const other = generateKeyPairSync("ed25519");
    const otherPublicPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();

    await expect(runRegisterWith(TEST_PRIVATE_KEY_PEM, otherPublicPem, "nodejs")).rejects.toThrow(
      /JWT_PRIVATE_KEY 與 JWT_PUBLIC_KEY 不是同一組金鑰對/,
    );
  });

  it("nodejs runtime、私鑰 A + 公鑰 A（相符）→ register() 正常 resolve", async () => {
    await expect(runRegisterWith(TEST_PRIVATE_KEY_PEM, TEST_PUBLIC_KEY_PEM, "nodejs")).resolves.toBeUndefined();
  });

  it("edge runtime 不做檢查——即使金鑰不成對也直接 resolve", async () => {
    const other = generateKeyPairSync("ed25519");
    const otherPublicPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();

    await expect(runRegisterWith(TEST_PRIVATE_KEY_PEM, otherPublicPem, "edge")).resolves.toBeUndefined();
  });
});
