// 產生 T-Pass 簽章用的 EdDSA (Ed25519) 金鑰對。
// 用法：node scripts/gen-keys.mjs
// 把輸出的兩行（含雙引號）貼進 .env.local。私鑰絕不進 git。
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";

// 預設產出的 CryptoKey 不可匯出，要 export PEM 必須 extractable: true。
const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
  extractable: true,
});

const privatePem = await exportPKCS8(privateKey);
const publicPem = await exportSPKI(publicKey);

// .env（dotenv / @next/env）會在雙引號值內把 \n 還原成換行，
// 所以把 PEM 的換行轉成字面 \n，存成單行、可直接貼上。
const toEnvLine = (name, pem) =>
  `${name}="${pem.trimEnd().replace(/\n/g, "\\n")}"`;

console.log("# 貼進 .env.local：");
console.log(toEnvLine("JWT_PRIVATE_KEY", privatePem));
console.log(toEnvLine("JWT_PUBLIC_KEY", publicPem));
// 換金鑰卻沿用同一個 kid，消費端（jose 的 createRemoteJWKSet 依 kid 選鑰並快取）會拿舊公鑰
// 驗新 token，且因為 kid 命中而不會重抓 JWKS——全部服務靜默驗不過。換 kid 才會觸發重抓。
console.log("");
console.log("# ⚠️ 若是替換既有金鑰（不是首次建置），同時把 JWT_KID 換成沒用過的值，例如：");
console.log("# JWT_KID=tpass-key-2");
