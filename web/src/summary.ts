// Resumo pequeno do fechamento (data/summary.json), lido pela página Mercado Hoje do portfólio
// (celowiz.github.io/mercado-hoje/). Usa as MESMAS regras do app: breadth() de signals.ts e
// signalHit() do engine com os parâmetros padrão dos blocos (volume ≥ 2×, RSI entrou > 70 / < 30).
// Universo: ações (kind "acao") com liquidez média de 21 dias ≥ defaults.liq21MinBrl.
// Determinístico: listas ordenadas por valor e, no empate, pelo ticker.
import { DEFS, signalHit, type Block, type BlockType, type Latest, type Row } from "./engine";
import { breadth } from "./signals";
import { isClosingRun } from "./alerts";

export const SUMMARY_SCHEMA = 1;
const LIST_MAX = 12;

const blk = (type: BlockType, params: Record<string, unknown> = {}): Block =>
  ({ id: type, type, enabled: true, params: { ...DEFS[type].defaults, ...params } });
const r5 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e5) / 1e5);
const r2 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

type Item = { t: string; chg: number | null; [k: string]: string | number | null };
function pick(rows: Row[], b: Block, extra: (r: Row) => Record<string, number | null> = () => ({}), by: (r: Row) => number = (r) => -(r.chg ?? 0)) {
  const hit = rows.filter((r) => signalHit(b, r)).sort((a, z) => by(a) - by(z) || a.t.localeCompare(z.t));
  return { n: hit.length, items: hit.slice(0, LIST_MAX).map((r): Item => ({ t: r.t, chg: r5(r.chg), ...extra(r) })) };
}

export function universeRows(latest: Latest): Row[] {
  const min = latest.defaults?.liq21MinBrl ?? 5_000_000;
  return latest.tickers.filter((r) => r.kind === "acao" && (r.liq21 ?? 0) >= min && r.price != null);
}

export function marketSummary(br: Latest, us?: Latest | null) {
  const rows = universeRows(br);
  const b = breadth(rows);
  const bench = br.benchmark as Latest["benchmark"] & { chg?: number | null; ifixChg?: number | null; name?: string; symbol?: string };
  const sorted = [...rows].filter((r) => r.chg != null).sort((a, z) => (z.chg! - a.chg!) || a.t.localeCompare(z.t));
  const usBench = us?.benchmark as (Latest["benchmark"] & { chg?: number | null; date?: string | null }) | undefined;
  return {
    schema: SUMMARY_SCHEMA,
    project: "monitor-b3",
    url: "https://celowiz.github.io/monitor-b3/",
    as_of: br.dataDate,
    generated_at: br.generatedAt,
    /** true quando a rodada é a de fechamento (≥ 17:30 BRT ou pregão anterior); senão a barra do dia é provisória */
    final: isClosingRun("br", br.generatedAt, br.dataDate),
    bench: {
      name: bench.name ?? "Ibovespa", symbol: bench.symbol ?? "^BVSP", price: r2(bench.price), chg: r5(bench.chg), ret21: r5(bench.ret21),
      ifix_proxy: bench.ifixProxy ?? null, ifix_chg: r5(bench.ifixChg), ifix_ret21: r5(bench.ifixRet21),
    },
    universe: { n: b.n, liq21_min_brl: br.defaults?.liq21MinBrl ?? 5_000_000, kind: "acao" },
    breadth: { adv: b.adv, dec: b.dec, unch: b.unch, above200: b.above200, above50: b.above50, highs: b.highs, lows: b.lows },
    signals: {
      high52: pick(rows, blk("high52")),
      low52: pick(rows, blk("low52"), undefined, (r) => r.chg ?? 0),
      golden: pick(rows, blk("smaCross", { dir: "golden" })),
      death: pick(rows, blk("smaCross", { dir: "death" }), undefined, (r) => r.chg ?? 0),
      volume: pick(rows, blk("volume", { mult: 2 }), (r) => ({ vr: r2(r.volRatio) }), (r) => -(r.volRatio ?? 0)),
      rsi_up: pick(rows, blk("rsi", { zone: "above", high: 70, entered: true }), (r) => ({ rsi: r2(r.rsi) }), (r) => -(r.rsi ?? 0)),
      rsi_down: pick(rows, blk("rsi", { zone: "below", low: 30, entered: true }), (r) => ({ rsi: r2(r.rsi) }), (r) => r.rsi ?? 0),
    },
    top: sorted.slice(0, 5).map((r) => ({ t: r.t, chg: r5(r.chg) })),
    bottom: sorted.slice(-5).reverse().map((r) => ({ t: r.t, chg: r5(r.chg) })),
    us: us && usBench
      ? { // data do próprio ^GSPC: pode ser mais nova que a das ações dos EUA (dataDate) quando o Yahoo atrasa as barras delas
          as_of: usBench.date ?? us.dataDate, generated_at: us.generatedAt, final: isClosingRun("us", us.generatedAt, us.dataDate),
          bench: { name: "S&P 500", symbol: "^GSPC", price: r2(usBench.price), chg: r5(usBench.chg), ret21: r5(usBench.ret21) } }
      : null,
  };
}
export type MarketSummary = ReturnType<typeof marketSummary>;
