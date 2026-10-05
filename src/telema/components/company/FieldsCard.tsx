import { useState, type ReactNode } from "react";
import type { Company, FieldSource } from "../../types";
import { COMPANY_FIELDS, SOURCE_LABELS, type CompanyField } from "../../shared/fields";
import { api, unwrap } from "../../lib/api";
import { Button, Card, ErrorBox, inputCls } from "../ui";

const NUMERIC = new Set<CompanyField>(["employee_count", "google_rating", "google_review_count"]);
const MULTILINE = new Set<CompanyField>(["notes", "current_note", "pain_point", "interest", "ng_reason", "next_action"]);

/** カルテの項目群。値の横に情報源（Excel/架電/手入力…）を小さく表示し、その場で編集できる */
export function FieldsCard({
  title,
  fields,
  company,
  sources,
  editable,
  onSaved,
  extraRows,
}: {
  title: string;
  fields: CompanyField[];
  company: Company;
  sources: FieldSource[];
  editable: boolean;
  onSaved: () => void;
  /** 項目の後ろに足す行（会社の列ではない項目。例：加盟協会）。<dt>/<dd> を持つ要素を渡す */
  extraRows?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const srcMap = new Map(sources.map((s) => [s.field, s]));

  function start() {
    setDraft(Object.fromEntries(fields.map((f) => [f, company[f] == null ? "" : String(company[f])])));
    setError(null);
    setEditing(true);
  }

  async function save() {
    const changed: Record<string, string | number | null> = {};
    for (const f of fields) {
      const before = company[f] == null ? "" : String(company[f]);
      const v = draft[f]!.trim();
      if (v === before) continue;
      changed[f] = NUMERIC.has(f) ? (v === "" ? null : Number(v)) : v === "" ? null : v;
    }
    if (Object.keys(changed).length === 0) return setEditing(false);
    if ("company_name" in changed && !changed.company_name) return setError("会社名は必須です");
    setSaving(true);
    try {
      await unwrap(api.companies[":id"].$patch({ param: { id: String(company.id) }, json: changed }));
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title={title}
      action={
        editable &&
        (editing ? (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button size="sm" variant="primary" disabled={saving} onClick={save}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={start}>
            編集
          </Button>
        ))
      }
    >
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
        {fields.map((f) => {
          const src = srcMap.get(f);
          const value = company[f];
          return (
            <div key={f} className="contents">
              <dt className="pt-1 text-xs text-slate-500">{COMPANY_FIELDS[f].label}</dt>
              <dd className="min-w-0">
                {editing ? (
                  MULTILINE.has(f) ? (
                    <textarea rows={2} className={inputCls} value={draft[f]} onChange={(e) => setDraft({ ...draft, [f]: e.target.value })} />
                  ) : (
                    <input
                      className={inputCls}
                      type={NUMERIC.has(f) ? "number" : "text"}
                      step={f === "google_rating" ? "0.1" : undefined}
                      value={draft[f]}
                      onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                    />
                  )
                ) : (
                  <div className="flex items-baseline gap-2 pt-0.5">
                    <span className={`whitespace-pre-wrap break-words ${value == null || value === "" ? "text-slate-300" : "text-slate-800"}`}>
                      {value == null || value === "" ? "未取得" : f === "map_url" ? <a href={String(value)} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">Googleマップで開く</a> : f === "website" ? <a href={String(value)} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">{String(value)}</a> : String(value)}
                    </span>
                    {src && (
                      <span className="shrink-0 text-[10px] text-slate-400" title={src.source_ref ?? undefined}>
                        {SOURCE_LABELS[src.source] ?? src.source}
                        {src.confidence != null && ` ${Math.round(src.confidence * 100)}%`}
                      </span>
                    )}
                  </div>
                )}
              </dd>
            </div>
          );
        })}
        {extraRows}
      </dl>
    </Card>
  );
}
