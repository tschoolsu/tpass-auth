// /admin/people：人員列表＋分頁＋搜尋（email／姓名）＋服務/狀態篩選。
import Link from "next/link";
import { UserPlus, Search } from "lucide-react";
import { authConfig } from "@/config/auth";
import { viewerIsAuthAdmin, canViewPanel } from "@/lib/admin-guard";
import { listSubjects, type SubjectStatusFilter } from "@/lib/permissions/repo";
import { Card, Input, Select, Button, LinkButton, Label } from "@/components/admin/primitives";
import { PermBadge } from "@/components/admin/PermBadge";
import type { Role, Restriction } from "@/lib/permissions/types";

const PAGE_SIZE = 20;

const STATUS_OPTIONS: Array<{ value: SubjectStatusFilter; label: string }> = [
  { value: "admin", label: "管理員" },
  { value: "moderator", label: "版主" },
  { value: "warning", label: "警告中" },
  { value: "ban", label: "禁止瀏覽" },
];

function parseStatus(raw: string | undefined): SubjectStatusFilter | undefined {
  return STATUS_OPTIONS.some((o) => o.value === raw)
    ? (raw as SubjectStatusFilter)
    : undefined;
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; service?: string; status?: string; page?: string }>;
}) {
  // 守門要在任何查詢之前：layout 的 Forbidden 只擋畫面，擋不住這支函式繼續跑，
  // 查到的東西會進 RSC payload 送給瀏覽器（見 lib/admin-guard.ts 的說明）。
  if (!(await canViewPanel())) return null;

  const { q, service, status: statusRaw, page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw) || 1);
  const serviceIds = [...new Set([...authConfig.serviceIds, "auth"])];

  const serviceId = service && serviceIds.includes(service) ? service : undefined;
  const status = parseStatus(statusRaw);
  const canBulk = await viewerIsAuthAdmin();

  const { subjects, total } = await listSubjects({
    query: q,
    serviceId,
    status,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const query = (extra: Record<string, string | number>) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (serviceId) params.set("service", serviceId);
    if (status) params.set("status", status);
    for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
    return `/admin/people?${params.toString()}`;
  };

  const filtered = Boolean(q || serviceId || status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">人員</h1>
          <p className="mt-1 font-medium text-muted-foreground">
            {filtered ? `符合條件 ${total} 位。` : `共 ${total} 位。`}
          </p>
        </div>
        {/* 批次改的是角色，版主不能改角色——按鈕不給看不到結果的人。 */}
        {canBulk && (
          <LinkButton href="/admin/bulk" variant="primary">
            <UserPlus className="h-4 w-4" />
            批次加人
          </LinkButton>
        )}
      </div>

      <form action="/admin/people" method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="q">搜尋</Label>
          <Input
            id="q"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="email 或姓名…"
            className="mt-1 w-56"
          />
        </div>
        <div>
          <Label htmlFor="service">服務</Label>
          <Select id="service" name="service" defaultValue={serviceId ?? ""} className="mt-1 w-36">
            <option value="">全部</option>
            {serviceIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="status">狀態</Label>
          <Select id="status" name="status" defaultValue={status ?? ""} className="mt-1 w-36">
            <option value="">全部</option>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="default">
          <Search className="h-4 w-4" />
          篩選
        </Button>
        {filtered && (
          <LinkButton href="/admin/people">清除</LinkButton>
        )}
      </form>

      <Card className="overflow-x-auto">
        {subjects.length === 0 ? (
          <p className="font-medium text-muted-foreground">
            {filtered ? "找不到符合條件的人員。" : "還沒有任何人員。"}
          </p>
        ) : (
          <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-foreground/20">
                <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">Email</th>
                <th className="py-2 pr-4 font-mono text-xs font-bold text-muted-foreground">姓名</th>
                <th className="py-2 font-mono text-xs font-bold text-muted-foreground">權限</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => {
                const notable = s.grants.filter(
                  (g) => g.role !== "default" || g.restriction !== "none",
                );
                return (
                  <tr key={s.id} className="border-b border-foreground/10 last:border-0">
                    <td className="py-2 pr-4">
                      <Link
                        href={`/admin/people/${encodeURIComponent(s.email)}`}
                        className="font-mono text-xs font-bold hover:underline"
                      >
                        {s.email}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 font-medium">
                      {/* name 只有本人登入過才會由 upsertSubjectOnLogin 回填——
                          批次建的人在他自己登入前這欄必然是空的，講明白比留一個「—」好。 */}
                      {s.name ?? (
                        <span className="font-mono text-xs text-muted-foreground">尚未登入</span>
                      )}
                    </td>
                    <td className="py-2">
                      {notable.length === 0 ? (
                        <span className="font-mono text-xs text-muted-foreground">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-2">
                          {notable.map((g) => (
                            <span key={g.id} className="inline-flex items-center gap-1">
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {g.serviceId}
                              </span>
                              <PermBadge
                                role={g.role as Role}
                                restriction={g.restriction as Restriction}
                              />
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          {/* 停用狀態維持 <Button disabled>——被停用的連結不是東西。 */}
          {page <= 1 ? (
            <Button variant="default" size="sm" disabled>
              上一頁
            </Button>
          ) : (
            <LinkButton href={query({ page: page - 1 })} size="sm">
              上一頁
            </LinkButton>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            第 {page} / {totalPages} 頁
          </span>
          {page >= totalPages ? (
            <Button variant="default" size="sm" disabled>
              下一頁
            </Button>
          ) : (
            <LinkButton href={query({ page: page + 1 })} size="sm">
              下一頁
            </LinkButton>
          )}
        </div>
      )}
    </div>
  );
}
