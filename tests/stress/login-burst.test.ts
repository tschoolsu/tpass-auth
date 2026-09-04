// 「同時灌爆登入」壓力測試。
//
// auth 是全生態唯一的發證端，`instances: 1`（fork，非 cluster），V8 heap 只給 384MB、
// pm2 重啟門檻 1G，連線池 max=10，而且**沒有任何 rate limit**。它掛掉的意思是
// 全校誰都換不到新票。所以這裡刻意把併發開到遠超連線池上限，並全程盯 RSS。
//
// 情境對應現實：開學第一天、選舉投票開放的那一分鐘、全校集合後同時掏出手機。
import { describe, it, expect, beforeAll } from "vitest";
import { prisma, resetDb, grant } from "../helpers/db";
import { Browser } from "../helpers/browser";
import { signAuthSession } from "../helpers/session";
import { APP_URL, EMAIL_DOMAIN, HOST_SUFFIX, SESSION_COOKIE } from "../helpers/env";
import { appAlive, appLog, appRssMb } from "../helpers/proc";

const USERS = Number(process.env.BURST_USERS ?? 500);
/** 同時打進來的請求數。連線池只有 10，這裡刻意開幾十倍。 */
const BURST = Number(process.env.BURST_CONCURRENCY ?? 300);

const CONSUMER_CALLBACK = `http://vote.${HOST_SUFFIX}/api/auth/callback`;

function authorizeUrl(service = "vote") {
  const p = new URLSearchParams({ service, redirect_uri: CONSUMER_CALLBACK, next: "/" });
  return `${APP_URL}/api/auth/authorize?${p}`;
}

const rssTrack: { label: string; mb: number | null }[] = [];
function trackRss(label: string) {
  const mb = appRssMb();
  rssTrack.push({ label, mb });
  console.log(`  ▸ RSS after ${label}: ${mb === null ? "?" : `${mb}MB`}`);
}

function summarize(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const total = sorted.reduce((a, b) => a + b, 0);
  const r = (n: number) => Math.round(n * 10) / 10;
  return { n: sorted.length, mean: r(total / (sorted.length || 1)), p50: r(at(0.5)), p95: r(at(0.95)), max: r(sorted[sorted.length - 1] ?? 0) };
}

/** 一次全部丟出去，不用 pool 慢慢餵——真實的登入尖峰就是這樣。 */
async function blast(count: number, fn: (i: number) => Promise<Response>) {
  const started = performance.now();
  const settled = await Promise.allSettled(
    Array.from({ length: count }, async (_, i) => {
      const t0 = performance.now();
      const res = await fn(i);
      await res.arrayBuffer();
      return { ms: performance.now() - t0, status: res.status };
    }),
  );
  const wallMs = performance.now() - started;
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [String(s.reason)] : []));
  return { wallMs, ok, errors, stats: summarize(ok.map((o) => o.ms)) };
}

let sessions: string[] = [];

