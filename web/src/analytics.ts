// GA4 (mesma propriedade do portfólio celowiz.github.io; aparece como page_path /monitor-b3/).
// Padrão: stub do gtag e config enfileirados já no carregamento; o script gtag.js
// só é injetado após o load + idle, para não pesar na primeira renderização.
// ?ga_debug=1 liga debug_mode (DebugView no GA4).
export const GA_MEASUREMENT_ID = "G-QCBFGR39WG";
const SCRIPT_ID = "ga-gtag";

type W = Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };
const w = (): W | undefined => (typeof window !== "undefined" ? (window as W) : undefined);

const isDebug = () => {
  try { return new URLSearchParams(w()?.location.search ?? "").has("ga_debug"); } catch { return false; }
};

function ensureStub(win: W) {
  if (!Array.isArray(win.dataLayer)) win.dataLayer = [];
  if (typeof win.gtag !== "function") {
    // eslint-disable-next-line prefer-rest-params
    win.gtag = function gtag() { win.dataLayer!.push(arguments); };
  }
}

function injectScript(win: W) {
  const d = win.document;
  if (d.getElementById(SCRIPT_ID)) return;
  const s = d.createElement("script");
  s.id = SCRIPT_ID; s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  d.head.appendChild(s);
}

let started = false;
export function initAnalytics() {
  const win = w();
  if (!win || started) return;
  started = true;
  ensureStub(win);
  win.gtag!("js", new Date());
  win.gtag!("config", GA_MEASUREMENT_ID, isDebug() ? { debug_mode: true } : {});
  const start = () => injectScript(win);
  const afterLoad = () => {
    const ric = (win as any).requestIdleCallback;
    if (typeof ric === "function") ric(start, { timeout: 3000 }); else win.setTimeout(start, 1);
  };
  if (win.document.readyState === "complete") afterLoad();
  else win.addEventListener("load", afterLoad, { once: true });
}

export function track(name: string, params: Record<string, string | number | boolean | undefined> = {}) {
  const win = w();
  if (!win) return;
  ensureStub(win);
  const payload: Record<string, unknown> = { send_to: GA_MEASUREMENT_ID };
  for (const [k, v] of Object.entries(params)) if (v !== undefined) payload[k] = v;
  if (isDebug()) payload.debug_mode = true;
  win.gtag!("event", name, payload);
}
