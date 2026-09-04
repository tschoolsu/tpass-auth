// /admin 總覽：統計卡＋email 搜尋（導向人員頁）＋最近 10 筆稽核紀錄。
import Link from "next/link";
import { Search } from "lucide-react";
import { authConfig } from "@/config/auth";
import { countSubjects, listRecentAuditLogs, roleStats, restrictionStats } from "@/lib/permissions/repo";
import { formatDateTime } from "@/lib/format-time";
import { Card, Input, Button } from "@/components/admin/primitives";
import { canViewPanel } from "@/lib/admin-guard";

export default async function AdminOverviewPage() {
  // 守門要在任何查詢之前：layout 的 Forbidden 只擋畫面，擋不住這支函式繼續跑，
  // 查到的東西會進 RSC payload 送給瀏覽器（見 lib/admin-guard.ts 的說明）。
  if (!(await canViewPanel())) return null;

  const serviceIds = [...new Set([...authConfig.serviceIds, "auth"])];

  const [totalSubjects, roles, restrictions, recentAudit] = await Promise.all([
    countSubjects(),
    roleStats(),
    restrictionStats(),
    listRecentAuditLogs(10),
  ]);

  const banCount = restrictions.find((r) => r.restriction === "ban")?._count ?? 0;
  const warningCount = restrictions.find((r) => r.restriction === "warning")?._count ?? 0;

  // serviceId → { admin, moderator }
  const roleByService = new Map<string, { admin: number; moderator: number }>(
    serviceIds.map((id) => [id, { admin: 0, moderator: 0 }]),
  );
  for (const row of roles) {
    const bucket = roleByService.get(row.serviceId);
    if (!bucket) continue;
    if (row.role === "admin") bucket.admin = row._count;
    if (row.role === "moderator") bucket.moderator = row._count;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">總覽</h1>
        <p className="mt-1 font-medium text-muted-foreground">
          T-Pass 生態系權限狀態一覽。
        </p>
      </div>

      {/* email 搜尋 → 導向人員列表 */}
      <form action="/admin/people" method="get" className="flex max-w-md gap-2">
        <Input type="search" name="q" placeholder="搜尋 email…" aria-label="搜尋 email" />
        <Button type="submit" variant="primary">
          <Search className="h-4 w-4" />
          搜尋
        </Button>
      </form>

      {/* 統計卡 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="font-mono text-xs font-bold text-muted-foreground">總人數</p>
          <p className="mt-2 text-3xl font-extrabold">{totalSubjects}</p>
        </Card>
        <Card>
          <p className="font-mono text-xs font-bold text-muted-foreground">禁止瀏覽</p>
          <p className="mt-2 text-3xl font-extrabold text-tone-rose-text">{banCount}</p>
        </Card>
        <Card>
          <p className="font-mono text-xs font-bold text-muted-foreground">警告中</p>
          <p className="mt-2 text-3xl font-extrabold text-tone-orange-text">{warningCount}</p>
        </Card>
        <Card>
          <p className="font-mono text-xs font-bold text-muted-foreground">服務數</p>
          <p className="mt-2 text-3xl font-extrabold">{serviceIds.length}</p>
        </Card>
      </div>

      {/* 各服務角色分佈 */}
      <Card className="overflow-x-auto">
        <h2 className="font-extrabold text-lg">各服務角色分佈</h2>
        <table className="mt-4 w-full min-w-[28rem] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b-2 border-foreground/20">
              <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">服務</th>
              <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">管理員</th>
              <th className="py-2 font-mono text-xs font-bold text-muted-foreground">版主</th>
            </tr>
          </thead>
          <tbody>
            {serviceIds.map((id) => {
              const bucket = roleByService.get(id)!;
              return (
                <tr key={id} className="border-b border-foreground/10 last:border-0">
                  <td className="py-2 pr-4">
                    <Link href={`/admin/services/${id}`} className="font-mono font-bold hover:underline">
                      {id}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-bold">{bucket.admin}</td>
                  <td className="py-2 font-bold">{bucket.moderator}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* 最近稽核紀錄 */}
      <Card className="overflow-x-auto">
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold text-lg">最近稽核紀錄</h2>
          <Link href="/admin/audit" className="text-sm font-bold text-accent hover:underline">
            查看全部 →
          </Link>
        </div>
        {recentAudit.length === 0 ? (
          <p className="mt-4 font-medium text-muted-foreground">尚無紀錄。</p>
        ) : (
          <table className="mt-4 w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-foreground/20">
                <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">時間</th>
                <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">操作者</th>
                <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">對象</th>
                <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">服務</th>
                <th className="py-2 font-mono text-xs font-bold text-muted-foreground">動作</th>
              </tr>
            </thead>
            <tbody>
              {recentAudit.map((log) => (
                <tr key={log.id} className="border-b border-foreground/10 last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {formatDateTime(log.at)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.actorEmail}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/people/${encodeURIComponent(log.targetEmail)}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {log.targetEmail}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.serviceId}</td>
                  <td className="py-2 font-mono text-xs font-bold">{log.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
