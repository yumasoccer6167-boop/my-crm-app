import { createMemoryRouter, Navigate, RouterProvider } from "react-router";
import { OpenCompany } from "./components/OpenCompany";
import { HostProvider } from "./lib/host";
import { MastersProvider } from "./lib/masters";
import { AssociationKarte } from "./pages/AssociationKarte";
import { Associations } from "./pages/Associations";

// CRM本体はURLを使わずタブで画面を切り替えているので、ここもURLを変えないメモリ上のルーターで画面を切り替える
const router = createMemoryRouter([
  { path: "/", element: <Navigate to="/associations" replace /> },
  { path: "/associations", element: <div className="text-slate-900"><Associations /></div> },
  { path: "/associations/:id", element: <div className="text-slate-900"><AssociationKarte /></div> },
  { path: "/companies/:id", element: <OpenCompany /> },
]);

/** CRM本体（src/App.jsx）の「協会」タブの中身：協会の組織図・加盟施設数・協会カルテ。施設名を押すとテレマリストの顧客カルテを開く */
export default function AssociationsApp({ onOpenCompany = () => {} }: { onOpenCompany?: (companyId: number) => void }) {
  return (
    <HostProvider value={{ appointmentTemplates: [], successCases: [], openSuccessCase: () => {}, createSuccessCase: () => {}, openCompany: onOpenCompany }}>
      <MastersProvider>
        <RouterProvider router={router} />
      </MastersProvider>
    </HostProvider>
  );
}
