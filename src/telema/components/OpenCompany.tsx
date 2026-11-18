import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useHost } from "../lib/host";

/** 施設名のリンク（/companies/:id）は、テレマリストの顧客カルテを開く。ここでは開かずに、元の画面へ戻す */
export function OpenCompany() {
  const { id } = useParams();
  const { openCompany } = useHost();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    navigate(-1);
    if (id) openCompany(Number(id));
  }, [id, navigate, openCompany]);
  return null;
}
