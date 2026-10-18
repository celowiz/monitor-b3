// Watchlist ("Minha lista"): estrelas por mercado, só no navegador (localStorage). Nada vai para servidor.
import type { Market } from "./engine";

const KEY = "monitorb3.watch.v1";
type Store = Partial<Record<Market, string[]>>;

function read(): Store { try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Store; } catch { return {}; } }
export function loadWatch(m: Market): string[] { const v = read()[m]; return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; }
export function saveWatch(m: Market, list: string[]) {
  try { const s = read(); s[m] = [...new Set(list)].sort(); localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* modo privado */ }
}
export function toggleWatch(list: string[], t: string): { list: string[]; added: boolean } {
  const has = list.includes(t);
  return { list: has ? list.filter((x) => x !== t) : [...list, t].sort(), added: !has };
}
