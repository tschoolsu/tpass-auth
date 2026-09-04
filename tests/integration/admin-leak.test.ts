// /admin 的資料外洩測試。
//
// layout 擋住畫面 ≠ 頁面沒有執行。Next 的 layout 與 page 是並行渲染的：layout 判斷
// 「沒有權限」而回傳 Forbidden 元件時，page 早就查完 DB 了，那些資料會跟著進 RSC payload
// 一起送到瀏覽器——使用者按 view-source 就看得到。
//
// 這裡測的是「送出去的整份回應裡不能出現後台資料」，不是「畫面上看不到」。
import { describe, it, expect, beforeAll } from "vitest";
import { Browser } from "../helpers/browser";
import { prisma, resetDb, grant } from "../helpers/db";
import { signAuthSession, STUDENT, type TestUser } from "../helpers/session";
import { EMAIL_DOMAIN, SESSION_COOKIE, SUPERADMIN_EMAIL } from "../helpers/env";

// 這些字串只會出現在後台資料裡。只要在回應中看到任何一個，就代表洩漏。
const SECRET_EMAIL = `victim-secret@${EMAIL_DOMAIN}`;
const SECRET_REASON = "洩漏測試用的管制理由";
const SECRET_ACTOR = `actor-secret@${EMAIL_DOMAIN}`;

async function browserFor(user: TestUser): Promise<Browser> {
  const b = new Browser();
  b.set(SESSION_COOKIE, await signAuthSession(user));
  return b;
}

const ADMIN_PAGES = [
  "/admin",
  "/admin/people",
  "/admin/audit",
  "/admin/bulk",
  "/admin/services/vote",
  `/admin/people/${encodeURIComponent(SECRET_EMAIL)}`,
];

describe("/admin 不得把後台資料送給沒有權限的人", () => {
  beforeAll(async () => {
    await resetDb();
    // 放一些「只有選委／管理員該看到」的資料進去
    await grant({
      email: SECRET_EMAIL,
      serviceId: "vote",
      role: "moderator",
      restriction: "ban",
      reason: SECRET_REASON,
    });
    await prisma.auditLog.create({
      data: {
        actorEmail: SECRET_ACTOR,
        targetEmail: SECRET_EMAIL,
        serviceId: "vote",
        action: "grant.update",
        before: { role: "default" },
        after: { role: "moderator", reason: SECRET_REASON },
      },
    });
  });

  it("一般登入使用者拿到的回應裡不該有任何後台資料", async () => {
    const browser = await browserFor(STUDENT);
    for (const path of ADMIN_PAGES) {
      const res = await browser.fetch(path, { redirect: "follow" });
      const body = await res.text();
      expect(body, `${path} 洩漏了被管制者的 email`).not.toContain(SECRET_EMAIL);
      expect(body, `${path} 洩漏了管制理由`).not.toContain(SECRET_REASON);
      expect(body, `${path} 洩漏了稽核紀錄的操作者`).not.toContain(SECRET_ACTOR);
    }
  });

  it("未登入者也一樣（連查詢都不該發生）", async () => {
    const browser = new Browser();
    for (const path of ADMIN_PAGES) {
      const res = await browser.fetch(path, { redirect: "follow" });
      const body = await res.text();
      expect(body, `${path} 對未登入者洩漏了資料`).not.toContain(SECRET_EMAIL);
      expect(body, `${path} 對未登入者洩漏了管制理由`).not.toContain(SECRET_REASON);
    }
  });

  it("有權限的人當然看得到（確認上面的斷言不是因為頁面壞掉才通過）", async () => {
    const browser = await browserFor({ email: SUPERADMIN_EMAIL });
    const res = await browser.fetch("/admin/audit", { redirect: "follow" });
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body, "管理員也看不到資料＝頁面本身壞了，前面的測試不算數").toContain(SECRET_ACTOR);
  });

  it("moderator 看得到人員頁，但管理員專屬入口不對他開放", async () => {
    const mod = `mod@${EMAIL_DOMAIN}`;
    await grant({ email: mod, serviceId: "auth", role: "moderator" });
    const browser = await browserFor({ email: mod });

    const people = await browser.fetch("/admin/people", { redirect: "follow" });
    expect(people.status).toBe(200);

    // bulk 是 admin 專屬
    const bulk = await browser.fetch("/admin/bulk", { redirect: "follow" });
    const body = await bulk.text();
    expect(body, "版主拿到了批次授權頁的內容").not.toContain(SECRET_EMAIL);
  });
});
