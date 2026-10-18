// Alertas sem servidor: o Actions avalia cada grafo de alerts/*.json no fechamento e publica JSON + RSS no Pages.
// Nada é enviado (sem email, sem issues): quem quiser assina o RSS em qualquer leitor gratuito.
import { Market, Row, Screen, evaluate } from "./engine";
import { whyLines } from "./explain";

export interface AlertDef { id: string; name: string; market: Market; active: boolean; desc?: string; screen: Screen }
export interface AlertEntry { date: string; t: string; name: string; why: string[]; price: number | null }
export interface AlertState {
  id: string; name: string; market: Market; desc?: string; screen: Screen;
  /** último pregão FECHADO avaliado */
  date: string | null; checkedAt: string;
  /** ativos no Resultado no último fechamento */
  current: string[];
  /** entradas novas (ativo que não estava no Resultado no fechamento anterior), mais recentes primeiro */
  entries: AlertEntry[];
  warning?: string;
  backtest?: string;
}
export const MAX_ENTRIES = 200;
export const ALERT_ID = /^[a-z0-9][a-z0-9-]{1,40}$/;

/** Problemas que impedem um alerta de rodar no Actions (sem navegador, sem estrelas). */
export function alertProblems(d: AlertDef): string[] {
  const out: string[] = [];
  if (!ALERT_ID.test(d.id)) out.push("id inválido (use letras minúsculas, números e hífen)");
  if (d.market !== "br" && d.market !== "us") out.push("market deve ser br ou us");
  if (!d.screen?.blocks?.length) out.push("grafo vazio");
  if (d.screen?.blocks?.some((b) => b.type === "watchlist" && b.enabled && b.params?.mode !== "fixed"))
    out.push("bloco Minha lista no modo estrelas: no servidor não há estrelas; fixe a lista antes de propor");
  return out;
}

/** Fechamento já saiu? BR: após 17:30 BRT; EUA: após 18:15 BRT (17:00 ET + atraso), ou dado de pregão anterior. */
export function isClosingRun(market: Market, generatedAt: string, dataDate: string | null): boolean {
  if (!dataDate) return false;
  const brt = new Date(new Date(generatedAt).getTime() - 3 * 3600_000);
  const today = brt.toISOString().slice(0, 10), mins = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  if (dataDate < today) return true;
  return mins >= (market === "us" ? 18 * 60 + 15 : 17 * 60 + 30);
}

export function step(d: AlertDef, rows: Row[], date: string, prev: AlertState | null, checkedAt: string): AlertState {
  const ev = evaluate(d.screen, rows);
  const have = new Set(rows.map((r) => r.t));
  const today = ev.complete ? ev.results : [];
  const base: AlertState = { id: d.id, name: d.name, market: d.market, desc: d.desc, screen: d.screen, date, checkedAt, current: [], entries: prev?.entries ?? [] };
  if (!ev.complete) base.warning = "grafo incompleto: " + ev.problems.join("; ");
  if (prev?.date === date) return { ...base, current: prev.current, entries: prev.entries }; // mesmo pregão: idempotente
  const before = new Set(prev?.current ?? []);
  const fresh: AlertEntry[] = today.filter((r) => !before.has(r.t)).map((r) => ({ date, t: r.t, name: r.name, why: whyLines(d.screen, r), price: r.price ?? null }));
  // ativo do fechamento anterior que hoje ficou sem dado (falha de download) continua "dentro": evita entrada falsa amanhã
  const carried = [...before].filter((t) => !have.has(t));
  return { ...base, current: [...new Set([...today.map((r) => r.t), ...carried])].sort(), entries: [...fresh, ...base.entries].slice(0, MAX_ENTRIES) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rfc822 = (d: string) => new Date(d + "T21:00:00Z").toUTCString();

export function rss(title: string, link: string, selfUrl: string, states: AlertState[], tickerUrl: (s: AlertState, t: string) => string): string {
  const items: string[] = [];
  for (const s of states) {
    const byDate = new Map<string, AlertEntry[]>();
    for (const e of s.entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    for (const [date, es] of byDate) {
      const html = `<p>${es.length} ativo(s) entraram no resultado do grafo <b>${esc(s.name)}</b> no fechamento de ${date.split("-").reverse().join("/")}.</p><ul>` +
        es.map((e) => `<li><a href="${esc(tickerUrl(s, e.t))}">${esc(e.t)}</a> · ${esc(e.name)}${e.why.length ? `<br/><small>${e.why.map(esc).join(" · ")}</small>` : ""}</li>`).join("") +
        `</ul><p><small>Material educativo, não é recomendação de investimento. Dados com atraso, preços ajustados por proventos.</small></p>`;
      items.push(`<item><title>${esc(`${s.name}: ${es.map((e) => e.t).join(", ")}`)}</title><link>${esc(link + "#alertas")}</link>` +
        `<guid isPermaLink="false">monitor-b3-${s.id}-${date}</guid><pubDate>${rfc822(date)}</pubDate><description>${esc(html)}</description></item>`);
    }
  }
  items.sort((a, b) => new Date(b.match(/<pubDate>(.*?)</)![1]).getTime() - new Date(a.match(/<pubDate>(.*?)</)![1]).getTime());
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(title)}</title><link>${esc(link)}</link>` +
    `<atom:link href="${esc(selfUrl)}" rel="self" type="application/rss+xml"/><description>Entradas novas nos grafos de alerta do Monitor B3 (educativo, sem recomendação).</description><language>pt-br</language>` +
    items.slice(0, 100).join("") + `</channel></rss>\n`;
}
