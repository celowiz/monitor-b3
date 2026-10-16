import { useEffect, useMemo, useRef, useState } from "react";
import Canvas, { Palette, addFromPalette, totalSteps } from "./Canvas";
import MyGraphs from "./MyGraphs";
import { SavedGraph, exportJson, importJson, loadGraphs, storeGraphs, upsert } from "./graphs";
import { blankScreen } from "./graph";
import Results from "./Results";
import Gallery from "./Gallery";
import Market from "./Market";
import History from "./History";
import { decodeScreen, encodeScreen, tokenFromHash } from "./share";
import ChartPanel from "./Chart";
import { BlockEditor } from "./Editors";
import { track } from "./analytics";
import { DEFS, Evaluated, Latest, Screen, blockSummary, defaultScreen, evaluate, isFilter, isLogic, isSignal, newId, Market as MarketId, setMarketContext } from "./engine";

const useWide = () => {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return w >= 800;
};
const clone = (s: Screen): Screen => JSON.parse(JSON.stringify(s));

function fmtRun(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " BRT";
}

function MobilePipeline({ screen, ev, sectors, tree, onChange }: { screen: Screen; ev: Evaluated; sectors: string[]; tree: Record<string, string[]>; onChange: (s: Screen) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const set = (id: string, patch: any) => onChange({ ...screen, blocks: screen.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  // No celular as ligações são só leitura: lista em ordem de execução, com edição de parâmetros e liga/desliga.
  const list = screen.blocks.filter((b) => b.type !== "result");
  return (
    <div className="mpipe">
      {ev.problems.length > 0 && <div className="mp-warn">⚠ {ev.problems.map((p) => p.msg).join(" · ")}</div>}
      {list.map((b) => {
        const sig = isSignal(b.type), lg = isLogic(b.type);
        return (
          <div key={b.id} className={`mp-card ${sig || lg ? "sig" : ""} ${b.enabled ? "on" : "off"}`}>
            <div className="mp-row" onClick={() => !lg && setOpen(open === b.id ? null : b.id)}>
              <span className="bn-ic">{DEFS[b.type].icon}</span>
              <div className="mp-t"><b>{DEFS[b.type].label}</b><span>{blockSummary(b)}</span></div>
              <span className="bn-n mono">{ev.perBlock.get(b.id) ?? "–"}</span>
              {!lg && <button className={"tg" + (b.enabled ? " on" : "")} onClick={(e) => { e.stopPropagation(); set(b.id, { enabled: !b.enabled }); }}><i /></button>}
            </div>
            {open === b.id && <div className="mp-ed"><BlockEditor block={b} sectors={sectors} tree={tree} onParams={(p) => set(b.id, { params: { ...b.params, ...p } })} /></div>}
          </div>
        );
      })}
      <div className="mp-add"><span className="mu">Para ligar e desligar conexões, use o computador.</span>
        <div className="mp-res"><span>Resultados</span><b className="mono">{ev.complete ? ev.results.length : "–"}</b></div>
      </div>
    </div>
  );
}

export default function App() {
  const wide = useWide();
  const [latest, setLatest] = useState<Latest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphs, setGraphs] = useState<SavedGraph[]>(loadGraphs);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(() => defaultScreen());
  const [presetIdx, setPresetIdx] = useState("builtin");
  const [sel, setSel] = useState<string | null>(null);
  const [gallery, setGallery] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fromLink = useRef(false);
  const flash = (m: string) => { setToast(m); window.clearTimeout((flash as any).t); (flash as any).t = window.setTimeout(() => setToast(null), 2600); };
  useEffect(() => {
    const load = () => {
      const tok = tokenFromHash(window.location.hash);
      if (!tok) return;
      fromLink.current = true;
      decodeScreen(tok).then((s) => {
        if (s) { setScreen(s); setPresetIdx("link"); setActiveId(null); flash(`Tela "${s.name}" carregada do link`); }
        else { fromLink.current = false; flash("Link inválido ou de versão antiga. Mostrando a tela padrão."); history.replaceState(null, "", window.location.pathname + window.location.search); }
      });
    };
    load(); window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}#t=${await encodeScreen(screen)}`;
    history.replaceState(null, "", url);
    track("share_link_copy", { preset: screen.name ?? presetIdx });
    try { await navigator.clipboard.writeText(url); flash("Link copiado. Quem abrir verá esta mesma tela."); }
    catch { window.prompt("Copie o link:", url); }
  };

  const [market, setMarket] = useState<MarketId>(() => {
    const q = new URLSearchParams(window.location.search).get("m");
    if (q === "us" || q === "br") return q;
    try { return localStorage.getItem("monitorb3.market") === "us" ? "us" : "br"; } catch { return "br"; }
  });
  const firstLoad = useRef(true);
  useEffect(() => {
    setError(null);
    const base = import.meta.env.BASE_URL + "data/";
    const get = (f: string) => fetch(base + f, { cache: "no-cache" }).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    (market === "br" ? get("latest_br.json").catch(() => get("latest.json")) : get("latest_us.json"))
      .then((d: Latest) => {
        setMarketContext(market); setSel(null); setLatest(d);
        if (!(firstLoad.current && fromLink.current)) { setScreen(defaultScreen(d.defaults?.liq21MinBrl)); setPresetIdx("builtin"); setActiveId(null); }
        firstLoad.current = false;
      })
      .catch((e) => { setLatest(null); setError(market === "us" ? `Dados do S&P 500 indisponíveis nesta rodada (${e.message}).` : `Não foi possível carregar os dados (${e.message}).`); });
  }, [market]);
  const switchMarket = (m: MarketId) => {
    if (m === market) return;
    track("market_switch", { market: m });
    try { localStorage.setItem("monitorb3.market", m); } catch { /* ignore */ }
    const u = new URL(window.location.href); u.searchParams.set("m", m); history.replaceState(null, "", u.pathname + u.search + u.hash);
    setMarket(m);
  };

  const rows = latest?.tickers ?? [];
  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector ?? "Sem setor"))).sort((a, b) => a.localeCompare(b, "pt-BR")), [rows]);
  const tree = useMemo(() => {
    const t: Record<string, Set<string>> = {};
    for (const r of rows) (t[r.sector ?? "Sem setor"] ??= new Set()).add(r.subsector ?? "Sem subsetor");
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Array.from(v)]));
  }, [rows]);
  const ev = useMemo(() => evaluate(screen, rows), [screen, rows]);
  // Execução estilo n8n: avança um passo a cada ~200 ms quando a tela muda.
  const [exec, setExec] = useState({ step: 999, runId: 0 });
  const sig = useMemo(() => JSON.stringify([screen.blocks.map((b) => [b.id, b.type, b.enabled, b.params]), screen.edges.map((e) => [e.source, e.target])]) + rows.length, [screen, rows]);
  useEffect(() => {
    if (!rows.length) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const n = totalSteps(screen);
    if (reduce) { setExec((e) => ({ step: n, runId: e.runId + 1 })); return; }
    let i = 0, timer = 0;
    const delay = window.setTimeout(() => {
      setExec((e) => ({ step: 0, runId: e.runId + 1 }));
      timer = window.setInterval(() => { i++; setExec((e) => ({ ...e, step: i })); if (i >= n) clearInterval(timer); }, 200);
    }, 120);
    return () => { clearTimeout(delay); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const done = exec.step >= totalSteps(screen);
  // screen_apply: uma vez por configuração, após a execução terminar e a tela ficar estável por 1,5 s.
  useEffect(() => {
    if (!done || !rows.length) return;
    const t = window.setTimeout(() => {
      const on = screen.blocks.filter((b) => b.enabled && b.type !== "universe");
      track("screen_apply", {
        preset: presetIdx === "builtin" ? "builtin" : (screen.name ?? "custom"),
        n_signals: on.filter((b) => !isFilter(b.type)).length,
        n_filters: on.filter((b) => isFilter(b.type)).length,
        n_logic: on.filter((b) => isLogic(b.type)).length,
        complete: ev.complete,
        result_count: ev.results.length,
      });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, sig]);
  const selRow = sel ? rows.find((r) => r.t === sel) ?? null : null;

  // Grafo aberto em "Meus grafos": cada mudança é salva automaticamente.
  useEffect(() => {
    if (!activeId) return;
    const t = window.setTimeout(() => setGraphs((gs) => { const g = gs.find((x) => x.id === activeId); if (!g) return gs; const next = upsert(gs, { ...g, updated: Date.now(), screen: { ...screen, name: g.name } }); storeGraphs(next); return next; }), 400);
    return () => clearTimeout(t);
  }, [screen, activeId]);
  const commit = (next: SavedGraph[]) => { setGraphs(next); storeGraphs(next); };
  const openGraph = (id: string) => { const g = graphs.find((x) => x.id === id); if (!g) return; track("preset_select", { preset: g.name, source: "my_graphs" }); setActiveId(id); setPresetIdx("saved"); setScreen(clone(g.screen)); };
  const saveAs = (s: Screen, name?: string | null) => {
    const n = name ?? window.prompt("Nome do grafo", s.builtin ? "Meu grafo" : s.name);
    if (!n) return;
    const g: SavedGraph = { id: newId("g"), name: n.slice(0, 80), updated: Date.now(), screen: { ...clone(s), name: n.slice(0, 80), builtin: false } };
    commit([g, ...graphs]); setActiveId(g.id); setPresetIdx("saved"); setScreen(g.screen);
    track("graph_save", { n_nodes: s.blocks.length, n_edges: s.edges.length });
    flash(`"${g.name}" salvo em Meus grafos`);
  };
  const newGraph = () => { const name = window.prompt("Nome do novo grafo", "Novo grafo"); if (name) saveAs(blankScreen(name), name); };
  const rename = (id: string) => {
    const g = graphs.find((x) => x.id === id); if (!g) return;
    const n = window.prompt("Novo nome", g.name); if (!n) return;
    commit(upsert(graphs, { ...g, name: n.slice(0, 80), updated: Date.now(), screen: { ...g.screen, name: n.slice(0, 80) } }));
    if (id === activeId) setScreen((s) => ({ ...s, name: n.slice(0, 80) }));
  };
  const duplicate = (id: string) => { const g = graphs.find((x) => x.id === id); if (g) saveAs(id === activeId ? screen : g.screen, `${g.name} (cópia)`); };
  const remove = (id: string) => {
    const g = graphs.find((x) => x.id === id); if (!g || !window.confirm(`Excluir "${g.name}"? Isso não pode ser desfeito.`)) return;
    commit(graphs.filter((x) => x.id !== id)); track("graph_delete", { n_nodes: g.screen.blocks.length });
    if (id === activeId) { setActiveId(null); setPresetIdx("builtin"); setScreen(defaultScreen(latest?.defaults?.liq21MinBrl)); }
  };
  const exportCur = () => {
    const blob = new Blob([exportJson(screen)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${(screen.name || "grafo").replace(/[^\w\-]+/g, "_").slice(0, 40)}.monitor-b3.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const importFile = (text: string) => {
    const s = importJson(text);
    if (!s) { flash("Arquivo inválido: não é um grafo do Monitor B3."); return; }
    track("graph_import", { n_nodes: s.blocks.length, n_edges: s.edges.length });
    saveAs(s, s.name);
  };
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const sigParams = useMemo(() => Object.fromEntries(screen.blocks.filter((b) => isSignal(b.type)).map((b) => [b.type, b.params])), [screen]);
  const [view, setView] = useState<"telas" | "historico" | "mercado">(() => (window.location.hash.includes("mercado") ? "mercado" : "telas"));
  const [chartMax, setChartMax] = useState(false);
  useEffect(() => { if (!sel) setChartMax(false); }, [sel]);
  useEffect(() => {
    if (!chartMax) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setChartMax(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [chartMax]);

  return (
    <div className={"app" + (wide ? "" : " mobile")}>
      <header className="top">
        <div className="brand"><a href="https://celowiz.github.io/">celowiz</a> / <b>Monitor B3</b> <span className="mu sub">construtor de telas</span>
          <nav className="tabs" role="tablist">
            <button role="tab" aria-selected={view === "telas"} className={view === "telas" ? "on" : ""} onClick={() => setView("telas")}>Telas</button>
            <button role="tab" aria-selected={view === "historico"} className={view === "historico" ? "on" : ""} onClick={() => { if (view !== "historico") track("history_tab_open"); setView("historico"); }}>Histórico</button>
            <button role="tab" aria-selected={view === "mercado"} className={view === "mercado" ? "on" : ""} onClick={() => { if (view !== "mercado") track("market_tab_open"); setView("mercado"); }}>Mercado</button>
          </nav>
          <div className="seg mkt-sel" role="group" aria-label="Mercado">
            <button className={market === "br" ? "on" : ""} aria-pressed={market === "br"} onClick={() => switchMarket("br")}>BR</button>
            <button className={market === "us" ? "on" : ""} aria-pressed={market === "us"} onClick={() => switchMarket("us")}>US</button>
          </div></div>
        {latest && (
          <div className="meta mono">
            <span><i className="dot" />Rodada <b>{fmtRun(latest.generatedAt)}</b></span>
            {wide && <span>Fonte <b>{market === "us" ? "Wikipedia + yfinance" : "brapi + yfinance"}</b></span>}
            {wide && <span title={latest.delayNote}>Atraso <b>~30 min</b></span>}
            <span>Universo <b>{latest.universeCount}</b>{wide ? " ativos" : ""}</span>
            <span className={latest.failedTickers.length ? "st-partial" : "st-ok"} title={latest.failedTickers.join(", ")}>
              {latest.failedTickers.length ? `parcial · ${latest.failedTickers.length} falha(s)` : "ok"}</span>
          </div>
        )}
      </header>

      {error && <div className="empty">{error}</div>}

      {view === "mercado" ? (latest && <Market key={market} latest={latest} wide={wide} />) : view === "historico" ? (latest && <History latest={latest} />) : (<>
      <div className="presets">
        <span className="cur-name"><span className="mu">Tela</span> <b>{screen.name}</b>{presetIdx === "link" && <span className="mu"> (link)</span>}{activeId && <span className="mu"> · salvo automaticamente</span>}</span>
        <button className="btn" onClick={() => { setActiveId(null); setPresetIdx("builtin"); setScreen(defaultScreen(latest?.defaults?.liq21MinBrl)); }}>Tela padrão</button>
        {!activeId && <button className="btn pri" onClick={() => saveAs(screen)}>Salvar em Meus grafos</button>}
        <span className="sp" />
        <button className="btn" onClick={() => setGallery(true)}>▦ Galeria de telas</button>
        <button className="btn" onClick={copyLink}>⧉ Copiar link</button>
      </div>

      {wide ? (
        <div className="builder">
          <Palette onAdd={addFromPalette} hasResult={screen.blocks.some((b) => b.type === "result")} />
          <button className={"scroll-hint" + (scrolled ? " gone" : "")} aria-label="Ir para os resultados" tabIndex={scrolled ? -1 : 0}
            onClick={() => { track("scroll_hint_click", { result_count: ev.results.length }); document.getElementById("resultados")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>
            Resultados <b className="mono">({ev.results.length})</b> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <Canvas screen={screen} ev={ev} total={rows.length} sectors={sectors} tree={tree} onChange={setScreen} step={exec.step} runId={exec.runId} />
          <MyGraphs graphs={graphs} activeId={activeId} onNew={newGraph} onOpen={openGraph} onRename={rename} onDuplicate={duplicate} onDelete={remove}
            onSave={() => saveAs(screen)} onExport={exportCur} onImport={importFile} onCopyLink={copyLink} dirtyUnsaved={!activeId} />
        </div>
      ) : (
        <MobilePipeline screen={screen} ev={ev} sectors={sectors} tree={tree} onChange={setScreen} />
      )}

      <div id="resultados" className={"lower" + (selRow && wide ? " with-chart" : "")}>
        <Results runId={exec.runId} done={done} ev={ev} total={latest?.universeCount ?? 0} failed={latest?.failedTickers ?? []} selected={sel} onSelect={(t: string) => { if (t !== sel) { const r = rows.find((x) => x.t === t); track("ticker_open", { ticker: t, asset_type: r?.kind, sector: r?.sector ?? undefined }); } setSel(t); }} compact={!wide} />
        {selRow && <div className={wide ? "side" + (chartMax ? " maxed" : "") : "fullscreen"}><ChartPanel row={selRow} hits={ev.hits.get(selRow.t) ?? []} onClose={() => setSel(null)} signalParams={sigParams} maximized={chartMax} onToggleMax={wide ? () => { if (!chartMax) track("chart_maximize", { ticker: selRow.t }); setChartMax((m) => !m); } : undefined} /></div>}
      </div>

      </>)}
      {gallery && <Gallery liqMin={latest?.defaults?.liq21MinBrl ?? 5_000_000} onClose={() => setGallery(false)}
        onPick={(s) => { track("preset_select", { preset: s.name, source: "gallery" }); setScreen(s); setPresetIdx("gallery"); setActiveId(null); setGallery(false); flash(`Tela "${s.name}" aplicada`); history.replaceState(null, "", window.location.pathname); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}

      <footer className="foot">
        <b>Conteúdo educativo, não é recomendação de investimento.</b>
        {latest && market === "us" && <span> Rodada {fmtRun(latest.generatedAt)} · barra de {latest.dataDate?.split("-").reverse().join("/")} (provisória durante o pregão) · preços yfinance diário auto_adjust, em US$ · universo S&P 500 e setores GICS (Wikipedia, lista em cache com data {latest.indexes?.SP500?.date ?? "—"}) · RS vs S&P 500 (^GSPC) · calendário NYSE. Máx./mín. 52s = 252 pregões excluindo hoje.</span>}
        {latest && market === "br" && <span> Rodada {fmtRun(latest.generatedAt)} · barra de {latest.dataDate?.split("-").reverse().join("/")} (provisória durante o pregão) · preços yfinance diário auto_adjust · universo e setores brapi.dev · IFIX: carteira B3 · RS: Ibovespa (^BVSP); FIIs vs IFIX (proxy {latest.benchmark.ifixProxy ?? "XFIX11"}). Máx./mín. 52s = 252 pregões excluindo hoje.</span>}
        {" "}<a href="https://github.com/celowiz/monitor-b3">código</a>
      </footer>
    </div>
  );
}
