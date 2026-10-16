import { useRef } from "react";
import { SavedGraph } from "./graphs";

interface Props {
  graphs: SavedGraph[]; activeId: string | null;
  onNew: () => void; onOpen: (id: string) => void; onRename: (id: string) => void; onDuplicate: (id: string) => void; onDelete: (id: string) => void;
  onSave: () => void; onExport: () => void; onImport: (text: string) => void; onCopyLink: () => void; dirtyUnsaved: boolean;
}
const when = (t: number) => {
  const d = new Date(t), now = new Date();
  return d.toDateString() === now.toDateString() ? `hoje ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export default function MyGraphs(p: Props) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <aside className="mygraphs" aria-label="Meus grafos">
      <div className="mg-h"><b>Meus grafos</b><span className="mu">salvos neste navegador</span></div>
      <div className="mg-act">
        <button className="btn sm pri" onClick={p.onNew}>+ Novo</button>
        {p.dirtyUnsaved && <button className="btn sm" onClick={p.onSave}>Salvar</button>}
        <button className="btn sm" onClick={p.onExport} title="baixar o grafo aberto em JSON">⤓ JSON</button>
        <button className="btn sm" onClick={() => file.current?.click()} title="importar um arquivo JSON">⤒ Importar</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) p.onImport(await f.text()); e.target.value = ""; }} />
      </div>
      {!p.graphs.length && <div className="mg-empty mu">Nenhum grafo salvo ainda. Monte um e clique em Salvar.</div>}
      <ul className="mg-list">
        {p.graphs.map((g) => {
          const on = g.id === p.activeId;
          return (
            <li key={g.id} className={on ? "on" : ""}>
              <button className="mg-name" onClick={() => p.onOpen(g.id)} title="abrir">{g.name}</button>
              <span className="mg-meta mu">{when(g.updated)} · {g.screen.blocks.length} blocos{on ? " · aberto" : ""}</span>
              {on && (
                <div className="mg-row">
                  <button className="btn xs" onClick={() => p.onRename(g.id)}>Renomear</button>
                  <button className="btn xs" onClick={() => p.onDuplicate(g.id)}>Duplicar</button>
                  <button className="btn xs danger" onClick={() => p.onDelete(g.id)}>Excluir</button>
                  <button className="btn xs" onClick={p.onCopyLink}>⧉ Copiar link</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
