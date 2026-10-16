import { DEFS, Screen, isLogic, isSignal } from "./engine";
import { PRESETS } from "./presets";

function Mini({ s }: { s: Screen }) {
  // Prévia do grafo: usa as posições do layout automático, reduzidas.
  const k = 0.22, W = 64, H = 18;
  const ps = s.blocks.map((b) => ({ b, x: (b.pos?.x ?? 0) * k, y: (b.pos?.y ?? 0) * k }));
  const minY = Math.min(...ps.map((p) => p.y)), maxX = Math.max(...ps.map((p) => p.x)) + W, maxY = Math.max(...ps.map((p) => p.y)) - minY + H;
  const at = new Map(ps.map((p) => [p.b.id, { ...p, y: p.y - minY + 4 }]));
  return (
    <svg className="gal-mini" viewBox={`-2 0 ${maxX + 4} ${maxY + 8}`} role="img" aria-label="prévia do grafo">
      {s.edges.map((e) => { const a = at.get(e.source), b = at.get(e.target); if (!a || !b) return null;
        const x1 = a.x + W, y1 = a.y + H / 2, x2 = b.x, y2 = b.y + H / 2, mx = (x1 + x2) / 2;
        return <path key={e.id} className={a.b.enabled ? "" : "off"} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} />; })}
      {[...at.values()].map(({ b, x, y }) => (
        <g key={b.id} className={(isSignal(b.type) ? "sg" : isLogic(b.type) || b.type === "result" ? "res" : "") + (b.enabled ? "" : " off")}>
          <rect x={x} y={y} width={W} height={H} rx={b.type === "universe" || b.type === "result" ? 9 : isLogic(b.type) ? 2 : 4} />
          <text x={x + W / 2} y={y + 12}>{DEFS[b.type].short}</text>
        </g>
      ))}
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
