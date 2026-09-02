// 一次性灌資料：把 AUTH_GROUPS（env JSON）搬進 DB（Subject + Grant）。
// 冪等——用 upsert，重跑不重複、不覆蓋別人手動在 panel 調過的 role/restriction。
// Phase 7（2026-07-27）：groups claim 已從程式碼全面移除，本腳本是唯一還讀 AUTH_GROUPS 的地方，
// 只為正式站一次性遷移保留（直接讀 process.env，不 import src/config/auth.ts，兩者已解耦）。
// 正式站 seed 完成後即可從主機 .env 刪除 AUTH_GROUPS，屆時本腳本亦可一併刪除。
import { loadEnvConfig } from "@next/env";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// 腳本不經 Next 路由，process.env 不會自動載入 .env / .env.local；明確載入。
loadEnvConfig(process.cwd());

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

type GroupMap = Record<string, Record<string, string[]>>;

function parseGroups(raw: string | undefined): GroupMap {
  if (!raw || !raw.trim()) return {};
  const parsed = JSON.parse(raw) as GroupMap;
  const out: GroupMap = {};
  for (const [email, perService] of Object.entries(parsed)) {
    out[email.toLowerCase()] = perService;
  }
  return out;
}

// AUTH_GROUPS 語意：super-admin ∈ groups → role admin；否則 admin ∈ groups → role moderator。
function roleFromGroups(groups: string[]) {
  if (groups.includes("super-admin")) return "admin";
  if (groups.includes("admin")) return "moderator";
  return "default";
}

async function main() {
  const groupMap = parseGroups(process.env.AUTH_GROUPS);
  const emails = Object.keys(groupMap);
  if (emails.length === 0) {
    console.log("AUTH_GROUPS 是空的，沒有東西可灌。");
    return;
  }

  let subjectCount = 0;
  let grantCount = 0;

  for (const email of emails) {
    const subject = await prisma.subject.upsert({
      where: { email },
      update: {},
      create: { email },
    });
    subjectCount += 1;

    for (const [serviceId, groups] of Object.entries(groupMap[email])) {
      const role = roleFromGroups(groups);
      if (role === "default") continue; // 沒有 admin/super-admin 群組的不用建 Grant

      await prisma.grant.upsert({
        where: { subjectId_serviceId: { subjectId: subject.id, serviceId } },
        update: { role },
        create: { subjectId: subject.id, serviceId, role },
      });
      grantCount += 1;
    }
  }

  console.log(`✅ seed 完成：${subjectCount} 個 Subject、${grantCount} 筆 Grant（來源 AUTH_GROUPS）`);
}

main()
  .catch((err) => {
    console.error("✗ seed 失敗：", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
