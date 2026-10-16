import { describe, expect, it } from "vitest";
import { decodeScreen, encodeScreen, tokenFromHash } from "../share";
import { defaultScreen, evaluate, Row } from "../engine";
import { PRESETS } from "../presets";
import { toCsv } from "../csv";

const strip = (s: any) => {
  const ix = new Map(s.blocks.map((b: any, i: number) => [b.id, i]));
  return { name: s.name, blocks: s.blocks.map((b: any) => ({ type: b.type, enabled: b.enabled, params: b.params, pos: b.pos })), edges: s.edges.map((e: any) => [ix.get(e.source), ix.get(e.target)]) };
};

describe("share", () => {
  it("round-trips every preset and default", async () => {
    for (const s of [defaultScreen(), ...PRESETS.map((p) => p.build(5e6))]) {
      s.blocks[1].pos = { x: 10, y: 20 };
      const tok = await encodeScreen(s);
      expect(tok).toMatch(/^2z\.[A-Za-z0-9_-]+$/);
      expect(strip(await decodeScreen(tok))).toEqual(strip(s));
    }
  });
  it("is compact", async () => { expect((await encodeScreen(defaultScreen())).length).toBeLessThan(400); });
  it("degrades gracefully", async () => {
    for (const t of ["", "garbage", "9z.abc", "1z.!!!", "1j.e30", "1z.AAAA"]) expect(await decodeScreen(t)).toBeNull();
    const tok = "1j." + btoa(JSON.stringify({ v: 1, n: "x", c: "o", b: [["nope", 1, {}], ["rsi", 1, { low: 25 }]] })).replace(/=+$/, "");
    const s = (await decodeScreen(tok))!;
    expect(s.blocks.map((b) => b.type)).toEqual(["universe", "rsi", "result"]); expect(s.blocks[1].params.low).toBe(25);
    expect(s.edges.length).toBe(2);
  });
  it("reads hash", () => { expect(tokenFromHash("#t=1z.abc")).toBe("1z.abc"); expect(tokenFromHash("")).toBeNull(); });
});

describe("csv", () => {
  const r = { t: "PETR4", name: 'Petro "BR"; SA', kind: "acao", sector: null, price: 58.11, chg: 0.022, liq21: 2.4e9, sma200: 41, rsi: 78.9, rs21: 9.2 } as unknown as Row;
  it("BOM, pt-BR decimals, escaping", () => {
    const c = toCsv([r], () => "Máx. 52s");
    expect(c.startsWith("\uFEFFTicker;Nome;")).toBe(true);
    const line = c.split("\r\n")[1];
    expect(line).toContain('"Petro ""BR""; SA"'); expect(line).toContain(";58,11;"); expect(line).toContain(";2,2;");
    expect(toCsv([r], () => "", false).split("\r\n")[1]).toContain(",58.11,");
  });
});

describe("presets", () => {
  it("evaluate without throwing", () => { for (const p of PRESETS) expect(() => evaluate(p.build(5e6), [])).not.toThrow(); });
});
