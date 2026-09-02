import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// 先 .env.local 再 .env：跟 Next 一樣的優先序。Prisma 7 的 CLI 不再自己讀 env 檔，
// 這一行同時消掉「Prisma CLI 只讀 .env」那個長期坑。
config({ path: [".env.local", ".env"] });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
