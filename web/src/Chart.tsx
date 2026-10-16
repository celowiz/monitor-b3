import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, type IChartApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from "lightweight-charts";
import { Block, BlockType, DEFS, KIND_LABEL, Row, SIGNAL_TYPES, fmtNum, fmtPct } from "./engine";
import { track } from "./analytics";
import { type Candles, type SignalEvent, SIGNAL_COLORS, historicalSignals } from "./signals";

const DEFAULT_ON: BlockType[] = ["high52", "low52", "smaCross", "rsi", "gap", "volume"];
const cache = new Map<string, Candles>();
const ts = (d: string) => (Date.parse(d + "T00:00:00Z") / 1000) as UTCTimestamp;

export default function ChartPanel({ row, hits, onClose, maximized = false, onToggleMax, signalParams }: { row: Row; hits: Block[]; onClose: () => void; maximized?: boolean; onToggleMax?: () => void; signalParams?: Partial<Record<BlockType, Record<string, any>>> }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [data, setData] = useState<Candles | null>(cache.get(row.t) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<number>(252);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [on, setOn] = useState<Set<BlockType>>(() => new Set(DEFAULT_ON));
  const [tip, setTip] = useState<{ x: number; y: number; d: string; ev: SignalEvent[]; rsi?: number | null; volr?: number | null } | null>(null);
  const events = useMemo(() => (data ? historicalSignals(data, signalParams) : []), [data, signalParams]);
  const counts = useMemo(() => { const m = new Map<BlockType, number>(); for (const e of events) m.set(e.type, (m.get(e.type) ?? 0) + 1); return m; }, [events]);
  const evRef = useRef(events); evRef.current = events;

  useEffect(() => {
    setErr(null);
    if (cache.has(row.t)) { setData(cache.get(row.t)!); return; }
    setData(null);
    fetch(`${import.meta.env.BASE_URL}data/candles/${row.t}.json`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d) => { cache.set(row.t, d); setData(d); }).catch(() => setErr("Sem candles para este ticker nesta rodada."));
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
    const panes = c.panes();
    if (panes.length === 3) { panes[0].setStretchFactor(3); panes[1].setStretchFactor(1); panes[2].setStretchFactor(1); }
    c.subscribeCrosshairMove((p) => {
      if (!p.time || !p.point || p.point.x < 0) { setTip(null); return; }
      const d = new Date((p.time as number) * 1000).toISOString().slice(0, 10), i = data.t.indexOf(d);
      const ev = evRef.current.filter((e) => e.t === d && onRef.current.has(e.type));
      setTip({ x: p.point.x, y: p.point.y, d, ev, rsi: data.rsi?.[i], volr: data.volr?.[i] });
    });
    return () => { c.remove(); chart.current = null; markers.current = null; };
  }, [data]);

  const onRef = useRef(on); onRef.current = on;
  useEffect(() => {
    if (!markers.current) return;
    const m: SeriesMarker<Time>[] = events.filter((e) => on.has(e.type)).map((e) => ({
      time: ts(e.t), position: e.up ? "belowBar" : "aboveBar", shape: e.type === "high52" || e.type === "low52" ? (e.up ? "arrowUp" : "arrowDown") : "circle",
      color: SIGNAL_COLORS[e.type], size: e.type === "high52" || e.type === "low52" || e.type === "smaCross" ? 1 : 0.6,
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
          <div className="cp-t">{row.t}</div>
          <div className="cp-s">{row.name} · {row.sector ?? "—"} · {KIND_LABEL[row.kind]}</div>
        </div>
        {onToggleMax && <button className="close cp-max" onClick={onToggleMax} aria-label={maximized ? "restaurar" : "tela cheia"} title={maximized ? "Restaurar (Esc)" : "Tela cheia"}>{maximized ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>}</button>}
        <button className="close" onClick={onClose} aria-label="fechar">×</button>
      </div>
      <div className="cp-price mono">R$ {fmtNum(row.price)} <span className={up ? "up" : "dn"}>{fmtPct(row.chg)}</span></div>
      <div className="badges">{hits.map((h) => <span key={h.id} className="bdg">{DEFS[h.type].short}</span>)}</div>
      <div className="cp-ctl">
        <div className="seg">{([[63, "3M"], [126, "6M"], [252, "1A"]] as [number, string][]).map(([v, l]) => <button key={l} className={range === v ? "on" : ""} onClick={() => setRange(v)}>{l}</button>)}</div>
        <span className="mu">Diário</span>
      </div>
      <div className="legend"><span><i style={{ background: "#d6a756" }} />SMA 50</span><span><i style={{ background: "#7c8cf0" }} />SMA 200</span><span><i className="dash" />Máx. 52s</span><span><i style={{ background: "rgba(63,184,169,.5)" }} />Volume</span></div>
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
            <div className="mu">RSI {tip.rsi == null ? "—" : fmtNum(tip.rsi, 0)} · Vol {tip.volr == null ? "—" : fmtNum(tip.volr, 1) + "×"}</div>
          </div>)}
        <div className="pane-lbl" style={{ top: "60.5%" }}>RSI(14) · 30/70</div><div className="pane-lbl" style={{ top: "80.5%" }}>Vol. relativo · 2×</div>
      </div>
      <p className="cp-note mu">Marcadores: dias em que cada sinal teria disparado no último ano, com os parâmetros da tela atual. Fins educativos, sem garantia de resultado futuro.</p>
      <dl className="stats mono">
        <div><dt>Máx. 52s</dt><dd>{fmtNum(row.high52)}</dd></div>
        <div><dt>Mín. 52s</dt><dd>{fmtNum(row.low52)}</dd></div>
        <div><dt>SMA 50</dt><dd>{fmtNum(row.sma50)}</dd></div>
        <div><dt>SMA 200</dt><dd>{fmtNum(row.sma200)}</dd></div>
        <div><dt>RSI(14)</dt><dd>{fmtNum(row.rsi, 1)}</dd></div>
        <div><dt>Vol./méd. 21d</dt><dd>{row.volRatio == null ? "—" : fmtNum(row.volRatio, 2) + "×"}</dd></div>
        <div><dt>RS 21d ({row.rsBench === "IFIX" ? "IFIX" : "Ibov"})</dt><dd>{row.rs21 == null ? "—" : `${row.rs21 >= 0 ? "+" : ""}${fmtNum(row.rs21, 1)} pp`}</dd></div>
        <div><dt>Barra</dt><dd>{row.date.split("-").reverse().join("/")}</dd></div>
      </dl>
    </section>
  );
}
