// Estado do pregão de uma rodada: intradiária (barra do dia parcial) ou de fechamento.
// Fechamentos em BRT (America/Sao_Paulo, UTC-3, sem horário de verão):
//   B3:   17:00 enquanto Nova York está em horário de verão (EDT, mar–nov); 18:00 no horário padrão (EST),
//         grade da B3 (Ofício Circular 050/2026-VNC: 10:00–17:55 + call até 18:00 a partir de 03/11/2026).
//   NYSE: 16:00 ET = 17:00 BRT em EDT, 18:00 BRT em EST.
import type { Latest, Market } from "./engine";

const BRT_MS = 3 * 3600_000;
const brtParts = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - BRT_MS);
  return { day: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes(), hhmm: d.toISOString().slice(11, 16) };
};

/** Nova York está em horário de verão (EDT) neste instante? */
export function nyIsDst(iso: string): boolean {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" })
    .formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "";
  return name === "EDT";
}

/** Fechamento do pregão regular, em minutos desde 00:00 BRT. */
export function closeMinutesBrt(_market: Market, iso: string): number {
  return (nyIsDst(iso) ? 17 : 18) * 60; // B3 e NYSE fecham juntos em BRT nas duas grades
}

/** A partir de quando (min BRT) a rodada conta como fechamento: B3 fecha + 30 min; EUA: fecha + 30 min, nunca antes de 18:15. */
export function finalAfterMinutesBrt(market: Market, iso: string): number {
  const close = closeMinutesBrt(market, iso) + 30;
  return market === "us" ? Math.max(18 * 60 + 15, close) : close;
}

/** Fechamento já saiu? Dado de pregão anterior conta como fechado. */
export function isClosingRun(market: Market, generatedAt: string, dataDate: string | null): boolean {
  if (!dataDate) return false;
  const { day, mins } = brtParts(generatedAt);
  if (dataDate < day) return true;
  return mins >= finalAfterMinutesBrt(market, generatedAt);
}

/** "HH:MM" em BRT de um ISO (qualquer fuso), ou null. */
export function hhmmBrt(iso: string | null | undefined): string | null {
  if (!iso || Number.isNaN(new Date(iso).getTime())) return null;
  return brtParts(iso).hhmm;
}

export interface SessionInfo {
  intraday: boolean;
  /** data da barra (YYYY-MM-DD) */
  dataDate: string | null;
  /** última cotação do índice de referência (ISO com fuso), ou null se o Yahoo não informou */
  lastQuoteAt: string | null;
  lastQuoteBrt: string | null;
  /** fechamento regular em "HH:MM" BRT, para o texto da página */
  closeBrt: string;
}

export function sessionInfo(market: Market, latest: Pick<Latest, "generatedAt" | "dataDate"> & { lastQuoteAt?: string | null }): SessionInfo {
  const lastQuoteAt = latest.lastQuoteAt ?? null;
  const c = closeMinutesBrt(market, latest.generatedAt);
  return {
    intraday: !isClosingRun(market, latest.generatedAt, latest.dataDate),
    dataDate: latest.dataDate,
    lastQuoteAt,
    lastQuoteBrt: hhmmBrt(lastQuoteAt),
    closeBrt: `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}`,
  };
}
