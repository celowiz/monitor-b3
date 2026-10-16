import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import { Block, DEFS, KIND_LABEL, Row, fmtNum, fmtPct } from "./engine";

interface Candles { t: string[]; o: number[]; h: number[]; l: number[]; c: number[]; v: number[]; sma50: (number | null)[]; sma200: (number | null)[]; high52: (number | null)[] }
const cache = new Map<string, Candles>();
const ts = (d: string) => (Date.parse(d + "T00:00:00Z") / 1000) as UTCTimestamp;

export default function ChartPanel({ row, hits, onClose, maximized = false, onToggleMax }: { row: Row; hits: Block[]; onClose: () => void; maximized?: boolean; onToggleMax?: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const [data, setData] = useState<Candles | null>(cache.get(row.t) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState<number>(252);

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
    return () => { c.remove(); chart.current = null; };
  }, [data]);

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
      <div className="chart-box" ref={el}>{!data && !err && <div className="mu pad">carregando candles…</div>}{err && <div className="mu pad">{err}</div>}</div>
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
