// Tela como grafo (DAG): avaliação topológica, validação, conexões válidas, migração v1 → v2 e layout automático.
import { Block, BlockType, DEFS, Evaluated, GEdge, Row, Screen, filterPass, isFilter, isLogic, isSignal, makeBlock, newId, signalHit } from "./engine";

export interface Problem { nodeId: string | null; kind: "no-input" | "logic-inputs" | "no-output" | "no-result" | "cycle"; msg: string }

/** Quantas entradas cada tipo aceita (Infinity para lógica). */
export const maxInputs = (t: BlockType) => (t === "universe" ? 0 : isLogic(t) ? Infinity : 1);
export const hasOutput = (t: BlockType) => t !== "result";
export const MIN_LOGIC_INPUTS = 2;

export const inputsOf = (s: Screen, id: string) => s.edges.filter((e) => e.target === id).map((e) => e.source);
export const outputsOf = (s: Screen, id: string) => s.edges.filter((e) => e.source === id).map((e) => e.target);

/** Ordem topológica (Kahn). Nós em ciclo ficam de fora de `order` e aparecem em `cyclic`. */
export function topo(s: Screen): { order: string[]; cyclic: string[] } {
  const ids = s.blocks.map((b) => b.id), deg = new Map(ids.map((i) => [i, 0]));
  for (const e of s.edges) if (deg.has(e.target) && deg.has(e.source)) deg.set(e.target, deg.get(e.target)! + 1);
  const q = ids.filter((i) => deg.get(i) === 0), order: string[] = [];
  while (q.length) {
    const n = q.shift()!; order.push(n);
    for (const e of s.edges) if (e.source === n && deg.has(e.target)) { deg.set(e.target, deg.get(e.target)! - 1); if (deg.get(e.target) === 0) q.push(e.target); }
  }
  return { order, cyclic: ids.filter((i) => !order.includes(i)) };
}

const reaches = (s: Screen, from: string, to: string) => {
  const seen = new Set<string>(), st = [from];
  while (st.length) { const n = st.pop()!; if (n === to) return true; if (seen.has(n)) continue; seen.add(n); st.push(...outputsOf(s, n)); }
  return false;
};

/** Regra de conexão: sem entrada no Universo, sem saída do Resultado, sem ciclos, sem duplicatas, respeita o limite de entradas. */
export function canConnect(s: Screen, source: string, target: string): boolean {
  const a = s.blocks.find((b) => b.id === source), b = s.blocks.find((x) => x.id === target);
  if (!a || !b || source === target) return false;
  if (!hasOutput(a.type) || maxInputs(b.type) === 0) return false;
  if (s.edges.some((e) => e.source === source && e.target === target)) return false;
  if (inputsOf(s, target).length >= maxInputs(b.type)) return false;
  return !reaches(s, target, source);
}

export function connect(s: Screen, source: string, target: string): Screen {
  if (!canConnect(s, source, target)) return s;
  return { ...s, edges: [...s.edges, { id: newId("e"), source, target }] };
}

const label = (b: Block) => DEFS[b.type].short;

export function validate(s: Screen): Problem[] {
  const ps: Problem[] = [];
  const { cyclic } = topo(s);
  for (const id of cyclic) ps.push({ nodeId: id, kind: "cycle", msg: `${label(s.blocks.find((b) => b.id === id)!)} está em um ciclo` });
  for (const b of s.blocks) {
    const n = inputsOf(s, b.id).length;
    if (b.type === "universe") continue;
    if (isLogic(b.type)) {
      if (n < MIN_LOGIC_INPUTS) ps.push({ nodeId: b.id, kind: "logic-inputs", msg: `${label(b)} com ${n} de ${MIN_LOGIC_INPUTS} entradas` });
      if (!outputsOf(s, b.id).length) ps.push({ nodeId: b.id, kind: "no-output", msg: `${label(b)} sem saída` });
    }
    else if (n === 0) ps.push({ nodeId: b.id, kind: "no-input", msg: `${label(b)} sem entrada` });
  }
  if (!s.blocks.some((b) => b.type === "result")) ps.push({ nodeId: null, kind: "no-result", msg: "Falta o nó Resultado" });
  return ps;
}

/** Avalia o DAG. Universo gera o conjunto; filtro/sinal aplicam-se à entrada (desligados = passam tudo);
 *  E = interseção, OU = união das entradas calculáveis. Nós sem entrada ficam sem valor (null), o resto é calculado. */
