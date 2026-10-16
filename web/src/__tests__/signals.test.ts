import { describe, expect, it } from "vitest";
import { breadth, historicalSignals, sectorTiles, squarify, type Candles } from "../signals";
import type { Row } from "../engine";

function mk(c: number[], extra: Partial<Candles> = {}): Candles {
  const n = c.length, nul = Array(n).fill(null);
  return { t: c.map((_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`), o: [...c], h: [...c], l: [...c], c, v: Array(n).fill(1),
    sma50: nul, sma200: nul, high52: nul, low52: nul, rsi: nul, volr: nul, rs21: nul, ...extra };
}
describe("historicalSignals", () => {
  it("streak fires once at N, range breakout, gap", () => {
    const c = [10, 10, 10, 10, 10, 11, 12, 13, 14];
    const o = c.map((x, i) => (i ? c[i - 1] : x)); o[5] = 10.5;
    const ev = historicalSignals(mk(c, { o }), { range: { n: 3 } });
    expect(ev.filter((e) => e.type === "streak").map((e) => e.i)).toEqual([7]);
    expect(ev.filter((e) => e.type === "range").map((e) => e.i)).toEqual([5, 6, 7, 8]);
    expect(ev.filter((e) => e.type === "gap").map((e) => e.i)).toEqual([5]);
  });
  it("cross, rsi entry, volume, 52w", () => {
    const d = mk([1, 1, 1, 1], { sma50: [1, 1, 2, 2], sma200: [1.5, 1.5, 1.5, 1.5], rsi: [40, 25, 20, 35], volr: [1, 3, 1, 1], high52: [null, null, null, 0.5] });
    const ev = historicalSignals(d);
    expect(ev.find((e) => e.type === "smaCross")?.i).toBe(2);
    expect(ev.filter((e) => e.type === "rsi").map((e) => e.i)).toEqual([1]);
    expect(ev.filter((e) => e.type === "volume").map((e) => e.i)).toEqual([1]);
    expect(ev.filter((e) => e.type === "high52").map((e) => e.i)).toEqual([3]);
  });
});
describe("market", () => {
  const R = (o: Partial<Row>) => ({ t: "X", kind: "acao", sector: "A", price: 10, chg: 0.01, liq21: 1, sma50: 9, sma200: 11, high52: 9.5, low52: 5, ...o }) as Row;
  it("breadth", () => {
    const b = breadth([R({}), R({ chg: -0.02, price: 4 }), R({ chg: 0 })]);
    expect(b).toMatchObject({ n: 3, above50: 2, above200: 0, highs: 2, lows: 1, adv: 1, dec: 1, unch: 1 });
  });
  it("sector tiles weighted, squarify covers area", () => {
    const t = sectorTiles([R({ liq21: 3, chg: 0.02 }), R({ liq21: 1, chg: -0.02 }), R({ sector: "B", liq21: 4 }), R({ kind: "fii", sector: "C" })], ["acao"]);
    expect(t.map((x) => x.sector)).toEqual(["A", "B"]); expect(t[0].chg).toBeCloseTo(0.01);
    const sq = squarify(t, 100, 50); expect(sq.reduce((a, r) => a + r.w * r.h, 0)).toBeCloseTo(5000);
  });
});
