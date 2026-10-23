import { describe, expect, it } from "vitest";
import { closeMinutesBrt, finalAfterMinutesBrt, hhmmBrt, isClosingRun, nyIsDst, sessionInfo } from "../session";

describe("session", () => {
  it("grade de verão/inverno de NY (B3 17:00 → 18:00 BRT a partir de 03/11/2026)", () => {
    expect(nyIsDst("2026-10-22T12:00:00-03:00")).toBe(true);
    expect(nyIsDst("2026-11-03T12:00:00-03:00")).toBe(false);
    expect(closeMinutesBrt("br", "2026-10-22T12:00:00-03:00")).toBe(17 * 60);
    expect(closeMinutesBrt("br", "2026-11-03T12:00:00-03:00")).toBe(18 * 60);
    expect(finalAfterMinutesBrt("br", "2026-11-03T12:00:00-03:00")).toBe(18 * 60 + 30);
    expect(finalAfterMinutesBrt("us", "2026-10-22T12:00:00-03:00")).toBe(18 * 60 + 15);
    expect(finalAfterMinutesBrt("us", "2026-11-03T12:00:00-03:00")).toBe(18 * 60 + 30);
  });
  it("intradiário até a rodada de fechamento", () => {
    // outubro (EDT): B3 fecha 17:00 → 17:34 é fechamento
    expect(isClosingRun("br", "2026-10-22T17:04:00-03:00", "2026-10-22")).toBe(false);
    expect(isClosingRun("br", "2026-10-22T17:34:00-03:00", "2026-10-22")).toBe(true);
    // novembro (EST): B3 fecha 18:00 → 17:34 e 18:04 ainda parciais, 18:34 fecha
    expect(isClosingRun("br", "2026-11-03T17:34:00-03:00", "2026-11-03")).toBe(false);
    expect(isClosingRun("br", "2026-11-03T18:04:00-03:00", "2026-11-03")).toBe(false);
    expect(isClosingRun("br", "2026-11-03T18:34:00-03:00", "2026-11-03")).toBe(true);
    expect(isClosingRun("us", "2026-11-03T18:20:00-03:00", "2026-11-03")).toBe(false);
    expect(isClosingRun("us", "2026-11-03T18:34:00-03:00", "2026-11-03")).toBe(true);
    // barra do pregão anterior (ex.: 10:04 antes do primeiro negócio) = fechada
    expect(isClosingRun("br", "2026-10-23T10:04:00-03:00", "2026-10-22")).toBe(true);
    // rodada tardia (23:47 BRT = 02:47Z do dia seguinte) segue no mesmo dia BRT
    expect(isClosingRun("us", "2026-10-23T02:47:00Z", "2026-10-22")).toBe(true);
  });
  it("hora da última cotação em BRT, sem inventar", () => {
    expect(hhmmBrt("2026-10-22T16:31:48-04:00")).toBe("17:31");
    expect(hhmmBrt(null)).toBeNull();
    const s = sessionInfo("br", { generatedAt: "2026-10-22T13:05:00-03:00", dataDate: "2026-10-22", lastQuoteAt: "2026-10-22T12:48:00-03:00" });
    expect(s).toMatchObject({ intraday: true, lastQuoteBrt: "12:48", closeBrt: "17:00" });
    expect(sessionInfo("br", { generatedAt: "2026-10-22T13:05:00-03:00", dataDate: "2026-10-22" }).lastQuoteBrt).toBeNull();
  });
});
