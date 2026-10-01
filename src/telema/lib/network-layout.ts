import { PREFECTURE_POSITIONS, PREFECTURES } from "../shared/prefectures";
import type { GraphNode } from "../types";

// 相関図の配置計算。点は「都道府県のまとまり（円）」の中に集まり、円どうしは地理に近い位置関係で並ぶ

export const UNKNOWN_PREF = "不明";
export const prefOf = (n: { prefecture: string | null }) => n.prefecture ?? UNKNOWN_PREF;

/** 都道府県の並び（JIS順、不明は最後） */
export const prefOrder = (p: string) => {
  const i = PREFECTURES.indexOf(p as never);
  return i < 0 ? 99 : i;
};

/** 点が集まる円（都道府県）。ghost は県別表示で外周に出す「他県」 */
export type Group = { key: string; pref: string; x: number; y: number; r: number; ghost: boolean; fixed: boolean };
export type SimNode = GraphNode & { x: number; y: number; vx: number; vy: number; pinned: boolean; group: string; ghost: boolean };
export type Link = { s: SimNode; t: SimNode };

// 都道府県不明は日本の南東の海上に置く
const geo = (pref: string) => (PREFECTURE_POSITIONS as Record<string, readonly [number, number]>)[pref] ?? [30.5, 142.5];
/** 緯度経度 → 図の座標（関東付近を原点に、ざっくり等距離に伸ばす） */
const project = (pref: string) => {
  const [lat, lng] = geo(pref);
  return { x: (lng - 137.5) * 90, y: -(lat - 36) * 110 };
};

const initialRadius = (n: number) => 30 + 14 * Math.sqrt(n);
const GAP = 28;

/** 円どうしの重なりを押し広げる（fixed の円は動かさない） */
export function relax(groups: Group[], iterations: number) {
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i]!;
        const b = groups[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        const min = a.r + b.r + GAP;
        if (d >= min) continue;
        if (d < 0.01) {
          // 同じ位置なら番号で決まる向きにずらす
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 1;
        }
        const push = min - d;
        const ux = dx / d;
        const uy = dy / d;
        const wa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
        const wb = b.fixed ? 0 : a.fixed ? 1 : 0.5;
        a.x -= ux * push * wa;
        a.y -= uy * push * wa;
        b.x += ux * push * wb;
        b.y += uy * push * wb;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

/** 全体：都道府県ごとの円を地理に近い位置に置く */
export function layoutAll(counts: Map<string, number>): Group[] {
  const groups = [...counts].map(([pref, n]): Group => ({ key: pref, pref, ...project(pref), r: initialRadius(n), ghost: false, fixed: false }));
  relax(groups, 400);
  const cx = groups.reduce((s, g) => s + g.x, 0) / (groups.length || 1);
  const cy = groups.reduce((s, g) => s + g.y, 0) / (groups.length || 1);
  for (const g of groups) {
    g.x -= cx;
    g.y -= cy;
  }
  return groups;
}

/** 県別：その県を中央に置き、つながっている他県をその方角の外周に置く */
export function layoutFocused(pref: string, n: number, others: Map<string, number>): Group[] {
  const main: Group = { key: pref, pref, x: 0, y: 0, r: initialRadius(n), ghost: false, fixed: true };
  const from = project(pref);
  const ghosts = [...others].map(([other, m], i): Group => {
    const to = project(other);
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) {
      dx = Math.cos(i * 2.4);
      dy = Math.sin(i * 2.4);
    } else {
      dx /= d;
      dy /= d;
    }
    const r = initialRadius(m) * 0.8;
    const ring = main.r + r + 110;
    return { key: `ghost:${other}`, pref: other, x: dx * ring, y: dy * ring, r, ghost: true, fixed: false };
  });
  const groups = [main, ...ghosts];
  relax(groups, 300);
  return groups;
}

/**
 * 1ステップ分の力学計算。
 * - 同じ円の中の点どうしは反発する（別の円の点とは計算しない）
 * - 同じ円の中のつながりはばねで引き合う（県をまたぐ線は配置に使わず、描くだけ）
 * - 点は自分の円の中心に引き寄せられる
 */
