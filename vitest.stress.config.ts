// 壓力測試：與整合測試同一套環境，但檔案分開、時限放寬，不會被 `pnpm test` 或 CI 誤觸。
//
//   pnpm build && pnpm stress --reporter=verbose
//   BURST_USERS=3000 BURST_CONCURRENCY=800 pnpm stress
//
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/stress/**/*.test.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 900_000,
  },
});
