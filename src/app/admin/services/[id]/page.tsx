// /admin/services/[id]：服務視角——本服務的 admin/moderator 名單、目前生效中的 ban/warning 名單。
import { notFound } from "next/navigation";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { authConfig } from "@/config/auth";
import { viewerIsAuthAdmin, canViewPanel } from "@/lib/admin-guard";
import { listGrantsForService } from "@/lib/permissions/repo";
import { toEntry } from "@/lib/permissions/resolve";
import { formatDateTime } from "@/lib/format-time";
import { Card, Badge, LinkButton } from "@/components/admin/primitives";

function isValidServiceId(id: string): boolean {
  return id === "auth" || authConfig.serviceIds.includes(id);
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // 守門要在任何查詢之前：layout 的 Forbidden 只擋畫面，擋不住這支函式繼續跑，
  // 查到的東西會進 RSC payload 送給瀏覽器（見 lib/admin-guard.ts 的說明）。
  if (!(await canViewPanel())) return null;

  const { id } = await params;
  if (!isValidServiceId(id)) notFound();

  const [grants, canBulk] = await Promise.all([
    listGrantsForService(id),
    viewerIsAuthAdmin(),
  ]);

  const admins = grants.filter((g) => g.role === "admin");
  const moderators = grants.filter((g) => g.role === "moderator");
  // ban/warning 只列「目前生效中」的（toEntry 已套用到期邏輯）——過期的管制不該再嚇人。
  const activeBans = grants.filter((g) => toEntry(g).restriction === "ban");
  const activeWarnings = grants.filter((g) => toEntry(g).restriction === "warning");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl font-extrabold tracking-tight">{id}</h1>
          <p className="mt-1 font-medium text-muted-foreground">服務視角：角色與管制名單。</p>
        </div>
        {/* 「幫這個服務加幹部」最自然的入口就在這頁——把 serviceId 帶過去預先勾好。
            批次改的是角色，版主不能改角色，所以按鈕只給管理員。 */}
        {canBulk && (
          <LinkButton href={`/admin/bulk?service=${encodeURIComponent(id)}`} variant="primary">
            <UserPlus className="h-4 w-4" />
            批次加人
          </LinkButton>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ListCard title="管理員" tone="violet" rows={admins} />
        <ListCard title="版主" tone="blue" rows={moderators} />
        <ListCard
          title="禁止瀏覽（生效中）"
          tone="rose"
          rows={activeBans}
          showReason
        />
        <ListCard
          title="警告中（生效中）"
          tone="orange"
          rows={activeWarnings}
          showReason
        />
      </div>
    </div>
  );
}

// Tailwind 是靜態掃描 class 字面值，模板字串組出來的 class 名不會被收進 CSS——
// 一律用完整字面值的對照表，不要用 `bg-tone-${tone}-badge` 這種動態拼法。
const TONE_BADGE: Record<"violet" | "blue" | "rose" | "orange", string> = {
  violet: "bg-tone-violet-badge text-tone-violet-text",
  blue: "bg-tone-blue-badge text-tone-blue-text",
  rose: "bg-tone-rose-badge text-tone-rose-text",
  orange: "bg-tone-orange-badge text-tone-orange-text",
};

function ListCard({
  title,
  tone,
  rows,
  showReason = false,
}: {
  title: string;
  tone: "violet" | "blue" | "rose" | "orange";
  rows: Array<{
    id: string;
    reason: string | null;
    expiresAt: Date | null;
    subject: { email: string };
  }>;
  showReason?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <h2 className="font-extrabold text-lg">{title}</h2>
        <Badge className={TONE_BADGE[tone]}>{rows.length}</Badge>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 font-medium text-muted-foreground">目前沒有人。</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="border-b border-foreground/10 pb-3 last:border-0 last:pb-0">
              <Link
                href={`/admin/people/${encodeURIComponent(r.subject.email)}`}
                className="font-mono text-sm font-bold hover:underline"
              >
                {r.subject.email}
              </Link>
              {showReason && r.reason && (
                <p className="mt-1 text-sm font-medium text-muted-foreground">「{r.reason}」</p>
              )}
              {r.expiresAt && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  到期：{formatDateTime(r.expiresAt)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
