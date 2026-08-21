// /admin/people/[email]：主力編輯頁。每個 serviceId 一列 role/restriction/reason/到期。
import { notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getAuthPerm } from "@/lib/admin-guard";
import { authConfig } from "@/config/auth";
import { findSubjectWithGrants } from "@/lib/permissions/repo";
import { isValidEmail } from "@/lib/permissions/parse-emails";
import { toEntry } from "@/lib/permissions/resolve";
import { Card, Badge } from "@/components/admin/primitives";
import { GrantRow, ROLE_RANK } from "./GrantRow";
import { DangerZone } from "./DangerZone";
import { EntryYearCard } from "./EntryYearCard";
import { parseEntryYearFromEmail, currentAcademicYear } from "@/lib/entry-year";
import type { Restriction, Role } from "@/lib/permissions/types";

export default async function PersonPage({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const { email: emailParam } = await params;
  const email = decodeURIComponent(emailParam).toLowerCase();

  // layout 已擋過未登入／無權限，這裡的 session 理論上必存在；仍照型別走 optional chaining。
  const session = await getSession();
  const perm = session ? await getAuthPerm(session) : null;
  const canChangeRole = perm?.role === "admin";

  // 網址是使用者打得出來的東西，先擋掉明顯不是 email 的字串，別讓後面的儲存把垃圾寫進 DB。
  if (!isValidEmail(email)) notFound();

  const isSuperadmin = authConfig.superadmins.includes(email);
  const subject = isSuperadmin ? null : await findSubjectWithGrants(email);

  // 沒有 Subject 記錄不再是死路——照常顯示一份全 default 的空白列，按下儲存才會建 row
  // （saveGrant 會自己 upsert）。純瀏覽不寫入，所以亂打網址也不會生出髒資料。
  const isNew = !isSuperadmin && !subject;

  const serviceIds = [...new Set([...authConfig.serviceIds, "auth"])];
  const grantByService = new Map((subject?.grants ?? []).map((g) => [g.serviceId, g]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-extrabold tracking-tight">{email}</h1>
        {subject?.name && <p className="mt-1 font-medium text-muted-foreground">{subject.name}</p>}
        {isNew && (
          <p className="mt-1 font-medium text-muted-foreground">
            尚未建立記錄——設定任一服務的權限後就會自動建立。
          </p>
        )}
      </div>

      {!isSuperadmin && (
        <EntryYearCard
          email={email}
          initialOverride={subject?.entryYearOverride ?? null}
          derivedFromEmail={parseEntryYearFromEmail(email)}
          academicYear={currentAcademicYear()}
          ttlSeconds={authConfig.jwt.ttlSeconds}
        />
      )}

      {isSuperadmin ? (
        <Card>
          <Badge className="bg-tone-violet-badge text-tone-violet-text">
            生態總管（AUTH_SUPERADMINS）
          </Badge>
          <p className="mt-3 font-medium text-muted-foreground">
            此帳號由環境變數指定為所有服務的管理員，恆為 admin、不進 DB、不可在此調整。
          </p>
        </Card>
      ) : (
        <Card>
          <ul>
            {serviceIds.map((serviceId) => {
              const grant = grantByService.get(serviceId);
              const isSelfAuthRow =
                serviceId === "auth" && email === session?.email.toLowerCase();
              const currentRank = ROLE_RANK[(grant?.role as Role | undefined) ?? "default"];
              return (
                <GrantRow
                  key={serviceId}
                  email={email}
                  serviceId={serviceId}
                  initialRole={(grant?.role as Role | undefined) ?? "default"}
                  initialRestriction={(grant?.restriction as Restriction | undefined) ?? "none"}
                  initialReason={grant?.reason ?? ""}
                  initialExpiresAt={grant?.expiresAt?.toISOString() ?? null}
                  canChangeRole={canChangeRole}
                  minRoleRank={isSelfAuthRow ? currentRank : 0}
                  ttlSeconds={authConfig.jwt.ttlSeconds}
                />
              );
            })}
          </ul>
        </Card>
      )}

      {/* 刪除只給 admin（版主連角色都不能改，更不該能把人整筆抹掉）。 */}
      {!isSuperadmin && subject && canChangeRole && (
        <DangerZone
          email={email}
          grantCount={subject.grants.length}
          activeRestrictionCount={
            subject.grants.filter((g) => toEntry(g).restriction !== undefined).length
          }
        />
      )}
    </div>
  );
}
