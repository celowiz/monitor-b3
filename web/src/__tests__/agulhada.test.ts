import { describe, expect, it } from "vitest";
import { agulhadaHit, agulhadaSeries, normParams } from "../agulhada";
import { historicalSignals, type Candles } from "../signals";
import { makeBlock, signalHit, type Row } from "../engine";
import fx from "./agulhada.fixture.json";

// plano por 25 pregões (médias coladas), depois alta forte (abertura em leque) e queda
const flatUp = [...Array(25).fill(10), 10.3, 10.7, 11.2, 11.8, 12.5];
const flatDown = [...Array(25).fill(10), 9.7, 9.3, 8.8, 8.2, 7.5];

describe("agulhada — fórmula", () => {
  it("paridade com indicators.py (pandas) numa série aleatória", () => {
    const s = agulhadaSeries(fx.c, {});
    expect(s.side).toEqual(fx.side);
    expect(fx.side.some((x: number) => x === 1) && fx.side.some((x: number) => x === -1)).toBe(true);
  });
  it("convergência em série plana; lado pela curta vs longa", () => {
    const s = agulhadaSeries([...Array(19).fill(10), 10, 10.01], {});
    expect(s.conv[19]).toBe(true); expect(s.side[20]).toBe(1);
    expect(s.conv.slice(0, 19).some(Boolean)).toBe(false); // sem SMA longa ainda
  });
  it("normParams limita períodos e alpha", () => {
    const p = normParams({ curta: 0, longa: 999, alpha: -1, window: 50, dir: "x" as any });
    expect([p.curta, p.longa, p.alpha, p.window, p.dir]).toEqual([2, 40, 0.1, 10, "both"]);
  });
});

describe("agulhada — eventos e triagem", () => {
  it("fresh = 1º dia da convergência; sem fresh, todo dia convergido", () => {
    const c = Array(30).fill(10);
    expect(agulhadaSeries(c, { fresh: true }).events.map((e) => e.i)).toEqual([19]);
    expect(agulhadaSeries(c, {}).events.length).toBe(11);
    expect(agulhadaHit(c, {})).not.toBeNull();            // ainda convergido hoje (original)
    expect(agulhadaHit(c, { fresh: true })).toBeNull();     // 1º dia foi há 10 pregões
    expect(agulhadaHit(c, { fresh: true, window: 10 })).toBeNull(); // janela cobre os pregões 20..29
    expect(agulhadaHit(c.slice(0, 29), { fresh: true, window: 10 })?.i).toBe(19); // janela 19..28
  });
  it("confirmação de abertura data o evento no dia em que as médias se abrem", () => {
    const s = agulhadaSeries(flatUp, { confirm: true, confirmN: 5 });
    expect(s.events).toHaveLength(1);
    const e = s.events[0];
    expect(e.up).toBe(true); expect(e.i).toBeGreaterThan(e.start);
    expect(s.conv[e.i]).toBe(false);
    expect(agulhadaSeries(flatDown, { confirm: true, confirmN: 5 }).events[0]?.up).toBe(false);
    expect(agulhadaSeries(flatUp, { confirm: true, confirmN: 1 }).events.length).toBeLessThanOrEqual(1);
  });
  it("direção filtra compra/venda", () => {
    const c = [...Array(19).fill(10), 10, 10.01];
    expect(agulhadaHit(c, { dir: "buy" })).not.toBeNull();
    expect(agulhadaHit(c, { dir: "sell" })).toBeNull();
  });
  it("signalHit usa os fechamentos do latest (cl)", () => {
    const b = makeBlock("agulhada");
    expect(signalHit(b, { cl: Array(30).fill(10) } as Row)).toBe(true);
    expect(signalHit(b, { cl: undefined } as Row)).toBe(false);
  });
  it("gráfico: marcadores só no 1º dia de cada convergência", () => {
    const c = flatUp, n = c.length, nul = Array(n).fill(null);
    const d: Candles = { t: c.map((_, i) => `2026-02-${String(i + 1).padStart(2, "0")}`), o: c, h: c, l: c, c, v: Array(n).fill(1), sma50: nul, sma200: nul, high52: nul };
    const ev = historicalSignals(d, { agulhada: {} }).filter((e) => e.type === "agulhada");
    expect(ev.map((e) => e.i)).toEqual([19]);
    expect(ev[0].up).toBe(true);
  });
});
