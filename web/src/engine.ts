import { AGU_DEFAULTS, agulhadaHit } from "./agulhada";
import { evaluateGraph, migrateScreen, type Problem } from "./graph";
// Modelo de blocos + avaliação client-side das telas.
export type Kind = "acao" | "bdr" | "etf" | "fii";

export interface Row {
  t: string; name: string; kind: Kind; sector: string | null; subsector: string | null; logo: string | null;
  date: string; price: number; prevClose: number | null; open: number | null; chg: number | null;
  high52: number | null; low52: number | null; liq21: number | null; vol: number | null; volRatio: number | null;
  rsi: number | null; idx?: string[]; rsiPrev: number | null; rsBench?: "IBOV" | "IFIX" | "SPX"; ret21: number | null; rs21: number | null;
  sma20: number | null; sma50: number | null; sma200: number | null; sma50Prev: number | null; sma200Prev: number | null;
  gap?: number | null; maxC20?: number | null; minC20?: number | null; maxC60?: number | null; minC60?: number | null;
  upStreak?: number; downStreak?: number;
  /** últimos fechamentos (o último = price), para sinais com períodos editáveis (Agulhada) */
  cl?: number[];
  /** TRIX (regra fixa, calculado no job de dados com o histórico inteiro): +1 compra, −1 venda, 0 nada hoje */
  trixSide?: number; trix?: number | null; trixSig?: number | null; trixBand?: number | null;
}

export type Market = "br" | "us";
// Contexto do mercado ativo (moeda, índice, opções do filtro de índice). Ajustado pelo App ao carregar os dados.
/** Watchlist do navegador (estrelas), por mercado. Ajustada pelo App; vazia fora do navegador (alertas/backtest no Actions). */
export const WATCH = { set: new Set<string>() };
export function setWatchContext(tickers: Iterable<string>) { WATCH.set = new Set(tickers); }
export const MKT = { market: "br" as Market, cur: "R$", bench: "Ibov", indexOptions: [["IBOV", "Ibovespa"], ["IFIX", "IFIX"], ["SMLL", "Small Caps"]] as [string, string][] };
export function setMarketContext(m: Market) {
  MKT.market = m;
  MKT.cur = m === "us" ? "US$" : "R$";
  MKT.bench = m === "us" ? "S&P 500" : "Ibov";
  DEFS.rs.short = m === "us" ? "RS vs S&P" : "RS vs Ibov";
  MKT.indexOptions = m === "us" ? [["SP500", "S&P 500"]] : [["IBOV", "Ibovespa"], ["IFIX", "IFIX"], ["SMLL", "Small Caps"]];
}
export interface HistStat { n: number; mean?: number | null; median?: number | null; hit?: number | null; exMean?: number | null; exHit?: number | null }
export interface SignalHistory { window: number; horizons: number[]; signals: Record<string, { events: number; tickers: number; h: Record<string, HistStat> }> }

export interface Latest {
  market?: Market; currency?: string; history?: SignalHistory;
  /** correções da série de preços (scripts/adjust.py): ticker → eventos corrigidos / quebras */
  adjustments?: { corrected: Record<string, { date: string; kind: string; jump: number; factor: number | null; note: string }[]>; b3Issuers?: number };
  generatedAt: string; dataDate: string | null; delayNote: string; universeCount: number;
  failedTickers: string[]; bdrAllowlist: string[]; benchmark: { ret21: number | null; price: number | null; ifixProxy?: string; ifixRet21?: number | null };
  indexes?: Record<string, { date: string | null; count: number }>; defaults: { liq21MinBrl: number }; tickers: Row[];
}

export type BlockType =
  | "universe" | "sector" | "liquidity" | "minPrice" | "chgRange" | "blocklist" | "sma200" | "index" | "watchlist"
  | "high52" | "low52" | "smaCross" | "volume" | "rsi" | "rs" | "gap" | "range" | "streak" | "agulhada" | "trix"
  | "and" | "or" | "result";

export interface Block {
  id: string; type: BlockType; enabled: boolean; params: Record<string, any>;
  pos?: { x: number; y: number };
}
export interface GEdge { id: string; source: string; target: string }
/** Tela = grafo: nós (blocks) + arestas explícitas. `combine` só existe em telas antigas (v1) e é convertido por migrateScreen. */
export interface Screen { name: string; blocks: Block[]; edges: GEdge[]; combine?: "and" | "or"; builtin?: boolean }

