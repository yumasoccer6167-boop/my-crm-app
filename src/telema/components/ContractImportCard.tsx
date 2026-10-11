import { useRef, useState } from "react";
import type { ContractImportBatch, ContractImportRow } from "../types";
import { api, unwrap } from "../lib/api";
import { useMasters } from "../lib/masters";
import { readTable } from "../shared/csv";
import { Button, Card, ErrorBox } from "./ui";

// 列名のゆれ（左から優先）。商品名・契約日と、電話番号か住所のどちらかが必要
const ALIASES = {
  name: ["会社名", "法人名", "施設名", "園名"],
  product: ["商品名", "商材", "商材名"],
  address: ["申込み住所", "住所"],
  phone: ["申込み電話番号", "電話番号", "電話"],
  sales: ["営業担当", "営業"],
  date: ["契約日"],
} as const;
const BATCH = 500;

async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf); // Excelで保存した日本語CSV
  }
}

/** CSVの行を、照合APIへ送る形にする。必要な列が無ければ理由を返す */
function toRows(text: string): { rows: ContractImportRow[] } | { error: string } {
  const { header, rows } = readTable(text);
  const col = Object.fromEntries((Object.keys(ALIASES) as (keyof typeof ALIASES)[]).map((k) => [k, ALIASES[k].find((h) => header.includes(h))])) as Record<keyof typeof ALIASES, string | undefined>;
  const missing = [!col.product && "商品名", !col.date && "契約日", !col.phone && !col.address && "電話番号か住所"].filter(Boolean);
  if (missing.length) return { error: `必要な列が見つかりません：${missing.join("・")}（見つかった列：${header.join("、")}）` };
  const get = (r: Record<string, string>, k: keyof typeof ALIASES) => (col[k] ? (r[col[k]!] ?? "") : "");
  return {
    rows: rows.map((r, i) => ({ line: i + 2, name: get(r, "name"), phone: get(r, "phone"), address: get(r, "address"), product: get(r, "product"), date: get(r, "date"), sales: get(r, "sales") })),
  };
}

type Total = Omit<ContractImportBatch, "added_keys" | "applied">;
const zero = (): Total => ({ rows: 0, added: 0, companies: 0, unmatched: 0, review: 0, existing: 0, duplicate: 0, no_product: 0, bad_date: 0, unmatched_rows: [], review_rows: [], unknown_sales: {}, basis: {} });

