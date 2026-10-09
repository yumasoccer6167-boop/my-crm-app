import type { Company, Contract } from "../../types";
import { useHost, type SuccessCasePrefill } from "../../lib/host";
import { Button, Card } from "../ui";

// 商材名から、事例の「制作内容」（絞り込み用の分類）を決める。当てはまらない商材は分類しない
const TAG_RULES: [RegExp, string][] = [
  [/MEO|口コミ/i, "MEO・口コミ対策"],
  [/Movie|動画|ムービー/i, "動画"],
  [/採用/, "採用サイト"],
  [/広告/, "広告運用"],
  [/Site|サイト|ホームページ|HP/i, "ホームページ"],
];
export function tagsFromProducts(products: string[]): string[] {
  return [...new Set(products.flatMap((p) => TAG_RULES.filter(([re]) => re.test(p)).map(([, tag]) => tag)))];
}

/** カルテの情報（法人名・施設名・業種・エリア・サイトURL・契約情報の商材）から、事例の追加フォームの初期値をつくる */
export function prefillFromCompany(company: Company, organization: Record<string, unknown> | null, contracts: Contract[]): SuccessCasePrefill {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const org = str(organization?.name).trim();
  const facility = company.company_name;
  const products = [...new Set(contracts.map((c) => c.product_name.trim()).filter(Boolean))];
  return {
    telemaCompanyId: company.id,
    telemaCompanyName: facility,
    // 法人名があれば「法人名（施設名）」。施設名が法人名と同じなら重ねない
    name: org && org !== facility ? `${org}（${facility}）` : facility,
    industry: str(company.industry),
    area: [company.prefecture, company.city].filter((v) => typeof v === "string" && v).join(""),
    url: str(company.website) || str(organization?.website),
    tags: tagsFromProducts(products),
    measure: products.join("＋"),
  };
}

/** この施設に紐づく事例（CRM本体の「事例管理」）。ユーザーの施設には「事例管理を登録」ボタンを出し、カルテの情報を反映して事例管理のフォームを開く */
export function SuccessCasesCard({ company, organization, contracts }: { company: Company; organization: Record<string, unknown> | null; contracts: Contract[] }) {
  const { successCases, openSuccessCase, createSuccessCase } = useHost();
  const mine = successCases.filter((c) => c.telemaCompanyId === company.id);
  const isUser = !!company.is_user;
  // ユーザーでない施設は、すでに紐づいた事例があるときだけカードを出す
  if (!isUser && mine.length === 0) return null;
  return (
    <Card
      title={
        <>
          導入事例{mine.length > 0 && <span className="ml-1 font-normal text-slate-500">{mine.length}</span>}
        </>
      }
      action={
        isUser && (
          <Button size="sm" variant="primary" onClick={() => createSuccessCase(prefillFromCompany(company, organization, contracts))}>
            事例管理を登録
          </Button>
        )
      }
    >
      {mine.length === 0 ? (
        <p className="text-sm text-slate-400">この施設の事例はまだありません。「事例管理を登録」で、法人名・施設名・住所・契約情報の商材などを反映して、事例管理に登録できます。</p>
      ) : (
        <ul className="space-y-2">
          {mine.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => openSuccessCase(c.id)} className="block w-full text-left text-sm hover:bg-slate-50">
                <span className="font-medium text-indigo-700 hover:underline">{c.measure || c.name || `${c.industry}（${c.area}）`}</span>
                <span className="mt-0.5 block text-xs text-slate-700">成果：{c.headline}{c.period && <span className="ml-2 text-slate-400">{c.period}</span>}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
