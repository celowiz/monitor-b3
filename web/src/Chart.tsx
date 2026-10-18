import { explain } from "./explain";
import { Star } from "./Results";
import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { Block, BlockType, DEFS, KIND_LABEL, MKT, Row, SIGNAL_TYPES, Screen, fmtNum, fmtPct, hitLabel } from "./engine";
import { CAVEATS, StatCell } from "./History";
import { track } from "./analytics";
import { AGU_DEFAULTS, agulhadaSeries, normParams } from "./agulhada";
import { type Candles, type SignalEvent, HIST_PARAMS, HORIZONS, SIGNAL_COLORS, fwdStats, historicalSignals } from "./signals";

const DEFAULT_ON: BlockType[] = ["high52", "low52", "smaCross", "rsi", "gap", "volume"];
const cache = new Map<string, Candles & { bc?: (number | null)[] }>();
const AGU_COL = { c: "#f2d16b", m: "#c9ced2", l: "#5aa9e6" };
const TRIX_COL = { t: "#e88fc0", s: "#c9ced2" };
/** pesos: preço, RSI, vol. relativo e um painel extra (1,4) para cada indicador ligado (Agulhada, TRIX) */
const PANE_W = (n: number) => [3, 1, 1, ...Array(Math.max(0, n - 3)).fill(1.4)];
/** posição (%) do rótulo de cada painel inferior, a partir dos pesos dos painéis */
const paneTops = (n: number) => { const w = PANE_W(n), tot = w.reduce((a, b) => a + b, 0); let acc = 0; return w.slice(0, -1).map((x) => `${((acc += x) / tot) * 100 + 0.5}%`); };
const ts = (d: string) => (Date.parse(d + "T00:00:00Z") / 1000) as UTCTimestamp;

function Why({ screen, row }: { screen: Screen; row: Row }) {
  const [open, setOpen] = useState(true);
  const steps = useMemo(() => explain(screen, row), [screen, row]);
  const res = steps.find((x) => x.block.type === "result");
  const shown = steps.filter((x) => x.block.type !== "result");
  return (
    <div className="why">
      <button className="link" aria-expanded={open} onClick={() => { track("explain_toggle", { open: !open, ticker: row.t, in_result: !!res?.pass }); setOpen(!open); }}>
        {open ? "▾" : "▸"} {res?.pass ? "Por que passou nesta tela" : "Por que não está no resultado"}</button>
      {open && <ol className="why-l">
        {shown.map((x) => (
          <li key={x.block.id} className={(x.pass ? "ok" : x.reached ? "no" : "na") + (x.off ? " off" : "")}>
            <span className="why-i" aria-hidden>{x.pass ? "✓" : x.reached ? "✗" : "·"}</span>
            <b>{x.label}</b><span className="why-v">{x.reached ? x.value : "não chegou a este bloco"}</span>
          </li>))}
      </ol>}
      {open && <p className="mu cp-note">Cada linha usa as mesmas regras da triagem com os dados desta barra. Explica o filtro, não prevê o preço.</p>}
    </div>
  );
}

