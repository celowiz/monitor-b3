import { describe, expect, it } from "vitest";
import { Row, Screen, makeBlock, newId, setWatchContext, evaluate } from "../engine";
import { connect, evaluateGraph } from "../graph";
import { PRESETS } from "../presets";
import { explain, whyLines } from "../explain";
import { AlertDef, alertProblems, isClosingRun, rss, step } from "../alerts";
import { Panel, rowsAt, runBacktest } from "../backtest";
import { toggleWatch } from "../watch";

const row = (t: string, o: Partial<Row> = {}): Row => ({ t, name: t, kind: "acao", sector: null, subsector: null, logo: null, date: "2026-10-15", price: 10, prevClose: 10, open: 10, chg: 0,
  high52: 20, low52: 5, liq21: 1e8, vol: 1, volRatio: 1, rsi: 50, rsiPrev: 50, ret21: 0, rs21: 0, sma20: 10, sma50: 10, sma200: 10, sma50Prev: 10, sma200Prev: 10, gap: 0, ...o } as Row);
const E = (s: string, t: string) => ({ id: newId("e"), source: s, target: t });
const chain = (...bs: ReturnType<typeof makeBlock>[]): Screen => { let s: Screen = { name: "x", blocks: bs, edges: [] }; for (let i = 1; i < bs.length; i++) s = connect(s, bs[i - 1].id, bs[i].id); return s; };

describe("watchlist", () => {
  it("modo estrelas usa o contexto do navegador; modo fixo usa a lista do bloco", () => {
    const rows = [row("PETR4"), row("VALE3"), row("ITUB4")];
    const live = chain(makeBlock("universe"), makeBlock("watchlist", true, { mode: "live" }), makeBlock("result"));
    setWatchContext(["VALE3"]);
    expect(evaluate(live, rows).results.map((r) => r.t)).toEqual(["VALE3"]);
    setWatchContext([]);
    expect(evaluate(live, rows).results).toHaveLength(0);
    const fixed = chain(makeBlock("universe"), makeBlock("watchlist", true, { mode: "fixed", tickers: "petr4, ITUB4" }), makeBlock("result"));
    expect(evaluate(fixed, rows).results.map((r) => r.t).sort()).toEqual(["ITUB4", "PETR4"]);
  });
  it("toggle adiciona/remove sem duplicar", () => {
    let l: string[] = []; l = toggleWatch(l, "A").list; l = toggleWatch(l, "B").list; expect(l).toEqual(["A", "B"]);
    const r = toggleWatch(l, "A"); expect(r.added).toBe(false); expect(r.list).toEqual(["B"]);
  });
});

describe("explicação (por que passou)", () => {
  const rows = [row("GAP3", { gap: 0.03 }), row("VOL3", { volRatio: 3 }), row("BOTH3", { gap: 0.03, volRatio: 3 }), row("RSI3", { rsi: 20 }), row("MAX3", { price: 21 }), row("NADA3", { liq21: 10 }),
    row("GOLD3", { sma50: 11, sma200: 10.5, sma50Prev: 10, sma200Prev: 10.5 }), row("FII11", { kind: "fii", rs21: 2, price: 11 })];
  const u = makeBlock("universe"), g = makeBlock("gap", true, { dir: "up", pct: 2 }), v = makeBlock("volume", true, { mult: 2 }), r = makeBlock("rsi", true, { zone: "below", low: 30 });
  const a = makeBlock("and"), o = makeBlock("or"), res = makeBlock("result");
  const dag: Screen = { name: "x", blocks: [u, g, v, r, a, o, res], edges: [E(u.id, g.id), E(u.id, v.id), E(u.id, r.id), E(g.id, a.id), E(v.id, a.id), E(a.id, o.id), E(r.id, o.id), E(o.id, res.id)] };
  const screens = [dag, ...PRESETS.filter((p) => p.id !== "agulhada" && p.id !== "trix").map((p) => p.build(5e6))];
  it("o veredito do nó Resultado bate com a avaliação do grafo, para todo ativo e tela", () => {
    for (const s of screens) {
      const ev = evaluateGraph(s, rows), inRes = new Set(ev.results.map((x) => x.t));
      for (const rw of rows) {
        const st = explain(s, rw), last = st.find((x) => x.block.type === "result");
        expect(!!last?.pass, `${s.name} / ${rw.t}`).toBe(inRes.has(rw.t));
      }
    }
  });
  it("mostra valores e regra", () => {
    const st = explain(dag, rows[2]);
    expect(st.find((x) => x.block.type === "gap")!.value).toMatch(/gap \+?3,0%/);
    expect(st.find((x) => x.block.type === "and")!.value).toBe("2 de 2 entrada(s) com o ativo");
    expect(whyLines(dag, rows[2]).length).toBe(2);
  });
});

