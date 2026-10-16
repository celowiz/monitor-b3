// Sinais históricos a partir dos candles (~1 ano) — mesma lógica de engine.signalHit, aplicada barra a barra.
import { BlockType, DEFS, SIGNAL_TYPES } from "./engine";

export interface Candles {
  t: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[];
  sma50: (number | null)[]; sma200: (number | null)[]; high52: (number | null)[];
  low52?: (number | null)[]; rsi?: (number | null)[]; volr?: (number | null)[]; rs21?: (number | null)[];
}
export interface SignalEvent { i: number; t: string; type: BlockType; text: string; up: boolean }

export const SIGNAL_COLORS: Record<string, string> = {
  high52: "#3fb8a9", low52: "#e06c6c", smaCross: "#d6a756", volume: "#9aa4ad", rsi: "#b58cf0",
  rs: "#5aa9e6", gap: "#e69a5a", range: "#7fd1c4", streak: "#c9c26a",
};

const nn = (x: number | null | undefined): x is number => x != null && Number.isFinite(x);

export function historicalSignals(d: Candles, params: Partial<Record<BlockType, Record<string, any>>> = {}): SignalEvent[] {
  const P = (t: BlockType) => ({ ...DEFS[t].defaults, ...(params[t] || {}) });
  const out: SignalEvent[] = [];
  const n = d.t.length;
  const push = (i: number, type: BlockType, text: string, up: boolean) => out.push({ i, t: d.t[i], type, text, up });
  for (let i = 1; i < n; i++) {
    const c = d.c[i], pc = d.c[i - 1];
    if (nn(d.high52[i]) && c > d.high52[i]!) push(i, "high52", "Rompeu máx. 52s", true);
    if (nn(d.low52?.[i]) && c < d.low52![i]!) push(i, "low52", "Rompeu mín. 52s", false);
    { const p = P("smaCross"), a = d.sma50[i], b = d.sma200[i], ap = d.sma50[i - 1], bp = d.sma200[i - 1];
      if (nn(a) && nn(b) && nn(ap) && nn(bp)) {
        if (p.dir !== "death" && a > b && ap <= bp) push(i, "smaCross", "Golden cross 50/200", true);
        if (p.dir !== "golden" && a < b && ap >= bp) push(i, "smaCross", "Death cross 50/200", false);
      } }
    { const m = Number(P("volume").mult), r = d.volr?.[i]; if (nn(r) && r >= m) push(i, "volume", `Volume ${r.toFixed(1)}× a média`, c >= d.o[i]); }
    { const p = P("rsi"), r = d.rsi?.[i], rp = d.rsi?.[i - 1];
      // marca a ENTRADA na zona (evita um marcador por dia enquanto fica lá)
      if (nn(r) && nn(rp)) {
        if (p.zone === "below" && r < Number(p.low) && rp >= Number(p.low)) push(i, "rsi", `RSI < ${p.low} (${r.toFixed(0)})`, false);
        if (p.zone === "above" && r > Number(p.high) && rp <= Number(p.high)) push(i, "rsi", `RSI > ${p.high} (${r.toFixed(0)})`, true);
      } }
    { const m = Number(P("rs").min), r = d.rs21?.[i], rp = d.rs21?.[i - 1];
      if (nn(r) && nn(rp) && r > m && rp <= m) push(i, "rs", `RS 21d virou positivo (+${r.toFixed(1)} pp)`, true); }
    { const p = P("gap"), g = (d.o[i] / pc - 1) * 100, x = Number(p.pct);
      if (Number.isFinite(g) && (p.dir === "up" ? g >= x : p.dir === "down" ? g <= -x : Math.abs(g) >= x)) push(i, "gap", `Gap ${g >= 0 ? "+" : ""}${g.toFixed(1)}%`, g >= 0); }
    { const p = P("range"), N = Number(p.n);
      if (i >= N) { const w = d.c.slice(i - N, i), mx = Math.max(...w), mn = Math.min(...w);
        if (p.dir !== "down" && c > mx) push(i, "range", `Rompeu máx. ${N} d`, true);
        if (p.dir !== "up" && c < mn) push(i, "range", `Rompeu mín. ${N} d`, false); } }
    { const p = P("streak"), N = Number(p.n);
      if (i >= N) { let k = 0; for (let j = i; j > 0 && (p.dir === "up" ? d.c[j] > d.c[j - 1] : d.c[j] < d.c[j - 1]); j--) k++;
        if (k === N) push(i, "streak", `${N} ${p.dir === "up" ? "altas" : "baixas"} seguidas`, p.dir === "up"); } }
  }
  return out;
}

export const ALL_SIGNALS = SIGNAL_TYPES;

