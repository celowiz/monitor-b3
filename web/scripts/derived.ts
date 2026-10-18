// Dados derivados gerados no Actions depois de scripts/build_data.py (rodar dentro de web/):
//   npx vite-node scripts/derived.ts -- --data public/data --panel ../.cache --alerts ../alerts
// 1) backtest walk-forward das telas da galeria e dos alertas (data/backtest/<mercado>/<id>.json + index.json)
// 2) alertas: entradas novas no fechamento, data/alerts/<id>.json, RSS <id>.xml e alerts.xml
// Usa o MESMO engine do navegador (src/), então backtest, alerta e tela nunca divergem.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { AlertDef, AlertState, alertProblems, isClosingRun, rss, step } from "../src/alerts";
import { BacktestResult, Panel, rowsAt, runBacktest } from "../src/backtest";
import { Latest, Market, Screen, setMarketContext } from "../src/engine";
import { importJson } from "../src/graphs";
import { PRESETS } from "../src/presets";

const arg = (k: string, d: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = resolve(arg("data", "public/data")), PANEL = resolve(arg("panel", "../.cache")), ALERTS = resolve(arg("alerts", "../alerts"));
const SITE = arg("site", "https://celowiz.github.io/monitor-b3/");
const LIVE = arg("live", SITE + "data/");
const now = new Date().toISOString();
const readJson = <T,>(p: string): T | null => { try { return JSON.parse(readFileSync(p, "utf8")) as T; } catch { return null; } };
const write = (p: string, s: string) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function live<T>(path: string): Promise<T | null> {
  try { const r = await fetch(LIVE + path, { signal: AbortSignal.timeout(15000), cache: "no-store" }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

function loadAlertDefs(): AlertDef[] {
  if (!existsSync(ALERTS)) return [];
  const out: AlertDef[] = [];
  for (const f of readdirSync(ALERTS).filter((x) => x.endsWith(".json")).sort()) {
    const raw = readJson<any>(join(ALERTS, f)); const s = raw && importJson(JSON.stringify(raw));
    if (!raw || !s) { log("alerta inválido, ignorado:", f); continue; }
    out.push({ id: String(raw.id ?? f.replace(/\.json$/, "")), name: String(raw.name ?? s.name).slice(0, 80), market: raw.market === "us" ? "us" : "br", active: raw.active !== false, desc: raw.desc, screen: s });
  }
  return out;
}

const summary = (b: BacktestResult, kind: string) => ({
  id: b.id, name: b.name, kind, from: b.from, to: b.to, days: b.days, indexLabel: b.indexLabel,
  h: Object.fromEntries(Object.entries(b.h).map(([k, v]) => [k, { n: v.graph.n, mean: v.graph.mean, hit: v.graph.hit, exMean: v.graph.exMean, base: v.base.mean, index: v.index.mean }])),
  curve: { graph: (b.curve.graph[b.curve.graph.length - 1] ?? 100), base: (b.curve.base[b.curve.base.length - 1] ?? 100), index: (b.curve.index[b.curve.index.length - 1] ?? 100), emptyPeriods: b.curve.emptyPeriods, periods: b.curve.periods },
});

async function main() {
  const defs = loadAlertDefs();
  const states: AlertState[] = [];
  for (const m of ["br", "us"] as Market[]) {
    const latest = readJson<Latest>(join(DATA, `latest_${m}.json`));
    if (!latest) { log(`[${m}] sem latest_${m}.json, pulando`); continue; }
    setMarketContext(m);
    const panel = readJson<Panel>(join(PANEL, `panel_${m}.json`));
    const liq = latest.defaults?.liq21MinBrl ?? 5_000_000;
    // ---------- backtest ----------
    const index: any[] = [];
    if (panel) {
      const jobs: [string, string, Screen][] = PRESETS.filter((p) => !(m === "us" && p.id === "fii") && p.id !== "watch").map((p) => [p.id, "preset", p.build(liq)]);
      for (const d of defs.filter((x) => x.market === m && !alertProblems(x).length)) jobs.push(["alert-" + d.id, "alert", { ...d.screen, name: d.name }]);
      for (const [id, kind, s] of jobs) {
        const t0 = Date.now(); const b = { ...runBacktest(id, s, panel), generatedAt: now };
        write(join(DATA, "backtest", m, `${id}.json`), JSON.stringify(b));
        index.push(summary(b, kind));
        const h21 = b.h["21"];
        log(`[${m}] backtest ${id}: ${b.days.withResults}/${b.evalDays} dias c/ resultado · 21d grafo ${((h21.graph.mean ?? 0) * 100).toFixed(2)}% (n=${h21.graph.n}) base ${((h21.base.mean ?? 0) * 100).toFixed(2)}% · ${Date.now() - t0} ms`);
      }
      write(join(DATA, "backtest", m, "index.json"), JSON.stringify({ market: m, generatedAt: now, evalDays: panel.evalDays, horizons: panel.horizons, mainLabel: panel.mainLabel, items: index }));
    } else log(`[${m}] sem painel (${PANEL}/panel_${m}.json): backtest e semente dos alertas pulados`);
    // ---------- alertas ----------
    const closing = isClosingRun(m, latest.generatedAt, latest.dataDate);
    for (const d of defs.filter((x) => x.market === m)) {
      const probs = alertProblems(d);
      let prev = readJson<AlertState>(join(DATA, "alerts", `${d.id}.json`)) ?? (await live<AlertState>(`alerts/${d.id}.json`));
      if (prev && prev.id !== d.id) prev = null;
      if (!d.active || probs.length) {
        states.push({ ...(prev ?? { entries: [], current: [], date: null }), id: d.id, name: d.name, market: m, desc: d.desc, screen: d.screen, checkedAt: now, warning: d.active ? probs.join("; ") : "alerta pausado (active: false)" } as AlertState);
        continue;
      }
      if (!prev && panel && latest.dataDate) {
        // primeira rodada: estado do pregão anterior a partir do painel (dados reais), para não marcar tudo como "novo"
        let i = panel.dates.length - 1; while (i > 0 && panel.dates[i] >= latest.dataDate) i--;
        prev = step(d, rowsAt(panel, i), panel.dates[i], null, now); prev.entries = [];
        log(`[${m}] alerta ${d.id}: semeado com ${panel.dates[i]} (${prev.current.length} no resultado)`);
      }
      let st: AlertState;
      if (closing && latest.dataDate) st = step(d, latest.tickers, latest.dataDate, prev, now);
      else st = { ...(prev ?? { entries: [], current: [], date: null }), id: d.id, name: d.name, market: m, desc: d.desc, screen: d.screen, checkedAt: now } as AlertState;
      if (panel) st.backtest = `backtest/${m}/alert-${d.id}.json`;
      states.push(st);
      log(`[${m}] alerta ${d.id}: ${closing ? "fechamento" : "pregão aberto (sem comparação)"} ${st.date} · ${st.current.length} no resultado · ${st.entries.filter((e) => e.date === st.date).length} novas`);
    }
  }
  const tickerUrl = (s: AlertState, t: string) => `${SITE}?m=${s.market}&tk=${encodeURIComponent(t)}`;
  for (const s of states) {
    write(join(DATA, "alerts", `${s.id}.json`), JSON.stringify(s));
    write(join(DATA, "alerts", `${s.id}.xml`), rss(`Monitor B3 · alerta: ${s.name}`, SITE, `${SITE}data/alerts/${s.id}.xml`, [s], tickerUrl));
  }
  if (states.length) {
    write(join(DATA, "alerts.xml"), rss("Monitor B3 · todos os alertas", SITE, `${SITE}data/alerts.xml`, states, tickerUrl));
    write(join(DATA, "alerts", "index.json"), JSON.stringify({ generatedAt: now, alerts: states.map((s) => ({ id: s.id, name: s.name, market: s.market, desc: s.desc, date: s.date, checkedAt: s.checkedAt, current: s.current, entries: s.entries.slice(0, 30), warning: s.warning, backtest: s.backtest })) }));
  }
  log(`ok: ${states.length} alerta(s)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