export const FILTER_TYPES: BlockType[] = ["universe", "watchlist", "sector", "liquidity", "minPrice", "chgRange", "blocklist", "sma200", "index"];
export const SIGNAL_TYPES: BlockType[] = ["high52", "low52", "smaCross", "volume", "rsi", "rs", "gap", "range", "streak", "agulhada", "trix"];
export const LOGIC_TYPES: BlockType[] = ["and", "or"];
export const isFilter = (t: BlockType) => FILTER_TYPES.includes(t);
export const isSignal = (t: BlockType) => SIGNAL_TYPES.includes(t);
export const isLogic = (t: BlockType) => t === "and" || t === "or";

export const KIND_LABEL: Record<Kind, string> = { acao: "Ação", bdr: "BDR", etf: "ETF", fii: "FII" };

export interface BlockDef { label: string; icon: string; group: "Entrada" | "Filtros" | "Sinais" | "Lógica" | "Saída"; short: string; defaults: Record<string, any> }
export const DEFS: Record<BlockType, BlockDef> = {
  universe: { label: "Universo", icon: "◎", group: "Entrada", short: "Universo", defaults: { kinds: ["acao", "bdr"] } },
  sector: { label: "Setor / subsetor", icon: "▦", group: "Filtros", short: "Setor", defaults: { sectors: [], subsectors: [] } },
  liquidity: { label: "Liquidez 21d", icon: "R$", group: "Filtros", short: "Liquidez 21d", defaults: { min: 5_000_000 } },
  minPrice: { label: "Preço mínimo", icon: "$", group: "Filtros", short: "Preço mínimo", defaults: { min: 1 } },
  chgRange: { label: "Variação no dia", icon: "±", group: "Filtros", short: "Var. dia %", defaults: { min: -100, max: 100 } },
  blocklist: { label: "Lista de exclusão", icon: "⊘", group: "Filtros", short: "Exclusão", defaults: { tickers: "" } },
  sma200: { label: "Posição vs SMA200", icon: "∼", group: "Filtros", short: "vs SMA200", defaults: { side: "above" } },
  index: { label: "Índice", icon: "◇", group: "Filtros", short: "Índice", defaults: { indices: ["IBOV"] } },
  watchlist: { label: "Minha lista", icon: "★", group: "Filtros", short: "Minha lista", defaults: { mode: "live", tickers: "" } },
  high52: { label: "Rompimento máx. 52s", icon: "↑", group: "Sinais", short: "Máx. 52s", defaults: {} },
  low52: { label: "Rompimento mín. 52s", icon: "↓", group: "Sinais", short: "Mín. 52s", defaults: {} },
  smaCross: { label: "Cruzamento SMA 50/200", icon: "×", group: "Sinais", short: "SMA 50/200", defaults: { dir: "golden" } },
  volume: { label: "Volume anormal", icon: "▁", group: "Sinais", short: "Volume 2×", defaults: { mult: 2 } },
  rsi: { label: "RSI(14)", icon: "∿", group: "Sinais", short: "RSI(14)", defaults: { zone: "below", low: 30, high: 70, entered: false } },
  rs: { label: "Força rel. vs índice", icon: "↗", group: "Sinais", short: "RS vs Ibov", defaults: { min: 0 } },
  gap: { label: "Gap de abertura", icon: "⇕", group: "Sinais", short: "Gap", defaults: { pct: 2, dir: "both" } },
  range: { label: "Rompimento de faixa", icon: "⇥", group: "Sinais", short: "Faixa N d", defaults: { n: 20, dir: "up" } },
  and: { label: "E (todos)", icon: "E", group: "Lógica", short: "E", defaults: {} },
  or: { label: "OU (qualquer)", icon: "OU", group: "Lógica", short: "OU", defaults: {} },
  result: { label: "Resultado", icon: "●", group: "Saída", short: "Resultado", defaults: {} },
  agulhada: { label: "Agulhada do Didi", icon: "⋈", group: "Sinais", short: "Agulhada", defaults: { ...AGU_DEFAULTS } },
  trix: { label: "TRIX", icon: "≋", group: "Sinais", short: "TRIX", defaults: {} },
  streak: { label: "Sequência de altas/baixas", icon: "⋰", group: "Sinais", short: "Sequência", defaults: { n: 3, dir: "up" } },
};