export default function ChartPanel({ row, hits, onClose, maximized = false, onToggleMax, signalParams, screen, starred, onStar }: { row: Row; hits: Block[]; onClose: () => void; maximized?: boolean; onToggleMax?: () => void; signalParams?: Partial<Record<BlockType, Record<string, any>>>; screen?: Screen; starred?: boolean; onStar?: (t: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [data, setData] = useState<(Candles & { bc?: (number | null)[] }) | null>(cache.get(MKT.market + row.t) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<number>(252);
  const rangeRef = useRef(range); rangeRef.current = range;
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [on, setOn] = useState<Set<BlockType>>(() => new Set(signalParams?.agulhada || signalParams?.trix ? (["agulhada", "trix"] as BlockType[]).filter((t) => signalParams[t]) : DEFAULT_ON));
  const aguP = useMemo(() => normParams(signalParams?.agulhada ?? AGU_DEFAULTS), [signalParams]);
  const aguKey = JSON.stringify(aguP);
  const aguOn = on.has("agulhada");
  const trixOn = on.has("trix");
  const agu = useMemo(() => (data ? agulhadaSeries(data.c, aguP) : null), [data, aguKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const aguRef = useRef(agu); aguRef.current = agu;
  const [tip, setTip] = useState<{ x: number; y: number; d: string; ev: SignalEvent[]; rsi?: number | null; volr?: number | null; dC?: number | null; dL?: number | null; tx?: number | null; txs?: number | null } | null>(null);
  const events = useMemo(() => (data ? historicalSignals(data, signalParams) : []), [data, signalParams]);
  const counts = useMemo(() => { const m = new Map<BlockType, number>(); for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1); return m; }, [events]);
  const tstats = useMemo(() => (data ? fwdStats(data, historicalSignals(data, HIST_PARAMS)) : null), [data]);
  const [showHist, setShowHist] = useState(false);
  const evRef = useRef(events); evRef.current = events;

  useEffect(() => {
    setErr(null);
    if (cache.has(MKT.market + row.t)) { setData(cache.get(MKT.market + row.t)!); return; }
    setData(null);
    fetch(`${import.meta.env.BASE_URL}data/${MKT.market === "us" ? "candles_us" : "candles"}/${row.t}.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { cache.set(MKT.market + row.t, d); setData(d); }).catch(() => setErr("Sem candles para este ticker nesta rodada."));
  }, [row.t]);

  useEffect(() => {
    if (!el.current || !data) return;
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: "#8b9196", fontFamily: "JetBrains Mono, monospace", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: "#15181b" }, horzLines: { color: "#15181b" } },
      rightPriceScale: { borderColor: "#22262a" }, timeScale: { borderColor: "#22262a" },
      crosshair: { mode: 0 }, localization: { locale: "pt-BR", priceFormatter: (p: number) => fmtNum(p) },
    });
    chart.current = c;
    const candle = c.addSeries(CandlestickSeries, { upColor: "#3fb8a9", downColor: "#e06c6c", wickUpColor: "#3fb8a9", wickDownColor: "#e06c6c", borderVisible: false });
    candle.setData(data.t.map((d, i) => ({ time: ts(d), open: data.o[i], high: data.h[i], low: data.l[i], close: data.c[i] })));
    const vol = c.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(data.t.map((d, i) => ({ time: ts(d), value: data.v[i], color: data.c[i] >= data.o[i] ? "rgba(63,184,169,.35)" : "rgba(224,108,108,.35)" })));
    const line = (vals: (number | null)[], color: string, style = LineStyle.Solid) => {
      const s = c.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(data.t.flatMap((d, i) => (vals[i] == null ? [] : [{ time: ts(d), value: vals[i] as number }])));
    };
    line(data.sma50, "#d6a756");
    line(data.sma200, "#7c8cf0");
    line(data.high52, "#e7e9ea", LineStyle.Dashed);
    candle.applyOptions({ priceLineColor: "#3fb8a9" });
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    markers.current = createSeriesMarkers(candle, []);
    // Painel RSI(14) com faixas 30/70
    const lineOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true };
    if (data.rsi) {
      const rs = c.addSeries(LineSeries, { ...lineOpts, color: "#b58cf0", priceFormat: { type: "price", precision: 0, minMove: 1 } }, 1);
      rs.setData(data.t.flatMap((d, i) => (data.rsi![i] == null ? [] : [{ time: ts(d), value: data.rsi![i] as number }])));
      for (const [v, col] of [[70, "#e06c6c"], [30, "#3fb8a9"]] as const) rs.createPriceLine({ price: v, color: col, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      rs.priceScale().applyOptions({ autoScale: false, scaleMargins: { top: 0.1, bottom: 0.1 } });
      rs.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    }
    // Painel volume relativo (vol / média 21d) com linha de 2×
    if (data.volr) {
      const vr = c.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: true, priceFormat: { type: "price", precision: 1, minMove: 0.1 } }, 2);
      vr.setData(data.t.flatMap((d, i) => (data.volr![i] == null ? [] : [{ time: ts(d), value: data.volr![i] as number, color: (data.volr![i] as number) >= 2 ? "rgba(214,167,86,.8)" : "rgba(139,145,150,.4)" }])));
      vr.createPriceLine({ price: 2, color: "#d6a756", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "2×" });
    }
    // Agulhada: SMAs curta/média/longa sobre o preço, faixa nas barras convergidas e painel distCurta/distLonga ± alpha
    if (aguOn && agu) {
      const band = c.addSeries(HistogramSeries, { priceScaleId: "agu", lastValueVisible: false, priceLineVisible: false, base: 0 });
      c.priceScale("agu").applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });
      band.setData(data.t.map((d, i) => (agu.conv[i] ? { time: ts(d), value: 1, color: agu.side[i] > 0 ? "rgba(63,184,169,.13)" : "rgba(224,108,108,.13)" } : { time: ts(d) })));
      line(agu.sc, AGU_COL.c); line(agu.sm, AGU_COL.m); line(agu.sl, AGU_COL.l);
      const pc = (v: (number | null)[]) => data.t.flatMap((d, i) => (v[i] == null ? [] : [{ time: ts(d), value: (v[i] as number) * 100 }]));
      const fmt = { type: "custom" as const, formatter: (x: number) => `${x.toFixed(1).replace(".", ",")}%`, minMove: 0.01 };
      const dc = c.addSeries(LineSeries, { ...lineOpts, color: AGU_COL.c, priceFormat: fmt }, 3);
      dc.setData(pc(agu.dC));
      const dl = c.addSeries(LineSeries, { ...lineOpts, color: AGU_COL.l, priceFormat: fmt }, 3);
      dl.setData(pc(agu.dL));
      for (const v of [aguP.alpha, -aguP.alpha]) dc.createPriceLine({ price: v, color: "#f2d16b", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      dc.createPriceLine({ price: 0, color: "#3a3f44", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    }
    // TRIX: painel próprio com TRIX(9), sinal EMA 9 e banda ±(q80 − q20)/2 de 60 pregões (tracejada)
    if (trixOn && data.trix) {
      const pane = aguOn ? 4 : 3;
      const ser = (v: (number | null)[] | undefined, k = 1) => data.t.flatMap((d, i) => (v?.[i] == null ? [] : [{ time: ts(d), value: (v[i] as number) * k }]));
      const fmt = { type: "custom" as const, formatter: (x: number) => x.toFixed(2).replace(".", ","), minMove: 0.001 };
      const tl = c.addSeries(LineSeries, { ...lineOpts, color: TRIX_COL.t, priceFormat: fmt }, pane); tl.setData(ser(data.trix));
      const sl = c.addSeries(LineSeries, { ...lineOpts, color: TRIX_COL.s, lineStyle: LineStyle.Solid, priceFormat: fmt }, pane); sl.setData(ser(data.trixSig));
      for (const k of [1, -1]) {
        const b = c.addSeries(LineSeries, { lineWidth: 1, color: "#6b7177", lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat: fmt }, pane);
        b.setData(ser(data.trixBand, k));
      }
      tl.createPriceLine({ price: 0, color: "#3a3f44", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    }
    const panes = c.panes();
    PANE_W(panes.length).forEach((w, k) => panes[k]?.setStretchFactor(w));
    c.subscribeCrosshairMove((p) => {
      if (!p.time || !p.point || p.point.x < 0) { setTip(null); return; }
      const d = new Date((p.time as number) * 1000).toISOString().slice(0, 10), i = data.t.indexOf(d);
      const ev = evRef.current.filter((e) => e.t === d && onRef.current.has(e.type));
      setTip({ x: p.point.x, y: p.point.y, d, ev, rsi: data.rsi?.[i], volr: data.volr?.[i], dC: aguRef.current?.dC[i], dL: aguRef.current?.dL[i], tx: data.trix?.[i], txs: data.trixSig?.[i] });
    });
    // reaplica a janela de tempo escolhida após recriar o gráfico (toggle da Agulhada recria as séries)
    const n = data.t.length; c.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - rangeRef.current), to: n + 2 });
    return () => { c.remove(); chart.current = null; markers.current = null; };
  }, [data, aguOn, agu, trixOn]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRef = useRef(on); onRef.current = on;
  useEffect(() => {
    if (!markers.current) return;
    const m: SeriesMarker<Time>[] = events.filter((e) => on.has(e.type)).map((e) => ({
      time: ts(e.t), position: e.up ? "belowBar" : "aboveBar", shape: e.type === "high52" || e.type === "low52" || e.type === "agulhada" || e.type === "trix" ? (e.up ? "arrowUp" : "arrowDown") : "circle",
      color: e.type === "agulhada" || e.type === "trix" ? (e.up ? "#3fb8a9" : "#e06c6c") : SIGNAL_COLORS[e.type], size: e.type === "high52" || e.type === "low52" || e.type === "smaCross" || e.type === "agulhada" || e.type === "trix" ? 1 : 0.6,
      ...(e.type === "agulhada" ? { text: e.up ? "A▲" : "A▼" } : e.type === "trix" ? { text: e.up ? "T▲" : "T▼" } : {}),
    }));
    markers.current.setMarkers(m);
  }, [events, on, data]);
  const toggle = (t: BlockType) => { track("chart_signal_toggle", { signal: t, on: !on.has(t) }); setOn((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n; }); };

  useEffect(() => {
    if (!chart.current || !data) return;
    const n = data.t.length;
    chart.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - range), to: n + 2 });
  }, [range, data]);

  useEffect(() => {
    const t = setTimeout(() => chart.current?.timeScale().fitContent(), 320);
    return () => clearTimeout(t);
  }, [maximized]);

  const up = (row.chg ?? 0) >= 0;
  return (
    <section className="chart-panel">
      <div className="cp-head">
        <div className="logo">{row.logo ? <img src={row.logo} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} /> : null}<span>{row.t.slice(0, 2)}</span></div>
        <div className="cp-id">
          <div className="cp-t">{row.t} <Star on={!!starred} t={row.t} onStar={onStar} /></div>
          <div className="cp-s">{row.name} · {row.sector ?? "—"} · {KIND_LABEL[row.kind]}</div>
        </div>
        {onToggleMax && <button className="close cp-max" onClick={onToggleMax} aria-label={maximized ? "restaurar" : "tela cheia"} title={maximized ? "Restaurar (Esc)" : "Tela cheia"}>{maximized ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>}</button>}
        <button className="close" onClick={onClose} aria-label="fechar">×</button>
      </div>
      <div className="cp-price mono">{MKT.cur} {fmtNum(row.price)} <span className={up ? "up" : "dn"}>{fmtPct(row.chg)}</span></div>
      <div className="badges">{hits.map((h) => <span key={h.id} className={"bdg" + (h.type === "trix" && row.trixSide && row.trixSide < 0 ? " side-dn" : "")}>{hitLabel(h, row)}</span>)}</div>
      {screen && <Why screen={screen} row={row} />}
      <div className="cp-ctl">
        <div className="seg">{([[63, "3M"], [126, "6M"], [252, "1A"]] as [number, string][]).map(([v, l]) => <button key={l} className={range === v ? "on" : ""} onClick={() => setRange(v)}>{l}</button>)}</div>
        <span className="mu">Diário</span>
      </div>
      <div className="legend"><span><i style={{ background: "#d6a756" }} />SMA 50</span><span><i style={{ background: "#7c8cf0" }} />SMA 200</span><span><i className="dash" />Máx. 52s</span><span><i style={{ background: "rgba(63,184,169,.5)" }} />Volume</span>
        {aguOn && <><span><i style={{ background: AGU_COL.c }} />SMA {aguP.curta}</span><span><i style={{ background: AGU_COL.m }} />SMA {aguP.media}</span><span><i style={{ background: AGU_COL.l }} />SMA {aguP.longa}</span><span><i className="box" style={{ background: "rgba(63,184,169,.3)" }} />Convergência (compra)</span><span><i className="box" style={{ background: "rgba(224,108,108,.3)" }} />(venda)</span></>}
        {trixOn && data?.trix && <><span><i style={{ background: TRIX_COL.t }} />TRIX(9)</span><span><i style={{ background: TRIX_COL.s }} />Sinal EMA 9</span><span><i className="dash" />Banda 60d</span><span><i style={{ background: "#3fb8a9" }} />T▲ compra</span><span><i style={{ background: "#e06c6c" }} />T▼ venda</span></>}</div>
      <div className="sig-tg" role="group" aria-label="Sinais no gráfico">
        {SIGNAL_TYPES.map((t) => (
          <button key={t} className={"sig-chip" + (on.has(t) ? " on" : "")} aria-pressed={on.has(t)} onClick={() => toggle(t)} title={DEFS[t].label}>
            <i style={{ background: SIGNAL_COLORS[t] }} />{DEFS[t].short}<span className="mono">{counts.get(t) ?? 0}</span>
          </button>))}
      </div>
      <div className="chart-box" ref={el}>{!data && !err && <div className="mu pad">carregando candles…</div>}{err && <div className="mu pad">{err}</div>}
        {tip && (
          <div className="cp-tip mono" style={{ left: Math.min(tip.x + 14, (el.current?.clientWidth ?? 400) - 190), top: Math.max(4, Math.min(tip.y - 10, 120)) }}>
            <b>{tip.d.split("-").reverse().join("/")}</b>
            {tip.ev.map((e, k) => <div key={k}><i style={{ background: SIGNAL_COLORS[e.type] }} />{e.text}</div>)}
            {aguOn && tip.dC != null && <div className="mu">distCurta {fmtNum(tip.dC * 100, 2)}% · distLonga {fmtNum((tip.dL ?? 0) * 100, 2)}%</div>}
            {trixOn && tip.tx != null && <div className="mu">TRIX {fmtNum(tip.tx, 3)} · sinal {fmtNum(tip.txs, 3)}</div>}
            <div className="mu">RSI {tip.rsi == null ? "—" : fmtNum(tip.rsi, 0)} · Vol {tip.volr == null ? "—" : fmtNum(tip.volr, 1) + "×"}</div>
          </div>)}
        {(() => { const lbl = ["RSI(14) · 30/70", "Vol. relativo · 2×", ...(aguOn ? [`Agulhada · distCurta / distLonga · ±${String(aguP.alpha).replace(".", ",")}%`] : []), ...(trixOn && data?.trix ? ["TRIX(9) · sinal EMA 9 · banda 60d"] : [])];
          return paneTops(lbl.length + 1).map((top, k) => <div key={k} className="pane-lbl" style={{ top }}>{lbl[k]}</div>); })()}
      </div>
      <p className="cp-note mu">Marcadores: dias em que cada sinal teria disparado no último ano, com os parâmetros da tela atual. Fins educativos, sem garantia de resultado futuro.</p>
      <dl className="stats mono">
        <div><dt>Máx. 52s</dt><dd>{fmtNum(row.high52)}</dd></div>
        <div><dt>Mín. 52s</dt><dd>{fmtNum(row.low52)}</dd></div>
        <div><dt>SMA 50</dt><dd>{fmtNum(row.sma50)}</dd></div>
        <div><dt>SMA 200</dt><dd>{fmtNum(row.sma200)}</dd></div>
        <div><dt>RSI(14)</dt><dd>{fmtNum(row.rsi, 1)}</dd></div>
        <div><dt>Vol./méd. 21d</dt><dd>{row.volRatio == null ? "—" : fmtNum(row.volRatio, 2) + "×"}</dd></div>
        <div><dt>RS 21d ({row.rsBench === "IFIX" ? "IFIX" : row.rsBench === "SPX" ? "S&P 500" : "Ibov"})</dt><dd>{row.rs21 == null ? "—" : `${row.rs21 >= 0 ? "+" : ""}${fmtNum(row.rs21, 1)} pp`}</dd></div>
        <div><dt>Barra</dt><dd>{row.date.split("-").reverse().join("/")}</dd></div>
      </dl>
      {tstats && (
        <div className="cp-hist">
          <button className="link" onClick={() => setShowHist((v) => !v)} aria-expanded={showHist}>{showHist ? "▾" : "▸"} Histórico de sinais deste ativo (12m)</button>
          {showHist && <>
            <div className="tbl-wrap"><table className="hs-tbl sm">
              <thead><tr><th>Sinal</th><th className="num">Ev.</th>{HORIZONS.map((x) => <th key={x}>+{x} preg.</th>)}</tr></thead>
              <tbody>{SIGNAL_TYPES.filter((t) => tstats[t].events).map((t) => (
                <tr key={t}><td><span className="hs-dot" style={{ background: SIGNAL_COLORS[t] }} />{DEFS[t].short}</td><td className="num mono">{tstats[t].events}</td>
                  {HORIZONS.map((x) => <StatCell key={x} compact s={tstats[t][x]} bench={row.rsBench === "IFIX" ? "IFIX" : MKT.bench} />)}</tr>))}</tbody>
            </table></div>
            <p className="mu cp-note">Um único ativo tem poucos eventos: trate como ilustração, não como estatística.</p>
            {CAVEATS}
          </>}
        </div>)}
    </section>
  );
}
