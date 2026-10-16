// Telas compartilháveis: Screen -> JSON compacto -> deflate-raw -> base64url, com versão.
import { Block, BlockType, DEFS, Screen, makeBlock } from "./engine";

export const SHARE_VERSION = 1;
type Packed = { v: number; n: string; c: "a" | "o"; b: [BlockType, 0 | 1, Record<string, any>, [number, number]?][] };

export function pack(s: Screen): Packed {
  return {
    v: SHARE_VERSION, n: s.name, c: s.combine === "or" ? "o" : "a",
    b: s.blocks.map((x) => {
      const def = DEFS[x.type].defaults, p: Record<string, any> = {};
      for (const [k, val] of Object.entries(x.params)) if (JSON.stringify(def[k]) !== JSON.stringify(val)) p[k] = val;
      const e: Packed["b"][number] = [x.type, x.enabled ? 1 : 0, p];
      if (x.pos) e.push([Math.round(x.pos.x), Math.round(x.pos.y)]);
      return e;
    }),
  };
}

export function unpack(o: unknown): Screen | null {
  const p = o as Packed;
  if (!p || typeof p !== "object" || p.v !== SHARE_VERSION || !Array.isArray(p.b)) return null;
  const blocks: Block[] = [];
  for (const e of p.b) {
    if (!Array.isArray(e) || !(e[0] in DEFS)) continue; // tipo desconhecido: ignora
    const params = e[2] && typeof e[2] === "object" ? e[2] : {};
    const b = makeBlock(e[0], !!e[1], params);
    if (Array.isArray(e[3]) && e[3].every(Number.isFinite)) b.pos = { x: e[3][0], y: e[3][1] };
    blocks.push(b);
  }
  if (!blocks.some((b) => b.type === "universe")) blocks.unshift(makeBlock("universe"));
  return { name: typeof p.n === "string" ? p.n.slice(0, 80) : "Tela compartilhada", combine: p.c === "o" ? "or" : "and", blocks };
}

const b64u = (u: Uint8Array) => { let s = ""; for (const c of u) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64u = (s: string) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(t)).arrayBuffer());
}
const hasCS = () => typeof CompressionStream !== "undefined";

// Formato do hash: "#t=1z.<base64url deflate>" ou "#t=1j.<base64url json>" (sem compressão).
export async function encodeScreen(s: Screen): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify(pack(s)));
  if (hasCS()) return `${SHARE_VERSION}z.` + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
  return `${SHARE_VERSION}j.` + b64u(raw);
}

export async function decodeScreen(token: string): Promise<Screen | null> {
  try {
    const m = /^(\d+)([zj])\.([A-Za-z0-9_-]+)$/.exec(token.trim());
    if (!m || Number(m[1]) !== SHARE_VERSION) return null;
    let bytes = unb64u(m[3]);
    if (m[2] === "z") { if (!hasCS()) return null; bytes = await pipe(bytes, new DecompressionStream("deflate-raw")); }
    return unpack(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { return null; }
}

export const tokenFromHash = (hash: string) => new URLSearchParams(hash.replace(/^#/, "")).get("t");
