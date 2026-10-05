import { createContext, useContext, type ReactNode } from "react";
import type { Association, CallStatus, UserRow } from "../types";
import type { CurrentUser } from "../types";
import { api, unwrap } from "./api";
import { useApi } from "./useApi";
import { ErrorBox, Loading } from "../components/ui";

type Masters = { me: CurrentUser; statuses: CallStatus[]; users: UserRow[]; associations: Association[]; aiAvailable: boolean; reload: () => void };
const Ctx = createContext<Masters | null>(null);

export function MastersProvider({ children }: { children: ReactNode }) {
  const { data, error, reload } = useApi(
    () => Promise.all([unwrap(api.me.$get()), unwrap(api.statuses.$get()), unwrap(api.users.$get()), unwrap(api.ai.status.$get()), unwrap(api.associations.$get())]),
    [],
  );
  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <Loading />;
  const [me, statuses, users, ai, associations] = data;
  return <Ctx.Provider value={{ me, statuses, users, associations, aiAvailable: ai.available, reload }}>{children}</Ctx.Provider>;
}

export function useMasters(): Masters {
  const v = useContext(Ctx);
  if (!v) throw new Error("MastersProvider がありません");
  return v;
}
