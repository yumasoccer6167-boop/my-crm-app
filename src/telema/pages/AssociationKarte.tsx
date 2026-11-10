import { useState } from "react";
import { Link, useParams } from "react-router";
import type { AssociationKarte as Karte, AssociationKarteInput } from "../types";
import { api, unwrap } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { useApi } from "../lib/useApi";
import { useMasters } from "../lib/masters";
import { AssociationMembers } from "../components/AssociationMembers";
import { ChairCrown, OfficerCrown } from "../components/CompanyTable";
import { Button, Card, ErrorBox, inputCls, Loading } from "../components/ui";

const num = (n: number) => n.toLocaleString();

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg bg-white px-4 py-3 ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {note && <div className="text-[11px] text-slate-400">{note}</div>}
    </div>
  );
}

/** 協会カルテ：協会1件の加盟施設数・加盟法人数・業種別の施設数・ユーザー率・会長・役員・協会HPのリンク */
export function AssociationKarte() {
  const { id = "" } = useParams();
  const { me } = useMasters();
  const canEdit = me.role === "admin" || me.role === "manager";
  const { data, error, loading, reload } = useApi(() => unwrap(api.associations[":id"].karte.$get({ param: { id } })), [id]);
  const members = useApi(() => unwrap(api["association-overview"][":id"].members.$get({ param: { id } })), [id]);

  return (
    <div className="space-y-4">
      <Link to="/associations" className="text-sm text-indigo-700 hover:underline">
        ← 協会の一覧に戻る
      </Link>
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading && !data ? (
        <Loading />
      ) : (
        data && (
          <>
            <Header karte={data} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Stat label="加盟施設数" value={num(data.metrics.facility_count)} note={data.metrics.facility_count > data.metrics.own_facility_count ? `直接加盟 ${num(data.metrics.own_facility_count)}（下位の協会を含む）` : undefined} />
              <Stat label="加盟法人数" value={num(data.metrics.organization_count)} note="法人が登録された施設の法人" />
              <Stat label="ユーザー施設数" value={num(data.metrics.user_facility_count)} />
              <Stat label="ユーザー法人数" value={num(data.metrics.user_organization_count)} />
              <Stat label="ユーザー率" value={data.metrics.user_rate == null ? "—" : `${data.metrics.user_rate}%`} note="ユーザー法人 ÷ 加盟法人" />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Industries karte={data} />
              <Profile karte={data} canEdit={canEdit} onSaved={reload} />
            </div>
            <Card title="加盟施設">
              {members.error ? (
                <ErrorBox message={members.error} onRetry={members.reload} />
              ) : members.data ? (
                <AssociationMembers facilities={members.data.facilities} truncated={members.data.truncated} />
              ) : (
                <Loading />
              )}
            </Card>
          </>
        )
      )}
    </div>
  );
}

function Header({ karte }: { karte: Karte }) {
  const a = karte.association;
  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">
        {a.name}
        {!a.is_active && <span className="ml-2 text-sm font-normal text-slate-400">（無効）</span>}
      </h1>
      <p className="mt-0.5 text-xs text-slate-500">
        {a.path.length > 1 && <span>{a.path.slice(0, -1).join(" ＞ ")}　</span>}
        {a.prefecture && <span>{a.prefecture}　</span>}
        <span>協会カルテ</span>
      </p>
    </div>
  );
}

