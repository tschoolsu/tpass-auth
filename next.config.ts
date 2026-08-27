import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 把既有的 PORTAL_URL 帶進前端 bundle：錯誤頁（client component）要用它組出
  // 「回門戶大廳」與「回報問題」的網址。值在 build 時決定，不新增必填 env。
  env: {
    NEXT_PUBLIC_PORTAL_URL: process.env.PORTAL_URL ?? "",
  },
};

export default nextConfig;
