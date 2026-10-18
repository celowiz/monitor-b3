// Aba Alertas: grafos avaliados no fechamento pelo Actions, com feed RSS. Nada é enviado por email.
import { useEffect, useMemo, useState } from "react";
import type { AlertEntry } from "./alerts";
import { ALERT_ID, alertProblems } from "./alerts";
import { Market, Screen } from "./engine";
import { exportJson } from "./graphs";
import { BtLine, useBtIndex } from "./Backtest";
import { track } from "./analytics";

interface AlertItem { id: string; name: string; market: Market; desc?: string; date: string | null; checkedAt: string; current: string[]; entries: AlertEntry[]; warning?: string; backtest?: string; screen?: Screen }
const BASE = () => import.meta.env.BASE_URL + "data/";
const abs = (p: string) => new URL(BASE() + p, window.location.href).href;
const dmy = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const REPO = "https://github.com/celowiz/monitor-b3";

function Copy({ url, label, alert_id }: { url: string; label: string; alert_id: string }) {
  const [ok, setOk] = useState(false);
  return <span className="rss">
    <a href={url} target="_blank" rel="noreferrer" onClick={() => track("alert_rss_click", { alert_id, action: "open" })}><span className="rss-ic">◉</span>{label}</a>
    <button className="link" onClick={async () => { track("alert_rss_click", { alert_id, action: "copy" }); try { await navigator.clipboard.writeText(url); setOk(true); setTimeout(() => setOk(false), 1600); } catch { window.prompt("Copie o endereço do feed:", url); } }}>{ok ? "copiado ✓" : "copiar endereço"}</button>
  </span>;
}

export default function Alerts({ market, screen, onOpen, onTicker, onBacktest }: {
  market: Market; screen: Screen; onOpen: (s: Screen, name: string) => void; onTicker: (s: Screen, t: string) => void; onBacktest: (id: string) => void;
}) {
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [full, setFull] = useState<Record<string, Screen>>({});
  const bt = useBtIndex(market);
  useEffect(() => {
    fetch(BASE() + "alerts/index.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : { alerts: [] })).then((d) => setItems(d.alerts ?? [])).catch(() => setItems([]));
  }, []);
  const mine = useMemo(() => (items ?? []).filter((a) => a.market === market), [items, market]);
  const getScreen = async (id: string): Promise<Screen | null> => {
    if (full[id]) return full[id];
    try { const d = await (await fetch(BASE() + `alerts/${id}.json`, { cache: "no-cache" })).json(); setFull((f) => ({ ...f, [id]: d.screen })); return d.screen; } catch { return null; }
  };
  // Propor o grafo atual: abre o editor do GitHub com o arquivo pronto (precisa de conta e PR; nada é publicado sem revisão).
  const [pid, setPid] = useState("");
  const probs = useMemo(() => alertProblems({ id: pid || "x-ok", name: screen.name, market, active: true, screen }), [pid, screen, market]);
  const propose = () => {
    const id = pid.trim();
    const body = JSON.parse(exportJson(screen));
    const json = JSON.stringify({ app: "monitor-b3", v: 2, id, name: screen.name, market, active: true, desc: "", screen: body.screen }, null, 2) + "\n";
    track("alert_propose", { market, n_nodes: screen.blocks.length });
    window.open(`${REPO}/new/main/alerts?filename=${encodeURIComponent(id + ".json")}&value=${encodeURIComponent(json)}`, "_blank", "noopener");
  };
  return (
    <div className="alerts">
      <div className="al-head">
        <div><h2>Alertas</h2>
          <p className="mu">Grafos avaliados automaticamente <b>no fechamento</b> de cada pregão (B3 após 17:30, EUA após 18:15, horário de Brasília). Quando um ativo <b>entra</b> no resultado, aparece aqui e no feed RSS. Sem email e sem cadastro: assine o RSS num leitor gratuito (Feedly, Inoreader, NetNewsWire, Thunderbird…).</p></div>
        <Copy url={abs("alerts.xml")} label="RSS de todos os alertas" alert_id="all" />
      </div>
      {items === null && <div className="empty">carregando…</div>}
      {items && !mine.length && <div className="empty">Nenhum alerta para este mercado nesta rodada.</div>}
      <div className="al-grid">
        {mine.map((a) => {
          const byDate = new Map<string, AlertEntry[]>(); for (const e of a.entries) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
          const dates = [...byDate.keys()].slice(0, 5);
          return (
            <article key={a.id} className="al-card">
              <div className="al-t"><h3>{a.name}</h3><span className="mu mono">{a.current.length} no resultado em {dmy(a.date)}</span></div>
              {a.desc && <p className="mu al-desc">{a.desc}</p>}
              {a.warning && <div className="mp-warn">⚠ {a.warning}</div>}
              <BtLine s={bt.get("alert-" + a.id)} onOpen={bt.has("alert-" + a.id) ? () => onBacktest("alert-" + a.id) : undefined} />
              <div className="al-feed">
                {!dates.length && <span className="mu">Sem entradas novas ainda.</span>}
                {dates.map((d) => (
                  <div key={d} className="al-day"><span className="al-d mono">{dmy(d)}</span>
                    <div className="al-tks">{byDate.get(d)!.map((e) => (
                      <button key={e.t} className="al-tk" title={`${e.name}\n${e.why.join("\n")}`} onClick={async () => { const s = await getScreen(a.id); if (s) onTicker({ ...s, name: a.name }, e.t); }}>
                        <b>{e.t}</b><span>{e.name}</span></button>))}</div>
                  </div>))}
              </div>
              <div className="al-act">
                <button className="btn sm" onClick={async () => { const s = await getScreen(a.id); if (s) onOpen({ ...s, name: a.name }, a.name); }}>Abrir grafo</button>
                <Copy url={abs(`alerts/${a.id}.xml`)} label="RSS" alert_id={a.id} />
              </div>
            </article>
          );
        })}
      </div>
      <div className="al-prop">
        <h3>Propor o grafo atual como alerta</h3>
        <p className="mu">Gera o arquivo <span className="mono">alerts/&lt;id&gt;.json</span> e abre o editor do GitHub para você sugerir a inclusão (pull request, com revisão). Grafo atual: <b>{screen.name}</b> · mercado {market === "us" ? "EUA" : "B3"}.</p>
        <div className="al-prop-f">
          <input className="ed-in mono" placeholder={`${market}-meu-alerta`} value={pid} onChange={(e) => setPid(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 41))} />
          <button className="btn pri" disabled={!ALERT_ID.test(pid) || probs.length > 0} onClick={propose}>Abrir no GitHub ↗</button>
        </div>
        {probs.length > 0 && <div className="mp-warn">⚠ {probs.join(" · ")}</div>}
      </div>
      <p className="mu cp-note">Entrada = ativo que estava fora do resultado no fechamento anterior e está dentro neste. Alertas mostram o que o filtro encontrou; não são recomendação de compra ou venda.</p>
    </div>
  );
}
