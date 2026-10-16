import { describe, expect, it } from "vitest";
import { Row, Screen, defaultScreen, makeBlock, newId } from "../engine";
import { canConnect, connect, evaluateGraph, migrateScreen, topo, validate } from "../graph";
import { decodeScreen } from "../share";
import { PRESETS } from "../presets";
import { importJson, exportJson } from "../graphs";

const row = (t: string, o: Partial<Row> = {}): Row => ({ t, name: t, kind: "acao", sector: null, subsector: null, logo: null, date: "2026-10-15", price: 10, prevClose: 10, open: 10, chg: 0,
  high52: 20, low52: 5, liq21: 1e8, vol: 1, volRatio: 1, rsi: 50, rsiPrev: 50, ret21: 0, rs21: 0, sma20: 10, sma50: 10, sma200: 10, sma50Prev: 10, sma200Prev: 10, gap: 0, ...o } as Row);
const rows = [row("GAP3", { gap: 0.03 }), row("VOL3", { volRatio: 3 }), row("BOTH3", { gap: 0.03, volRatio: 3 }), row("RSI3", { rsi: 20 }), row("NADA3")];
const E = (s: string, t: string) => ({ id: newId("e"), source: s, target: t });

function gapVolOrRsi() {
  const u = makeBlock("universe"), g = makeBlock("gap", true, { dir: "up", pct: 2 }), v = makeBlock("volume", true, { mult: 2 }), r = makeBlock("rsi", true, { zone: "below", low: 30 });
  const a = makeBlock("and"), o = makeBlock("or"), res = makeBlock("result");
  const s: Screen = { name: "x", blocks: [u, g, v, r, a, o, res], edges: [E(u.id, g.id), E(u.id, v.id), E(u.id, r.id), E(g.id, a.id), E(v.id, a.id), E(a.id, o.id), E(r.id, o.id), E(o.id, res.id)] };
  return { s, u, g, v, r, a, o, res };
}

describe("avaliação do DAG", () => {
  it("(Gap E Volume) OU RSI<30", () => {
    const { s, a, o } = gapVolOrRsi();
    const ev = evaluateGraph(s, rows);
    expect(ev.complete).toBe(true);
    expect(ev.perBlock.get(a.id)).toBe(1);
    expect(ev.results.map((r) => r.t).sort()).toEqual(["BOTH3", "RSI3"]);
    expect(ev.perIn.get(o.id)).toBe(2);
  });
  it("sinal desligado deixa passar tudo", () => {
    const { s, g } = gapVolOrRsi();
    s.blocks = s.blocks.map((b) => (b.id === g.id ? { ...b, enabled: false } : b));
    expect(evaluateGraph(s, rows).results.map((r) => r.t).sort()).toEqual(["BOTH3", "RSI3", "VOL3"]);
  });
  it("grafo incompleto: calcula o que dá e não mostra resultado", () => {
    const { s, r, o } = gapVolOrRsi();
    s.edges = s.edges.filter((e) => e.target !== r.id);
    const ev = evaluateGraph(s, rows);
    expect(ev.complete).toBe(false);
    expect(ev.results).toEqual([]);
    expect(ev.perBlock.get(o.id)).toBe(1); // OU usa só a entrada calculável
    expect(ev.problems.map((p) => p.msg)).toEqual(["RSI(14) sem entrada"]);
  });
});

describe("validação", () => {
  it("lista todos os problemas", () => {
    const { s, r, o, res } = gapVolOrRsi();
    s.edges = s.edges.filter((e) => e.target !== r.id && e.source !== r.id);
    s.blocks.push(makeBlock("high52"));
    const ps = validate(s);
    expect(ps.map((p) => p.kind).sort()).toEqual(["logic-inputs", "no-input", "no-input"]);
    expect(validate({ ...s, edges: s.edges.filter((e) => e.source !== o.id) }).some((p) => p.kind === "no-output" && p.nodeId === o.id)).toBe(true);
    expect(ps.find((p) => p.nodeId === o.id)?.msg).toBe("OU com 1 de 2 entradas");
    expect(validate({ ...s, blocks: s.blocks.filter((b) => b.id !== res.id) }).some((p) => p.kind === "no-result")).toBe(true);
  });
  it("tela padrão e presets são válidos", () => {
    for (const s of [defaultScreen(), ...PRESETS.map((p) => p.build(5e6))]) expect(validate(s)).toEqual([]);
  });
});