// Amplitude / mercado a partir das linhas do latest.json.
import type { Kind, Row } from "./engine";
export interface Breadth { n: number; above200: number; above50: number; highs: number; lows: number; adv: number; dec: number; unch: number }
export function breadth(rows: Row[]): Breadth {
  const b: Breadth = { n: rows.length, above200: 0, above50: 0, highs: 0, lows: 0, adv: 0, dec: 0, unch: 0 };
  for (const r of rows) {
    if (r.sma200 != null && r.price > r.sma200) b.above200++;
    if (r.sma50 != null && r.price > r.sma50) b.above50++;
    if (r.high52 != null && r.price > r.high52) b.highs++;
    if (r.low52 != null && r.price < r.low52) b.lows++;
    if (r.chg == null || r.chg === 0) b.unch++; else if (r.chg > 0) b.adv++; else b.dec++;
  }
  return b;
}
export interface SectorTile { sector: string; liq: number; chg: number | null; n: number; top: Row[] }
export function sectorTiles(rows: Row[], kinds: Kind[]): SectorTile[] {
  const m = new Map<string, Row[]>();
  for (const r of rows) if (kinds.includes(r.kind)) { const k = r.sector ?? "Sem setor"; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m.entries()].map(([sector, rs]) => {
    let w = 0, s = 0; for (const r of rs) if (r.chg != null && r.liq21) { w += r.liq21; s += r.chg * r.liq21; }
    return { sector, liq: rs.reduce((a, r) => a + (r.liq21 ?? 0), 0), chg: w ? s / w : null, n: rs.length, top: [...rs].sort((a, b) => (b.liq21 ?? 0) - (a.liq21 ?? 0)).slice(0, 3) };
  }).sort((a, b) => b.liq - a.liq);
}

// Treemap "squarified" simples: retorna retângulos em [0,W]x[0,H].
export function squarify<T extends { liq: number }>(items: T[], W: number, H: number) {
  const out: { item: T; x: number; y: number; w: number; h: number }[] = [];
  const tot = items.reduce((a, b) => a + b.liq, 0) || 1;
  let rest = items.map((it) => ({ it, a: (it.liq / tot) * W * H }));
  let x = 0, y = 0, w = W, h = H;
  while (rest.length) {
    const side = Math.min(w, h);
    let row: typeof rest = [], best = Infinity;
    for (const r of rest) {
      const t = [...row, r], s = t.reduce((a, b) => a + b.a, 0);
      const worst = Math.max(...t.map((q) => Math.max((side * side * q.a) / (s * s), (s * s) / (side * side * q.a))));
      if (worst > best && row.length) break;
      row = t; best = worst;
    }
    const s = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) { const cw = s / h; let cy = y; for (const q of row) { const qh = q.a / cw; out.push({ item: q.it, x, y: cy, w: cw, h: qh }); cy += qh; } x += cw; w -= cw; }
    else { const ch = s / w; let cx = x; for (const q of row) { const qw = q.a / ch; out.push({ item: q.it, x: cx, y, w: qw, h: ch }); cx += qw; } y += ch; h -= ch; }
    rest = rest.slice(row.length);
  }
  return out;
}

// Variantes "de alta" usadas no histórico (iguais às do job de dados, scripts/history.py).
export const HIST_PARAMS: Partial<Record<BlockType, Record<string, any>>> = {
  smaCross: { dir: "golden" }, volume: { mult: 2 }, rsi: { zone: "below", low: 30 }, rs: { min: 0 },
  gap: { pct: 2, dir: "up" }, range: { n: 20, dir: "up" }, streak: { n: 3, dir: "up" },
};
export const HORIZONS = [5, 21, 63];
export interface FwdStat { n: number; mean: number | null; median: number | null; hit: number | null; exMean: number | null; exHit: number | null }
const med = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export function fwdStats(d: Candles & { bc?: (number | null)[] }, events: SignalEvent[]): Record<string, Record<number, FwdStat> & { events: number }> {
  const out: Record<string, any> = {};
  for (const t of ALL_SIGNALS) {
    const ev = events.filter((e) => e.type === t);
    const row: any = { events: ev.length };
    for (const hz of HORIZONS) {
      const r: number[] = [], ex: number[] = [];
      for (const e of ev) {
        const j = e.i + hz; if (j >= d.c.length) continue;
        const x = d.c[j] / d.c[e.i] - 1; r.push(x);
        const b0 = d.bc?.[e.i], b1 = d.bc?.[j];
        if (nn(b0) && nn(b1)) ex.push(x - (b1 / b0 - 1));
      }
      row[hz] = { n: r.length, mean: mean(r), median: med(r), hit: r.length ? r.filter((x) => x > 0).length / r.length : null,
        exMean: mean(ex), exHit: ex.length ? ex.filter((x) => x > 0).length / ex.length : null };
    }
    out[t] = row;
  }
  return out;
}
