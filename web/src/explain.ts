// "Por que passou": percorre o grafo para UM ativo e mostra, nó a nó, se passou e com quais valores.
// Usa filterPass/signalHit (as mesmas funções da triagem), então a explicação nunca diverge do resultado.
import { agulhadaSeries, normParams } from "./agulhada";
import { Block, DEFS, KIND_LABEL, MKT, Row, Screen, WATCH, filterPass, fmtBrl, fmtNum, fmtPct, isFilter, isLogic, isSignal, parseList, signalHit } from "./engine";
import { inputsOf, migrateScreen, topo } from "./graph";

export interface ExplainStep {
  block: Block; label: string;
  /** chegou ao nó (alguma/todas as entradas passaram) */
  reached: boolean;
  /** passou no nó (para lógica/resultado: o ativo sai do nó) */
  pass: boolean;
  /** valor do ativo e regra usada, em texto curto */
  value: string;
  off?: boolean;
}

const pct = (v: number | null | undefined, d = 1) => fmtPct(v ?? null, d);
const n2 = (v: number | null | undefined, d = 2) => fmtNum(v ?? null, d);

export function valueText(b: Block, r: Row): string {
  const p = b.params;
  switch (b.type) {
    case "universe": return `${KIND_LABEL[r.kind]} · aceita ${(p.kinds as string[]).map((k) => KIND_LABEL[k as keyof typeof KIND_LABEL]).join(", ")}`;
    case "watchlist": return p.mode === "fixed" ? (parseList(p.tickers).includes(r.t) ? "está na lista fixa" : "fora da lista fixa") : (WATCH.set.has(r.t) ? "★ está nas suas estrelas" : "sem estrela");
    case "sector": return `${r.sector ?? "Sem setor"} / ${r.subsector ?? "Sem subsetor"}`;
    case "liquidity": return `liq. 21d ${fmtBrl(r.liq21)} · mín. ${fmtBrl(Number(p.min))}`;
    case "minPrice": return `preço ${MKT.cur} ${n2(r.price)} · mín. ${MKT.cur} ${n2(Number(p.min))}`;
    case "chgRange": return `var. dia ${pct(r.chg)} · faixa ${p.min}% a ${p.max}%`;
    case "blocklist": return parseList(p.tickers).includes(r.t) ? "está na lista de exclusão" : "fora da lista de exclusão";
    case "sma200": return r.sma200 ? `preço ${n2(r.price)} vs SMA200 ${n2(r.sma200)} (${pct(r.price / r.sma200 - 1)})` : "sem SMA200 (histórico curto)";
    case "index": return `membro de ${(r.idx ?? []).join(", ") || "nenhum índice"} · pede ${(p.indices ?? []).join(" ou ") || "qualquer"}`;
    case "high52": return r.high52 != null ? `fech. ${n2(r.price)} vs máx. 52s ${n2(r.high52)} (${pct(r.price / r.high52 - 1)})` : "sem 52 semanas de histórico";
    case "low52": return r.low52 != null ? `fech. ${n2(r.price)} vs mín. 52s ${n2(r.low52)} (${pct(r.price / r.low52 - 1)})` : "sem 52 semanas de histórico";
    case "smaCross": return `SMA50 ${n2(r.sma50)} / SMA200 ${n2(r.sma200)} · ontem ${n2(r.sma50Prev)} / ${n2(r.sma200Prev)}`;
    case "volume": return `volume ${r.volRatio == null ? "—" : n2(r.volRatio, 1) + "×"} a média 21d · pede ≥ ${p.mult}×`;
    case "rsi": return `RSI ${n2(r.rsi, 1)} (ontem ${n2(r.rsiPrev, 1)}) · pede ${p.zone === "below" ? `< ${p.low}` : `> ${p.high}`}${p.entered ? ", entrando hoje" : ""}`;
    case "rs": return `RS 21d ${r.rs21 == null ? "—" : `${r.rs21 >= 0 ? "+" : ""}${n2(r.rs21, 1)} pp`} · pede > ${p.min} pp`;
    case "gap": return `gap ${pct(r.gap)} · pede ${p.dir === "up" ? "≥ +" : p.dir === "down" ? "≤ −" : "|gap| ≥ "}${p.pct}%`;
    case "range": { const mx = (r as any)[`maxC${p.n}`], mn = (r as any)[`minC${p.n}`]; return `fech. ${n2(r.price)} · máx. ${p.n} fech. ${n2(mx)} · mín. ${n2(mn)}`; }
    case "streak": return `${p.dir === "up" ? r.upStreak ?? 0 : r.downStreak ?? 0} fech. seguidos em ${p.dir === "up" ? "alta" : "baixa"} · pede ${p.n}+`;
    case "agulhada": {
      if (!r.cl?.length) return "sem fechamentos";
      const q = normParams(p), s = agulhadaSeries(r.cl, q), i = r.cl.length - 1;
      return `distCurta ${s.dC[i] == null ? "—" : n2(s.dC[i]! * 100) + "%"} · distLonga ${s.dL[i] == null ? "—" : n2(s.dL[i]! * 100) + "%"} · alpha ${String(q.alpha).replace(".", ",")}% · ${s.side[i] > 0 ? "curta ≥ longa (compra)" : s.side[i] < 0 ? "curta < longa (venda)" : "sem convergência hoje"}`;
    }
    case "trix": return `TRIX ${n2(r.trix, 3)} · sinal ${n2(r.trixSig, 3)} · banda ±${n2(r.trixBand, 3)} · ${r.trixSide === 1 ? "compra ▲" : r.trixSide === -1 ? "venda ▼" : "sem sinal hoje"}`;
    default: return "";
  }
}

export function explain(screen: Screen, r: Row): ExplainStep[] {
  const s = migrateScreen(screen);
  const byId = new Map(s.blocks.map((b) => [b.id, b]));
  const out = new Map<string, boolean>(); // o ativo sai do nó?
  const steps: ExplainStep[] = [];
  for (const id of topo(s).order) {
    const b = byId.get(id)!;
    const ins = inputsOf(s, id).filter((i) => out.has(i)).map((i) => out.get(i)!);
    let reached: boolean;
    if (b.type === "universe") reached = true;
    else if (!ins.length) reached = false;
    else if (b.type === "and") reached = ins.every(Boolean);
    else reached = ins.some(Boolean);
    if (b.type !== "universe" && !inputsOf(s, id).length) continue; // nó solto: não participa
    let pass = reached, value = "";
    if (isFilter(b.type)) { const ok = filterPass(b, r); pass = reached && ok; value = valueText(b, r); }
    else if (isSignal(b.type)) { const ok = signalHit(b, r); pass = reached && (!b.enabled || ok); value = valueText(b, r) + (b.enabled ? "" : " (bloco desligado: deixa passar)"); }
    else if (isLogic(b.type)) value = `${ins.filter(Boolean).length} de ${ins.length} entrada(s) com o ativo`;
    else if (b.type === "result") value = pass ? "chega ao Resultado" : "não chega ao Resultado";
    out.set(id, pass);
    steps.push({ block: b, label: DEFS[b.type].label, reached, pass, value, off: !b.enabled });
  }
  return steps;
}

/** Linhas curtas para RSS/tooltip: só os sinais e filtros que o ativo passou (sem universo/lógica). */
export function whyLines(screen: Screen, r: Row): string[] {
  return explain(screen, r).filter((x) => x.pass && x.block.enabled && (isSignal(x.block.type) || (isFilter(x.block.type) && x.block.type !== "universe"))).map((x) => `${x.label}: ${x.value}`);
}
