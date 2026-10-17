// Agulhada do Didi — fiel a cursor-agents/agulhada/indicators.py:
//   SMA curta/média/longa (3/8/20) do fechamento
//   distCurta = SMAc/SMAm − 1 · distLonga = SMAl/SMAm − 1
//   convergência ("agulhada") quando |distCurta|, |distLonga| e |distCurta − distLonga| < alpha
//   lado: SMAc ≥ SMAl → compra (+1); SMAc < SMAl → venda (−1)
// Extras opcionais (não existem no original): só o 1º dia da convergência e confirmação por abertura (leque).
// Função pura usada tanto na triagem (últimos fechamentos do latest.json) quanto no gráfico (candles de 1 ano).

export interface AguParams {
  dir: "buy" | "sell" | "both"; alpha: number; curta: number; media: number; longa: number;
  fresh: boolean; confirm: boolean; confirmN: number; window: number;
}
export const AGU_DEFAULTS: AguParams = { dir: "both", alpha: 1.5, curta: 3, media: 8, longa: 20, fresh: false, confirm: false, confirmN: 3, window: 1 };
/** Limites dos parâmetros editáveis; o latest.json traz AGU_CLOSES fechamentos por ativo, suficientes para o pior caso. */
export const AGU_LIMITS = { curta: [2, 10], media: [3, 30], longa: [5, 40], window: [1, 10], confirmN: [1, 10], alpha: [0.1, 10] } as const;
export const AGU_CLOSES = 62; // ≥ longa máx. + janela máx. + confirmN máx. + 2

export interface AguEvent { i: number; up: boolean; start: number; confirmed: boolean }
export interface AguSeries {
  sc: (number | null)[]; sm: (number | null)[]; sl: (number | null)[];
  dC: (number | null)[]; dL: (number | null)[]; conv: boolean[]; side: (0 | 1 | -1)[];
  /** 1º dia de cada convergência (marcadores ▲/▼) */
  starts: AguEvent[];
  /** eventos que contam como sinal com os parâmetros dados (fresh/confirm) */
  events: AguEvent[];
}

const clampInt = (v: unknown, [lo, hi]: readonly [number, number], d: number) => {
  const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
export function normParams(p: Partial<AguParams> = {}): AguParams {
  const q = { ...AGU_DEFAULTS, ...p };
  const a = Number(q.alpha);
  return {
    dir: q.dir === "buy" || q.dir === "sell" ? q.dir : "both",
    alpha: Number.isFinite(a) ? Math.min(AGU_LIMITS.alpha[1], Math.max(AGU_LIMITS.alpha[0], a)) : AGU_DEFAULTS.alpha,
    curta: clampInt(q.curta, AGU_LIMITS.curta, 3), media: clampInt(q.media, AGU_LIMITS.media, 8), longa: clampInt(q.longa, AGU_LIMITS.longa, 20),
    fresh: !!q.fresh, confirm: !!q.confirm, confirmN: clampInt(q.confirmN, AGU_LIMITS.confirmN, 3), window: clampInt(q.window, AGU_LIMITS.window, 1),
  };
}

function sma(c: number[], n: number): (number | null)[] {
  const out: (number | null)[] = Array(c.length).fill(null); let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

export function agulhadaSeries(c: number[], raw: Partial<AguParams> = {}): AguSeries {
  const p = normParams(raw), a = p.alpha / 100, n = c.length;
  const sc = sma(c, p.curta), sm = sma(c, p.media), sl = sma(c, p.longa);
  const dC: (number | null)[] = Array(n).fill(null), dL: (number | null)[] = Array(n).fill(null);
  const conv: boolean[] = Array(n).fill(false), side: (0 | 1 | -1)[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const x = sc[i], m = sm[i], y = sl[i];
    if (x == null || m == null || y == null || !m) continue;
    dC[i] = x / m - 1; dL[i] = y / m - 1;
    if (Math.abs(dC[i]!) < a && Math.abs(dL[i]!) < a && Math.abs(dC[i]! - dL[i]!) < a) { conv[i] = true; side[i] = x >= y ? 1 : -1; }
  }
  const starts: AguEvent[] = [];
  for (let i = 0; i < n; i++) if (conv[i] && (i === 0 || !conv[i - 1])) starts.push({ i, up: side[i] > 0, start: i, confirmed: false });
  let events: AguEvent[];
  if (p.confirm) {
    // abertura: quando a convergência termina, as médias precisam ficar ordenadas no lado do sinal
    // (compra: curta > média > longa; venda: curta < média < longa) em até N pregões após o último dia convergido.
    // Lado = o do último dia convergido. O evento é datado no dia da confirmação (sem olhar o futuro).
    events = [];
    for (const s of starts) {
      let end = s.i; while (end + 1 < n && conv[end + 1]) end++;
      const up = side[end] > 0;
      for (let j = end + 1; j <= Math.min(n - 1, end + p.confirmN); j++) {
        if (conv[j]) break; // nova convergência antes de abrir
        const x = sc[j]!, m = sm[j]!, y = sl[j]!;
        if (up ? x > m && m > y : x < m && m < y) { events.push({ i: j, up, start: s.i, confirmed: true }); break; }
      }
    }
  } else if (p.fresh) events = starts;
  else events = conv.flatMap((v, i) => (v ? [{ i, up: side[i] > 0, start: i, confirmed: false }] : []));
  return { sc, sm, sl, dC, dL, conv, side, starts, events };
}

const dirOk = (p: AguParams, up: boolean) => p.dir === "both" || (p.dir === "buy") === up;

/** Sinal na triagem: algum evento nos últimos `window` pregões, no lado pedido. */
export function agulhadaHit(closes: number[] | null | undefined, raw: Partial<AguParams> = {}): AguEvent | null {
  if (!closes || closes.length < 2) return null;
  const p = normParams(raw), s = agulhadaSeries(closes, p), from = closes.length - p.window;
  for (let k = s.events.length - 1; k >= 0; k--) { const e = s.events[k]; if (e.i < from) break; if (dirOk(p, e.up)) return e; }
  return null;
}
export const agulhadaFilterEvents = (s: AguSeries, raw: Partial<AguParams>) => { const p = normParams(raw); return s.events.filter((e) => dirOk(p, e.up)); };
