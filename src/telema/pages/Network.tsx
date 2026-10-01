import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useSearchParams } from "react-router";
import type { GraphEdge } from "../types";
import { UserTag } from "../components/CompanyPicker";
import { ConnectForm, type PickedCompany } from "../components/ConnectForm";
import { NetworkList } from "../components/NetworkList";
import { Button, Card, Empty, ErrorBox, inputCls, Loading, StatusBadge } from "../components/ui";
import { api, unwrap } from "../lib/api";
import {
  degreeScale,
  fitGroups,
  layoutAll,
  layoutFocused,
  nodeColor,
  prefOf,
  prefOrder,
  prefTint,
  step,
  type Group,
  type Link as SimLink,
  type SimNode,
} from "../lib/network-layout";
import { useApi } from "../lib/useApi";

// 点の色＝都道府県（色相）× つながりの多さ（明るさ）。ユーザー（受注）は緑の輪で示す
const CUSTOMER_RING = "#10b981";
const CROSS_COLOR = "#f97316";

type View = { k: number; x: number; y: number };
type Sim = { nodes: SimNode[]; byId: Map<number, SimNode>; links: SimLink[]; groups: Map<string, Group>; alpha: number };

export function Network() {
  const [params, setParams] = useSearchParams();
  const customers = params.get("customers") !== "0";
  const graph = useApi(() => unwrap(api.relations.graph.$get({ query: { customers: customers ? "1" : "0" } })), [customers]);
  const data = graph.data;
  const focus = Number(params.get("focus")) || null;
  const all = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);
  // 表示する都道府県（"all" は全体）。カルテから開いたときはその施設の都道府県
  const focusNode = focus ? all.get(focus) : undefined;
  const pref = params.get("pref") ?? (focusNode ? prefOf(focusNode) : "all");

  const [selected, setSelected] = useState<number | null>(focus);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  // つながりの追加フォーム（initial は選択中の施設から始めるとき）
  const [connect, setConnect] = useState<{ initial?: PickedCompany } | null>(null);
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  const [, setTick] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  // viewBox を表示サイズ（px）に合わせ、文字が縮まないようにする
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const sim = useRef<Sim>({ nodes: [], byId: new Map(), links: [], groups: new Map(), alpha: 0 });
  const drag = useRef<{ kind: "pan" | "node"; id?: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const raf = useRef(0);
  const running = useRef(false);
  // 表示位置・縮尺。ドラッグ・ホイール中は DOM の transform だけを書き換え（React の再描画なし）、
  // 操作が止まったら state に反映して線の太さ・文字の大きさを描き直す
  const viewRef = useRef(view);
  const gRef = useRef<SVGGElement>(null);
  const commitTimer = useRef(0);
  // 配置が落ち着いたら、カルテから開いた施設を中央に寄せる／全体が収まるように縮尺を合わせる
  const pendingFocus = useRef(focus);
  const needsFit = useRef(true);

  const isCross = (e: GraphEdge) => {
    const a = all.get(e.source);
    const b = all.get(e.target);
    return !!a && !!b && prefOf(a) !== prefOf(b);
  };

  // 都道府県ごとの施設数・県をまたぐつながりの数（タブ用）
  const prefStats = useMemo(() => {
    const m = new Map<string, { nodes: number; cross: number }>();
    for (const n of data?.nodes ?? []) {
      const s = m.get(prefOf(n)) ?? { nodes: 0, cross: 0 };
      s.nodes++;
      m.set(prefOf(n), s);
    }
    for (const e of data?.edges ?? []) {
      const a = all.get(e.source);
      const b = all.get(e.target);
      if (!a || !b || prefOf(a) === prefOf(b)) continue;
      m.get(prefOf(a))!.cross++;
      m.get(prefOf(b))!.cross++;
    }
    return [...m].sort((x, y) => prefOrder(x[0]) - prefOrder(y[0]));
  }, [data, all]);

  // 施設ごとのつながりの本数（全体で数え、どの表示でも同じ色になるようにする）
  const degree = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of data?.edges ?? []) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return { of: (id: number) => m.get(id) ?? 0, max: Math.max(0, ...m.values()) };
  }, [data]);

  // いま表示する点・線・円。県別では、他県の相手を外周の円（ghost）に出す
  const sub = useMemo(() => {
    if (!data) return null;
    if (pref === "all") {
      const counts = new Map<string, number>();
      for (const n of data.nodes) counts.set(prefOf(n), (counts.get(prefOf(n)) ?? 0) + 1);
      return { nodes: data.nodes.map((n) => ({ n, group: prefOf(n), ghost: false })), edges: data.edges, groups: layoutAll(counts) };
    }
    const inside = new Set(data.nodes.filter((n) => prefOf(n) === pref).map((n) => n.id));
    const edges = data.edges.filter((e) => inside.has(e.source) || inside.has(e.target));
    const ghostIds = new Set(edges.flatMap((e) => [e.source, e.target]).filter((id) => !inside.has(id)));
    const ghostCounts = new Map<string, number>();
    for (const id of ghostIds) {
      const p = prefOf(all.get(id)!);
      ghostCounts.set(p, (ghostCounts.get(p) ?? 0) + 1);
    }
    const nodes = [
      ...data.nodes.filter((n) => inside.has(n.id)).map((n) => ({ n, group: pref, ghost: false })),
      ...[...ghostIds].map((id) => ({ n: all.get(id)!, group: `ghost:${prefOf(all.get(id)!)}`, ghost: true })),
    ];
    return { nodes, edges, groups: layoutFocused(pref, inside.size, ghostCounts) };
  }, [data, pref, all]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e!.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sub && sub.nodes.length > 0]);


  // 点を円の中心のまわりに並べてから動かし始める（同じ円にいた点は前回の位置を引き継ぐ）
  useEffect(() => {
    if (!sub) return;
    const prev = sim.current.byId;
    const groups = new Map(sub.groups.map((g) => [g.key, g]));
    const counter = new Map<string, number>();
    const nodes = sub.nodes.map(({ n, group, ghost }): SimNode => {
      const p = prev.get(n.id);
      if (p && p.group === group) return { ...n, x: p.x, y: p.y, vx: 0, vy: 0, pinned: p.pinned, group, ghost };
      const g = groups.get(group)!;
      const i = counter.get(group) ?? 0;
      counter.set(group, i + 1);
      const r = 14 * Math.sqrt(i + 0.5);
      return { ...n, x: g.x + r * Math.cos(i * 2.39996), y: g.y + r * Math.sin(i * 2.39996), vx: 0, vy: 0, pinned: false, group, ghost };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = sub.edges.flatMap((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      return s && t ? [{ s, t }] : [];
    });
    sim.current = { nodes, byId, links, groups, alpha: 1 };
    needsFit.current = true;
    fitView();
    restart();
    return () => {
      cancelAnimationFrame(raf.current);
      running.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  function restart(alpha = sim.current.alpha) {
    sim.current.alpha = Math.max(sim.current.alpha, alpha);
    // 動いている最中なら勢いを足すだけ（点のドラッグ中に毎回やり直さない）
    if (running.current) return;
    running.current = true;
    let frame = 0;
    const loop = () => {
      const s = sim.current;
      for (let i = 0; i < 3; i++) step(s.nodes, s.links, s.groups, s.alpha);
      fitGroups(s.nodes, s.groups);
      s.alpha *= 0.97;
      // 利用者が動かすまでは、配置が広がるのに合わせて全体が収まるように追従する
      if (needsFit.current && pendingFocus.current == null && ++frame % 8 === 0) fitView();
      setTick((t) => t + 1);
      if (s.alpha > 0.01) {
        raf.current = requestAnimationFrame(loop);
        return;
      }
      running.current = false;
      if (pendingFocus.current != null && s.byId.has(pendingFocus.current)) {
        centerOn(pendingFocus.current);
        pendingFocus.current = null;
        needsFit.current = false;
      } else if (needsFit.current) {
        fitView();
        needsFit.current = false;
      }
    };
    raf.current = requestAnimationFrame(loop);
  }

  /** すべての円が画面に収まるように縮尺と位置を合わせる */
  function fitView() {
    const gs = [...sim.current.groups.values()];
    if (gs.length === 0) return;
    const x0 = Math.min(...gs.map((g) => g.x - g.r));
    const x1 = Math.max(...gs.map((g) => g.x + g.r));
    const y0 = Math.min(...gs.map((g) => g.y - g.r - 20));
    const y1 = Math.max(...gs.map((g) => g.y + g.r));
    const { w, h } = sizeRef.current;
    const k = Math.min(1.5, Math.max(0.1, Math.min(w / (x1 - x0 + 60), h / (y1 - y0 + 60))));
    setViewNow({ k, x: (-(x0 + x1) / 2) * k, y: (-(y0 + y1) / 2) * k });
  }

  function setViewNow(v: View) {
    clearTimeout(commitTimer.current);
    viewRef.current = v;
    setView(v);
  }

  /** 操作中の移動・拡大縮小。描き直しは止まってから（delay ms 後）にまとめて行う */
  function moveView(v: View, delay: number) {
    viewRef.current = v;
    gRef.current?.setAttribute("transform", `translate(${v.x} ${v.y}) scale(${v.k})`);
    clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => setView(viewRef.current), delay);
  }

  function selectPref(p: string) {
    const next = new URLSearchParams(params);
    next.set("pref", p);
    next.delete("focus");
    setParams(next, { replace: true });
  }

  const neighbors = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const e of sub?.edges ?? []) {
      if (!m.has(e.source)) m.set(e.source, new Set());
      if (!m.has(e.target)) m.set(e.target, new Set());
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [sub]);

  const query = q.trim();
  const matches = useMemo(
    () =>
      query
        ? new Set((sub?.nodes ?? []).filter(({ n }) => [n.company_name, n.contact_name, n.address].some((v) => v?.includes(query))).map(({ n }) => n.id))
        : null,
    [sub, query],
  );

  // 画面上の座標 → 図の座標
  function toGraph(clientX: number, clientY: number) {
    const pt = new DOMPoint(clientX, clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    const v = viewRef.current;
    return { x: (pt.x - v.x) / v.k, y: (pt.y - v.y) / v.k };
  }

  function onPointerDown(e: ReactPointerEvent, nodeId?: number) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: nodeId ? "node" : "pan", id: nodeId, sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
  }
  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
    if (!d.moved) return;
    needsFit.current = false;
    if (d.kind === "pan") {
      const ctm = svgRef.current!.getScreenCTM()!;
      moveView({ ...viewRef.current, x: d.vx + (e.clientX - d.sx) / ctm.a, y: d.vy + (e.clientY - d.sy) / ctm.d }, 1000);
    } else {
      const n = sim.current.byId.get(d.id!);
      if (!n) return;
      const p = toGraph(e.clientX, e.clientY);
      n.x = p.x;
      n.y = p.y;
      n.pinned = true;
      restart(0.1);
    }
  }
  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "pan" && d.moved) setViewNow(viewRef.current);
    if (!d || d.moved) return;
    setSelected(d.kind === "node" ? (d.id ?? null) : null);
  }
  // ホイールで拡大縮小。React の onWheel は preventDefault できずページも一緒にスクロールするので、直接登録する
  const hasSvg = !!sub && sub.nodes.length > 0;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      needsFit.current = false;
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(el.getScreenCTM()!.inverse());
      const v = viewRef.current;
      // トラックパッドのピンチ（ctrlKey 付き）は細かく大量に来るので倍率を上げる
      const k = Math.min(4, Math.max(0.1, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      moveView({ k, x: pt.x - ((pt.x - v.x) * k) / v.k, y: pt.y - ((pt.y - v.y) * k) / v.k }, 150);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSvg]);

  // 選んだ施設が画面の中央に来るように動かす
  function centerOn(id: number) {
    const n = sim.current.byId.get(id);
    if (n) {
      const k = Math.max(viewRef.current.k, 0.9);
      setViewNow({ k, x: -n.x * k, y: -n.y * k });
    }
    setSelected(id);
  }

  // 追加したつながりの施設がある都道府県を開き、その施設を中央に出す
  function onConnected(aId: number) {
    setConnect(null);
    pendingFocus.current = aId;
    setSelected(aId);
    const next = new URLSearchParams(params);
    next.set("focus", String(aId));
    next.delete("pref");
    setParams(next, { replace: true });
    void graph.reload();
  }

  if (graph.error) return <ErrorBox message={graph.error} onRetry={graph.reload} />;
  if (!data || !sub) return <Loading />;

  const s = sim.current;
  const sel = selected != null ? s.byId.get(selected) : undefined;
  const selNeighbors = sel ? (neighbors.get(sel.id) ?? new Set<number>()) : null;
  const dim = (id: number) => (selNeighbors ? id !== sel!.id && !selNeighbors.has(id) : matches ? !matches.has(id) : false);
  const selEdges = sel ? sub.edges.filter((e) => e.source === sel.id || e.target === sel.id) : [];
  const crossEdges = sub.edges.filter(isCross);
  const shownNodes = sub.nodes.filter((x) => !x.ghost).length;
  // 県別表示：この県とつながっている他県の一覧
  const linkedPrefs = new Map<string, number>();
  if (pref !== "all") {
    for (const e of crossEdges) {
      const other = [all.get(e.source)!, all.get(e.target)!].find((n) => prefOf(n) !== pref);
      if (other) linkedPrefs.set(prefOf(other), (linkedPrefs.get(prefOf(other)) ?? 0) + 1);
    }
  }
  const groupSize = new Map<string, number>();
  for (const n of s.nodes) groupSize.set(n.group, (groupSize.get(n.group) ?? 0) + 1);
  const chip = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${active ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-bold text-slate-900">つながり</h1>
        <span className="text-sm text-slate-500">
          {pref === "all" ? "全体" : pref}：施設 {shownNodes} ・ つながり {sub.edges.length}
          {crossEdges.length > 0 && <span style={{ color: CROSS_COLOR }}> （うち県をまたぐ {crossEdges.length}）</span>}
        </span>
        <input
          className={`${inputCls} max-w-56`}
          placeholder="園名・担当者・住所で探す"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            const first = matches && [...matches][0];
            if (e.key === "Enter" && first) centerOn(first);
          }}
        />
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={customers}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              if (e.target.checked) next.delete("customers");
              else next.set("customers", "0");
              setParams(next, { replace: true });
            }}
          />
          つながりの無いユーザー（受注）も表示
        </label>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setConnect({ initial: sel })}>
          ＋つなぐ
        </Button>
      </div>

      {/* 都道府県の切り替え */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        <button type="button" className={chip(pref === "all")} onClick={() => selectPref("all")}>
          全体 {data.nodes.length}
        </button>
        {prefStats.map(([p, st]) => (
          <button key={p} type="button" className={chip(pref === p)} onClick={() => selectPref(p)}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: nodeColor(p, 1) }} />
            {p} {st.nodes}
            {st.cross > 0 && (
              <span className="ml-1" style={{ color: pref === p ? "#fed7aa" : CROSS_COLOR }} title="県をまたぐつながり">
                ↔{st.cross}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          色＝都道府県　つながり 少
          <span
            className="inline-block h-2.5 w-16 rounded-full"
            style={{ background: `linear-gradient(to right, ${nodeColor("東京都", 0)}, ${nodeColor("東京都", 0.5)}, ${nodeColor("東京都", 1)})` }}
          />
          多（明るいほど多い）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300 ring-2" style={{ ["--tw-ring-color" as string]: CUSTOMER_RING }} />
          ユーザー（受注）
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" />
          ユーザー以外
        </span>
        <span className="flex items-center gap-1">
          <svg width="22" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="22" y2="3" stroke={CROSS_COLOR} strokeWidth="2" strokeDasharray="5 3" />
          </svg>
          県をまたぐつながり
        </span>
        {pref !== "all" && (
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-400 bg-white" />
            他県の施設
          </span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="relative overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
          {sub.nodes.length === 0 ? (
            <Empty>
              まだつながりがありません。右上の「＋つなぐ」か会社カルテの「つながり」で、知り合いの施設を登録すると点と線で表示されます。
            </Empty>
          ) : (
            <svg
              ref={svgRef}
              viewBox={`${-size.w / 2} ${-size.h / 2} ${size.w} ${size.h}`}
              className="h-[70vh] w-full cursor-grab touch-none select-none active:cursor-grabbing"
              onPointerDown={(e) => onPointerDown(e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <g ref={gRef} transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {/* 都道府県のまとまり */}
                {[...s.groups.values()].map((g) => {
                  const tint = prefTint(g.pref);
                  return (
                    <g key={g.key}>
                      <circle
                        cx={g.x}
                        cy={g.y}
                        r={g.r}
                        fill={tint.fill}
                        fillOpacity={g.ghost ? 0.6 : 1}
                        stroke={tint.stroke}
                        strokeWidth={1.5 / view.k}
                        strokeDasharray={g.ghost ? `${6 / view.k} ${4 / view.k}` : undefined}
                      />
                      <text
                        x={g.x}
                        y={g.y - g.r - 6 / view.k}
                        textAnchor="middle"
                        fontSize={13 / view.k}
                        fontWeight={600}
                        fill={tint.text}
                        stroke="white"
                        strokeWidth={3 / view.k}
                        paintOrder="stroke"
                        className={g.pref !== pref ? "cursor-pointer hover:underline" : undefined}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => g.pref !== pref && selectPref(g.pref)}
                      >
                        {g.pref} {groupSize.get(g.key) ?? 0}
                        {g.pref !== pref && " ›"}
                      </text>
                    </g>
                  );
                })}
                {sub.edges.map((e) => {
                  const a = s.byId.get(e.source);
                  const b = s.byId.get(e.target);
                  if (!a || !b) return null;
                  const cross = isCross(e);
                  const active = sel ? e.source === sel.id || e.target === sel.id : hoverEdge === e.id;
                  const faded = sel && !active;
                  const color = cross ? (active ? "#c2410c" : CROSS_COLOR) : active ? "#4f46e5" : "#cbd5e1";
                  return (
                    <g key={e.id} onPointerEnter={() => setHoverEdge(e.id)} onPointerLeave={() => setHoverEdge(null)}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={10 / view.k} />
                      <line
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        stroke={color}
                        strokeWidth={(active ? 2.5 : cross ? 1.8 : 1.5) / view.k}
                        strokeDasharray={cross ? `${6 / view.k} ${4 / view.k}` : undefined}
                        opacity={faded ? 0.25 : 1}
                      />
                      {active && e.label && (
                        <text
                          x={(a.x + b.x) / 2}
                          y={(a.y + b.y) / 2}
                          textAnchor="middle"
                          dy={-4 / view.k}
                          fontSize={11 / view.k}
                          fill={cross ? "#c2410c" : "#4338ca"}
                          stroke="white"
                          strokeWidth={3 / view.k}
                          paintOrder="stroke"
                        >
                          {e.label}
                        </text>
                      )}
                    </g>
                  );
                })}
                {s.nodes.map((n) => {
                  const isSel = n.id === selected;
                  const faded = dim(n.id);
                  const hit = matches?.has(n.id);
                  const showLabel = isSel || view.k >= 0.6 || !!selNeighbors?.has(n.id) || hit;
                  const r = (isSel ? 9 : 7) / Math.sqrt(view.k);
                  const t = degreeScale(degree.of(n.id), degree.max);
                  const color = nodeColor(prefOf(n), t);
                  const customer = n.status_category === "won";
                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x} ${n.y})`}
                      opacity={faded ? 0.2 : 1}
                      className="cursor-pointer"
                      onPointerDown={(e) => onPointerDown(e, n.id)}
                    >
                      <title>{[n.company_name, n.contact_name && `担当 ${n.contact_name}`, n.address].filter(Boolean).join("\n")}</title>
                      {/* つながりの多い点はうっすら光らせる */}
                      {t > 0.4 && <circle r={r * (1.4 + t)} fill={color} opacity={0.22 * t} />}
                      {customer && <circle r={r + 3 / view.k} fill="none" stroke={CUSTOMER_RING} strokeWidth={2 / view.k} />}
                      <circle
                        r={r}
                        fill={n.ghost ? "white" : color}
                        stroke={isSel || hit ? "#312e81" : n.ghost ? color : "white"}
                        strokeWidth={(isSel || hit || n.ghost ? 2.5 : 1.5) / view.k}
                      />
                      {showLabel && (
                        <text
                          y={r + 12 / view.k}
                          textAnchor="middle"
                          fontSize={11 / view.k}
                          fill={n.ghost ? "#64748b" : "#0f172a"}
                          stroke="white"
                          strokeWidth={3 / view.k}
                          paintOrder="stroke"
                        >
                          {n.company_name}
                          {n.contact_name && (
                            <tspan x={0} dy={13 / view.k} fontSize={10 / view.k} fill="#64748b">
                              {n.contact_name}
                            </tspan>
                          )}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
          <div className="pointer-events-none absolute bottom-2 left-3 text-[11px] text-slate-400">
            ドラッグで移動・ホイールで拡大縮小・点をクリックで詳細・県名をクリックでその県の相関図
          </div>
          {sub.nodes.length > 0 && (
            <button
              type="button"
              onClick={fitView}
              className="absolute right-2 top-2 rounded-md bg-white/90 px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
            >
              全体が収まるように表示
            </button>
          )}
        </div>

        <Card title={connect ? "つながりを追加" : sel ? "選択中の施設" : pref === "all" ? "全体" : pref}>
          {connect ? (
            <ConnectForm key={connect.initial?.id ?? "new"} initial={connect.initial} onSaved={onConnected} onClose={() => setConnect(null)} />
          ) : sel ? (
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-slate-900">{sel.company_name}</div>
                  <div className="flex shrink-0 items-center gap-1">
                    <UserTag category={sel.status_category} />
                    <StatusBadge label={sel.status_label} category={sel.status_category} />
                  </div>
                </div>
                <div className="mt-1 text-slate-700">
                  担当者：{sel.contact_name ? `${sel.contact_name}${sel.contact_role ? `（${sel.contact_role}）` : ""}` : <span className="text-slate-400">未判明</span>}
                </div>
                <div className="text-xs text-slate-500">{sel.address ?? "住所未登録"}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                  <Link to={`/companies/${sel.id}`} className="text-indigo-700 hover:underline">
                    カルテを開く
                  </Link>
                  <button type="button" onClick={() => setConnect({ initial: sel })} className="text-indigo-700 hover:underline">
                    この施設からつなぐ
                  </button>
                  {prefOf(sel) !== pref && (
                    <button type="button" onClick={() => selectPref(prefOf(sel))} className="text-indigo-700 hover:underline">
                      {prefOf(sel)}の相関図へ
                    </button>
                  )}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs text-slate-500">知り合い（{selEdges.length}）</div>
                {selEdges.length === 0 ? (
                  <p className="text-xs text-slate-400">まだつながりがありません</p>
                ) : (
                  <ul className="space-y-2">
                    {selEdges.map((e) => {
                      const mineIsSource = e.source === sel.id;
                      const other = all.get(mineIsSource ? e.target : e.source);
                      if (!other) return null;
                      const mine = mineIsSource ? e.source_contact_name : e.target_contact_name;
                      const theirs = mineIsSource ? e.target_contact_name : e.source_contact_name;
                      const cross = prefOf(other) !== prefOf(sel);
                      return (
                        <li key={e.id}>
                          <button type="button" onClick={() => centerOn(other.id)} className="text-left font-medium text-indigo-700 hover:underline">
                            {other.company_name}
                          </button>
                          {cross && (
                            <span className="ml-1.5 rounded px-1 text-[11px]" style={{ color: CROSS_COLOR, background: "#fff7ed" }}>
                              {prefOf(other)}
                            </span>
                          )}
                          <div className="text-xs text-slate-600">
                            {(mine || theirs) && (
                              <span>
                                {mine ?? "—"} ⇔ {theirs ?? "—"}
                              </span>
                            )}
                            {e.label && <span className="ml-2 rounded bg-indigo-50 px-1.5 text-[11px] text-indigo-700">{e.label}</span>}
                          </div>
                          {e.notes && <div className="whitespace-pre-wrap text-xs text-slate-500">{e.notes}</div>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {pref !== "all" && (
                <div>
                  <div className="mb-1 text-xs text-slate-500">つながっている他の都道府県（{linkedPrefs.size}）</div>
                  {linkedPrefs.size === 0 ? (
                    <p className="text-xs text-slate-400">県をまたぐつながりはありません</p>
                  ) : (
                    <ul className="space-y-1">
                      {[...linkedPrefs]
                        .sort((a, b) => prefOrder(a[0]) - prefOrder(b[0]))
                        .map(([p, n]) => (
                          <li key={p} className="flex items-center justify-between">
                            <button type="button" onClick={() => selectPref(p)} className="text-indigo-700 hover:underline">
                              {p}
                            </button>
                            <span className="text-xs" style={{ color: CROSS_COLOR }}>
                              ↔ {n}本
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
              <ul className="list-disc space-y-1 pl-4 text-slate-600">
                <li>点 = 施設（園名・担当者・住所）、線 = 知り合い関係です。</li>
                <li>円は都道府県のまとまりです。県をまたぐつながりはオレンジの破線で表示します。</li>
                <li>上の県名か、図の中の県名をクリックするとその県の相関図になります。</li>
                <li>つながりは右上の「＋つなぐ」か、下の施設一覧の「＋知り合いをつなぐ」で、ユーザー・ユーザー以外を問わず2つの施設を選んで登録します（会社カルテの「つながり」カードからも登録できます）。</li>
                <li>知り合いの園がまだ登録されていなければ、検索結果の「新しい園として登録」からその場で追加できます。</li>
              </ul>
            </div>
          )}
        </Card>
      </div>

      <NetworkList
        title={pref === "all" ? "全体" : pref}
        nodes={sub.nodes.filter((x) => !x.ghost).map((x) => x.n)}
        edges={data.edges}
        all={all}
        query={query}
        onFocus={(id) => {
          centerOn(id);
          svgRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        onConnected={() => void graph.reload()}
      />
    </div>
  );
}
