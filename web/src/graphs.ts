// "Meus grafos": CRUD em localStorage. Migra as telas salvas da versão antiga (monitorb3.screens.v1).
import { Block, BlockType, DEFS, Screen, newId } from "./engine";
import { autoLayout, connect, migrateScreen } from "./graph";

export interface SavedGraph { id: string; name: string; updated: number; screen: Screen }
const KEY = "monitorb3.graphs.v2", OLD = "monitorb3.screens.v1";

export function loadGraphs(): SavedGraph[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return (JSON.parse(raw) as SavedGraph[]).map((g) => ({ ...g, screen: migrateScreen(g.screen) }));
    const old = JSON.parse(localStorage.getItem(OLD) || "[]") as Screen[];
    const gs = old.map((s) => ({ id: newId("g"), name: s.name, updated: Date.now(), screen: { ...migrateScreen(s), builtin: false } }));
    if (gs.length) storeGraphs(gs);
    return gs;
  } catch { return []; }
}
export function storeGraphs(gs: SavedGraph[]) { try { localStorage.setItem(KEY, JSON.stringify(gs)); } catch { /* cota cheia ou modo privado */ } }

export const upsert = (gs: SavedGraph[], g: SavedGraph) => (gs.some((x) => x.id === g.id) ? gs.map((x) => (x.id === g.id ? g : x)) : [g, ...gs]);

export function exportJson(s: Screen): string {
  return JSON.stringify({ app: "monitor-b3", v: 2, screen: { name: s.name, blocks: s.blocks, edges: s.edges } }, null, 2);
}
/** Aceita o arquivo exportado (v2) ou uma tela antiga (lista + combine). */
export function importJson(text: string): Screen | null {
  try {
    const o = JSON.parse(text), s = o?.screen ?? o;
    if (!s || !Array.isArray(s.blocks)) return null;
    const name = String(s.name ?? "Importado").slice(0, 80);
    const blocks: Block[] = s.blocks.filter((b: any) => b && typeof b.id === "string" && b.type in DEFS).map((b: any) => ({
      id: b.id, type: b.type, enabled: b.enabled !== false, params: { ...DEFS[b.type as BlockType].defaults, ...(b.params || {}) },
      ...(b.pos && Number.isFinite(b.pos.x) && Number.isFinite(b.pos.y) ? { pos: { x: b.pos.x, y: b.pos.y } } : {}),
    }));
    if (!Array.isArray(s.edges)) return { ...migrateScreen({ name, blocks, edges: [], combine: s.combine === "or" ? "or" : "and" }), builtin: false };
    let g: Screen = { name, blocks, edges: [] };
    for (const e of s.edges) if (e && typeof e.source === "string") g = connect(g, e.source, e.target);
    return { ...autoLayout(g), builtin: false };
  } catch { return null; }
}
