import { describe, expect, it } from "vitest";
import { marketSummary, universeRows } from "../summary";
import type { Latest, Row } from "../engine";

const R = (o: Partial<Row>) => ({ t: "X", kind: "acao", sector: "A", price: 10, chg: 0.01, liq21: 6e6, sma50: 9, sma200: 11, high52: 12, low52: 5,
  sma50Prev: 9, sma200Prev: 11, volRatio: 1, rsi: 50, rsiPrev: 50, ...o }) as Row;
const L = (tickers: Row[], extra: Partial<Latest> = {}): Latest => ({ generatedAt: "2026-10-20T20:31:28-03:00", dataDate: "2026-10-20", delayNote: "", universeCount: tickers.length,
  failedTickers: [], bdrAllowlist: [], defaults: { liq21MinBrl: 5e6 }, tickers,
  benchmark: { name: "Ibovespa", symbol: "^BVSP", price: 208295.98, chg: 0.01569, ret21: 0.12453, ifixProxy: "XFIX11", ifixRet21: 0.0566, ifixChg: 0.00358 } as Latest["benchmark"], ...extra });

describe("summary", () => {
  const rows = [
    R({ t: "AAAA3", chg: 0.05, price: 13, high52: 12 }),                       // máx. 52s
    R({ t: "BBBB3", chg: -0.2, price: 4, low52: 5 }),                          // mín. 52s
    R({ t: "CCCC3", chg: 0.02, sma50: 12, sma200: 11, sma50Prev: 10, sma200Prev: 11 }), // golden
    R({ t: "DDDD3", chg: 0.01, volRatio: 3.2 }),                               // volume
    R({ t: "EEEE3", chg: 0.03, rsi: 75, rsiPrev: 68 }),                        // RSI entrou > 70
    R({ t: "FFFF3", chg: 0.04, rsi: 80, rsiPrev: 79 }),                        // já estava > 70: não conta
    R({ t: "GGGG3", kind: "fii", chg: 0.09, price: 99, high52: 1 }),           // fora do universo (FII)
    R({ t: "HHHH3", liq21: 1e6, chg: 0.09, price: 99, high52: 1 }),            // fora do universo (liquidez)
  ];
  it("universo = ações líquidas", () => {
    expect(universeRows(L(rows)).map((r) => r.t)).toEqual(["AAAA3", "BBBB3", "CCCC3", "DDDD3", "EEEE3", "FFFF3"]);
  });
  it("sinais seguem signalHit/breadth", () => {
    const s = marketSummary(L(rows));
    expect(s.universe.n).toBe(6);
    expect(s.breadth).toMatchObject({ adv: 5, dec: 1, highs: 1, lows: 1 });
    expect(s.signals.high52.items.map((x) => x.t)).toEqual(["AAAA3"]);
    expect(s.signals.low52.items.map((x) => x.t)).toEqual(["BBBB3"]);
    expect(s.signals.golden.items.map((x) => x.t)).toEqual(["CCCC3"]);
    expect(s.signals.volume.items).toEqual([{ t: "DDDD3", chg: 0.01, vr: 3.2 }]);
    expect(s.signals.rsi_up.items.map((x) => x.t)).toEqual(["EEEE3"]);
    expect(s.top[0]).toEqual({ t: "AAAA3", chg: 0.05 });
    expect(s.bottom[0]).toEqual({ t: "BBBB3", chg: -0.2 });
    expect(s.final).toBe(true);
    expect(s.bench).toMatchObject({ price: 208295.98, chg: 0.01569, ifix_proxy: "XFIX11" });
    expect(s.us).toBeNull();
  });
  it("rodada intradiária não é final; determinístico e pequeno", () => {
    const a = marketSummary(L(rows, { generatedAt: "2026-10-20T13:00:00-03:00" }));
    expect(a.final).toBe(false);
    expect(JSON.stringify(marketSummary(L(rows, { generatedAt: "2026-10-20T13:00:00-03:00" })))).toBe(JSON.stringify(a));
    const many = Array.from({ length: 600 }, (_, i) => R({ t: `T${String(i).padStart(3, "0")}3`, chg: 0.01, price: 13, high52: 12, volRatio: 5, rsi: 75, rsiPrev: 60 }));
    const big = marketSummary(L(many));
    expect(big.signals.high52.n).toBe(600);
    expect(big.signals.high52.items.length).toBe(12);
    expect(JSON.stringify(big).length).toBeLessThan(20_000);
  });
});
