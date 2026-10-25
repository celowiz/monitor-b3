import { useMemo, useState } from "react";
import { downloadCsv, toCsv } from "./csv";
import { track } from "./analytics";
import { Block, DEFS, Evaluated, KIND_LABEL, Row, fmtBrl, fmtNum, fmtPct, hitLabel } from "./engine";

type Col = { k: string; l: string; get: (r: Row) => number | string | null; cls?: string };
const dist200 = (r: Row) => (r.sma200 ? r.price / r.sma200 - 1 : null);
const COLS: Col[] = [
  { k: "t", l: "Ticker", get: (r) => r.t },
  { k: "kind", l: "Tipo", get: (r) => KIND_LABEL[r.kind] },
  { k: "price", l: "Preço", get: (r) => r.price, cls: "num" },
  { k: "chg", l: "Var. dia", get: (r) => r.chg, cls: "num" },
  { k: "liq21", l: "Liq. 21d", get: (r) => r.liq21, cls: "num" },
  { k: "d200", l: "Dist. SMA200", get: dist200, cls: "num" },
  { k: "rsi", l: "RSI", get: (r) => r.rsi, cls: "num" },
  { k: "rs21", l: "RS 21d", get: (r) => r.rs21, cls: "num" },
];

export function useSorted(rows: Row[]) {
  const [sort, setSort] = useState<{ k: string; d: 1 | -1 }>({ k: "liq21", d: -1 });
  const sorted = useMemo(() => {
    const c = COLS.find((x) => x.k === sort.k)!;
    return [...rows].sort((a, b) => {
      const x = c.get(a), y = c.get(b);
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.d;
    });
  }, [rows, sort]);
  return { sorted, sort, setSort };
}

const Logo = ({ r }: { r: Row }) => (
  <span className="logo sm">{r.logo ? <img src={r.logo} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} /> : null}<span>{r.t.slice(0, 2)}</span></span>
);
const Badges = ({ hits, r }: { hits?: Block[]; r?: Row }) => {
  if (!hits?.length) return <span className="mu">—</span>;
  return <>{hits.slice(0, 2).map((h) => <span key={h.id} className={"bdg" + (h.type === "trix" && r?.trixSide ? (r.trixSide > 0 ? " side-up" : " side-dn") : "")}>{hitLabel(h, r)}</span>)}{hits.length > 2 && <span className="bdg amb">+{hits.length - 2}</span>}</>;
};
const cls = (v: number | null | undefined) => (v == null ? "" : v >= 0 ? "up" : "dn");

export function Star({ on, t, onStar }: { on: boolean; t: string; onStar?: (t: string) => void }) {
  if (!onStar) return null;
  const act = (e: { stopPropagation: () => void; preventDefault: () => void }) => { e.stopPropagation(); e.preventDefault(); onStar(t); };
  return <span role="button" tabIndex={0} className={"star" + (on ? " on" : "")} title={on ? "Remover de Minha lista" : "Adicionar a Minha lista"} aria-label={on ? `Remover ${t} de Minha lista` : `Adicionar ${t} a Minha lista`} aria-pressed={on}
    onClick={act} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") act(e); }}>{on ? "★" : "☆"}</span>;
}