function download(name: string, header: string[], lines: string[][]) {
  const esc = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const csv = "﻿" + [header, ...lines].map((l) => l.map(esc).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** 契約一覧のCSVを、電話番号・住所でカルテ（施設）と照合して、契約情報に追加する（管理者のみ） */
export function ContractImportCard() {
  const { me } = useMasters();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; rows: ContractImportRow[] } | null>(null);
  const [running, setRunning] = useState<null | { apply: boolean; done: number }>(null);
  const [result, setResult] = useState<{ apply: boolean; total: Total } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (me.role !== "admin") return null;

  async function pick(f: File | undefined) {
    setError(null);
    setResult(null);
    setFile(null);
    if (!f) return;
    const parsed = toRows(await readText(f));
    if ("error" in parsed) setError(parsed.error);
    else if (parsed.rows.length === 0) setError("CSVにデータの行がありません");
    else setFile({ name: f.name, rows: parsed.rows });
  }

  /** 500行ずつ送って最後まで繰り返す。apply=false は確認だけ（何も保存しない）。回をまたぐ重複を見分けるため、追加予定の契約を次の回へ渡す */
  async function run(apply: boolean) {
    if (!file) return;
    setError(null);
    setResult(null);
    setRunning({ apply, done: 0 });
    const total = zero();
    let known: string[] = [];
    try {
      for (let i = 0; i < file.rows.length; i += BATCH) {
        const r: ContractImportBatch = await unwrap(api.admin["contract-import"].$post({ json: { apply, rows: file.rows.slice(i, i + BATCH), known_keys: known.join("\n") } }));
        for (const k of ["rows", "added", "unmatched", "review", "existing", "duplicate", "no_product", "bad_date"] as const) total[k] += r[k];
        total.companies += r.companies;
        total.unmatched_rows.push(...r.unmatched_rows);
        total.review_rows.push(...r.review_rows);
        for (const [n, c] of Object.entries(r.unknown_sales)) total.unknown_sales[n] = (total.unknown_sales[n] ?? 0) + c;
        for (const [n, c] of Object.entries(r.basis)) total.basis[n] = (total.basis[n] ?? 0) + c;
        known = [...known, ...r.added_keys];
        setRunning({ apply, done: Math.min(file.rows.length, i + BATCH) });
      }
      setResult({ apply, total });
    } catch (e) {
      setError(`途中で止まりました：${e instanceof Error ? e.message : String(e)}（取り込み済みの分は保存されています。もう一度実行すると、すでに入っている契約は重ねて追加しません）`);
    } finally {
      setRunning(null);
    }
  }

  const t = result?.total;
  const unknown = t ? Object.entries(t.unknown_sales).sort((a, b) => b[1] - a[1]) : [];
  return (
    <Card title="契約一覧のCSVから取り込む（管理者）">
      <div className="space-y-3 text-sm text-slate-700">
        <p>
          契約一覧のCSV（会社名・商品名・申込み住所・申込み電話番号・営業担当・契約日）を、<b>電話番号・住所でカルテ（施設）と照合</b>して、各施設の「契約情報」に追加します。
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          <li>電話番号か住所が一致する施設に追加します。複数の施設に一致するときは会社名で絞り、決まらないものと、電話番号と住所が食い違うものは「要確認」にして追加しません。</li>
          <li>営業担当は、メンバー名と一致したときだけ入ります。同じ施設・商材・契約日の契約がすでにあるもの、CSV内の重複は追加しません。商品名や契約日が空の行も追加しません。</li>
          <li>先に「確認する」で結果を見てから、取り込みます。</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="text-xs" onChange={(e) => void pick(e.target.files?.[0])} />
          {file && <span className="text-xs text-slate-500">{file.name}（{file.rows.length.toLocaleString()}行）</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!file || !!running} onClick={() => void run(false)}>
            確認する（取り込まない）
          </Button>
          {result && !result.apply && result.total.added > 0 && (
            <Button
              variant="primary"
              disabled={!!running}
              onClick={() => {
                if (confirm(`確認した内容で、契約情報を ${result.total.added}件（${result.total.companies}施設）追加します。よろしいですか？`)) void run(true);
              }}
            >
              この内容で取り込む
            </Button>
          )}
          {running && (
            <span className="text-xs text-slate-500">
              {running.apply ? "取り込み中" : "確認中"}…（{running.done.toLocaleString()} / {file?.rows.length.toLocaleString()}行）
            </span>
          )}
        </div>
        {error && <ErrorBox message={error} />}
        {t && (
          <div className="space-y-2 rounded-md bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="font-medium text-slate-900">{result.apply ? "取り込みました" : "確認結果（まだ取り込んでいません）"}</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-4">
              <span>追加する契約情報 <b className="tabular-nums">{t.added}</b>件（{t.companies}施設）</span>
              <span>施設が見つからない <b className="tabular-nums">{t.unmatched}</b>行</span>
              <span>要確認 <b className="tabular-nums">{t.review}</b>行</span>
              <span>すでに同じ契約あり <b className="tabular-nums">{t.existing}</b>行</span>
              <span>CSV内の重複 <b className="tabular-nums">{t.duplicate}</b>行</span>
              <span>商品名なし <b className="tabular-nums">{t.no_product}</b>行</span>
              <span>契約日が読めない・なし <b className="tabular-nums">{t.bad_date}</b>行</span>
              <span className="text-slate-500">{Object.entries(t.basis).map(([k, v]) => `${k} ${v}`).join(" / ")}</span>
            </div>
            {unknown.length > 0 && (
              <p className="text-xs text-amber-800">
                営業担当がメンバーと一致せず、空欄で追加：{unknown.slice(0, 8).map(([n, c]) => `${n} ${c}件`).join("、")}
                {unknown.length > 8 && " ほか"}
              </p>
            )}
            {t.review_rows.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-700">
                  要確認（追加していません）
                  <button type="button" className="font-normal text-indigo-700 hover:underline" onClick={() => download("契約_要確認.csv", ["行", "会社名", "電話", "住所", "商品名", "契約日", "理由", "候補"], t.review_rows.map((r) => [String(r.line), r.name, r.phone, r.address, r.product, r.date, r.reason, r.candidates.join(" / ")]))}>
                    CSVで保存
                  </button>
                </div>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {t.review_rows.slice(0, 50).map((r) => (
                    <li key={r.line}>
                      {r.line}行目 <b className="text-slate-800">{r.name}</b>（{r.product}）：{r.reason}
                      {r.candidates.length > 0 && <span className="text-slate-400">（候補: {r.candidates.join("、")}）</span>}
                    </li>
                  ))}
                  {t.review > 50 && <li className="text-slate-400">ほか。全件は「CSVで保存」で確認できます{t.review > t.review_rows.length && `（保存できるのは先頭${t.review_rows.length}件）`}</li>}
                </ul>
              </div>
            )}
            {t.unmatched_rows.length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-700">
                  施設が見つからない（追加していません）
                  <button type="button" className="font-normal text-indigo-700 hover:underline" onClick={() => download("契約_施設なし.csv", ["行", "会社名", "電話", "住所", "商品名", "契約日"], t.unmatched_rows.map((r) => [String(r.line), r.name, r.phone, r.address, r.product, r.date]))}>
                    CSVで保存
                  </button>
                </div>
                <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs text-slate-600">
                  {t.unmatched_rows.slice(0, 30).map((r) => (
                    <li key={r.line}>
                      {r.line}行目 <b className="text-slate-800">{r.name}</b>（{r.product}）{r.phone} {r.address}
                    </li>
                  ))}
                  {t.unmatched > 30 && <li className="text-slate-400">ほか。全件は「CSVで保存」で確認できます{t.unmatched > t.unmatched_rows.length && `（保存できるのは先頭${t.unmatched_rows.length}件）`}</li>}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
