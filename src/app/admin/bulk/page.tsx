// /admin/bulk：批次授權——貼一批 email、勾服務、選角色。
// 存在的理由：學期初拿到一份幹部名單要一次給權限，逐人逐服務點是 200 次以上的互動。
import { authConfig } from "@/config/auth";
import { viewerIsAuthAdmin, canViewPanel } from "@/lib/admin-guard";
import { Forbidden } from "@/components/admin/Forbidden";
import { BulkGrantForm } from "./BulkGrantForm";

export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string }>;
}) {
  // 守門要在任何查詢之前：layout 的 Forbidden 只擋畫面，擋不住這支函式繼續跑，
  // 查到的東西會進 RSC payload 送給瀏覽器（見 lib/admin-guard.ts 的說明）。
  if (!(await canViewPanel("admin"))) return null;

  // layout 只擋到版主，但批次改的是角色——版主本來就不能改角色。
  // 不擋在這裡的話，版主會看到一份填得完、按下去卻只會被 action 拒絕的表單。
  if (!(await viewerIsAuthAdmin())) {
    return <Forbidden message="批次授權會變更角色，只開放給管理員。版主可以調整個別人員的管制狀態。" />;
  }

  const { service } = await searchParams;
  const serviceIds = [...new Set([...authConfig.serviceIds, "auth"])];

  // 從服務頁按「批次加人」進來時預先勾好那個服務；亂帶的值忽略。
  const preselected = service && serviceIds.includes(service) ? [service] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">批次授權</h1>
        <p className="mt-1 font-medium text-muted-foreground">
          貼上 email 就好——換行、逗號、分號、空白都能分隔，重複的會自動去掉。
          沒建過的人會一併建立，不必先新增。
        </p>
      </div>

      <BulkGrantForm
        serviceIds={serviceIds}
        preselected={preselected}
        ttlSeconds={authConfig.jwt.ttlSeconds}
        emailDomain={authConfig.allowedEmailDomain}
      />
    </div>
  );
}
