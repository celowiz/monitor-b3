import { Block, KIND_LABEL, Kind } from "./engine";

interface Props { block: Block; sectors: string[]; tree?: Record<string, string[]>; onParams: (p: Record<string, any>) => void }

const Num = ({ value, step, onChange, suffix }: { value: number; step?: number; onChange: (v: number) => void; suffix?: string }) => (
  <label className="ed-num nodrag">
    <input type="number" value={value} step={step ?? 1} onChange={(e) => onChange(Number(e.target.value))} />
    {suffix && <span>{suffix}</span>}
  </label>
);

function Seg<T extends string | number>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg nodrag">
      {options.map(([v, l]) => (
        <button key={String(v)} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function BlockEditor({ block, sectors, tree = {}, onParams }: Props) {
  const p = block.params;
  const subsectors = Array.from(new Set((p.sectors || []).flatMap((x: string) => tree[x] || []))).sort() as string[];
  switch (block.type) {
    case "universe":
      return (
        <div className="chips nodrag">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => {
            const on = p.kinds.includes(k);
            return (
              <button key={k} className={"chip" + (on ? " on" : "")}
                onClick={() => onParams({ kinds: on ? p.kinds.filter((x: Kind) => x !== k) : [...p.kinds, k] })}>
                {KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
      );
    case "sector":
      return (
        <div className="col nodrag">
          <select className="ed-sel nodrag nowheel" multiple size={4} value={p.sectors}
            onChange={(e) => onParams({ sectors: Array.from(e.target.selectedOptions).map((o) => o.value), subsectors: [] })}>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {p.sectors?.length > 0 && subsectors.length > 0 && (
            <select className="ed-sel nodrag nowheel" multiple size={4} value={p.subsectors}
              onChange={(e) => onParams({ subsectors: Array.from(e.target.selectedOptions).map((o) => o.value) })}>
              {subsectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <span className="hint">Ctrl/⌘ + clique para vários · nada = todos</span>
        </div>
      );
    case "liquidity": {
      const steps = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
      const mi = p.min / 1e6;
      const idx = steps.reduce((b, v, i) => (Math.abs(v - mi) < Math.abs(steps[b] - mi) ? i : b), 0);
      return (
        <div className="col nodrag">
          <input className="slider nodrag" type="range" min={0} max={steps.length - 1} value={idx}
            onChange={(e) => onParams({ min: steps[Number(e.target.value)] * 1e6 })} />
          <Num value={mi} step={0.5} suffix="R$ mi (média 21d)" onChange={(v) => onParams({ min: v * 1e6 })} />
        </div>
      );
    }
    case "chgRange":
      return (
        <div className="row nodrag">
          <Num value={p.min} step={0.5} suffix="% a" onChange={(v) => onParams({ min: v })} />
          <Num value={p.max} step={0.5} suffix="%" onChange={(v) => onParams({ max: v })} />
        </div>
      );
    case "blocklist":
      return <textarea className="ed-txt nodrag nowheel" rows={2} placeholder="ex.: AMER3, OIBR3" value={p.tickers} onChange={(e) => onParams({ tickers: e.target.value })} />;
    case "sma200":
      return <Seg value={p.side} options={[["above", "Acima"], ["below", "Abaixo"]]} onChange={(v) => onParams({ side: v })} />;
    case "index":
      return (
        <div className="chips nodrag">
          {[["IBOV", "Ibovespa"], ["IFIX", "IFIX"], ["SMLL", "Small Caps"]].map(([k, l]) => {
            const on = p.indices.includes(k);
            return <button key={k} className={"chip" + (on ? " on" : "")} onClick={() => onParams({ indices: on ? p.indices.filter((x: string) => x !== k) : [...p.indices, k] })}>{l}</button>;
          })}
        </div>
      );
    case "minPrice":
      return <Num value={p.min} step={0.5} suffix="R$" onChange={(v) => onParams({ min: v })} />;
    case "smaCross":
      return <Seg value={p.dir} options={[["golden", "Golden ↑"], ["death", "Death ↓"], ["any", "Ambos"]]} onChange={(v) => onParams({ dir: v })} />;
    case "volume":
      return <Num value={p.mult} step={0.25} suffix="× média 21d" onChange={(v) => onParams({ mult: v })} />;
    case "rsi":
      return (
        <div className="col nodrag">
          <div className="row">
            <Seg value={p.zone} options={[["below", "Sobrevenda"], ["above", "Sobrecompra"]]} onChange={(v) => onParams({ zone: v })} />
          </div>
          <div className="row">
            {p.zone === "below"
              ? <Num value={p.low} onChange={(v) => onParams({ low: v })} suffix="limite <" />
              : <Num value={p.high} onChange={(v) => onParams({ high: v })} suffix="limite >" />}
            <label className="ck"><input type="checkbox" checked={p.entered} onChange={(e) => onParams({ entered: e.target.checked })} />entrou hoje</label>
          </div>
        </div>
      );
    case "gap":
      return (
        <div className="row nodrag">
          <Num value={p.pct} step={0.5} suffix="%" onChange={(v) => onParams({ pct: v })} />
          <Seg value={p.dir} options={[["up", "Alta"], ["down", "Baixa"], ["both", "Ambos"]]} onChange={(v) => onParams({ dir: v })} />
        </div>
      );
    case "range":
      return (
        <div className="row nodrag">
          <Seg value={p.n} options={[[20, "20d"], [60, "60d"]]} onChange={(v) => onParams({ n: v })} />
          <Seg value={p.dir} options={[["up", "Rompe ↑"], ["down", "Perde ↓"], ["both", "Ambos"]]} onChange={(v) => onParams({ dir: v })} />
        </div>
      );
    case "streak":
      return (
        <div className="row nodrag">
          <Num value={p.n} onChange={(v) => onParams({ n: Math.max(1, Math.round(v)) })} suffix="fech." />
          <Seg value={p.dir} options={[["up", "Altas"], ["down", "Baixas"]]} onChange={(v) => onParams({ dir: v })} />
        </div>
      );
    case "rs":
      return <Num value={p.min} step={0.5} suffix="pp vs índice (21d)" onChange={(v) => onParams({ min: v })} />;
    default:
      return null;
  }
}
