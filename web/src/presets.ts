import { BlockType, Screen, makeBlock } from "./engine";

export interface Preset { id: string; name: string; desc: string; build: (liqMin: number) => Screen }
const base = (liq: number, kinds = ["acao", "bdr"]) => [makeBlock("universe", true, { kinds }), makeBlock("liquidity", true, { min: liq }), makeBlock("minPrice", true, { min: 1 })];
const scr = (name: string, combine: "and" | "or", blocks: ReturnType<typeof makeBlock>[]): Screen => ({ name, combine, blocks, builtin: true });
const sig = (t: BlockType, p?: Record<string, any>) => makeBlock(t, true, p);

export const PRESETS: Preset[] = [
  { id: "max52", name: "Máx. 52s + liq. R$ 5 mi", desc: "Ativos líquidos que fecham acima da máxima das últimas 52 semanas (252 pregões). Rompimentos de máxima costumam ser estudados como sinal de tendência de alta.",
    build: (l) => scr("Máx. 52s + liq. R$ 5 mi", "and", [...base(l), sig("high52")]) },
  { id: "momentum", name: "Momentum", desc: "Combina três ideias: retorno de 21 dias acima do Ibovespa (força relativa), preço acima da média de 200 dias e volume ao menos 2× a média de 21 dias, sinal de participação acima do normal.",
    build: (l) => scr("Momentum", "and", [...base(l), makeBlock("sma200", true, { side: "above" }), sig("rs", { min: 0 }), sig("volume", { mult: 2 })]) },
  { id: "rsi30", name: "Reversão (RSI<30)", desc: "O RSI(14) mede a velocidade das altas e baixas recentes numa escala de 0 a 100. Abaixo de 30 é chamado de sobrevenda, região onde alguns analistas procuram possíveis repiques.",
    build: (l) => scr("Reversão (RSI<30)", "and", [...base(l), sig("rsi", { zone: "below", low: 30 })]) },
  { id: "golden", name: "Golden cross recente", desc: "A média de 50 dias cruzou para cima a de 200 dias no último pregão. É um indicador clássico, porém atrasado: confirma tendências que já começaram.",
    build: (l) => scr("Golden cross recente", "and", [...base(l), sig("smaCross", { dir: "golden" })]) },
  { id: "fii", name: "FIIs fortes vs IFIX", desc: "Fundos imobiliários líquidos cujo retorno em 21 dias supera o do IFIX (aproximado pelo ETF XFIX11) e que estão acima da média de 200 dias.",
    build: (l) => scr("FIIs fortes vs IFIX", "and", [...base(Math.min(l, 1_000_000), ["fii"]), makeBlock("sma200", true, { side: "above" }), sig("rs", { min: 0 })]) },
  { id: "gap", name: "Gap de alta com volume", desc: "Abertura pelo menos 2% acima do fechamento anterior, com volume 2× a média. Gaps com volume indicam que uma notícia ou fluxo moveu o preço antes do pregão.",
    build: (l) => scr("Gap de alta com volume", "and", [...base(l), sig("gap", { pct: 2, dir: "up" }), sig("volume", { mult: 2 })]) },
  { id: "range20", name: "Rompimento 20 dias", desc: "Preço acima do maior fechamento dos últimos 20 pregões. É a versão de curto prazo do rompimento de máxima, usada em sistemas de tendência como os de Donchian.",
    build: (l) => scr("Rompimento 20 dias", "and", [...base(l), sig("range", { n: 20, dir: "up" })]) },
];