export function step(nodes: SimNode[], links: Link[], groups: Map<string, Group>, alpha: number) {
  const buckets = new Map<string, SimNode[]>();
  for (const n of nodes) {
    const b = buckets.get(n.group);
    if (b) b.push(n);
    else buckets.set(n.group, [n]);
  }
  for (const b of buckets.values()) {
    for (let i = 0; i < b.length; i++) {
      const a = b[i]!;
      for (let j = i + 1; j < b.length; j++) {
        const c = b[j]!;
        const dx = c.x - a.x || 0.01;
        const dy = c.y - a.y || 0.01;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        if (d2 > 160_000) continue;
        const f = (300 * alpha) / d2;
        a.vx -= dx * f;
        a.vy -= dy * f;
        c.vx += dx * f;
        c.vy += dy * f;
      }
    }
  }
  for (const { s, t } of links) {
    if (s.group !== t.group) continue;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = ((d - 60) / d) * 0.08 * alpha;
    s.vx += dx * f;
    s.vy += dy * f;
    t.vx -= dx * f;
    t.vy -= dy * f;
  }
  for (const n of nodes) {
    const g = groups.get(n.group);
    if (g) {
      n.vx += (g.x - n.x) * 0.08 * alpha;
      n.vy += (g.y - n.y) * 0.08 * alpha;
    }
    if (n.pinned) {
      n.vx = n.vy = 0;
      continue;
    }
    n.vx *= 0.6;
    n.vy *= 0.6;
    n.x += n.vx;
    n.y += n.vy;
  }
}

/** 円の大きさを実際の点の広がりに合わせ、重なったら押し広げる（押された円の点も一緒に動かす） */
export function fitGroups(nodes: SimNode[], groups: Map<string, Group>) {
  const reach = new Map<string, number>();
  for (const n of nodes) {
    const g = groups.get(n.group);
    if (!g) continue;
    reach.set(g.key, Math.max(reach.get(g.key) ?? 0, Math.hypot(n.x - g.x, n.y - g.y)));
  }
  const list = [...groups.values()];
  const before = list.map((g) => [g.x, g.y] as const);
  for (const g of list) g.r = Math.max(24, (reach.get(g.key) ?? 0) + 22);
  relax(list, 4);
  const shift = new Map(list.map((g, i) => [g.key, [g.x - before[i]![0], g.y - before[i]![1]] as const]));
  for (const n of nodes) {
    const s = shift.get(n.group);
    if (s && (s[0] || s[1])) {
      n.x += s[0];
      n.y += s[1];
    }
  }
}

// ---------- 色 ----------
/** 都道府県の色相。JIS順に黄金角ずつずらし、隣り合う県が似た色にならないようにする（不明は null＝灰色） */
export function prefHue(pref: string): number | null {
  const i = PREFECTURES.indexOf(pref as never);
  return i < 0 ? null : (200 + i * 137.508) % 360;
}

/** 点の色。t はつながりの多さ（0〜1）。多いほど鮮やかで明るく、少ないほど淡くくすむ */
export function nodeColor(pref: string, t: number): string {
  const h = prefHue(pref);
  if (h == null) return `hsl(215 ${10 + 15 * t}% ${76 - 26 * t}%)`;
  return `hsl(${h.toFixed(0)} ${15 + 85 * t}% ${82 - 32 * t}%)`;
}

/** 都道府県の円・県名の色 */
export function prefTint(pref: string): { fill: string; stroke: string; text: string } {
  const h = prefHue(pref);
  if (h == null) return { fill: "#f8fafc", stroke: "#cbd5e1", text: "#475569" };
  return { fill: `hsl(${h.toFixed(0)} 70% 97%)`, stroke: `hsl(${h.toFixed(0)} 50% 80%)`, text: `hsl(${h.toFixed(0)} 60% 30%)` };
}

/** つながりの本数 → 0〜1（本数の差が大きくても見分けやすいよう対数で伸ばす） */
export function degreeScale(degree: number, max: number): number {
  return max <= 0 ? 0 : Math.log1p(degree) / Math.log1p(max);
}
