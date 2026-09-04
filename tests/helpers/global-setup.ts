// 整合測試的全域前置：用 production build 起一個真的 auth 實例，env 全部注入測試值
// （測試金鑰、測試資料庫、假的 Google 憑證）。@next/env 不會覆蓋已存在的 process.env，
// 所以它連的是 t_auth_test 而不是開發庫——tests/integration/smoke.test.ts 會再確認一次。
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_LOG_FILE, APP_PID_FILE, APP_URL, TEST_PORT, testEnv } from "./env";

let app: ChildProcess | null = null;

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`等 ${url} 逾時：${String(lastError)}`);
}

export async function setup() {
  const buildId = path.join(process.cwd(), ".next", "BUILD_ID");
  if (!existsSync(buildId)) {
    throw new Error("找不到 .next/BUILD_ID：整合測試打的是 production build，請先 `pnpm build`");
  }

  app = spawn(
    "node",
    [
      path.join("node_modules", "next", "dist", "bin", "next"),
      "start",
      "-p",
      String(TEST_PORT),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...testEnv(), NODE_ENV: "production" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  writeFileSync(APP_PID_FILE, String(app.pid ?? ""), "utf8");
  writeFileSync(APP_LOG_FILE, "", "utf8");
  const logs: string[] = [];
  const record = (d: unknown) => {
    logs.push(String(d));
    appendFileSync(APP_LOG_FILE, String(d));
  };
  app.stdout?.on("data", record);
  app.stderr?.on("data", record);

  try {
    await waitFor(`${APP_URL}/.well-known/jwks.json`, 60_000);
  } catch (e) {
    console.error(`[global-setup] auth 起不來：\n${logs.join("")}`);
    throw e;
  }
}

export async function teardown() {
  app?.kill("SIGTERM");
}
