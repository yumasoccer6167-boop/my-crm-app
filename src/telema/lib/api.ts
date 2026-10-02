// /api/telema/* のクライアント。
// 元実装（Hono client）と同じ形で呼べる: api.companies[":id"].$get({ param: { id }, query: {...} })
// 認証は CRM 本体のログイントークン（localStorage の crm_token）をそのまま使う。

import type {
  AIUsageData,
  AssigneeMappingItem,
  CallExtraction,
  CallLog,
  CallStatus,
  Company,
  CompanyDetailData,
  CompanyListData,
  Contact,
  CurrentUser,
  DuplicateCandidate,
  DashboardData,
  MonthlyCallsData,
  Facet,
  GraphEdge,
  GraphNode,
  ListSource,
  PrefectureStat,
  RelationItem,
  UserRow,
  VisitTarget,
} from "../types";

type Args = { param?: Record<string, string>; query?: Record<string, string | number | undefined>; json?: unknown };
type Res<T> = { ok: boolean; status: number; json(): Promise<T> };
type Call<T> = (args?: Args) => Promise<Res<T>>;

/** API の形（パス → メソッド → レスポンス型）。サーバー側は telema/*.py */
type Api = {
  me: { $get: Call<CurrentUser> };
  statuses: { $get: Call<CallStatus[]>; $post: Call<CallStatus>; ":id": { $patch: Call<CallStatus> } };
  users: { $get: Call<UserRow[]> };
  "list-sources": { $get: Call<ListSource[]> };
  "visit-targets": { $get: Call<VisitTarget[]> };
  dashboard: { $get: Call<DashboardData>; "calls-monthly": { $get: Call<MonthlyCallsData> } };
  "prefecture-stats": { $get: Call<PrefectureStat[]> };
  companies: {
    $get: Call<CompanyListData>;
    $post: Call<Company>;
    duplicates: { $get: Call<DuplicateCandidate[]> };
    facets: { $get: Call<{ industries: Facet[]; prefectures: Facet[]; cities: Facet[] }> };
    "bulk-assign": { $post: Call<{ updated: number; unchanged: number; not_found: number }> };
    "bulk-delete": { $post: Call<{ deleted: number; not_found: number }> };
    ":id": {
      $get: Call<CompanyDetailData>;
      $patch: Call<Company>;
      contacts: { $post: Call<Contact> };
      calls: { $get: Call<CallLog[]>; $post: Call<CallLog> };
      relations: { $get: Call<RelationItem[]>; $post: Call<Record<string, unknown> & { id: number }> };
    };
  };
  contacts: { ":id": { $patch: Call<Contact> } };
  calls: {
    ":id": {
      deactivate: { $post: Call<{ ok: true }> };
      analyze: { $post: Call<{ ok: true; extraction: CallExtraction; next_call_at: string | null }> };
    };
  };
  ai: { status: { $get: Call<{ available: boolean }> } };
  admin: {
    "ai-usage": { $get: Call<AIUsageData> };
    "assignee-mapping": {
      $get: Call<{ column: string; items: AssigneeMappingItem[] }>;
      $post: Call<{ updated: number; counts: Record<string, number> }>;
    };
  };
  relations: {
    graph: { $get: Call<{ nodes: GraphNode[]; edges: GraphEdge[] }> };
    ":id": { $patch: Call<Record<string, unknown>> };
  };
};

const BASE = "/api/telema";
const TOKEN_KEY = "crm_token";

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function request(method: string, segments: string[], args: Args = {}): Promise<Res<unknown>> {
  const path = segments.map((s) => (s.startsWith(":") ? encodeURIComponent(args.param?.[s.slice(1)] ?? "") : s)).join("/");
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args.query ?? {})) if (v !== undefined && v !== "") qs.set(k, String(v));
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (args.json !== undefined) headers["Content-Type"] = "application/json";
  const query = qs.toString();
  return fetch(`${BASE}/${path}${query ? `?${query}` : ""}`, {
    method,
    headers,
    body: args.json === undefined ? undefined : JSON.stringify(args.json),
  });
}

/** api.a.b[":id"] のようにたどったパスを覚えておき、$get / $post / $patch で送る */
function endpoint(segments: string[]): unknown {
  return new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      if (key === "$get") return (a?: Args) => request("GET", segments, a);
      if (key === "$post") return (a?: Args) => request("POST", segments, a);
      if (key === "$patch") return (a?: Args) => request("PATCH", segments, a);
      return endpoint([...segments, key]);
    },
  });
}

export const api = endpoint([]) as Api;

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** レスポンスを検査し、エラー時はサーバーの日本語メッセージで throw する */
export async function unwrap<T>(p: Promise<Res<T>>): Promise<T> {
  let res;
  try {
    res = await p;
  } catch {
    throw new ApiRequestError("サーバーに接続できません。ネットワークを確認してください", 0, "network_error");
  }
  if (res.ok) return res.json();
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  throw new ApiRequestError(body?.error?.message ?? `エラーが発生しました (${res.status})`, res.status, body?.error?.code ?? "unknown");
}
