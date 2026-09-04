// 測試專用的 Ed25519 金鑰對（PEM）。
//
// ⚠️ 這不是任何真實環境的金鑰，也永遠不可以變成真實環境的金鑰。整合測試會用它啟動一個
// 測試用的 auth 實例，這樣測試才能簽出「auth 簽的」session cookie 而不必碰主機或本機
// `.env.local` 裡的真私鑰。刻意寫死在版控裡——它保護不了任何東西，也不該被當成機密。
export const TEST_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIDUkZlWJdmkWnyddIutlHSxRVwD+MCK++9l+sZXNRNnj
-----END PRIVATE KEY-----
`;

export const TEST_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjxl+cIwDTmeYkngAtkL1gK2/sddNhKICUBRtqrXIf5E=
-----END PUBLIC KEY-----
`;

export const TEST_KID = "tpass-test-key";
