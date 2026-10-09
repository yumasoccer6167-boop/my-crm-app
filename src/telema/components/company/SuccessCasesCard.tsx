import type { Company } from "../../types";
import { useHost } from "../../lib/host";
import { Button, Card } from "../ui";

/** この施設に紐づく事例（CRM本体の「事例管理」）。事例の追加は、カルテの情報を反映した状態で事例管理のフォームが開く */
export function SuccessCasesCard({ company, organization }: { company: Company; organization: Record<string, unknown> | null }) {
  const { successCases, openSuccessCase, createSuccessCase } = useHost();
  const mine = successCases.filter((c) => c.telemaCompanyId === company.id);
  return (
    <Card
      title={
        <>
          導入事例{mine.length > 0 && <span className="ml-1 font-normal text-slate-500">{mine.length}</span>}
        </>
      }
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            createSuccessCase({
              telemaCompanyId: company.id,
              telemaCompanyName: company.company_name,
              name: company.company_name,
              industry: (company.industry as string | null) ?? "",
              area: [company.prefecture, company.city].filter((v) => typeof v === "string" && v).join(""),
              url: (company.website as string | null) ?? (organization?.website as string | undefined) ?? "",
            })
          }
        >
          ＋事例を登録
        </Button>
      }
    >
      {mine.length === 0 ? (
        <p className="text-sm text-slate-400">この施設の事例はまだありません。「事例を登録」で、カルテの情報を反映して事例管理に登録できます。</p>
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