describe("alertas", () => {
  const s = chain(makeBlock("universe"), makeBlock("high52"), makeBlock("result"));
  const d: AlertDef = { id: "t-max", name: "Máx", market: "br", active: true, screen: s };
  it("só entradas novas; mesma data é idempotente; ativo sem dado hoje é mantido", () => {
    const d1 = step(d, [row("A", { price: 21 }), row("B", { price: 21 })], "2026-10-14", null, "x");
    expect(d1.entries.map((e) => e.t).sort()).toEqual(["A", "B"]);
    const d2 = step(d, [row("A", { price: 21 }), row("C", { price: 21 })], "2026-10-15", d1, "x"); // B sem dado hoje
    expect(d2.entries.filter((e) => e.date === "2026-10-15").map((e) => e.t)).toEqual(["C"]);
    expect(d2.current).toEqual(["A", "B", "C"]);
    expect(step(d, [row("Z", { price: 99 })], "2026-10-15", d2, "y").entries).toEqual(d2.entries);
    const d3 = step(d, [row("A"), row("B", { price: 21 }), row("C", { price: 21 })], "2026-10-16", d2, "x");
    expect(d3.entries.filter((e) => e.date === "2026-10-16")).toHaveLength(0); // B voltou a ter dado e já estava dentro
    expect(d3.current).toEqual(["B", "C"]);
  });
  it("recusa Minha lista no modo estrelas e ids ruins", () => {
    const w = chain(makeBlock("universe"), makeBlock("watchlist", true, { mode: "live" }), makeBlock("result"));
    expect(alertProblems({ ...d, screen: w }).join()).toMatch(/estrelas/);
    expect(alertProblems({ ...d, id: "Ruim!" }).join()).toMatch(/id/);
    expect(alertProblems(d)).toEqual([]);
  });
  it("fechamento: BR após 17:30 BRT, EUA após 18:15 BRT, ou barra de pregão anterior", () => {
    expect(isClosingRun("br", "2026-10-16T17:00:00-03:00", "2026-10-16")).toBe(false);
    expect(isClosingRun("br", "2026-10-16T17:45:00-03:00", "2026-10-16")).toBe(true);
    expect(isClosingRun("us", "2026-10-16T17:45:00-03:00", "2026-10-16")).toBe(false);
    expect(isClosingRun("us", "2026-10-16T18:20:00-03:00", "2026-10-16")).toBe(true);
    expect(isClosingRun("br", "2026-10-17T10:00:00-03:00", "2026-10-16")).toBe(true);
  });
  it("RSS válido e escapado", () => {
    const st = step(d, [row("A&B", { price: 21 })], "2026-10-14", null, "x");
    const x = rss("t", "https://s/", "https://s/a.xml", [st], (_s, t) => `https://s/?tk=${t}`);
    expect(x).toContain("<guid isPermaLink=\"false\">monitor-b3-t-max-2026-10-14</guid>");
    expect(x).not.toMatch(/A&B/); expect(x).toMatch(/recomendação/);
  });
});

function mkPanel(): Panel {
  const N = 12, off = 2, dates = Array.from({ length: N }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
  const ser = (g: number) => Array.from({ length: N + off }, (_, i) => +(100 * (1 + g) ** i).toFixed(6));
  const f = (c: number[]) => ({ price: c.slice(off), high52: c.slice(off).map(() => 1e9), liq21: c.slice(off).map(() => 1e9) } as Record<string, (number | null)[]>);
  const A = ser(0.01), B = ser(-0.01);
  return { market: "br", dates, closeOffset: off, horizons: [1, 2], evalDays: 6, mainLabel: "Ibovespa", bench: { main: ser(0.005).slice(off) },
    tickers: {
      A: { name: "A", kind: "acao", sector: null, subsector: null, idx: [], rsBench: "IBOV", f: f(A), c: A, x: [] },
      B: { name: "B", kind: "acao", sector: null, subsector: null, idx: [], rsBench: "IBOV", f: f(B), c: B, x: [8, 9] },
    } };
}
describe("backtest walk-forward", () => {
  it("linhas do dia i não dependem de dados posteriores (sem look-ahead)", () => {
    const p = mkPanel(), before = JSON.stringify(rowsAt(p, 7));
    for (const k of Object.values(p.tickers)) { for (const a of Object.values(k.f)) for (let j = 8; j < a.length; j++) a[j] = 999; for (let j = 8 + p.closeOffset; j < k.c.length; j++) k.c[j] = 999; }
    expect(JSON.stringify(rowsAt(p, 7))).toBe(before);
  });
  it("coorte, base, índice e exclusões por quebra", () => {
    const p = mkPanel();
    const onlyA = chain(makeBlock("universe"), makeBlock("watchlist", true, { mode: "fixed", tickers: "A" }), makeBlock("result"));
    const b = runBacktest("x", onlyA, p, 3);
    expect(b.from).toBe(p.dates[6]); expect(b.evalDays).toBe(6);
    const h1 = b.h["1"];
    expect(h1.graph.n).toBe(5); // 6 dias, o último sem retorno futuro
    expect(h1.graph.mean!).toBeCloseTo(0.01, 6); expect(h1.graph.hit).toBe(1);
    expect(h1.graph.exMean!).toBeCloseTo(0.005, 6);
    expect(h1.base.n).toBe(5); // a lista fixa é filtro: a base é a mesma coorte
    const all = runBacktest("y", chain(makeBlock("universe"), makeBlock("liquidity", true, { min: 1 }), makeBlock("result")), p, 3);
    expect(all.h["1"].graph.n).toBe(5 + 3); // B: dias 6,7,10 (8 e 9 excluídos por quebra; 11 sem futuro)
    expect(h1.index.mean!).toBeCloseTo(0.005, 6);
    expect(b.curve.graph[b.curve.graph.length - 1]).toBeCloseTo(100 * 1.01 ** 5, 2);
    expect(b.curve.index[b.curve.index.length - 1]).toBeCloseTo(100 * 1.005 ** 5, 2);
  });
});
