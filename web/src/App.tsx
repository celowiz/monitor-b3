import { useEffect, useMemo, useRef, useState } from "react";
import Canvas, { Palette, insertBlock, totalSteps } from "./Canvas";
import Results from "./Results";
import Gallery from "./Gallery";
import { decodeScreen, encodeScreen, tokenFromHash } from "./share";
import ChartPanel from "./Chart";
import { BlockEditor } from "./Editors";
import { track } from "./analytics";
import { BlockType, DEFS, Latest, Screen, blockSummary, defaultScreen, evaluate, isFilter, loadSaved, makeBlock, storeSaved } from "./engine";

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

function MobilePipeline({ screen, counts, sectors, tree, onChange, resultCount }: { screen: Screen; counts: Map<string, number>; sectors: string[]; tree: Record<string, string[]>; onChange: (s: Screen) => void; resultCount: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const set = (id: string, patch: any) => onChange({ ...screen, blocks: screen.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) });
  return (
    <div className="mpipe">
      {screen.blocks.map((b, i) => {
        const sig = !isFilter(b.type);
        const firstSig = sig && (i === 0 || isFilter(screen.blocks[i - 1].type));
        return (
          <div key={b.id}>
            {firstSig && <div className="mp-sep">sinais · combinar com
              <div className="seg"><button className={screen.combine === "and" ? "on" : ""} onClick={() => onChange({ ...screen, combine: "and" })}>E</button><button className={screen.combine === "or" ? "on" : ""} onClick={() => onChange({ ...screen, combine: "or" })}>OU</button></div></div>}
            <div className={`mp-card ${sig ? "sig" : ""} ${b.enabled ? "on" : "off"}`}>
              <div className="mp-row" onClick={() => setOpen(open === b.id ? null : b.id)}>
                <span className="bn-ic">{DEFS[b.type].icon}</span>
                <div className="mp-t"><b>{DEFS[b.type].label}</b><span>{blockSummary(b)}</span></div>
                <span className="bn-n mono">{counts.get(b.id) ?? "–"}</span>
                <button className={"tg" + (b.enabled ? " on" : "")} onClick={(e) => { e.stopPropagation(); set(b.id, { enabled: !b.enabled }); }}><i /></button>
              </div>
              {open === b.id && (
                <div className="mp-ed">
                  <BlockEditor block={b} sectors={sectors} tree={tree} onParams={(p) => set(b.id, { params: { ...b.params, ...p } })} />
                  {b.type !== "universe" && <button className="link" onClick={() => onChange({ ...screen, blocks: screen.blocks.filter((x) => x.id !== b.id) })}>remover bloco</button>}
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="mp-add">
        <select value="" onChange={(e) => e.target.value && onChange(insertBlock(screen, makeBlock(e.target.value as BlockType)))}>
          <option value="">+ adicionar bloco</option>
          {(Object.keys(DEFS) as BlockType[]).map((t) => <option key={t} value={t}>{DEFS[t].group} · {DEFS[t].label}</option>)}
        </select>
        <div className="mp-res"><span>Resultados</span><b className="mono">{resultCount}</b></div>
      </div>
    </div>
  );
}

export default function App() {
  const wide = useWide();
  const [latest, setLatest] = useState<Latest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Screen[]>(loadSaved);
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
        if (s) { setScreen(s); setPresetIdx("link"); flash(`Tela "${s.name}" carregada do link`); }
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

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/latest.json`, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((d: Latest) => { setLatest(d); if (!fromLink.current) setScreen(defaultScreen(d.defaults?.liq21MinBrl)); })
      .catch((e) => setError(`Não foi possível carregar os dados (${e.message}).`));
  }, []);

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
  const sig = useMemo(() => JSON.stringify(screen.blocks.map((b) => [b.type, b.enabled, b.params])) + screen.combine + rows.length, [screen, rows]);
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
        preset: presetIdx === "builtin" ? "builtin" : (saved[Number(presetIdx)]?.name ?? screen.name ?? "custom"),
        n_signals: on.filter((b) => !isFilter(b.type)).length,
        n_filters: on.filter((b) => isFilter(b.type)).length,
        combine: screen.combine,
        result_count: ev.results.length,
      });
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, sig]);
  const selRow = sel ? rows.find((r) => r.t === sel) ?? null : null;

  const choose = (v: string) => {
    setPresetIdx(v);
    track("preset_select", { preset: v === "builtin" ? "builtin" : saved[Number(v)]?.name ?? v });
    if (v === "builtin") setScreen(defaultScreen(latest?.defaults?.liq21MinBrl));
    else setScreen(clone(saved[Number(v)]));
  };
  const save = () => {
    const name = window.prompt("Nome da tela", presetIdx === "builtin" ? "Minha tela" : screen.name);
    if (!name) return;
    const s = { ...clone(screen), name, builtin: false };
    const i = saved.findIndex((x) => x.name === name);
    const next = i >= 0 ? saved.map((x, j) => (j === i ? s : x)) : [...saved, s];
    setSaved(next); storeSaved(next); setScreen(s); setPresetIdx(String(i >= 0 ? i : next.length - 1));
  };
  const del = () => {
    if (presetIdx === "builtin") return;
    const next = saved.filter((_, j) => j !== Number(presetIdx));
    setSaved(next); storeSaved(next); choose("builtin");
  };
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const [chartMax, setChartMax] = useState(false);
  useEffect(() => { if (!sel) setChartMax(false); }, [sel]);
  useEffect(() => {
    if (!chartMax) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setChartMax(false); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [chartMax]);
  const add = (t: BlockType) => setScreen(insertBlock(screen, makeBlock(t)));

  return (
    <div className={"app" + (wide ? "" : " mobile")}>
      <header className="top">
        <div className="brand"><a href="https://celowiz.github.io/">celowiz</a> / <b>Monitor B3</b> <span className="mu sub">construtor de telas</span></div>
        {latest && (
          <div className="meta mono">
            <span><i className="dot" />Rodada <b>{fmtRun(latest.generatedAt)}</b></span>
            {wide && <span>Fonte <b>brapi + yfinance</b></span>}
            {wide && <span title={latest.delayNote}>Atraso <b>~30 min</b></span>}
            <span>Universo <b>{latest.universeCount}</b>{wide ? " ativos" : ""}</span>
            <span className={latest.failedTickers.length ? "st-partial" : "st-ok"} title={latest.failedTickers.join(", ")}>
              {latest.failedTickers.length ? `parcial · ${latest.failedTickers.length} falha(s)` : "ok"}</span>
          </div>
        )}
      </header>

      {error && <div className="empty">{error}</div>}

      <div className="presets">
        <select value={presetIdx} onChange={(e) => choose(e.target.value)}>
          <option value="builtin">Máx. 52s + liq. R$ 5 mi</option>
          {presetIdx === "gallery" && <option value="gallery">{screen.name}</option>}
          {presetIdx === "link" && <option value="link">{screen.name} (link)</option>}
          {saved.map((s, i) => <option key={i} value={String(i)}>{s.name}</option>)}
        </select>
        <button className="btn pri" onClick={save}>Salvar tela</button>
        {presetIdx !== "builtin" && <button className="btn" onClick={del}>Excluir</button>}
        <button className="btn" onClick={() => choose(presetIdx === "gallery" || presetIdx === "link" ? "builtin" : presetIdx)}>Restaurar</button>
        <span className="sp" />
        <button className="btn" onClick={() => setGallery(true)}>▦ Galeria de telas</button>
        <button className="btn" onClick={copyLink}>⧉ Copiar link</button>
      </div>

      {wide ? (
        <div className="builder">
          <Palette onAdd={add} />
          <button className={"scroll-hint" + (scrolled ? " gone" : "")} aria-label="Ir para os resultados" tabIndex={scrolled ? -1 : 0}
            onClick={() => { track("scroll_hint_click", { result_count: ev.results.length }); document.getElementById("resultados")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); }}>
            Resultados <b className="mono">({ev.results.length})</b> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <Canvas screen={screen} counts={ev.perBlock} total={rows.length} filteredCount={ev.filtered.length} resultCount={ev.results.length} sectors={sectors} tree={tree} onChange={setScreen} step={exec.step} runId={exec.runId} />
        </div>
      ) : (
        <MobilePipeline screen={screen} counts={ev.perBlock} sectors={sectors} tree={tree} onChange={setScreen} resultCount={ev.results.length} />
      )}

      <div id="resultados" className={"lower" + (selRow && wide ? " with-chart" : "")}>
        <Results runId={exec.runId} done={done} ev={ev} total={latest?.universeCount ?? 0} failed={latest?.failedTickers ?? []} selected={sel} onSelect={(t: string) => { if (t !== sel) { const r = rows.find((x) => x.t === t); track("ticker_open", { ticker: t, asset_type: r?.kind, sector: r?.sector ?? undefined }); } setSel(t); }} compact={!wide} />
        {selRow && <div className={wide ? "side" + (chartMax ? " maxed" : "") : "fullscreen"}><ChartPanel row={selRow} hits={ev.hits.get(selRow.t) ?? []} onClose={() => setSel(null)} maximized={chartMax} onToggleMax={wide ? () => { if (!chartMax) track("chart_maximize", { ticker: selRow.t }); setChartMax((m) => !m); } : undefined} /></div>}
      </div>

      {gallery && <Gallery liqMin={latest?.defaults?.liq21MinBrl ?? 5_000_000} onClose={() => setGallery(false)}
        onPick={(s) => { track("preset_select", { preset: s.name, source: "gallery" }); setScreen(s); setPresetIdx("gallery"); setGallery(false); flash(`Tela "${s.name}" aplicada`); history.replaceState(null, "", window.location.pathname); }} />}
      {toast && <div className="toast" role="status">{toast}</div>}

      <footer className="foot">
        <b>Conteúdo educativo, não é recomendação de investimento.</b>
        {latest && <span> Rodada {fmtRun(latest.generatedAt)} · barra de {latest.dataDate?.split("-").reverse().join("/")} (provisória durante o pregão) · preços yfinance diário auto_adjust · universo e setores brapi.dev · IFIX: carteira B3 · RS: Ibovespa (^BVSP); FIIs vs IFIX (proxy {latest.benchmark.ifixProxy ?? "XFIX11"}). Máx./mín. 52s = 252 pregões excluindo hoje.</span>}
        {" "}<a href="https://github.com/celowiz/monitor-b3">código</a>
      </footer>
    </div>
  );
}
