// 訪問ルートの組み立て（ユーザーの施設を都道府県ごとに日別のルートへ分ける）。
// 移動時間は直線距離からの目安。出発前に Google マップの経路で確かめる前提。
import type { VisitTarget } from "../types";

export type Stop = { main: VisitTarget; also: VisitTarget[]; lat: number; lng: number };
export type Leg = { km: number; min: number; how: "徒歩" | "電車・バス" };
export type Day = { stops: Stop[]; legs: Leg[]; times: number[]; lunchAfter: number | null; end: number; travel: number };
export type Options = { stay: number; maxStops: number };

export const START = 10 * 60; // 1件目 10:00
export const LIMIT = 17 * 60 + 30; // 17:30 までに終える
export const LUNCH = 45; // 2件目の後に昼食
const MAX_LEG_KM = 40; // これより離れた施設は同じ日に入れない

/** 2点間の直線距離（km） */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 移動の目安。1.2km までは徒歩（時速4.8km）、それより遠いと駅までの徒歩・待ち時間15分＋道のり（直線の1.3倍）を時速25kmで */
export function estimateLeg(km: number): Leg {
  if (km <= 1.2) return { km, min: Math.max(3, Math.round((km / 4.8) * 60)), how: "徒歩" };
  return { km, min: Math.round(15 + ((km * 1.3) / 25) * 60), how: "電車・バス" };
}

/** 同じ場所（30m以内）の施設は1回の訪問にまとめる */
function toStops(targets: VisitTarget[]): Stop[] {
  const stops: Stop[] = [];
  for (const t of targets) {
    const p = { lat: t.latitude!, lng: t.longitude! };
    const same = stops.find((s) => distanceKm(s, p) < 0.03);
    if (same) same.also.push(t);
    else stops.push({ main: t, also: [], ...p });
  }
  return stops;
}

/** 1日の時刻を計算する（times は各施設の到着時刻、分） */
function schedule(stops: Stop[], stay: number): Day {
  const legs: Leg[] = [];
  const times: number[] = [];
  let t = START;
  let lunchAfter: number | null = null;
  stops.forEach((s, i) => {
    if (i > 0) {
      const leg = estimateLeg(distanceKm(stops[i - 1]!, s));
      legs.push(leg);
      t += leg.min;
      if (i === 2) {
        lunchAfter = 1;
        t += LUNCH;
      }
    }
    times.push(t);
    t += stay;
  });
  return { stops, legs, times, lunchAfter, end: t, travel: legs.reduce((n, l) => n + l.min, 0) };
}

/** 回る順番：5件以下なので全通り試して、移動距離が一番短い順にする */
function bestOrder(stops: Stop[]): Stop[] {
  if (stops.length <= 2) return stops;
  let best = stops;
  let bestKm = Infinity;
  const permute = (rest: Stop[], acc: Stop[]) => {
    if (rest.length === 0) {
      const km = acc.reduce((n, s, i) => (i ? n + distanceKm(acc[i - 1]!, s) : 0), 0);
      if (km < bestKm) {
        bestKm = km;
        best = acc;
      }
      return;
    }
    rest.forEach((s, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, s]));
  };
  permute(stops, []);
  return best;
}

/**
 * 1つの都道府県の施設を日別に分ける。
 * 残っている施設のうち一番外側（重心から遠い）施設から始め、近い施設を順に足していく。
 * 件数の上限・17:30 までに終わるか・離れすぎていないかで、その日に入れるかを決める
 */
export function planDays(targets: VisitTarget[], opt: Options): Day[] {
  const rest = toStops(targets.filter((t) => t.latitude != null && t.longitude != null));
  const days: Day[] = [];
  while (rest.length) {
    const cLat = rest.reduce((n, s) => n + s.lat, 0) / rest.length;
    const cLng = rest.reduce((n, s) => n + s.lng, 0) / rest.length;
    const seed = rest.reduce((a, b) => (distanceKm(b, { lat: cLat, lng: cLng }) > distanceKm(a, { lat: cLat, lng: cLng }) ? b : a));
    rest.splice(rest.indexOf(seed), 1);
    let day = [seed];
    while (day.length < opt.maxStops && rest.length) {
      const last = day[day.length - 1]!;
      const next = rest.reduce((a, b) => (distanceKm(last, b) < distanceKm(last, a) ? b : a));
      if (distanceKm(last, next) > MAX_LEG_KM) break;
      const trial = bestOrder([...day, next]);
      if (schedule(trial, opt.stay).end > LIMIT) break;
      day = trial;
      rest.splice(rest.indexOf(next), 1);
    }
    days.push(schedule(day, opt.stay));
  }
  return days;
}

export const fmtTime = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;

/** 施設間の経路（公共交通機関）を Google マップで開く */
export const legUrl = (a: Stop, b: Stop) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=transit`;

/** その日の全行程を Google マップで開く（経由地つきの経路は公共交通機関に対応していないため移動手段は指定しない） */
export const dayUrl = (d: Day) => {
  const [first, ...more] = d.stops;
  const last = more.pop();
  if (!first || !last) return `https://www.google.com/maps/search/?api=1&query=${first!.lat},${first!.lng}`;
  const via = more.map((s) => `${s.lat},${s.lng}`).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${first.lat},${first.lng}&destination=${last.lat},${last.lng}${via ? `&waypoints=${encodeURIComponent(via)}` : ""}`;
};