let seq = 0;
export const newId = (t: string) => `${t}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
export const makeBlock = (type: BlockType, enabled = true, params?: Record<string, any>): Block => ({
  id: newId(type), type, enabled, params: { ...DEFS[type].defaults, ...(params || {}) },
});

export function defaultScreen(liqMin = 5_000_000): Screen {
  return migrateScreen({
    name: "Máx. 52s + liq. R$ 5 mi", combine: "and", builtin: true,
    blocks: [
      makeBlock("universe"), makeBlock("sector"), makeBlock("liquidity", true, { min: liqMin }), makeBlock("minPrice", true, { min: 1 }),
      // Grafo enxuto: os outros sinais ficam na paleta (antes eram 8 blocos desligados ocupando o canvas).
      makeBlock("high52", true),
    ],
    edges: [],
  });
}

export function filterPass(b: Block, r: Row): boolean {
  if (!b.enabled) return true;
  const p = b.params;
  switch (b.type) {
    case "universe": return (p.kinds as string[]).includes(r.kind);
    case "sector": return (!p.sectors?.length || p.sectors.includes(r.sector ?? "Sem setor")) &&
      (!p.subsectors?.length || p.subsectors.includes(r.subsector ?? "Sem subsetor"));
    case "chgRange": return r.chg != null && r.chg * 100 >= Number(p.min) && r.chg * 100 <= Number(p.max);
    case "blocklist": return !parseList(p.tickers).includes(r.t);
    case "sma200": return r.sma200 != null && (p.side === "above" ? r.price > r.sma200 : r.price < r.sma200);
    case "index": return !p.indices?.length || (r.idx ?? []).some((i) => p.indices.includes(i));
    case "liquidity": return (r.liq21 ?? 0) >= Number(p.min || 0);
    case "minPrice": return r.price >= Number(p.min || 0);
    case "watchlist": return p.mode === "fixed" ? parseList(p.tickers).includes(r.t) : WATCH.set.has(r.t);
  }
  return true;
}

export function signalHit(b: Block, r: Row): boolean {
  const p = b.params;
  switch (b.type) {
    case "high52": return r.high52 != null && r.price > r.high52;
    case "low52": return r.low52 != null && r.price < r.low52;
    case "smaCross": {
      if (r.sma50 == null || r.sma200 == null || r.sma50Prev == null || r.sma200Prev == null) return false;
      const golden = r.sma50 > r.sma200 && r.sma50Prev <= r.sma200Prev;
      const death = r.sma50 < r.sma200 && r.sma50Prev >= r.sma200Prev;
      return p.dir === "golden" ? golden : p.dir === "death" ? death : golden || death;
    }
    case "volume": return r.volRatio != null && r.volRatio >= Number(p.mult);
    case "rsi": {
      if (r.rsi == null) return false;
      const lo = Number(p.low), hi = Number(p.high);
      const inZone = (v: number) => (p.zone === "below" ? v < lo : v > hi);
      if (!inZone(r.rsi)) return false;
      return p.entered ? r.rsiPrev != null && !inZone(r.rsiPrev) : true;
    }
    case "rs": return r.rs21 != null && r.rs21 > Number(p.min);
    case "gap": {
      if (r.gap == null) return false;
      const g = r.gap * 100, x = Number(p.pct);
      return p.dir === "up" ? g >= x : p.dir === "down" ? g <= -x : Math.abs(g) >= x;
    }
    case "range": {
      const mx = (r as any)[`maxC${p.n}`] as number | null, mn = (r as any)[`minC${p.n}`] as number | null;
      const upHit = mx != null && r.price > mx, dnHit = mn != null && r.price < mn;
      return p.dir === "up" ? upHit : p.dir === "down" ? dnHit : upHit || dnHit;
    }
    case "agulhada": return agulhadaHit(r.cl, p) != null;
    case "trix": return r.trixSide === 1 || r.trixSide === -1;
    case "streak": return (p.dir === "up" ? r.upStreak ?? 0 : r.downStreak ?? 0) >= Number(p.n);
  }
  return false;
}

export function blockSummary(b: Block): string {
  const p = b.params;
  switch (b.type) {
    case "universe": return (p.kinds as Kind[]).map((k) => KIND_LABEL[k]).join(" · ") || "nenhum tipo";
    case "sector": return [p.sectors?.length ? `${p.sectors.length} setor(es)` : "todos os setores", p.subsectors?.length ? `${p.subsectors.length} subsetor(es)` : ""].filter(Boolean).join(" · ");
    case "chgRange": return `${p.min}% a ${p.max}% no dia`;
    case "blocklist": { const n = parseList(p.tickers).length; return n ? `exclui ${n} ticker(s)` : "nenhum excluído"; }
    case "sma200": return `preço ${p.side === "above" ? "acima" : "abaixo"} da SMA200`;
    case "index": return p.indices?.length ? `membro de ${p.indices.join(" ou ")}` : "qualquer";
    case "liquidity": return `≥ ${fmtBrl(p.min)}`;
    case "minPrice": return `≥ ${MKT.cur} ${Number(p.min).toLocaleString("pt-BR")}`;
    case "watchlist": return p.mode === "fixed" ? `lista fixa · ${parseList(p.tickers).length} ativo(s)` : `★ estrelas deste navegador · ${WATCH.set.size} ativo(s)`;
    case "high52": return "preço > máx. 252 pregões (ex-hoje)";
    case "low52": return "preço < mín. 252 pregões (ex-hoje)";
    case "smaCross": return { golden: "golden: 50 cruza 200 ↑ hoje", death: "death: 50 cruza 200 ↓ hoje", any: "qualquer cruzamento hoje" }[p.dir as string] ?? "";
    case "volume": return `vol. hoje ≥ ${p.mult}× média 21d`;
    case "rsi": return `${p.zone === "below" ? `< ${p.low}` : `> ${p.high}`} Wilder${p.entered ? " · entrou hoje" : ""}`;
    case "gap": return `|abertura − fech. ontem| ≥ ${p.pct}% · ${({ up: "alta", down: "baixa", both: "ambos" } as any)[p.dir]}`;
    case "range": return p.dir === "up" ? `fech. > máx. ${p.n} fech. (ex-hoje)` : p.dir === "down" ? `fech. < mín. ${p.n} fech. (ex-hoje)` : `rompe máx./mín. ${p.n} fech.`;
    case "streak": return `${p.n}+ fech. seguidos em ${p.dir === "up" ? "alta" : "baixa"}`;
    case "agulhada": {
      const d = ({ buy: "compra", sell: "venda", both: "compra ou venda" } as any)[p.dir];
      const w = Number(p.window) > 1 ? `últimos ${p.window} preg.` : "hoje";
      return `SMA ${p.curta}/${p.media}/${p.longa} · conv. < ${String(p.alpha).replace(".", ",")}% · ${d} · ${w}${p.fresh ? " · 1º dia" : ""}${p.confirm ? ` · abertura ≤ ${p.confirmN}d` : ""}`;
    }
    case "trix": return "TRIX(9) cruza sinal EMA 9 fora da banda 60d · compra ou venda · hoje";
    case "and": return "todas as entradas (interseção)";
    case "or": return "qualquer entrada (união)";
    case "result": return "ativos que chegam aqui";
    case "rs": return MKT.market === "us" ? `ret. 21d − S&P 500 > ${p.min} pp` : `ret. 21d − índice > ${p.min} pp (Ibov; FII: IFIX)`;
  }
}

/** Rótulo curto do sinal para um ativo, com o lado quando o sinal tem lado (TRIX ▲/▼). */
export function hitLabel(b: Block, r?: Row): string {
  if (b.type === "trix" && r?.trixSide) return `TRIX ${r.trixSide > 0 ? "▲" : "▼"}`;
  return DEFS[b.type].short;
}

export interface Evaluated {
  filtered: Row[]; results: Row[]; hits: Map<string, Block[]>; perBlock: Map<string, number>;
  /** tamanho do conjunto que entra em cada nó (null = sem entrada calculável) */
  perIn: Map<string, number | null>; problems: Problem[]; complete: boolean;
}

export function evaluate(screen: Screen, rows: Row[]): Evaluated { return evaluateGraph(migrateScreen(screen), rows); }

export function fmtBrl(v: number | null | undefined): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const c = MKT.cur;
  if (a >= 1e9) return `${c} ${(v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
  if (a >= 1e6) return `${c} ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${c} ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return `${c} ${v.toLocaleString("pt-BR")}`;
}
export const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtPct = (v: number | null | undefined, d = 1) =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%`;


export const parseList = (s: string) => (s || "").toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
