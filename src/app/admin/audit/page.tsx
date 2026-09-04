// /admin/audit：稽核紀錄列表＋分頁，可依 targetEmail / serviceId 過濾。
// 一次批次授權會寫入數十筆同時間、同操作者的 role.change——逐列印出來會把畫面灌爆，
// 所以連續且同組的列會摺成一列，展開才看細項。
import Link from "next/link";
import { authConfig } from "@/config/auth";
import { listAuditLogs } from "@/lib/permissions/repo";
import { describeAudit } from "@/lib/audit-describe";
import { formatDateTime } from "@/lib/format-time";
import { Card, Input, Select, Button, LinkButton, Label } from "@/components/admin/primitives";
import { canViewPanel } from "@/lib/admin-guard";

const PAGE_SIZE = 30;

type Log = Awaited<ReturnType<typeof listAuditLogs>>["logs"][number];

// 連續且 (at, actorEmail, action) 相同的列＝同一次批次操作。
// 用「連續」而不是全域分組：列表本來就按 at desc 排序，這個假設夠弱——
// 萬一摺不起來就退化成逐列顯示，不會顯示錯的東西。分頁邊界可能切開一組，可接受。
function groupLogs(logs: Log[]): Log[][] {
  const groups: Log[][] = [];
  for (const log of logs) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    if (
      head &&
      head.at.getTime() === log.at.getTime() &&
      head.actorEmail === log.actorEmail &&
      head.action === log.action
    ) {
      last.push(log);
    } else {
      groups.push([log]);
    }
  }
  return groups;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ targetEmail?: string; serviceId?: string; page?: string }>;
}) {
  // 守門要在任何查詢之前：layout 的 Forbidden 只擋畫面，擋不住這支函式繼續跑，
  // 查到的東西會進 RSC payload 送給瀏覽器（見 lib/admin-guard.ts 的說明）。
  if (!(await canViewPanel())) return null;

  const { targetEmail, serviceId, page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw) || 1);
  const serviceIds = [...new Set([...authConfig.serviceIds, "auth"])];

  const { logs, total } = await listAuditLogs({
    targetEmail,
    serviceId,
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const groups = groupLogs(logs);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">稽核紀錄</h1>
        <p className="mt-1 font-medium text-muted-foreground">共 {total} 筆。</p>
      </div>

      <form action="/admin/audit" method="get" className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="targetEmail">對象 email</Label>
          <Input
            id="targetEmail"
            name="targetEmail"
            defaultValue={targetEmail ?? ""}
            placeholder="留空＝全部"
            className="mt-1 w-56"
          />
        </div>
        <div>
          <Label htmlFor="serviceId">服務</Label>
          <Select id="serviceId" name="serviceId" defaultValue={serviceId ?? ""} className="mt-1 w-40">
            <option value="">全部</option>
            {serviceIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="primary">
          篩選
        </Button>
      </form>

      <Card>
        {groups.length === 0 ? (
          <p className="font-medium text-muted-foreground">沒有符合條件的紀錄。</p>
        ) : (
          <ul className="space-y-3">
            {groups.map((group) =>
              group.length === 1 ? (
                <SingleEntry key={group[0].id} log={group[0]} />
              ) : (
                <BatchEntry key={group[0].id} group={group} />
              ),
            )}
          </ul>
        )}
      </Card>

      {totalPages > 1 && (
        <PaginationLinks
          page={page}
          totalPages={totalPages}
          targetEmail={targetEmail}
          serviceId={serviceId}
        />
      )}
    </div>
  );
}

function Meta({ log }: { log: Log }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className="font-mono text-xs text-muted-foreground">{formatDateTime(log.at)}</span>
      <span className="font-mono text-xs font-bold">{log.actorEmail}</span>
    </div>
  );
}

function TargetLink({ email }: { email: string }) {
  return (
    <Link
      href={`/admin/people/${encodeURIComponent(email)}`}
      className="font-mono text-xs font-bold hover:underline"
    >
      {email}
    </Link>
  );
}

function RawJson({ log }: { log: Log }) {
  // 原始值是這張表的證據價值所在——人話描述只是導讀，不取代它。
  return (
    <details className="mt-1">
      <summary className="cursor-pointer font-mono text-[11px] text-accent">原始值</summary>
      <pre className="mt-1 max-w-full overflow-x-auto rounded-md border-2 border-foreground/20 bg-muted p-2 font-mono text-[10px]">
        {JSON.stringify({ before: log.before, after: log.after }, null, 2)}
      </pre>
    </details>
  );
}

function SingleEntry({ log }: { log: Log }) {
  return (
    <li className="border-b border-foreground/10 pb-3 last:border-0 last:pb-0">
      <Meta log={log} />
      <p className="mt-1 text-sm font-medium">
        對 <TargetLink email={log.targetEmail} /> 在{" "}
        <span className="font-mono text-xs font-bold">{log.serviceId}</span>{" "}
        {describeAudit(log)}
      </p>
      <RawJson log={log} />
    </li>
  );
}

function BatchEntry({ group }: { group: Log[] }) {
  const head = group[0];
  const people = new Set(group.map((l) => l.targetEmail)).size;
  const services = [...new Set(group.map((l) => l.serviceId))];

  return (
    <li className="border-b border-foreground/10 pb-3 last:border-0 last:pb-0">
      <Meta log={head} />
      <details>
        <summary className="mt-1 cursor-pointer text-sm font-medium">
          <span className="inline-block rounded-md border-2 border-foreground bg-tone-violet-badge px-2 py-0.5 font-mono text-[11px] font-bold text-tone-violet-text">
            批次 · {group.length} 筆
          </span>{" "}
          影響 {people} 人，服務：
          <span className="font-mono text-xs font-bold">{services.join("、")}</span>
        </summary>
        <ul className="mt-2 space-y-2 border-l-2 border-foreground/20 pl-3">
          {group.map((log) => (
            <li key={log.id}>
              <p className="text-sm font-medium">
                <TargetLink email={log.targetEmail} /> ·{" "}
                <span className="font-mono text-xs">{log.serviceId}</span>{" "}
                <span className="text-muted-foreground">{describeAudit(log)}</span>
              </p>
              <RawJson log={log} />
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function PaginationLinks({
  page,
  totalPages,
  targetEmail,
  serviceId,
}: {
  page: number;
  totalPages: number;
  targetEmail?: string;
  serviceId?: string;
}) {
  const hrefFor = (p: number) => {
    const params = new URLSearchParams();
    if (targetEmail) params.set("targetEmail", targetEmail);
    if (serviceId) params.set("serviceId", serviceId);
    params.set("page", String(p));
    return `/admin/audit?${params.toString()}`;
  };
  return (
    <div className="flex items-center justify-between">
      {/* 停用狀態維持 <Button disabled>——被停用的連結不是東西，沒辦法用 aria 講清楚。 */}
      {page <= 1 ? (
        <Button variant="default" size="sm" disabled>
          上一頁
        </Button>
      ) : (
        <LinkButton href={hrefFor(page - 1)} size="sm">
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
        <LinkButton href={hrefFor(page + 1)} size="sm">
          下一頁
        </LinkButton>
      )}
    </div>
  );
}
