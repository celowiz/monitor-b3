import { DEFS, HistStat, Latest, MKT, SIGNAL_TYPES, fmtNum, fmtPct } from "./engine";
import { SIGNAL_COLORS } from "./signals";

const VARIANT: Record<string, string> = {
  high52: "fech. > máx. 52s", low52: "fech. < mín. 52s", smaCross: "golden cross 50/200", volume: "vol. ≥ 2× média 21d",
  rsi: "RSI(14) entra < 30", rs: "RS 21d vira > 0", gap: "gap de alta ≥ 2%", range: "fech. > máx. 20 fech.", streak: "3ª alta seguida",
};

export function StatCell({ s, bench, compact }: { s?: HistStat; bench: string; compact?: boolean }) {
  if (!s || !s.n) return <td className="hs-c mu">n = 0</td>;
  const small = s.n < 30;
  if (compact) return (
    <td className={"hs-c" + (small ? " small" : "")} title={`média ${fmtPct(s.mean ?? null)} · mediana ${fmtPct(s.median ?? null)} · vs ${bench} ${fmtPct(s.exMean ?? null)} · n ${s.n}`}>
      <b className={"mono " + ((s.mean ?? 0) >= 0 ? "up" : "dn")}>{fmtPct(s.mean ?? null)}</b>
      <span className="mono">{s.hit == null ? "—" : fmtNum(s.hit * 100, 0) + "%"} · n {s.n}</span>
    </td>);
  return (
    <td className={"hs-c" + (small ? " small" : "")} title={`n = ${s.n}${small ? " (amostra pequena)" : ""}`}>
      <b className={"mono " + ((s.mean ?? 0) >= 0 ? "up" : "dn")}>{fmtPct(s.mean ?? null)}</b>
      <span className="mono">med {fmtPct(s.median ?? null)} · acerto {s.hit == null ? "—" : fmtNum(s.hit * 100, 0) + "%"}</span>
      <span className="mono di">vs {bench} {fmtPct(s.exMean ?? null)} · {s.exHit == null ? "—" : fmtNum(s.exHit * 100, 0) + "%"} · n {s.n}</span>
    </td>
  );
}

export const CAVEATS = (
  <ul className="hs-cav">
    <li><b>Sem custos</b>: corretagem, spread, impostos e slippage não entram; entrada no fechamento do próprio dia do sinal.</li>
    <li><b>Viés de sobrevivência</b>: o universo é o de hoje (ativos que saíram da bolsa ou do índice no período não aparecem), o que tende a inflar os retornos.</li>
    <li><b>Amostra pequena e sobreposta</b>: só ~12 meses, eventos do mesmo período se correlacionam (um dia de mercado forte gera muitos sinais), e horizontes longos têm n menor. Células em cinza têm n &lt; 30.</li>
    <li><b>Sem look-ahead</b>: cada sinal usa apenas dados até o fechamento do dia em que disparou; o retorno é medido depois.</li>
    <li>Conteúdo educativo. Desempenho passado não garante resultado futuro e isto não é recomendação de investimento.</li>
  </ul>
);

export default function History({ latest }: { latest: Latest }) {
  const h = latest.history;
  const bench = MKT.bench;
  if (!h) return <div className="empty">Histórico indisponível nesta rodada.</div>;
  return (
    <section className="hist">
      <div className="mk-sub"><h2>Histórico de sinais</h2>
        <span className="mu">últimos {h.window} pregões · {latest.universeCount} ativos do universo atual · retorno médio após o sinal (5 / 21 / 63 pregões)</span></div>
      <div className="tbl-wrap">
        <table className="hs-tbl">
          <thead><tr><th>Sinal</th><th className="num">Eventos 12m</th>{h.horizons.map((x) => <th key={x}>+{x} pregões</th>)}</tr></thead>
          <tbody>
            {SIGNAL_TYPES.map((t) => { const s = h.signals[t]; if (!s) return null; return (
              <tr key={t}>
                <td><div className="hs-sig"><i style={{ background: SIGNAL_COLORS[t] }} /><div><b>{DEFS[t].label}</b><span className="mu">{VARIANT[t]}</span></div></div></td>
                <td className="num mono">{s.events.toLocaleString("pt-BR")}<div className="di">{s.tickers} ativos</div></td>
                {h.horizons.map((x) => <StatCell key={x} s={s.h[String(x)]} bench={bench} />)}
              </tr>); })}
          </tbody>
        </table>
      </div>
      <p className="mu hs-how">Como ler: <b>média</b> e <b>mediana</b> do retorno do ativo após o sinal; <b>acerto</b> = % de eventos com retorno &gt; 0; <b>vs {bench}</b> = retorno acima do índice no mesmo período{MKT.market === "br" ? " (FIIs vs IFIX/XFIX11)" : ""} e % de vezes que superou o índice.</p>
      {CAVEATS}
    </section>
  );
}
