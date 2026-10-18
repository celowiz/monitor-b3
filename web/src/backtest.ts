// Backtest do grafo inteiro (walk-forward, sem look-ahead). Roda no Actions (web/scripts/derived.ts) sobre o painel
// diário gerado por scripts/panel.py, com o MESMO engine do navegador: em cada pregão, as linhas dos ativos são
// montadas só com dados até aquele dia, o grafo é avaliado e quem chega ao Resultado forma a coorte do dia.
import { AGU_CLOSES } from "./agulhada";
import { Kind, Row, Screen, evaluate } from "./engine";

export interface PanelTicker {
  name: string; kind: Kind; sector: string | null; subsector: string | null; idx: string[]; rsBench?: "IBOV" | "IFIX" | "SPX";
  f: Record<string, (number | null)[]>;
  /** fechamentos ajustados (total-return) alinhados a dates, com closeOffset pregões a mais no início */
  c: (number | null)[];
  /** índices (em dates) excluídos: janela atravessa uma quebra não explicada da série */
  x: number[];
}
export interface Panel {
  market: "br" | "us"; dates: string[]; closeOffset: number; horizons: number[]; evalDays: number; mainLabel: string;
  bench: { main: (number | null)[]; ifix?: (number | null)[] };
  tickers: Record<string, PanelTicker>;
}

export function rowsAt(p: Panel, i: number): Row[] {
  const out: Row[] = [];
  const date = p.dates[i];
  for (const [t, k] of Object.entries(p.tickers)) {
    if (k.f.price[i] == null || k.x.includes(i)) continue;
    const row: any = { t, name: k.name, kind: k.kind, sector: k.sector, subsector: k.subsector, logo: null, idx: k.idx, rsBench: k.rsBench, date };
    for (const [f, arr] of Object.entries(k.f)) row[f] = arr[i];
    const cl: number[] = [];
    for (let j = i + p.closeOffset; j >= 0 && cl.length < AGU_CLOSES; j--) { const v = k.c[j]; if (v != null) cl.unshift(v); }
    row.cl = cl;
    out.push(row as Row);
  }
  return out;
}

const close = (k: PanelTicker, p: Panel, i: number) => k.c[i + p.closeOffset];
export const fwd = (k: PanelTicker, p: Panel, i: number, h: number): number | null => {
  const a = close(k, p, i), b = close(k, p, i + h);
  return a != null && b != null && i + h < p.dates.length ? b / a - 1 : null;
};
const benchOf = (p: Panel, k: PanelTicker) => (k.rsBench === "IFIX" && p.bench.ifix ? p.bench.ifix : p.bench.main);
const bfwd = (s: (number | null)[], i: number, h: number) => (s[i] != null && s[i + h] != null ? s[i + h]! / s[i]! - 1 : null);

export interface Agg { n: number; mean: number | null; median: number | null; hit: number | null; exMean: number | null; exHit: number | null }
function agg(xs: [number, number | null][]): Agg {
  if (!xs.length) return { n: 0, mean: null, median: null, hit: null, exMean: null, exHit: null };
  const r = xs.map((x) => x[0]).sort((a, b) => a - b), ex = xs.map((x) => x[1]).filter((x): x is number => x != null);
  const m = r.length >> 1;
  return { n: r.length, mean: r.reduce((a, b) => a + b, 0) / r.length, median: r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2,
    hit: r.filter((x) => x > 0).length / r.length, exMean: ex.length ? ex.reduce((a, b) => a + b, 0) / ex.length : null,
    exHit: ex.length ? ex.filter((x) => x > 0).length / ex.length : null };
}

export interface BacktestResult {
  id: string; name: string; market: "br" | "us"; from: string; to: string; evalDays: number; rebalance: number;
  indexLabel: string; generatedAt?: string;
  /** dias com ≥ 1 ativo no Resultado, média e máximo de ativos por dia */
  days: { withResults: number; avgCount: number; maxCount: number };
  counts: number[];
  /** por horizonte: grafo (cada ativo-dia que passou), base (ativo-dias que passaram só nos filtros) e índice */
  h: Record<string, { graph: Agg; base: Agg; index: Agg }>;
  /** carteira sem sobreposição: compra igual a cada `rebalance` pregões quem está no Resultado, segura até o próximo */
  curve: { dates: string[]; graph: number[]; base: number[]; index: number[]; periods: number; emptyPeriods: number };
}

