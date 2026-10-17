import { BlockType, DEFS, HistStat, Latest, MKT, SIGNAL_TYPES, fmtNum, fmtPct } from "./engine";
import { SIGNAL_COLORS } from "./signals";

const VARIANT: Record<string, string> = {
  high52: "fech. > máx. 52s", low52: "fech. < mín. 52s", smaCross: "golden cross 50/200", volume: "vol. ≥ 2× média 21d",
  rsi: "RSI(14) entra < 30", rs: "RS 21d vira > 0", gap: "gap de alta ≥ 2%", range: "fech. > máx. 20 fech.", streak: "3ª alta seguida",
  agulhada_buy: "compra ▲ · SMA 3/8/20 a < 1,5% · todo pregão convergido", agulhada_sell: "venda ▼ · SMA 3/8/20 a < 1,5% · todo pregão convergido",
  trix_buy: "compra ▲ · TRIX(9) > sinal, abaixo da banda 60d", trix_sell: "venda ▼ · TRIX(9) < sinal, acima da banda 60d",
};
/** Sinais com lado aparecem em duas linhas (compra/venda) no histórico. */
const SIDED: Record<string, [string, string]> = { agulhada: ["agulhada_buy", "agulhada_sell"], trix: ["trix_buy", "trix_sell"] };
export const histKeys = (types: string[]) => types.flatMap((t) => SIDED[t] ?? [t]);
const baseOf = (k: string) => k.replace(/_(buy|sell)$/, "");
const pp = (v: number) => `${v >= 0 ? "+" : ""}${fmtNum(v, 1)} pp`;

export function StatCell({ s, bench, compact, base }: { s?: HistStat; bench: string; compact?: boolean; base?: HistStat }) {
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
      {base?.n && s.mean != null && base.mean != null ? <span className="mono di hs-vb" title="diferença para a base (todos os pregões dos mesmos ativos no período)">vs base {fmtPct(s.mean - base.mean)} · acerto {s.hit != null && base.hit != null ? pp((s.hit - base.hit) * 100) : "—"}</span> : null}
    </td>
  );
}

export const CAVEATS = (
  <ul className="hs-cav">
    <li><b>Sem custos</b>: corretagem, spread, impostos e slippage não entram; entrada no fechamento do próprio dia do sinal.</li>
    <li><b>Viés de sobrevivência</b>: o universo é o de hoje (ativos que saíram da bolsa ou do índice no período não aparecem), o que tende a inflar os retornos.</li>
    <li><b>Amostra pequena e sobreposta</b>: só ~12 meses, eventos do mesmo período se correlacionam (um dia de mercado forte gera muitos sinais), e horizontes longos têm n menor. Células em cinza têm n &lt; 30.</li>
    <li><b>Agulhada conta todo pregão convergido</b> (é o que o bloco padrão listaria naquele dia): convergências longas geram muitos eventos seguidos e quase iguais, então o n exagera a quantidade de situações independentes.</li>
    <li><b>Erros de dados</b>: retornos fora de −95% a +300% no horizonte (típicos de grupamento não ajustado na fonte) são descartados, nos sinais e na base.</li>
    <li><b>Sem look-ahead</b>: cada sinal usa apenas dados até o fechamento do dia em que disparou; o retorno é medido depois.</li>
    <li>Conteúdo educativo. Desempenho passado não garante resultado futuro e isto não é recomendação de investimento.</li>
  </ul>
);

export default function History({ latest }: { latest: Latest }) {
  const h = latest.history;
  const bench = MKT.bench;
  const base = h?.signals.base;
  if (!h) return <div className="empty">Histórico indisponível nesta rodada.</div>;
  return (
    <section className="hist">
      <div className="mk-sub"><h2>Histórico de sinais</h2>
        <span className="mu">últimos {h.window} pregões · {latest.universeCount} ativos do universo atual · retorno médio após o sinal (5 / 21 / 63 pregões)</span></div>
      <div className="tbl-wrap">
        <table className="hs-tbl">
          <thead><tr><th>Sinal</th><th className="num">Eventos 12m</th>{h.horizons.map((x) => <th key={x}>+{x} pregões</th>)}</tr></thead>
          <tbody>
            {base && (
              <tr className="hs-base">
                <td><div className="hs-sig"><i style={{ background: "#5b6166" }} /><div><b>Base (todos os pregões)</b><span className="mu">todos os pregões dos mesmos ativos · comportamento normal</span></div></div></td>
                <td className="num mono">{base.events.toLocaleString("pt-BR")}<div className="di">ativo-dias</div></td>
                {h.horizons.map((x) => <StatCell key={x} s={base.h[String(x)]} bench={bench} />)}
              </tr>)}
            {histKeys(SIGNAL_TYPES).map((k) => { const s = h.signals[k]; if (!s) return null; const t = baseOf(k) as BlockType; return (
              <tr key={k}>
                <td><div className="hs-sig"><i style={{ background: SIGNAL_COLORS[t] }} /><div><b>{DEFS[t].label}{k !== t ? (k.endsWith("_buy") ? " · compra" : " · venda") : ""}</b><span className="mu">{VARIANT[k]}</span></div></div></td>
                <td className="num mono">{s.events.toLocaleString("pt-BR")}<div className="di">{s.tickers} ativos</div></td>
                {h.horizons.map((x) => <StatCell key={x} s={s.h[String(x)]} bench={bench} base={base?.h[String(x)]} />)}
              </tr>); })}
          </tbody>
        </table>
      </div>
      <p className="mu hs-how">Como ler: <b>média</b> e <b>mediana</b> do retorno do ativo após o sinal; <b>acerto</b> = % de eventos com retorno &gt; 0; <b>vs {bench}</b> = retorno acima do índice no mesmo período{MKT.market === "br" ? " (FIIs vs IFIX/XFIX11)" : ""} e % de vezes que superou o índice; <b>vs base</b> = diferença para a linha Base (todos os pregões dos mesmos ativos no período, com ou sem sinal), ou seja, o quanto o sinal se afastou do comportamento normal. Compra e venda aparecem separadas: numa venda, retorno abaixo da base é o que o sinal "esperaria".</p>
      {CAVEATS}
    </section>
  );
}