export function evaluateGraph(s: Screen, rows: Row[]): Evaluated {
  const sets = new Map<string, Row[] | null>(), perIn = new Map<string, number | null>(), perBlock = new Map<string, number>();
  const byId = new Map(s.blocks.map((b) => [b.id, b]));
  const { order } = topo(s);
  for (const id of order) {
    const b = byId.get(id)!;
    const ins = inputsOf(s, id).map((i) => sets.get(i)).filter((x): x is Row[] => Array.isArray(x));
    let input: Row[] | null;
    if (b.type === "universe") input = rows;
    else if (!ins.length) input = null;
    else if (b.type === "and") { const keys = ins.map((r) => new Set(r.map((x) => x.t))); input = ins[0].filter((r) => keys.every((k) => k.has(r.t))); }
    else { const m = new Map<string, Row>(); for (const set of ins) for (const r of set) m.set(r.t, r); input = [...m.values()]; }
    perIn.set(id, input ? input.length : null);
    let out: Row[] | null = input;
    if (input && (isFilter(b.type))) out = input.filter((r) => filterPass(b, r));
    else if (input && isSignal(b.type)) out = b.enabled ? input.filter((r) => signalHit(b, r)) : input;
    sets.set(id, out);
    if (out) perBlock.set(id, isSignal(b.type) && !b.enabled ? input!.filter((r) => signalHit(b, r)).length : out.length);
  }
  const problems = validate(s);
  const res = s.blocks.find((b) => b.type === "result");
  const resSet = res ? sets.get(res.id) ?? null : null;
  const complete = problems.length === 0 && !!resSet;
  const results = complete ? resSet! : [];
  // "após filtros": o que chega ao primeiro nível de sinais/lógica (união das saídas dos filtros que alimentam não-filtros)
  const fm = new Map<string, Row>();
  for (const e of s.edges) { const a = byId.get(e.source), t = byId.get(e.target); if (a && t && isFilter(a.type) && !isFilter(t.type)) for (const r of sets.get(a.id) ?? []) fm.set(r.t, r); }
  const filtered = fm.size || !complete ? [...fm.values()] : results;
  const hits = new Map<string, Block[]>();
  const inRes = new Set(results.map((r) => r.t));
  for (const b of s.blocks) if (isSignal(b.type) && b.enabled) for (const r of sets.get(b.id) ?? []) if (inRes.has(r.t)) { const a = hits.get(r.t) || []; a.push(b); hits.set(r.t, a); }
  return { filtered, results, hits, perBlock, perIn, problems, complete };
}

/** Profundidade (maior caminho a partir de uma fonte) — usada no layout e na animação de execução. */
export function depths(s: Screen): Map<string, number> {
  const d = new Map<string, number>();
  for (const id of topo(s).order) { const ins = inputsOf(s, id); d.set(id, ins.length ? Math.max(...ins.map((i) => (d.get(i) ?? 0) + 1)) : 0); }
  for (const b of s.blocks) if (!d.has(b.id)) d.set(b.id, 0);
  return d;
}

const COL = 300, ROW = 170;
/** Preenche `pos` dos nós que não têm posição, em colunas por profundidade. */
export function autoLayout(s: Screen): Screen {
  if (s.blocks.every((b) => b.pos)) return s;
  const d = depths(s), cols = new Map<number, Block[]>();
  for (const b of s.blocks) { const k = d.get(b.id)!; (cols.get(k) ?? cols.set(k, []).get(k)!).push(b); }
  const maxN = Math.max(...[...cols.values()].map((c) => c.length));
  const pos = new Map<string, { x: number; y: number }>();
  for (const [k, c] of cols) c.forEach((b, i) => pos.set(b.id, { x: k * COL, y: (i - (c.length - 1) / 2) * ROW + ((maxN - 1) / 2) * ROW }));
  return { ...s, blocks: s.blocks.map((b) => (b.pos ? b : { ...b, pos: pos.get(b.id) })) };
}

/** Converte telas v1 (lista linear + combine E/OU) no grafo equivalente; telas que já têm `edges` passam direto. */
export function migrateScreen(s: Screen): Screen {
  if (Array.isArray(s.edges) && s.combine === undefined) return s;
  const blocks: Block[] = s.blocks.filter((b) => !isLogic(b.type) && b.type !== "result").map((b) => ({ ...b, pos: undefined }));
  const edges: GEdge[] = [];
  const E = (a: string, b: string) => edges.push({ id: newId("e"), source: a, target: b });
  const filters = blocks.filter((b) => isFilter(b.type));
  // v1: todos os filtros (inclusive vários Universos) em série; universos extras viram filtros de tipo.
  const uni = filters.find((b) => b.type === "universe") ?? (() => { const u = makeBlock("universe"); blocks.unshift(u); filters.unshift(u); return u; })();
  const chain = [uni, ...filters.filter((b) => b !== uni)];
  for (let i = 1; i < chain.length; i++) E(chain[i - 1].id, chain[i].id);
  const last = chain[chain.length - 1].id;
  const sigs = blocks.filter((b) => isSignal(b.type)), on = sigs.filter((b) => b.enabled);
  const res = makeBlock("result");
  for (const g of sigs) E(last, g.id);
  if (!on.length) E(last, res.id);
  else if (on.length === 1) E(on[0].id, res.id);
  else { const lg = makeBlock(s.combine === "or" ? "or" : "and"); for (const g of on) E(g.id, lg.id); E(lg.id, res.id); blocks.push(lg); }
  blocks.push(res);
  const { combine: _c, ...rest } = s;
  return autoLayout({ ...rest, blocks, edges });
}

/** Grafo novo mínimo: Universo → Resultado. */
export function blankScreen(name = "Novo grafo"): Screen {
  const u = makeBlock("universe"), r = makeBlock("result");
  return autoLayout({ name, blocks: [u, r], edges: [{ id: newId("e"), source: u.id, target: r.id }] });
}

export function removeNode(s: Screen, id: string): Screen {
  return { ...s, blocks: s.blocks.filter((b) => b.id !== id), edges: s.edges.filter((e) => e.source !== id && e.target !== id) };
}