describe("conexões", () => {
  it("rejeita ciclos, duplicatas, entrada no Universo, saída do Resultado e 2ª entrada em filtro", () => {
    const { s, u, g, a, o, res } = gapVolOrRsi();
    expect(canConnect(s, o.id, g.id)).toBe(false); // ciclo o→g→a→o (g já tem entrada, e criaria ciclo)
    const f1 = makeBlock("liquidity"), f2 = makeBlock("minPrice");
    let t: Screen = { ...s, blocks: [...s.blocks, f1, f2] };
    t = connect(t, f1.id, f2.id);
    expect(canConnect(t, f2.id, f1.id)).toBe(false); // ciclo
    expect(canConnect(t, f1.id, f2.id)).toBe(false); // duplicata / já tem entrada
    expect(canConnect(t, g.id, u.id)).toBe(false);
    expect(canConnect(t, res.id, f1.id)).toBe(false);
    expect(canConnect(t, g.id, g.id)).toBe(false);
    expect(canConnect(t, f2.id, a.id)).toBe(true); // lógica aceita N entradas
    expect(topo(t).cyclic).toEqual([]);
  });
  it("topo detecta ciclo forçado", () => {
    const a = makeBlock("and"), b = makeBlock("or");
    expect(topo({ name: "c", blocks: [a, b], edges: [E(a.id, b.id), E(b.id, a.id)] }).cyclic.length).toBe(2);
  });
});

describe("migração v1 → v2", () => {
  const v1 = (combine: "and" | "or", on: boolean[]) => {
    const blocks = [makeBlock("universe"), makeBlock("liquidity"), makeBlock("gap", on[0], { dir: "up" }), makeBlock("volume", on[1]), makeBlock("rsi", on[2], { low: 30 })];
    return { name: "v1", combine, blocks, edges: [] } as Screen;
  };
  const oldEval = (s: Screen) => { // semântica da v1
    const f = rows.filter((r) => (r.liq21 ?? 0) >= 5e6), on = s.blocks.filter((b) => b.enabled && ["gap", "volume", "rsi"].includes(b.type));
    const hit = (b: any, r: Row) => (b.type === "gap" ? (r.gap ?? 0) * 100 >= 2 : b.type === "volume" ? (r.volRatio ?? 0) >= 2 : (r.rsi ?? 99) < 30);
    return (!on.length ? f : f.filter((r) => (s.combine === "and" ? on.every((b) => hit(b, r)) : on.some((b) => hit(b, r))))).map((r) => r.t).sort();
  };
  it("dá o mesmo resultado que a tela antiga", () => {
    for (const c of ["and", "or"] as const) for (const on of [[true, true, false], [true, true, true], [false, false, false], [false, true, false]]) {
      const s = v1(c, on), m = migrateScreen(s);
      expect(m.combine).toBeUndefined();
      expect(validate(m)).toEqual([]);
      expect(evaluateGraph(m, rows).results.map((r) => r.t).sort()).toEqual(oldEval(s));
    }
  });
  it("link v1 abre como grafo", async () => {
    const tok = "1j." + btoa(JSON.stringify({ v: 1, n: "Gap", c: "a", b: [["universe", 1, {}], ["gap", 1, { dir: "up" }], ["volume", 1, {}]] })).replace(/=+$/, "");
    const s = (await decodeScreen(tok))!;
    expect(s.blocks.map((b) => b.type)).toEqual(["universe", "gap", "volume", "and", "result"]);
    expect(validate(s)).toEqual([]);
    expect(evaluateGraph(s, rows).results.map((r) => r.t)).toEqual(["BOTH3"]);
  });
  it("export/import JSON preserva o grafo e revalida arestas", () => {
    const { s } = gapVolOrRsi();
    const back = importJson(exportJson(s))!;
    expect(back.edges.length).toBe(s.edges.length);
    expect(evaluateGraph(back, rows).results.length).toBe(2);
    const bad = JSON.parse(exportJson(s)); bad.screen.edges.push({ id: "z", source: bad.screen.blocks[6].id, target: bad.screen.blocks[0].id });
    expect(importJson(JSON.stringify(bad))!.edges.length).toBe(s.edges.length);
    expect(importJson("nope")).toBeNull();
  });
});
