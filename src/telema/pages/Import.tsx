import { useState } from "react";
import { useNavigate } from "react-router";
import { Button, Card, ErrorBox, inputCls } from "../components/ui";
import { api, unwrap } from "../lib/api";
import { DuplicateList, findDuplicates } from "../components/DuplicateList";
import type { DuplicateCandidate } from "../types";

/** Excel/CSV取り込みは STEP 7 で実装。先に手入力の1件登録を置く */
export function ImportPage() {
  const nav = useNavigate();
  const [f, setF] = useState({ company_name: "", organization_name: "", phone: "", address: "", industry: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // 重複候補（確認済みなら null のまま登録する）
  const [dups, setDups] = useState<DuplicateCandidate[] | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      if (!dups) {
        const found = await findDuplicates(f);
        if (found.length) {
          setDups(found);
          return;
        }
      }
      const row = await unwrap(
        api.companies.$post({
          json: {
            company_name: f.company_name,
            organization_name: f.organization_name || undefined,
            phone: f.phone || null,
            address: f.address || null,
            industry: f.industry || null,
          },
        }),
      );
      nav(`/companies/${row.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const input = (k: keyof typeof f, placeholder: string) => (
    <input
      className={inputCls}
      placeholder={placeholder}
      value={f[k]}
      onChange={(e) => {
        setF({ ...f, [k]: e.target.value });
        setDups(null);
      }}
    />
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Excel / CSV から取り込む">
        <div className="rounded-md border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-400">
          次のステップ（STEP 7）で実装します。
          <br />
          列名がバラバラなExcelでも自動で項目を認識し、重複候補を確認してから取り込めます。
        </div>
      </Card>
      <Card title="1件だけ手入力で登録">
        <div className="space-y-2">
          {input("company_name", "会社名・施設名（必須）")}
          {input("organization_name", "法人名（任意）")}
          {input("phone", "電話番号")}
          {input("address", "住所")}
          {input("industry", "業種・施設類型")}
          {error && <ErrorBox message={error} />}
          {dups && <DuplicateList items={dups} />}
          <div className="flex justify-end">
            <Button variant="primary" disabled={!f.company_name.trim() || saving} onClick={create}>
              {dups ? "別の施設なので登録する" : "登録してカルテを開く"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
