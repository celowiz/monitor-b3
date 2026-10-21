// Gera data/summary.json (ver src/summary.ts). Rodar dentro de web/ depois de scripts/build_data.py:
//   npx vite-node scripts/summary.ts -- --data public/data
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Latest } from "../src/engine";
import { marketSummary } from "../src/summary";

const arg = (k: string, d: string) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = resolve(arg("data", "public/data"));
const read = (f: string): Latest | null => { try { return JSON.parse(readFileSync(join(DATA, f), "utf8")) as Latest; } catch { return null; } };

const br = read("latest_br.json");
if (!br) { console.error("summary: sem latest_br.json em", DATA); process.exit(1); }
const s = marketSummary(br, read("latest_us.json"));
const out = JSON.stringify(s);
writeFileSync(join(DATA, "summary.json"), out);
console.log(`summary.json: ${out.length} bytes · ${s.as_of} · ${s.breadth.adv}/${s.universe.n} em alta · ${s.signals.high52.n} máximas 52s · final=${s.final}`);