export function runBacktest(id: string, screen: Screen, p: Panel, rebalance = 21): BacktestResult {
  const N = p.dates.length, start = Math.max(1, N - p.evalDays);
  const fiiOnly = (() => { const u = screen.blocks.find((b) => b.type === "universe"); const k = u?.params?.kinds as string[] | undefined; return !!k && k.length === 1 && k[0] === "fii"; })();
  const idxS = fiiOnly && p.bench.ifix ? p.bench.ifix : p.bench.main;
  const indexLabel = fiiOnly && p.bench.ifix ? "IFIX (XFIX11)" : p.mainLabel;
  const res: string[][] = [], base: string[][] = [];
  for (let i = start; i < N; i++) {
    const ev = evaluate(screen, rowsAt(p, i));
    res.push(ev.complete ? ev.results.map((r) => r.t) : []);
    base.push(ev.complete ? ev.filtered.map((r) => r.t) : []);
  }
  const h: BacktestResult["h"] = {};
  for (const hz of p.horizons) {
    const g: [number, number | null][] = [], b: [number, number | null][] = [], ix: [number, number | null][] = [];
    res.forEach((ts, d) => {
      const i = start + d;
      const one = (t: string, into: [number, number | null][]) => {
        const k = p.tickers[t]; const r = fwd(k, p, i, hz); if (r == null) return;
        const br = bfwd(benchOf(p, k), i, hz); into.push([r, br == null ? null : r - br]);
      };
      ts.forEach((t) => one(t, g)); base[d].forEach((t) => one(t, b));
      if (ts.length) { const br = bfwd(idxS, i, hz); if (br != null) ix.push([br, 0]); }
    });
    h[String(hz)] = { graph: agg(g), base: agg(b), index: agg(ix) };
  }
  // curva: carteiras de peso igual, rebalanceadas a cada `rebalance` pregões; vazio = caixa (0%)
  const dates: string[] = [], cg: number[] = [], cb: number[] = [], ci: number[] = [];
  let vg = 100, vb = 100, vi = 100, periods = 0, empty = 0;
  for (let s0 = start; s0 < N - 1; s0 += rebalance) {
    const s1 = Math.min(N - 1, s0 + rebalance), d = s0 - start;
    const port = (ts: string[]) => ts.map((t) => p.tickers[t]).filter((k) => close(k, p, s0) != null);
    const G = port(res[d]), B = port(base[d]);
    periods++; if (!G.length) empty++;
    const val = (ks: PanelTicker[], j: number) => {
      if (!ks.length) return 1;
      let s = 0; for (const k of ks) { let c = null as number | null; for (let q = j; q >= s0 && c == null; q--) c = close(k, p, q); s += (c ?? close(k, p, s0)!) / close(k, p, s0)!; }
      return s / ks.length;
    };
    for (let j = s0 + (periods === 1 ? 0 : 1); j <= s1; j++) {
      const ib = idxS[s0] && idxS[j] ? idxS[j]! / idxS[s0]! : 1;
      dates.push(p.dates[j]); cg.push(+(vg * val(G, j)).toFixed(3)); cb.push(+(vb * val(B, j)).toFixed(3)); ci.push(+(vi * ib).toFixed(3));
    }
    vg = cg[cg.length - 1]; vb = cb[cb.length - 1]; vi = ci[ci.length - 1];
  }
  const counts = res.map((x) => x.length), withR = counts.filter((x) => x > 0);
  return {
    id, name: screen.name, market: p.market, from: p.dates[start], to: p.dates[N - 1], evalDays: N - start, rebalance, indexLabel,
    days: { withResults: withR.length, avgCount: withR.length ? +(withR.reduce((a, b) => a + b, 0) / withR.length).toFixed(1) : 0, maxCount: Math.max(0, ...counts) },
    counts, h, curve: { dates, graph: cg, base: cb, index: ci, periods, emptyPeriods: empty },
  };
}
