import { useState } from "react";
import type { MyRule } from "../types";
import { api, unwrap } from "../lib/api";
import { useApi } from "../lib/useApi";
import { Button, Card, Empty, ErrorBox, inputCls, Loading } from "../components/ui";

/** フラグの色。増えたフラグ（ここに無いもの）は灰色 */
const FLAG_COLORS: Record<string, string> = {
  テレアポ: "bg-sky-50 text-sky-800 ring-sky-200",
  商談: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  稼働: "bg-amber-50 text-amber-800 ring-amber-200",
  営業マン像: "bg-violet-50 text-violet-800 ring-violet-200",
};
const flagCls = (f: string) => FLAG_COLORS[f] ?? "bg-slate-100 text-slate-700 ring-slate-200";

function FlagBadge({ flag }: { flag: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${flagCls(flag)}`}>{flag}</span>;
}

/** マイページ3ページ目「マイルール」。フラグ・ルールの内容・期待できる成果を、一覧で見られる。自分の分だけ */
export function MyRules() {
  const { data, error, loading, reload } = useApi(() => unwrap(api["my-rules"].$get()), []);
  const [filter, setFilter] = useState<string>("");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data || (loading && !data)) return <Loading />;
  const count = (f: string) => data.items.filter((i) => i.flag === f).length;
  const shown = filter ? data.items.filter((i) => i.flag === filter) : data.items;
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">自分で決めたルールを、フラグごとに残せます。自分の分だけ表示されます。</p>
      <RuleForm flags={data.flags} onSaved={reload} />
      <Card
        title={`マイルール一覧（${data.items.length}件）`}
        action={
          <div className="flex flex-wrap gap-1.5">
            {([["", `すべて ${data.items.length}`], ...data.flags.map((f): [string, string] => [f, `${f} ${count(f)}`])] as [string, string][]).map(([f, label]) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${filter === f ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        {shown.length === 0 ? (
          <Empty>{data.items.length === 0 ? "マイルールはまだありません。上のフォームから追加してください" : "このフラグのルールはありません"}</Empty>
        ) : (
          <div className="overflow-x-auto rounded-md ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="w-28 px-3 py-2 text-left font-medium">フラグ</th>
                  <th className="px-3 py-2 text-left font-medium">ルールの内容</th>
                  <th className="px-3 py-2 text-left font-medium">期待できる成果</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <RuleRow key={r.id} rule={r} flags={data.flags} onChanged={reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** フラグ（1つ選ぶ）・ルールの内容・期待できる成果の入力欄。追加と編集で使う */
function Fields({ flags, flag, rule, outcome, onChange }: { flags: string[]; flag: string; rule: string; outcome: string; onChange: (v: { flag: string; rule: string; outcome: string }) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs text-slate-500">フラグ</div>
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={flag === f}
              onClick={() => onChange({ flag: f, rule, outcome })}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${flag === f ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">ルールの内容</div>
          <textarea rows={3} maxLength={2000} value={rule} onChange={(e) => onChange({ flag, rule: e.target.value, outcome })} placeholder="例：朝イチは30件かける" className={inputCls} />
        </label>
        <label className="block">
          <div className="mb-1 text-xs text-slate-500">期待できる成果</div>
          <textarea rows={3} maxLength={2000} value={outcome} onChange={(e) => onChange({ flag, rule, outcome: e.target.value })} placeholder="例：アポ率が上がる" className={inputCls} />
        </label>
      </div>
    </div>
  );
}

function RuleForm({ flags, onSaved }: { flags: string[]; onSaved: () => void }) {
  const [v, setV] = useState({ flag: flags[0] ?? "", rule: "", outcome: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function add() {
    setSaving(true);
    setErr(null);
    try {
      await unwrap(api["my-rules"].$post({ json: { flag: v.flag, rule: v.rule.trim(), outcome: v.outcome.trim() } }));
      setV({ flag: v.flag, rule: "", outcome: "" });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Card title="ルールを追加">
      <Fields flags={flags} {...v} onChange={setV} />
      <div className="mt-3 flex items-center gap-3">
        <Button variant="primary" onClick={add} disabled={saving || !v.rule.trim()}>
          {saving ? "追加中…" : "追加"}
        </Button>
        {err && <span className="text-sm text-rose-700">{err}</span>}
      </div>
    </Card>
  );
}

function RuleRow({ rule, flags, onChanged }: { rule: MyRule; flags: string[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ flag: rule.flag, rule: rule.rule, outcome: rule.outcome ?? "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 保存済みのフラグが今の選択肢に無いとき（フラグを減らしたあと）も、そのまま選べるようにしておく
  const options = flags.includes(rule.flag) ? flags : [rule.flag, ...flags];

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <tr className="border-t border-slate-100 bg-slate-50/60">
        <td colSpan={4} className="p-3">
          <Fields flags={options} {...v} onChange={setV} />
          <div className="mt-3 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={busy || !v.rule.trim()} onClick={() => run(() => unwrap(api["my-rules"][":id"].$patch({ param: { id: String(rule.id) }, json: { flag: v.flag, rule: v.rule.trim(), outcome: v.outcome.trim() } })))}>
              保存
            </Button>
            <Button size="sm" disabled={busy} onClick={() => { setEditing(false); setV({ flag: rule.flag, rule: rule.rule, outcome: rule.outcome ?? "" }); setErr(null); }}>
              キャンセル
            </Button>
            {err && <span className="text-sm text-rose-700">{err}</span>}
          </div>
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-2.5">
        <FlagBadge flag={rule.flag} />
      </td>
      <td className="whitespace-pre-wrap px-3 py-2.5 text-slate-800">{rule.rule}</td>
      <td className="whitespace-pre-wrap px-3 py-2.5 text-slate-700">{rule.outcome ?? <span className="text-slate-400">—</span>}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <div className="flex justify-end gap-1.5">
          <Button size="sm" onClick={() => setEditing(true)}>
            編集
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => {
              if (window.confirm("このルールを削除しますか？")) void run(() => unwrap(api["my-rules"][":id"].deactivate.$post({ param: { id: String(rule.id) } })));
            }}
          >
            削除
          </Button>
        </div>
        {err && <div className="mt-1 text-xs text-rose-700">{err}</div>}
      </td>
    </tr>
  );
}
