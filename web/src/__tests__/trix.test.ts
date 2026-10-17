import { describe, expect, it } from "vitest";
import { DEFS, SIGNAL_TYPES, blockSummary, evaluate, hitLabel, makeBlock, signalHit, type Row } from "../engine";
import { HIST_PARAMS, fwdStats, historicalSignals, type Candles } from "../signals";
import { PRESETS } from "../presets";
import { histKeys } from "../History";

const R = (o: Partial<Row>) => ({ t: "PETR4", name: "Petrobras", kind: "acao", sector: "Petróleo", price: 10, chg: 0, liq21: 1e7, ...o }) as Row;
function mk(c: number[], side: number[]): Candles {
  const n = c.length, nul = Array(n).fill(null);
  return { t: c.map((_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`), o: [...c], h: [...c], l: [...c], c, v: Array(n).fill(1),
    sma50: nul, sma200: nul, high52: nul, trixSide: side, trix: nul, trixSig: nul, trixBand: nul };
}

describe("TRIX — bloco", () => {
  it("é sinal sem parâmetros configuráveis", () => {
    expect(SIGNAL_TYPES).toContain("trix");
    expect(DEFS.trix.defaults).toEqual({});
    expect(blockSummary(makeBlock("trix"))).toMatch(/TRIX\(9\).*EMA 9.*banda 60d/);
  });
  it("dispara nos dois lados e rotula o lado", () => {
    const b = makeBlock("trix");
    expect(signalHit(b, R({ trixSide: 1 }))).toBe(true);
    expect(signalHit(b, R({ trixSide: -1 }))).toBe(true);
    expect(signalHit(b, R({ trixSide: 0 }))).toBe(false);
    expect(signalHit(b, R({}))).toBe(false); // dados antigos sem o campo
    expect(hitLabel(b, R({ trixSide: 1 }))).toBe("TRIX ▲");
    expect(hitLabel(b, R({ trixSide: -1 }))).toBe("TRIX ▼");
  });
  it("marcadores históricos com lado; estatística por ativo só compra", () => {
    const d = mk([10, 11, 12, 11, 10, 11, 12], [0, 1, 0, -1, -1, -1, 0]); // sequência de venda marca só o 1º dia
    const ev = historicalSignals(d).filter((e) => e.type === "trix");
    expect(ev.map((e) => [e.i, e.up])).toEqual([[1, true], [3, false]]);
    expect(ev[0].text).toMatch(/compra/);
    const hist = historicalSignals(d, HIST_PARAMS).filter((e) => e.type === "trix");
    expect(hist.map((e) => e.i)).toEqual([1]);
    expect(fwdStats(d, hist).trix.events).toBe(1);
  });
});

describe("TRIX — preset da Galeria", () => {
  it("Universo → TRIX → Saída e roda", () => {
    const p = PRESETS.find((x) => x.id === "trix")!;
    const s = p.build(5e6);
    expect(s.blocks.map((b) => b.type).sort()).toEqual(["result", "trix", "universe"]);
    const rows = [R({ t: "A3", trixSide: 1 }), R({ t: "B3", trixSide: -1 }), R({ t: "C3", trixSide: 0 }), R({ t: "D11", kind: "fii", trixSide: 1 })];
    const ev = evaluate(s, rows);
    expect(ev.complete).toBe(true);
    expect(ev.results.map((r) => r.t).sort()).toEqual(["A3", "B3"]);
  });
});

describe("Histórico — Agulhada e TRIX separados por lado", () => {
  it("histKeys expande sinais com lado", () => {
    const k = histKeys(SIGNAL_TYPES);
    expect(k).toContain("agulhada_buy"); expect(k).toContain("agulhada_sell");
    expect(k).toContain("trix_buy"); expect(k).toContain("trix_sell");
    expect(k).not.toContain("trix"); expect(k).toContain("high52");
  });
  it("descarta retornos absurdos (erro de dados)", () => {
    const d = mk([1, 1, 1, 1, 1, 1, 5000, 5000, 5000, 5000, 5000, 5000], Array(12).fill(0));
    const st = fwdStats(d, [{ i: 1, t: d.t[1], type: "trix", text: "", up: true }]);
    expect(st.trix[5].n).toBe(0);
  });
});
