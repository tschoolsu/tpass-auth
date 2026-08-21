"use client";
// 入學屆別覆寫。休學復學者 email 沿用、學號前綴不變 → 年級會多算一級，這裡改算到正確的一屆。
// 存的是屆別不是年級：設定一次就永久正確，不必每年開學重標。
// 生效時間與權限變更同理（無狀態本地驗章，要等 token 換發），所以沿用 EffectiveAtNotice。
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEntryYear } from "@/app/admin/actions";
import { Button, Card, Input, Label } from "@/components/admin/primitives";
import { EffectiveAtNotice } from "@/components/admin/EffectiveAtNotice";

// 屆別 → 這學年度的年級標籤。超出高中三年（畢業／未入學／休學中）就不假裝知道。
function gradeLabel(entryYear: number | null, academicYear: number): string {
  if (entryYear === null) return "無屆別（非學生帳號）";
  const grade = academicYear - entryYear + 1;
  const zh = ["一", "二", "三"][grade - 1];
  return zh ? `高${zh}` : "不在高中三年範圍內";
}

export function EntryYearCard({
  email,
  initialOverride,
  derivedFromEmail,
  academicYear,
  ttlSeconds,
}: {
  email: string;
  initialOverride: number | null;
  derivedFromEmail: number | null;
  academicYear: number;
  ttlSeconds: number;
}) {
  const [value, setValue] = useState(
    initialOverride === null ? "" : String(initialOverride),
  );
  const [error, setError] = useState<string | null>(null);
  const [effectiveAt, setEffectiveAt] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function submit(entryYear: number | null) {
    setError(null);
    setEffectiveAt(null);
    startTransition(async () => {
      const result = await saveEntryYear({ email, entryYear });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEffectiveAt(Math.floor(Date.now() / 1000) + ttlSeconds);
      router.refresh();
    });
  }

  function onSave() {
    const trimmed = value.trim();
    if (trimmed === "") {
      setError("要恢復自動推算請按「恢復自動」");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      setError("請輸入民國學年度數字，例如 115");
      return;
    }
    submit(parsed);
  }

  function onClear() {
    setValue("");
    submit(null);
  }

  // 畫面上顯示的「目前算作」用輸入框的即時值，讓人按下儲存前就看得到後果。
  const previewEntry = value.trim() === "" ? derivedFromEmail : Number(value);
  const previewValid = Number.isInteger(previewEntry);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-sm font-bold">入學屆別</h2>
        <p className="font-mono text-xs text-muted-foreground">
          依信箱推算：
          {derivedFromEmail === null
            ? "無（非學生帳號）"
            : `${derivedFromEmail} 屆 · ${gradeLabel(derivedFromEmail, academicYear)}`}
        </p>
      </div>

      <p className="mt-2 font-medium text-muted-foreground">
        休學復學等情況下信箱前三碼不再等於實際屆別，可在此改算到正確的一屆。
        設定後每年自動跟著升級，不必重標。
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="entry-year">民國入學學年度</Label>
          <Input
            id="entry-year"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={derivedFromEmail === null ? "未設定" : String(derivedFromEmail)}
            className="mt-1 w-32"
            disabled={pending}
          />
        </div>
        <Button variant="primary" onClick={onSave} disabled={pending}>
          {pending ? "儲存中…" : "儲存"}
        </Button>
        <Button onClick={onClear} disabled={pending || initialOverride === null}>
          恢復自動
        </Button>
      </div>

      {previewValid && (
        <p className="mt-3 font-mono text-xs font-bold">
          → 目前算作 {previewEntry} 屆 · {gradeLabel(previewEntry as number, academicYear)}
        </p>
      )}

      {/* 這個 repo 沒有 tone-red-* 色票（已確認），錯誤訊息照抄 GrantRow.tsx 的既有寫法。 */}
      {error && <p className="mt-3 font-mono text-xs font-bold text-destructive">{error}</p>}
      {effectiveAt !== null && (
        <div className="mt-3">
          <EffectiveAtNotice effectiveAtSeconds={effectiveAt} />
        </div>
      )}
    </Card>
  );
}