/** 業種ごとの施設数。バーは一番多い業種を100%にした長さ、比率は加盟施設全体に対する割合 */
function Industries({ karte }: { karte: Karte }) {
  const total = karte.metrics.facility_count;
  const max = Math.max(1, ...karte.industries.map((i) => i.count));
  return (
    <Card title="業種別の施設数">
      {karte.industries.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">加盟施設がまだありません</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="py-1.5 pr-2 font-medium">業種</th>
              <th className="w-1/3 py-1.5 pr-2 font-medium" aria-label="施設数のグラフ" />
              <th className="py-1.5 pr-2 text-right font-medium">施設数</th>
              <th className="py-1.5 pr-2 text-right font-medium">比率</th>
              <th className="py-1.5 text-right font-medium">うちユーザー</th>
            </tr>
          </thead>
          <tbody>
            {karte.industries.map((i) => (
              <tr key={i.industry} className="border-b border-slate-50">
                <td className="py-1.5 pr-2 text-slate-800">{i.industry}</td>
                <td className="py-1.5 pr-2">
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-indigo-400" style={{ width: `${(i.count / max) * 100}%` }} />
                  </div>
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{num(i.count)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-600">{total ? `${((i.count / total) * 100).toFixed(1)}%` : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{num(i.user_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

const FIELDS = ["chair_name", "officer_names", "website_url"] as const;
type Draft = Record<(typeof FIELDS)[number], string>;
const toDraft = (a: Karte["association"]): Draft => ({ chair_name: a.chair_name ?? "", officer_names: a.officer_names ?? "", website_url: a.website_url ?? "" });

/** 会長名・役員名・協会HPのリンク。管理者・マネージャーが入力する。顧客カルテで会長・役員に印を付けた担当者も、あわせて出す */
function Profile({ karte, canEdit, onSaved }: { karte: Karte; canEdit: boolean; onSaved: () => void }) {
  const a = karte.association;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(a));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      // 変えた項目だけ送る（空にした項目は空の文字で送ると消える）
      const json: AssociationKarteInput = {};
      for (const f of FIELDS) if (draft[f].trim() !== (a[f] ?? "")) json[f] = draft[f];
      if (Object.keys(json).length) await unwrap(api.associations[":id"].karte.$patch({ param: { id: String(a.id) }, json }));
      setEditing(false);
      onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const set = (f: (typeof FIELDS)[number]) => (e: { target: { value: string } }) => setDraft({ ...draft, [f]: e.target.value });

  return (
    <Card
      title="協会の情報"
      action={
        canEdit &&
        !editing && (
          <Button size="sm" onClick={() => { setDraft(toDraft(a)); setMessage(null); setEditing(true); }}>
            編集
          </Button>
        )
      }
    >
      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="block text-sm">
            <span className="text-xs text-slate-500">会長名</span>
            <input value={draft.chair_name} onChange={set("chair_name")} maxLength={200} className={inputCls} placeholder="例：山田 太郎" />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-slate-500">役員名（1行に1人。役職も書けます）</span>
            <textarea value={draft.officer_names} onChange={set("officer_names")} maxLength={2000} rows={4} className={inputCls} placeholder={"例：\n副会長　佐藤 花子\n理事　鈴木 一郎"} />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-slate-500">協会HPのリンク（URLを貼り付け）</span>
            <input type="url" value={draft.website_url} onChange={set("website_url")} maxLength={500} className={inputCls} placeholder="https://" />
          </label>
          {message && <p className="text-xs text-red-600">{message}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
            <Button variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              やめる
            </Button>
          </div>
        </form>
      ) : (
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500">会長名</dt>
            <dd className="mt-0.5 text-slate-900">{a.chair_name ?? <span className="text-slate-300">未入力</span>}</dd>
            {karte.chairs.length > 0 && <People people={karte.chairs} kind="chair" />}
          </div>
          <div>
            <dt className="text-xs text-slate-500">役員名</dt>
            <dd className="mt-0.5 whitespace-pre-wrap text-slate-900">{a.officer_names ?? <span className="text-slate-300">未入力</span>}</dd>
            {karte.officers.length > 0 && <People people={karte.officers} kind="officer" />}
          </div>
          <div>
            <dt className="text-xs text-slate-500">協会HPのリンク</dt>
            <dd className="mt-0.5">
              {a.website_url ? (
                <a href={a.website_url} target="_blank" rel="noopener noreferrer" className="break-all text-indigo-700 hover:underline">
                  {a.website_url}
                </a>
              ) : (
                <span className="text-slate-300">未入力</span>
              )}
            </dd>
          </div>
          <p className="text-[11px] text-slate-400">最終更新 {fmtDateTime(a.updated_at)}</p>
        </dl>
      )}
    </Card>
  );
}

/** 顧客カルテで、協会会長・協会役員に印を付けた担当者（施設のカルテへのリンク） */
function People({ people, kind }: { people: Karte["chairs"]; kind: "chair" | "officer" }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {people.map((p) => (
        <li key={p.contact_id} className="flex items-center gap-1">
          {kind === "chair" ? <ChairCrown /> : <OfficerCrown />}
          <Link to={`/companies/${p.company_id}`} className="text-indigo-700 hover:underline" title={p.company_name}>
            {p.name ?? "氏名不明"}
          </Link>
          {p.role && <span className="text-slate-500">（{p.role}）</span>}
          <span className="text-slate-400">顧客カルテより</span>
        </li>
      ))}
    </ul>
  );
}
