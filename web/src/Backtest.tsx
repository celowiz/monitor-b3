// Backtest do grafo inteiro, pré-calculado no Actions (web/scripts/derived.ts). Aqui só exibe.
import { useEffect, useRef, useState } from "react";
import { createChart, LineSeries, type UTCTimestamp } from "lightweight-charts";
import type { Agg, BacktestResult } from "./backtest";
import { Market, fmtNum, fmtPct } from "./engine";
import { track } from "./analytics";

const BASE = () => import.meta.env.BASE_URL + "data/";
export interface BtSummary { id: string; name: string; kind: string; from: string; to: string; indexLabel: string; days: { withResults: number; avgCount: number; maxCount: number };
  h: Record<string, { n: number; mean: number | null; hit: number | null; exMean: number | null; base: number | null; index: number | null }>;
  curve: { graph: number; base: number; index: number; emptyPeriods: number; periods: number } }
const idxCache = new Map<string, Promise<{ items: BtSummary[] } | null>>();
export function loadBtIndex(m: Market) {
  if (!idxCache.has(m)) idxCache.set(m, fetch(`${BASE()}backtest/${m}/index.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return idxCache.get(m)!;
}
export function useBtIndex(m: Market) {
  const [v, setV] = useState<Map<string, BtSummary>>(new Map());
  useEffect(() => { let ok = true; loadBtIndex(m).then((d) => ok && setV(new Map((d?.items ?? []).map((x) => [x.id, x])))); return () => { ok = false; }; }, [m]);
  return v;
}
const dmy = (d: string) => d.split("-").reverse().join("/");
const sg = (v: number | null | undefined, d = 2) => (v == null ? "—" : fmtPct(v, d));
const cls = (v: number | null | undefined) => (v == null ? "" : v > 0 ? "up" : v < 0 ? "dn" : "");

/** Linha curta para cards (galeria/alertas): retorno médio em 21 pregões do grafo vs base. */
export function BtLine({ s, onOpen }: { s?: BtSummary; onOpen?: () => void }) {
  if (!s) return null;
  const h = s.h["21"];
  return (
    <div className="bt-line mono">
      <span title="retorno médio 21 pregões depois do sinal, últimos 12 meses">21 preg.: <b className={cls(h?.mean)}>{sg(h?.mean, 1)}</b> <span className="mu">vs base {sg(h?.base, 1)}</span></span>
      <span className="mu">n {h?.n ?? 0} · {s.days.withResults} dias</span>
      {onOpen && <button className="link" onClick={onOpen}>ver backtest ›</button>}
    </div>
  );
}

function Row({ l, a, small }: { l: string; a: Agg; small?: boolean }) {
  return (
    <tr className={small || a.n < 30 ? "small" : ""}>
      <td>{l}</td><td className="num mono">{a.n}</td>
      <td className={"num mono " + cls(a.mean)}>{sg(a.mean)}</td><td className={"num mono " + cls(a.median)}>{sg(a.median)}</td>
      <td className="num mono">{a.hit == null ? "—" : fmtNum(a.hit * 100, 0) + "%"}</td>
      <td className={"num mono " + cls(a.exMean)}>{l.startsWith("Índice") ? "—" : sg(a.exMean)}</td>
    </tr>
  );
}

function Curve({ b }: { b: BacktestResult }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const c = createChart(el.current, { autoSize: true, layout: { background: { color: "transparent" }, textColor: "#8b9196", fontFamily: "JetBrains Mono, monospace", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#15181b" }, horzLines: { color: "#15181b" } }, rightPriceScale: { borderColor: "#22262a" }, timeScale: { borderColor: "#22262a" },
      localization: { locale: "pt-BR", priceFormatter: (p: number) => fmtNum(p, 1) }, handleScroll: false, handleScale: false });
    const t = b.curve.dates.map((d) => (Date.parse(d + "T00:00:00Z") / 1000) as UTCTimestamp);
    const add = (vals: number[], color: string, w: 1 | 2) => c.addSeries(LineSeries, { color, lineWidth: w, priceLineVisible: false, lastValueVisible: true }).setData(vals.map((v, i) => ({ time: t[i], value: v })));
    add(b.curve.index, "#7c8cf0", 1); add(b.curve.base, "#8b9196", 1); add(b.curve.graph, "#3fb8a9", 2);
    c.timeScale().fitContent();
    return () => c.remove();
  }, [b]);
  return <div className="bt-curve" ref={el} />;
}

export default function BacktestView({ market, id, source, onClose }: { market: Market; id: string; source: string; onClose: () => void }) {
  const [b, setB] = useState<BacktestResult | null>(null);
  const [err, setErr] = useState(false);
  const [h, setH] = useState("21");
  useEffect(() => {
    fetch(`${BASE()}backtest/${market}/${id}.json`, { cache: "no-cache" }).then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then((d: BacktestResult) => { setB(d); track("backtest_view", { backtest_id: id, market, source, n21: d.h["21"]?.graph.n ?? 0 }); }).catch(() => setErr(true));
  }, [market, id, source]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const hz = b ? Object.keys(b.h) : [];
  const cur = b?.h[h];
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal bt-modal" role="dialog" aria-modal="true" aria-label="Backtest" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div><h2>Backtest · {b?.name ?? "…"}</h2>
          <span className="mu">{b ? <>Últimos {b.evalDays} pregões ({dmy(b.from)} a {dmy(b.to)}) · {market === "us" ? "EUA" : "B3"} · o grafo inteiro, avaliado dia a dia só com dados até aquele fechamento.</> : err ? "Backtest indisponível nesta rodada." : "carregando…"}</span></div>
          <button className="close" onClick={onClose} aria-label="fechar">×</button></div>
        {b && cur && <>
          <div className="bt-kpis">
            <div><b className="mono">{b.days.withResults}</b><span>dias com ativo no resultado (de {b.evalDays})</span></div>
            <div><b className="mono">{fmtNum(b.days.avgCount, 1)}</b><span>ativos por dia, em média (máx. {b.days.maxCount})</span></div>
            <div><b className={"mono " + cls(cur.graph.mean != null && cur.base.mean != null ? cur.graph.mean - cur.base.mean : null)}>{cur.graph.mean != null && cur.base.mean != null ? `${cur.graph.mean - cur.base.mean >= 0 ? "+" : ""}${fmtNum((cur.graph.mean - cur.base.mean) * 100, 2)} pp` : "—"}</b><span>grafo − base em {h} pregões</span></div>
          </div>
          <div className="bt-hz"><span className="mu">Horizonte</span>
            <div className="seg">{hz.map((x) => <button key={x} className={x === h ? "on" : ""} onClick={() => { if (x !== h) track("backtest_horizon_change", { backtest_id: id, horizon: Number(x) }); setH(x); }}>+{x} preg.</button>)}</div></div>
          <div className="tbl-wrap"><table className="hs-tbl bt-tbl">
            <thead><tr><th>Quem</th><th className="num">n</th><th className="num">Média</th><th className="num">Mediana</th><th className="num">% positivos</th><th className="num">Excesso vs índice</th></tr></thead>
            <tbody>
              <Row l="Grafo (Resultado)" a={cur.graph} />
              <Row l="Base (só filtros, sem sinais)" a={cur.base} />
              <Row l={`Índice: ${b.indexLabel}`} a={cur.index} />
            </tbody>
          </table></div>
          <p className="mu cp-note">Cada linha é um ativo-dia: ativo que estava no resultado num pregão, com o retorno total (com proventos) do fechamento daquele dia até {h} pregões depois. A <b>base</b> são os ativos que passaram só pelos filtros do grafo, no mesmo dia: mostra se os sinais acrescentam algo além do universo. Índice: retorno do {b.indexLabel} nos mesmos dias em que o grafo teve resultado. Excesso: contra o Ibovespa, ou o IFIX para FIIs{market === "us" ? " (S&P 500 com dividendos)" : ""}.</p>
          <h3 className="bt-h3">Carteira simulada (sem sobreposição)</h3>
          <div className="legend"><span><i style={{ background: "#3fb8a9" }} />Grafo {fmtNum(b.curve.graph[b.curve.graph.length - 1] - 100, 1)}%</span><span><i style={{ background: "#8b9196" }} />Base {fmtNum(b.curve.base[b.curve.base.length - 1] - 100, 1)}%</span><span><i style={{ background: "#7c8cf0" }} />{b.indexLabel} {fmtNum(b.curve.index[b.curve.index.length - 1] - 100, 1)}%</span></div>
          <Curve b={b} />
          <p className="mu cp-note">A cada {b.rebalance} pregões, compra em pesos iguais o que está no Resultado e segura até a próxima troca; sem ativos, fica em caixa a 0% ({b.curve.emptyPeriods} de {b.curve.periods} períodos). Ilustra a ordem de grandeza, não é uma estratégia.</p>
          <ul className="hs-cav">
            <li><b>Sem look-ahead</b>: indicadores de cada dia usam só dados até aquele fechamento; trechos com quebra de série não explicada (dados do Yahoo suspeitos) ficam de fora.</li>
            <li><b>Viés de sobrevivência</b>: universo, setores e participação em índices são os de hoje; quem saiu da bolsa no período não aparece.</li>
            <li><b>Sem custos</b> (corretagem, spread, impostos, slippage); entrada no fechamento do dia do sinal, o que na prática nem sempre é possível.</li>
            <li><b>Amostra curta e sobreposta</b>: 12 meses, um só regime de mercado; ativos-dia seguidos são quase o mesmo evento. Linhas em cinza têm n &lt; 30.</li>
            <li>Conteúdo educativo. Desempenho passado não garante resultado futuro e isto não é recomendação de investimento.</li>
          </ul>
        </>}
      </div>
    </div>
  );
}
