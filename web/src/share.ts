// Telas compartilháveis: Screen -> JSON compacto -> deflate-raw -> base64url, com versão.
import { Block, BlockType, DEFS, Screen, makeBlock } from "./engine";
import { autoLayout, connect, migrateScreen } from "./graph";

export const SHARE_VERSION = 2;
type PB = [BlockType, 0 | 1, Record<string, any>, [number, number]?];
type PackedV1 = { v: 1; n: string; c: "a" | "o"; b: PB[] };
type PackedV2 = { v: 2; n: string; b: PB[]; e: [number, number][] };

const packBlock = (x: Block): PB => {
  const def = DEFS[x.type].defaults, p: Record<string, any> = {};
  for (const [k, val] of Object.entries(x.params)) if (JSON.stringify(def[k]) !== JSON.stringify(val)) p[k] = val;
  const e: PB = [x.type, x.enabled ? 1 : 0, p];
  if (x.pos) e.push([Math.round(x.pos.x), Math.round(x.pos.y)]);
  return e;
};
const unpackBlock = (e: unknown): Block | null => {
  if (!Array.isArray(e) || !(e[0] in DEFS)) return null; // tipo desconhecido: ignora
  const params = e[2] && typeof e[2] === "object" ? e[2] : {};
  const b = makeBlock(e[0], !!e[1], params);
  if (Array.isArray(e[3]) && e[3].length === 2 && e[3].every(Number.isFinite)) b.pos = { x: e[3][0], y: e[3][1] };
  return b;
};
const nameOf = (n: unknown) => (typeof n === "string" ? n.slice(0, 80) : "Tela compartilhada");

export function pack(s: Screen): PackedV2 {
  const idx = new Map(s.blocks.map((b, i) => [b.id, i]));
  return { v: 2, n: s.name, b: s.blocks.map(packBlock), e: s.edges.filter((e) => idx.has(e.source) && idx.has(e.target)).map((e) => [idx.get(e.source)!, idx.get(e.target)!]) };
}

export function unpack(o: unknown): Screen | null {
  const p = o as PackedV1 | PackedV2;
  if (!p || typeof p !== "object" || !Array.isArray(p.b)) return null;
  if (p.v === 1) {
    const blocks = p.b.map(unpackBlock).filter((b): b is Block => !!b);
    if (!blocks.some((b) => b.type === "universe")) blocks.unshift(makeBlock("universe"));
    return migrateScreen({ name: nameOf(p.n), combine: p.c === "o" ? "or" : "and", blocks, edges: [] });
  }
  if (p.v !== 2 || !Array.isArray(p.e)) return null;
  const all = p.b.map(unpackBlock), blocks = all.filter((b): b is Block => !!b);
  let s: Screen = { name: nameOf(p.n), blocks, edges: [] };
  for (const e of p.e) {
    if (!Array.isArray(e)) continue;
    const a = all[e[0]], b = all[e[1]];
    if (a && b) s = connect(s, a.id, b.id); // revalida: ignora arestas inválidas/ciclos
  }
  return autoLayout(s);
}

const b64u = (u: Uint8Array) => { let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s: string) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
}
const hasCS = () => typeof CompressionStream !== "undefined";

// Formato do hash: "#t=2z.<...>" (v2 = grafo). Links "1z." (v1, lista linear) ainda abrem, convertidos em grafo.
// "#t=1z.<base64url deflate>" ou "#t=1j.<base64url json>" (sem compressão).
export async function encodeScreen(s: Screen): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(pack(s)));
  if (hasCS()) return `${SHARE_VERSION}z.` + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
  return `${SHARE_VERSION}j.` + b64u(raw);
}

export async function decodeScreen(token: string): Promise<Screen | null> {
  try {
    const m = /^(\d+)([zj])\.([A-Za-z0-9_-]+)$/.exec(token.trim());
    if (!m || ![1, 2].includes(Number(m[1]))) return null;
    let bytes = unb64u(m[3]);
    if (m[2] === "z") { if (!hasCS()) return null; bytes = await pipe(bytes, new DecompressionStream("deflate-raw")); }
    return unpack(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}

export const tokenFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, "")).get("t");