export default function Results({ runId, done, ev, total, failed, selected, onSelect, compact, watch, onStar }: {
  runId: number; done: boolean; ev: Evaluated; total: number; failed: string[]; selected: string | null; onSelect: (t: string) => void; compact: boolean;
  watch?: string[]; onStar?: (t: string) => void;
}) {
  const ws = new Set(watch ?? []);
  const { sorted, sort, setSort } = useSorted(ev.results);
  const shown = done ? sorted : [];
  const rv = (i: number) => ({ animationDelay: `${Math.min(i, 25) * 28}ms` });
  const sortLabel = COLS.find((c) => c.k === sort.k)!.l;
  return (
    <section className="results">
      <div className="res-head">
        <h2>Resultados</h2><span className="mu">{ev.results.length} ativos · ordenado por {sortLabel}</span>
        <button className="btn sm csv" disabled={!sorted.length} title="CSV com ; e vírgula decimal (abre direto no Excel)"
          onClick={() => { track("csv_export", { result_count: sorted.length }); downloadCsv(`monitor-b3-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(sorted, (r) => (ev.hits.get(r.t) ?? []).map((h) => hitLabel(h, r)).join(" | "))); }}>↓ Exportar CSV</button>
        {compact && (
          <select className="ed-sel" aria-label="Ordenar por" value={sort.k} onChange={(e) => setSort({ k: e.target.value, d: -1 })}>
            {COLS.slice(2).map((c) => <option key={c.k} value={c.k}>{c.l}</option>)}
          </select>
        )}
      </div>
      <div className="funnel">
        <div><b className="mono">{total}</b><span>universo</span></div>
        <div><b className="mono">{ev.filtered.length}</b><span>após filtros</span></div>
        <div><b className="mono">{!ev.complete ? "–" : done ? ev.results.length : "…"}</b><span>resultado</span></div>
        <div title={failed.join(", ")}><b className="mono">{failed.length}</b><span>falha{failed.length === 1 ? "" : "s"}{failed.length ? ` (${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""})` : ""}</span></div>
      </div>
      {!ev.complete && <div className="empty">Grafo incompleto: {ev.problems.map((p) => p.msg).join("; ")}. Conecte os blocos para ver os resultados.</div>}
      {ev.complete && done && !sorted.length && <div className="empty">Nenhum ativo passa nesta tela agora. Afrouxe filtros, troque E por OU ou desligue algum sinal.</div>}
      {compact ? (
        <div className="cards" key={runId}>
          {shown.map((r, i) => (
            <button key={r.t} style={rv(i)} className={"card" + (selected === r.t ? " sel" : "")} onClick={() => onSelect(r.t)}>
              <Logo r={r} />
              <div className="c-id"><b>{r.t} <Star on={ws.has(r.t)} t={r.t} onStar={onStar} /></b><span>{r.name}</span><div className="badges"><Badges hits={ev.hits.get(r.t)} r={r} /></div></div>
              <div className="c-num mono"><b>{fmtNum(r.price)}</b><span className={cls(r.chg)}>{fmtPct(r.chg)}</span><span className="mu">RSI {fmtNum(r.rsi, 1)}</span></div>
            </button>
          ))}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              {COLS.map((c) => (
                <th key={c.k} className={(c.cls || "") + (sort.k === c.k ? " act" : "")}
                  onClick={() => setSort({ k: c.k, d: sort.k === c.k ? (sort.d === 1 ? -1 : 1) : c.k === "t" ? 1 : -1 })}>
                  {c.l}{sort.k === c.k ? (sort.d === 1 ? " ↑" : " ↓") : ""}
                </th>
              ))}
              <th>Sinais</th>
            </tr></thead>
            <tbody key={runId}>
              {shown.map((r, i) => {
                const d = dist200(r);
                return (
                  <tr key={r.t} style={rv(i)} className={selected === r.t ? "sel" : ""} onClick={() => onSelect(r.t)}>
                    <td><div className="tk"><Star on={ws.has(r.t)} t={r.t} onStar={onStar} /><Logo r={r} /><div><b>{r.t}</b><span>{r.name}</span></div></div></td>
                    <td><span className="kind">{KIND_LABEL[r.kind]}</span></td>
                    <td className="num mono">{fmtNum(r.price)}</td>
                    <td className={"num mono " + cls(r.chg)}>{fmtPct(r.chg)}</td>
                    <td className="num mono">{fmtBrl(r.liq21)}</td>
                    <td className={"num mono " + cls(d)}>{fmtPct(d)}</td>
                    <td className="num mono">{fmtNum(r.rsi, 1)}</td>
                    <td className={"num mono " + cls(r.rs21)}>{r.rs21 == null ? "—" : `${r.rs21 >= 0 ? "+" : ""}${fmtNum(r.rs21, 1)} pp`}</td>
                    <td><div className="badges"><Badges hits={ev.hits.get(r.t)} r={r} /></div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
