import { DEFS, Screen, isFilter } from "./engine";
import { PRESETS } from "./presets";

function Mini({ s }: { s: Screen }) {
  const f = s.blocks.filter((b) => b.enabled && isFilter(b.type)), g = s.blocks.filter((b) => b.enabled && !isFilter(b.type));
  const W = 64, H = 18, gap = 14, y0 = 8;
  const sy = (i: number) => y0 + i * (H + 6);
  const midY = sy(Math.max(0, (g.length - 1) / 2));
  const sx = f.length * (W + gap);
  const h = Math.max(sy(g.length - 1), midY) + H + y0;
  return (
    <svg className="gal-mini" viewBox={`0 0 ${sx + W + gap + 44} ${h}`} role="img" aria-label="prévia dos blocos">
      {f.map((b, i) => <g key={b.id}>
        <rect x={i * (W + gap)} y={midY} width={W} height={H} rx="4" />
        <text x={i * (W + gap) + W / 2} y={midY + 12}>{DEFS[b.type].short}</text>
        <line x1={i * (W + gap) + W} y1={midY + H / 2} x2={(i + 1) * (W + gap)} y2={i === f.length - 1 ? midY + H / 2 : midY + H / 2} />
      </g>)}
      {g.map((b, i) => <g key={b.id} className="sg">
        <path d={`M${sx - gap} ${midY + H / 2} C${sx - 4} ${midY + H / 2} ${sx - 10} ${sy(i) + H / 2} ${sx} ${sy(i) + H / 2}`} />
        <rect x={sx} y={sy(i)} width={W} height={H} rx="4" />
        <text x={sx + W / 2} y={sy(i) + 12}>{DEFS[b.type].short}</text>
        <path d={`M${sx + W} ${sy(i) + H / 2} C${sx + W + 10} ${sy(i) + H / 2} ${sx + W + 4} ${midY + H / 2} ${sx + W + gap} ${midY + H / 2}`} />
      </g>)}
      <rect className="res" x={sx + W + gap} y={midY} width={40} height={H} rx="4" />
      <text className="res" x={sx + W + gap + 20} y={midY + 12}>{s.combine === "or" ? "OU" : "E"}</text>
    </svg>
  );
}

export default function Gallery({ liqMin, onPick, onClose }: { liqMin: number; onPick: (s: Screen) => void; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Galeria de telas" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h"><div><h2>Galeria de telas</h2><span className="mu">Pontos de partida para estudar sinais. Conteúdo educativo, não é recomendação de investimento.</span></div>
          <button className="close" onClick={onClose} aria-label="fechar">×</button></div>
        <div className="gal-grid">
          {PRESETS.map((p) => { const s = p.build(liqMin); return (
            <article key={p.id} className="gal-card">
              <h3>{p.name}</h3>
              <Mini s={s} />
              <p>{p.desc}</p>
              <button className="btn pri" onClick={() => onPick(p.build(liqMin))}>Usar esta tela</button>
            </article>); })}
        </div>
      </div>
    </div>
  );
}
