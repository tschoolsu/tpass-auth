// 單元測試：純函式，不需要資料庫或 build，CI 跑的就是這一份。
// tests/ 底下的整合與壓力測試要資料庫與 production build，走各自的 config
// （vitest.integration.config.ts / vitest.stress.config.ts）。
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // lib 幾乎都 import "server-only"，那個套件在 Node 直接 import 會炸（那正是它的用途）。
      "server-only": path.resolve(__dirname, "tests/helpers/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // config/auth.ts 在 import 當下就檢查必填 env，所以要先餵一組假值。
    setupFiles: ["tests/helpers/unit-setup.ts"],
  },
});
