// 整合測試：需要本機 PostgreSQL（測試庫 t_auth_test）與一次 production build。
// 與單元測試（vitest.config.ts）分開，CI 只跑得動後者。
//
//   pnpm build && pnpm test:integration
//
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
