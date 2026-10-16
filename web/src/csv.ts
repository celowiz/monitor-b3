import { KIND_LABEL, Row } from "./engine";

const dist200 = (r: Row) => (r.sma200 ? r.price / r.sma200 - 1 : null);
export const CSV_COLS: { l: string; get: (r: Row, sig: string) => number | string | null | undefined }[] = [
  { l: "Ticker", get: (r) => r.t }, { l: "Nome", get: (r) => r.name }, { l: "Tipo", get: (r) => KIND_LABEL[r.kind] },
  { l: "Setor", get: (r) => r.sector }, { l: "Preço", get: (r) => r.price },
  { l: "Var. dia %", get: (r) => (r.chg == null ? null : r.chg * 100) }, { l: "Liq. 21d (R$)", get: (r) => r.liq21 },
  { l: "Dist. SMA200 %", get: (r) => { const d = dist200(r); return d == null ? null : d * 100; } },
  { l: "RSI", get: (r) => r.rsi }, { l: "RS 21d (pp)", get: (r) => r.rs21 }, { l: "Sinais", get: (_r, s) => s },
];

export function toCsv(rows: Row[], signals: (r: Row) => string, ptBR = true): string {
  const sep = ptBR ? ";" : ",";
  const cell = (v: unknown) => {
    if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "";
    let s = typeof v === "number" ? String(Math.round(v * 10000) / 10000) : String(v);
    if (typeof v === "number" && ptBR) s = s.replace(".", ",");
    return (s.includes(sep) || /["\n\r]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLS.map((c) => cell(c.l)).join(sep), ...rows.map((r) => CSV_COLS.map((c) => cell(c.get(r, signals(r)))).join(sep))];
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