describe(`同時灌爆登入（${USERS} 人、瞬間併發 ${BURST}）`, () => {
  beforeAll(async () => {
    await resetDb();
    console.log(`\n[灌爆設定] 使用者 ${USERS}・瞬間併發 ${BURST}・連線池上限 10・V8 heap 384MB`);
    // 每個人一張 auth 登入態（等同「已經跑完 Google，正在跟各服務換票」）
    sessions = await Promise.all(
      Array.from({ length: USERS }, (_, i) =>
        signAuthSession({ email: `s${String(i).padStart(4, "0")}@${EMAIL_DOMAIN}` }),
      ),
    );
    trackRss("setup");
  });

  it("JWKS 被全生態同時拉（消費端重啟時就會這樣）", async () => {
    const { wallMs, ok, errors, stats } = await blast(BURST, () =>
      fetch(`${APP_URL}/.well-known/jwks.json`),
    );
    console.log(
      `  ▸ JWKS ${BURST} 併發：牆鐘 ${Math.round(wallMs)}ms・失敗 ${errors.length}・` +
        `p50 ${stats.p50}ms・p95 ${stats.p95}ms・吞吐 ${Math.round((BURST / wallMs) * 1000)}req/秒`,
    );
    expect(errors.length / BURST, "JWKS 拉不到＝全生態驗不了章").toBeLessThan(0.01);
    expect(ok.every((o) => o.status === 200)).toBe(true);
    trackRss("JWKS 灌爆");
  });

  it("登入起手式（/api/auth/login）同時湧入", async () => {
    const { wallMs, ok, errors, stats } = await blast(BURST, (i) =>
      fetch(`${APP_URL}/api/auth/login?redirect_uri=${encodeURIComponent(`http://s${i % 8}.${HOST_SUFFIX}/`)}`, {
        redirect: "manual",
      }),
    );
    console.log(
      `  ▸ login ${BURST} 併發：牆鐘 ${Math.round(wallMs)}ms・失敗 ${errors.length}・` +
        `p95 ${stats.p95}ms・吞吐 ${Math.round((BURST / wallMs) * 1000)}req/秒`,
    );
    expect(errors.length / BURST).toBeLessThan(0.01);
    expect(ok.every((o) => o.status === 302 || o.status === 307)).toBe(true);
    trackRss("login 灌爆");
  });

  it("換票（authorize）同時湧入——每次要跑 3 趟 DB，連線池只有 10", async () => {
    const { wallMs, ok, errors, stats } = await blast(BURST, (i) =>
      fetch(authorizeUrl(), {
        headers: { Cookie: `${SESSION_COOKIE}=${sessions[i % sessions.length]}` },
        redirect: "manual",
      }),
    );
    const nonOk = ok.filter((o) => o.status !== 200);
    console.log(
      `  ▸ authorize ${BURST} 併發：牆鐘 ${Math.round(wallMs)}ms・例外 ${errors.length}・` +
        `非 200 ${nonOk.length}・p50 ${stats.p50}ms・p95 ${stats.p95}ms・max ${stats.max}ms・` +
        `吞吐 ${Math.round((BURST / wallMs) * 1000)}req/秒`,
    );
    if (errors.length) console.log(`  ▸ 例外樣本：${errors[0]}`);

    expect(
      errors.length / BURST,
      "有請求在連線池排隊時直接爆掉——登入尖峰會有人換不到票",
    ).toBeLessThan(0.01);
    expect(nonOk, "有人拿到了非 200 的回應").toHaveLength(0);
    // 連線池只有 10 條，300 併發必然排隊；重點是「排隊而不是失敗」，
    // 但 p95 若超過 connectionTimeoutMillis(5s) 就會開始有人直接失敗。
    expect(stats.p95, "authorize p95 逼近連線逾時，再多人就會開始掉票").toBeLessThan(5000);
    trackRss("authorize 灌爆");
  });

  it("全校同時登入：每個人各換一次票，一張都不能掉", async () => {
    const { wallMs, ok, errors } = await blast(USERS, (i) =>
      fetch(authorizeUrl(), {
        headers: { Cookie: `${SESSION_COOKIE}=${sessions[i]}` },
        redirect: "manual",
      }),
    );
    const failed = ok.filter((o) => o.status !== 200).length + errors.length;
    console.log(
      `  ▸ ${USERS} 人各換一次票：牆鐘 ${Math.round(wallMs)}ms・失敗 ${failed}・` +
        `吞吐 ${Math.round((USERS / wallMs) * 1000)}票/秒`,
    );
    expect(failed).toBe(0);
    trackRss("全員換票");
  });

  it("同一個人連開多個服務：多條登入流程並存，cookie 不會無限長大", async () => {
    const browser = new Browser();
    // 連開 20 次登入（比實際多分頁還誇張），看 cookie 有沒有被淘汰機制收住
    for (let i = 0; i < 20; i++) {
      await browser.fetch(
        `/api/auth/login?redirect_uri=${encodeURIComponent(`http://s${i}.${HOST_SUFFIX}/`)}`,
      );
    }
    const flowCookies = browser.names().filter((n) => n.startsWith("oauth_flow_"));
    console.log(`  ▸ 連開 20 次登入後，殘留的流程 cookie：${flowCookies.length} 條`);
    expect(flowCookies.length, "流程 cookie 沒有被淘汰，header 會越來越大").toBeLessThanOrEqual(6);

    const headerBytes = Buffer.byteLength(browser.cookieHeader());
    console.log(`  ▸ Cookie header 大小：${headerBytes} bytes`);
    // nginx 預設 large_client_header_buffers 單行 8k
    expect(headerBytes, "Cookie header 逼近 nginx 的 8k 上限").toBeLessThan(4000);
  });

  it("PostgreSQL 連線被砍光（模擬 PG 重啟）之後仍能發票", async () => {
    const killed = await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = 't_auth_test' AND pid <> pg_backend_pid()`,
    );
    console.log(`  ▸ 砍掉 ${killed.length} 條 DB 連線`);
    expect(appAlive(), "砍 DB 連線之後 auth 死了").toBe(true);

    let ok = false;
    let lastStatus = 0;
    for (let i = 0; i < 5 && !ok; i++) {
      const res = await fetch(authorizeUrl(), {
        headers: { Cookie: `${SESSION_COOKIE}=${sessions[0]}` },
        redirect: "manual",
      });
      await res.arrayBuffer();
      lastStatus = res.status;
      ok = res.status === 200;
    }
    expect(ok, `PG 連線被砍後再也發不出票（最後狀態 ${lastStatus}）`).toBe(true);
    expect(appLog()).not.toContain("uncaughtException");
    trackRss("PG 連線被砍");
  });

  it("DB 有資料時也一樣快（權限查詢不會隨人數退化）", async () => {
    // 灌一批 Grant 進去，模擬真實環境的權限資料量
    const emails = Array.from({ length: 300 }, (_, i) => `g${i}@${EMAIL_DOMAIN}`);
    for (let i = 0; i < emails.length; i += 50) {
      await Promise.all(
        emails.slice(i, i + 50).map((email) =>
          grant({ email, serviceId: "vote", role: i % 3 === 0 ? "moderator" : "default" }),
        ),
      );
    }
    const { stats, errors } = await blast(BURST, (i) =>
      fetch(authorizeUrl(), {
        headers: { Cookie: `${SESSION_COOKIE}=${sessions[i % sessions.length]}` },
        redirect: "manual",
      }),
    );
    console.log(`  ▸ DB 有 ${emails.length} 筆 Grant 後的 authorize：p50 ${stats.p50}ms・p95 ${stats.p95}ms`);
    expect(errors).toHaveLength(0);
    expect(stats.p95).toBeLessThan(5000);
    trackRss("有資料時換票");
  });

  // 極限探測：故意打到超過單一 Node process 的 accept 能力。
  // 這裡**不要求零失敗**——真實環境前面有 nginx 吸收連線，裸連線直達 Node 的情境不會發生。
  // 要保證的是另外兩件事：打爆的當下服務不會倒，以及壓力一撤就立刻恢復正常。
  // 實測（本機、單 process）：800 併發零失敗；2000 併發約 15-20% 連線被拒，
  // 但 server 沒有 uncaughtException、沒有 OOM，後續請求全部正常。
  it("極限探測：打到連線被拒也不能倒，壓力一撤要立刻恢復", async () => {
    const EXTREME = BURST * 4;
    const { wallMs, ok, errors } = await blast(EXTREME, (i) =>
      fetch(authorizeUrl(), {
        headers: { Cookie: `${SESSION_COOKIE}=${sessions[i % sessions.length]}` },
        redirect: "manual",
      }),
    );
    const refusedRate = errors.length / EXTREME;
    console.log(
      `  ▸ 極限 ${EXTREME} 併發：牆鐘 ${Math.round(wallMs)}ms・連線被拒 ${errors.length}` +
        `（${Math.round(refusedRate * 100)}%）・成功 ${ok.length}`,
    );

    expect(appAlive(), "被打爆之後 auth 死了").toBe(true);
    expect(appLog(), "被打爆時出現未捕捉的例外").not.toContain("uncaughtException");
    expect(appLog(), "被打爆時 V8 heap 耗盡").not.toContain("heap out of memory");
    // 被拒的是連線，不是業務邏輯——凡是連上的都要拿到票。
    expect(ok.every((o) => o.status === 200), "有連上的請求拿到非 200").toBe(true);

    // 壓力一撤，立刻要能正常服務。
    const recovery = await fetch(authorizeUrl(), {
      headers: { Cookie: `${SESSION_COOKIE}=${sessions[0]}` },
      redirect: "manual",
    });
    await recovery.arrayBuffer();
    expect(recovery.status, "壓力撤掉之後仍然發不出票").toBe(200);
    trackRss("極限探測");
  });

  it("記憶體軌跡：不能逼近 pm2 的重啟門檻", () => {
    console.log(`  ▸ RSS 軌跡：${rssTrack.map((r) => `${r.label}=${r.mb ?? "?"}MB`).join(" → ")}`);
    const peak = Math.max(...rssTrack.map((r) => r.mb ?? 0));
    console.log(`  ▸ 峰值 RSS：${peak}MB（pm2 重啟門檻 1024MB、V8 heap 上限 384MB）`);
    expect(peak, "峰值逼近 pm2 的 1G 門檻，會觸發重啟迴圈（2026-09-02 的老路）").toBeLessThan(800);
    expect(appAlive(), "壓測結束時 auth 已經不在了").toBe(true);
  });
});
