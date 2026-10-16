import { useEffect, useMemo, useRef, useState } from "react";
import { Kind, KIND_LABEL, Latest, fmtBrl, fmtPct } from "./engine";
import { breadth, sectorTiles, squarify } from "./signals";

// Cor divergente: vermelho (-3%) → cinza (0) → teal (+3%)
function heat(chg: number | null) {
  if (chg == null) return "#1a1d20";
  const x = Math.max(-1, Math.min(1, chg / 0.03));
  const [r, g, b] = x >= 0 ? [63, 184, 169] : [224, 108, 108];
  const a = 0.12 + Math.abs(x) * 0.68;
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function Bar({ label, v, n, hint }: { label: string; v: number; n: number; hint: string }) {
  const p = n ? v / n : 0;
  return (
    <div className="br-card" title={hint}>
      <span className="mu">{label}</span>
      <b className="mono">{(p * 100).toFixed(0)}%</b>
      <div className="br-bar"><i style={{ width: `${p * 100}%` }} /></div>
      <span className="di mono">{v} de {n}</span>
    </div>
  );
}

export default function Market({ latest, wide }: { latest: Latest; wide: boolean }) {
  const all: Kind[] = ["acao", "bdr", "etf", "fii"];
  const [kinds, setKinds] = useState<Kind[]>(["acao"]);
  const rows = useMemo(() => latest.tickers.filter((r) => kinds.includes(r.kind)), [latest, kinds]);
  const b = useMemo(() => breadth(rows), [rows]);
  const tiles = useMemo(() => sectorTiles(latest.tickers, kinds), [latest, kinds]);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(box.current); return () => ro.disconnect();
  }, []);
  const H = wide ? 420 : Math.max(360, W * 1.1);
  const rects = useMemo(() => squarify(tiles.filter((t) => t.liq > 0), W, H), [tiles, W, H]);
  const toggle = (k: Kind) => setKinds((s) => (s.includes(k) ? (s.length > 1 ? s.filter((x) => x !== k) : s) : [...s, k]));
  const bm = latest.benchmark as Latest["benchmark"] & { chg?: number | null; ifixChg?: number | null };
  const cls = (v?: number | null) => (v == null ? "" : v >= 0 ? "up" : "dn");
  return (
    <section className="market">
      <div className="mk-head">
        <div className="mk-idx">
          <div><span className="mu">Ibovespa</span><b className={"mono " + cls(bm.chg)}>{fmtPct(bm.chg ?? null)}</b></div>
          <div><span className="mu">IFIX <small>({bm.ifixProxy ?? "XFIX11"})</small></span><b className={"mono " + cls(bm.ifixChg)}>{fmtPct(bm.ifixChg ?? null)}</b></div>
        </div>
        <div className="seg mk-kinds" role="group" aria-label="Tipos de ativo">
          {all.map((k) => <button key={k} className={kinds.includes(k) ? "on" : ""} onClick={() => toggle(k)}>{KIND_LABEL[k]}</button>)}
        </div>
      </div>
      <div className="br-grid">
        <Bar label="Acima da SMA200" v={b.above200} n={b.n} hint="Fatia do universo com preço acima da média de 200 pregões: termômetro da tendência de longo prazo." />
        <Bar label="Acima da SMA50" v={b.above50} n={b.n} hint="Fatia acima da média de 50 pregões: tendência de médio prazo." />
        <div className="br-card" title="Rompimentos de máxima vs mínima de 52 semanas hoje (excluindo a barra de hoje do cálculo).">
          <span className="mu">Novas máx. vs mín. 52s</span>
          <b className="mono"><span className="up">{b.highs}</span> <span className="di">vs</span> <span className="dn">{b.lows}</span></b>
          <div className="br-bar two"><i style={{ width: `${(b.highs / Math.max(1, b.highs + b.lows)) * 100}%` }} /></div>
          <span className="di">{b.highs + b.lows ? `${((b.highs / (b.highs + b.lows)) * 100).toFixed(0)}% máximas` : "nenhum rompimento"}</span>
        </div>
        <div className="br-card" title="Quantos ativos subiram vs caíram no dia (avanço/declínio).">
          <span className="mu">Avanço / declínio</span>
          <b className="mono"><span className="up">{b.adv}</span> <span className="di">/</span> <span className="dn">{b.dec}</span>{b.unch ? <span className="di"> · {b.unch} =</span> : null}</b>
          <div className="br-bar two"><i style={{ width: `${(b.adv / Math.max(1, b.adv + b.dec)) * 100}%` }} /></div>
          <span className="di">{b.n} ativos</span>
        </div>
      </div>
      <div className="mk-sub"><h2>Mapa de setores</h2><span className="mu">área = liquidez média 21d · cor = variação do dia ponderada por liquidez</span>
        <span className="hm-leg"><i style={{ background: heat(-0.03) }} />−3%<i style={{ background: heat(0) }} />0<i style={{ background: heat(0.03) }} />+3%</span></div>
      <div className="heatmap" ref={box} style={{ height: H }}>
        {rects.map(({ item: t, x, y, w, h }) => (
          <div key={t.sector} className="hm-tile" style={{ left: x, top: y, width: w, height: h, background: heat(t.chg) }}
            title={`${t.sector}\n${fmtPct(t.chg)} · ${t.n} ativos · liq. ${fmtBrl(t.liq)}\n${t.top.map((r) => `${r.t} ${fmtPct(r.chg)}`).join("  ")}`}>
            {w > 60 && h > 30 && <><b>{t.sector}</b><span className="mono">{fmtPct(t.chg)}</span></>}
            {w > 120 && h > 70 && <small className="mono">{t.top.map((r) => r.t).join(" · ")}</small>}
          </div>))}
      </div>
    </section>
  );
}
