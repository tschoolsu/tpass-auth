// 盯著測試 auth 實例的 process：記憶體與存活。
// auth 的 pm2 設定給的 V8 heap 只有 384MB、pm2 重啟門檻 1G（ecosystem.config.js），
// 而它是全生態唯一的發證端——被灌爆時的記憶體曲線比延遲更值得看。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { APP_LOG_FILE, APP_PID_FILE } from "./env";

export function appPid(): number | null {
  if (!existsSync(APP_PID_FILE)) return null;
  const pid = Number(readFileSync(APP_PID_FILE, "utf8").trim());
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

export function appRssMb(): number | null {
  const pid = appPid();
  if (pid === null) return null;
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" });
    const kb = Number(out.trim());
    return Number.isFinite(kb) ? Math.round((kb / 1024) * 10) / 10 : null;
  } catch {
    return null;
  }
}

export function appAlive(): boolean {
  const pid = appPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function appLog(): string {
  return existsSync(APP_LOG_FILE) ? readFileSync(APP_LOG_FILE, "utf8") : "";
}
