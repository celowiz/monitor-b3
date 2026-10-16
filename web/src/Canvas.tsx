import { track } from "./analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, Handle, Position, useReactFlow, ReactFlowProvider, BaseEdge, getSmoothStepPath, getBezierPath,
  type Node, type Edge, type NodeProps, type NodeChange, type EdgeChange, type EdgeProps, type Connection, BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Block, BlockType, DEFS, Evaluated, Screen, blockSummary, isFilter, isLogic, isSignal, makeBlock, FILTER_TYPES, SIGNAL_TYPES } from "./engine";
import { BlockEditor } from "./Editors";
import { MIN_LOGIC_INPUTS, canConnect, connect, depths, hasOutput, inputsOf, removeNode, type Problem } from "./graph";

interface CanvasProps {
  screen: Screen; ev: Evaluated; total: number;
  sectors: string[]; tree: Record<string, string[]>; onChange: (s: Screen) => void; step: number; runId: number;
}
export type Status = "idle" | "running" | "success" | "error";

/** Ordem de execução = profundidade no DAG; depois do último nível vem um passo extra de "concluído". */
export function stepOf(screen: Screen, id: string): number { return depths(screen).get(id) ?? 0; }
export const totalSteps = (screen: Screen) => Math.max(0, ...depths(screen).values()) + 2;
const statusAt = (step: number, mine: number, err = false): Status => (step < mine ? "idle" : step === mine ? "running" : err ? "error" : "success");

function FlowEdge(p: EdgeProps<Edge<{ st: Status; off?: boolean }>>) {
  const args = { sourceX: p.sourceX, sourceY: p.sourceY, targetX: p.targetX, targetY: p.targetY, sourcePosition: p.sourcePosition, targetPosition: p.targetPosition };
  const [path] = Math.abs(p.sourceY - p.targetY) > 4 ? getSmoothStepPath({ ...args, borderRadius: 10 }) : getBezierPath(args);
  const st = p.data?.st ?? "idle";
  const cls = `fe fe-${p.data?.off ? "off" : st}${p.selected ? " fe-sel" : ""}`;
  return (
    <>
      <BaseEdge id={p.id} path={path} className={cls} interactionWidth={14} />
      {st === "running" && !p.data?.off && (
        <circle r="3.2" className="fe-dot"><animateMotion dur="0.55s" repeatCount="indefinite" path={path} /></circle>
      )}
    </>
  );
}
const edgeTypes = { flow: FlowEdge };

type Common = { block: Block; status: Status; count?: number; inCount?: number | null; warn?: string; onPlus?: () => void; remove: () => void };
type BlockData = Common & { sectors: string[]; tree: Record<string, string[]>; set: (b: Block) => void };

const Plus = ({ onPlus }: { onPlus?: () => void }) => onPlus ? (
  <button className="bn-plus nodrag" title="adicionar bloco conectado a esta saída" aria-label="adicionar bloco conectado" onClick={(e) => { e.stopPropagation(); onPlus(); }}>+</button>
) : null;
const Warn = ({ w }: { w?: string }) => (w ? <div className="bn-warn" role="note">⚠ {w}</div> : null);
const Count = ({ status, inCount, count }: { status: Status; inCount?: number | null; count?: number }) => (
  <span className="bn-n mono" title="entram → saem">
    {status === "running" ? "…" : status === "idle" || inCount == null ? "–" : <>{inCount} → <b>{count ?? "–"}</b></>}
  </span>
);

function BlockNode({ data }: NodeProps<Node<BlockData>>) {
  const { block, count, inCount, status, sectors, tree, set, remove, warn, onPlus } = data;
  const def = DEFS[block.type];
  const sig = isSignal(block.type), uni = block.type === "universe";
  return (
    <div className={`bn ${sig ? "sig" : "flt"} ${uni ? "pill" : ""} ${block.enabled ? "on" : "off"} st-${status}${warn ? " warn" : ""}`}>
      <Warn w={warn} />
      {!uni && <Handle type="target" position={Position.Left} />}
      <div className="bn-cap">{sig ? "sinal" : uni ? "entrada" : "filtro"}</div>
      <div className="bn-head">
        <span className="bn-ic">{def.icon}</span>
        <span className="bn-t">{def.label}</span>
        <Count status={status} inCount={inCount} count={count} />
        <button className={"tg nodrag" + (block.enabled ? " on" : "")} aria-label="ligar/desligar" onClick={() => set({ ...block, enabled: !block.enabled })}><i /></button>
        <button className="bn-x nodrag" aria-label="remover bloco" onClick={remove}>×</button>
      </div>
      <div className="bn-sum">{blockSummary(block)}</div>
      <div className="bn-ed"><BlockEditor block={block} sectors={sectors} tree={tree} onParams={(p) => set({ ...block, params: { ...block.params, ...p } })} /></div>
      <Handle type="source" position={Position.Right} />
      <Plus onPlus={onPlus} />
    </div>
  );
}

function LogicNode({ data }: NodeProps<Node<Common & { nIn: number; toggle: () => void }>>) {
  const { block, status, inCount, count, warn, nIn, onPlus, remove, toggle } = data;
  const slots = Math.max(MIN_LOGIC_INPUTS, nIn + 1);
  return (
    <div className={`ln ln-${block.type} st-${status}${warn ? " warn" : ""}`}>
      <Warn w={warn} />
      <div className="ln-d" />
      {Array.from({ length: slots }, (_, i) => {
        const t = 20 + (60 * i) / Math.max(1, slots - 1);
        return <Handle key={i} id={`in${i}`} type="target" position={Position.Left} style={{ top: `${t}%`, left: `${Math.abs(t - 50)}%` }} />;
      })}
      <div className="ln-body">
        <button className="ln-t nodrag" title="alternar E / OU" onClick={toggle}>{block.type === "and" ? "E" : "OU"}</button>
        <Count status={status} inCount={inCount} count={count} />
      </div>
      <button className="bn-x nodrag ln-x" aria-label="remover bloco" onClick={remove}>×</button>
      <Handle type="source" position={Position.Right} />
      <Plus onPlus={onPlus} />
    </div>
  );
}

function CountUp({ to, run }: { to: number; run: boolean }) {
  const [v, setV] = useState(run ? 0 : to);
  useEffect(() => {
    if (!run) { setV(to); return; }
    const t0 = performance.now(); let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / 450); setV(Math.round(to * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run]);
  return <>{v}</>;
}

function ResNode({ data }: NodeProps<Node<Common & { n: number; complete: boolean }>>) {
  const { status, n, complete, warn, remove } = data;
  return (
    <div className={`rn st-${complete ? status : "idle"}${complete ? "" : " incomplete"}`}>
      <Warn w={warn} />
      <Handle type="target" position={Position.Left} />
      <div className="bn-cap">resultado</div>
      <div className="res-n mono">{!complete || status === "idle" ? "–" : <CountUp to={n} run={status === "running"} />}</div>
      <div className="rn-sub">{complete ? "ativos" : "⚠ incompleto"}</div>
      <button className="bn-x nodrag rn-x" aria-label="remover bloco" onClick={remove}>×</button>
    </div>
  );
}

const nodeTypes = { block: BlockNode, logic: LogicNode, res: ResNode };

const PICK: [string, BlockType[]][] = [["Filtros", FILTER_TYPES.slice(1)], ["Sinais", SIGNAL_TYPES], ["Lógica", ["and", "or"]], ["Saída", ["result"]]];
const nodeType = (t: BlockType) => (isLogic(t) ? "logic" : t === "result" ? "res" : "block");

function Inner({ screen, ev, total, sectors, tree, onChange, step }: CanvasProps) {
  const rf = useReactFlow();
  const [picker, setPicker] = useState<{ from: string; x: number; y: number } | null>(null);
  // Modo controlado: a seleção (para Delete) fica aqui, fora do modelo da tela.
  const [selN, setSelN] = useState<Set<string>>(new Set());
  const [selE, setSelE] = useState<Set<string>>(new Set());
  const d = useMemo(() => depths(screen), [screen]);
  const warnOf = useMemo(() => { const m = new Map<string, string>(); for (const p of ev.problems) if (p.nodeId && !m.has(p.nodeId)) m.set(p.nodeId, p.kind === "no-input" ? "Entrada não conectada" : p.kind === "cycle" ? "Ciclo" : p.kind === "no-output" ? "Saída não conectada" : p.msg); return m; }, [ev.problems]);

  const setBlock = useCallback((b: Block) => onChange({ ...screen, blocks: screen.blocks.map((x) => (x.id === b.id ? b : x)) }), [screen, onChange]);
  const remove = useCallback((id: string) => onChange(removeNode(screen, id)), [screen, onChange]);

  const nodes: Node[] = useMemo(() => screen.blocks.map((b) => {
    const mine = d.get(b.id) ?? 0, warn = warnOf.get(b.id);
    const err = (isFilter(b.type) && b.enabled && ev.perBlock.get(b.id) === 0) || (b.type === "result" && ev.complete && ev.results.length === 0);
    const status: Status = warn ? "idle" : !b.enabled && step > mine ? "idle" : statusAt(step, mine, err);
    const common = { block: b, status, count: ev.perBlock.get(b.id), inCount: b.type === "universe" ? total : ev.perIn.get(b.id) ?? null, warn,
      remove: () => remove(b.id), onPlus: hasOutput(b.type) ? () => setPicker({ from: b.id, x: (b.pos?.x ?? 0) + 320, y: b.pos?.y ?? 0 }) : undefined };
    const data = b.type === "result" ? { ...common, n: ev.results.length, complete: ev.complete }
      : isLogic(b.type) ? { ...common, nIn: inputsOf(screen, b.id).length, toggle: () => setBlock({ ...b, type: b.type === "and" ? "or" : "and" }) }
      : { ...common, sectors, tree, set: setBlock };
    return { id: b.id, type: nodeType(b.type), position: b.pos ?? { x: 0, y: 0 }, selected: selN.has(b.id), dragHandle: isLogic(b.type) || b.type === "result" ? undefined : ".bn-head", data };
  }), [screen, ev, d, warnOf, step, total, sectors, tree, setBlock, remove, selN]);

  const edges: Edge[] = useMemo(() => {
    const byId = new Map(screen.blocks.map((b) => [b.id, b]));
    const slot = new Map<string, number>();
    return screen.edges.map((e) => {
      const t = byId.get(e.target), s = byId.get(e.source);
      let targetHandle: string | undefined;
      if (t && isLogic(t.type)) { const i = slot.get(t.id) ?? 0; slot.set(t.id, i + 1); targetHandle = `in${i}`; }
      return { id: e.id, source: e.source, target: e.target, targetHandle, type: "flow", selected: selE.has(e.id),
        data: { st: statusAt(step, d.get(e.target) ?? 0), off: !!s && isSignal(s.type) && !s.enabled } };
    });
  }, [screen, step, d, selE]);

  const onNodesChange = useCallback((chs: NodeChange[]) => {
    let s = screen, changed = false;
    const sel = chs.filter((c) => c.type === "select");
    if (sel.length) setSelN((cur) => { const n = new Set(cur); for (const c of sel) if (c.type === "select") { if (c.selected) n.add(c.id); else n.delete(c.id); } return n; });
    for (const c of chs) {
      if (c.type === "position" && c.position) { s = { ...s, blocks: s.blocks.map((b) => (b.id === c.id ? { ...b, pos: c.position } : b)) }; changed = true; }
      if (c.type === "remove") { s = removeNode(s, c.id); changed = true; }
    }
    if (changed) onChange(s);
  }, [screen, onChange]);
  const onEdgesChange = useCallback((chs: EdgeChange[]) => {
    const sel = chs.filter((c) => c.type === "select");
    if (sel.length) setSelE((cur) => { const n = new Set(cur); for (const c of sel) if (c.type === "select") { if (c.selected) n.add(c.id); else n.delete(c.id); } return n; });
    const rm = new Set(chs.filter((c) => c.type === "remove").map((c) => c.id));
    if (rm.size) onChange({ ...screen, edges: screen.edges.filter((e) => !rm.has(e.id)) });
  }, [screen, onChange]);
  const isValidConnection = useCallback((c: Connection | Edge) => !!c.source && !!c.target && canConnect(screen, c.source, c.target), [screen]);
  const onConnect = useCallback((c: Connection) => {
    const next = connect(screen, c.source, c.target);
    if (next !== screen) { track("edge_connect", { source_type: screen.blocks.find((b) => b.id === c.source)?.type, target_type: screen.blocks.find((b) => b.id === c.target)?.type }); onChange(next); }
  }, [screen, onChange]);

  const addAt = useCallback((type: BlockType, pos: { x: number; y: number }, from?: string) => {
    const b = makeBlock(type); b.pos = pos;
    track("block_add", { block_type: type });
    let s: Screen = { ...screen, blocks: [...screen.blocks, b] };
    if (from) { s = connect(s, from, b.id); if (s.edges.length > screen.edges.length) track("edge_connect", { source_type: screen.blocks.find((x) => x.id === from)?.type, target_type: type, via: "plus" }); }
    onChange(s);
  }, [screen, onChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-block") as BlockType;
    if (type && type in DEFS) addAt(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [rf, addAt]);

  // Paleta (clique) e foco vindos de fora do canvas.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const add = (e: Event) => { const r = el.getBoundingClientRect(); addAt((e as CustomEvent).detail, rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 })); };
    el.addEventListener("mb3-add", add); return () => el.removeEventListener("mb3-add", add);
  }, [rf, addAt]);
  // Tela trocada (galeria, link, Meus grafos): reenquadra. Edições pontuais não mexem na câmera.
  const prevIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set(screen.blocks.map((b) => b.id));
    const replaced = ![...ids].some((i) => prevIds.current.has(i));
    prevIds.current = ids;
    if (replaced) { const t = window.setTimeout(() => rf.fitView({ padding: 0.12, duration: 250 }), 60); return () => clearTimeout(t); }
  }, [screen.blocks, rf]);
  const focus = (p: Problem) => {
    const b = p.nodeId ? screen.blocks.find((x) => x.id === p.nodeId) : null;
    if (b?.pos) rf.setCenter(b.pos.x + 120, b.pos.y + 50, { zoom: 1.1, duration: 400 });
  };

  return (
    <div className="canvas" id="mb3-canvas" ref={wrap} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}>
      <ReactFlow zoomOnScroll={false} panOnScroll={false} preventScrolling={false} zoomOnPinch zoomActivationKeyCode={["Meta", "Control"]} panOnDrag
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onConnect={onConnect} isValidConnection={isValidConnection} connectOnClick nodesConnectable edgesFocusable elementsSelectable
        fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.25} maxZoom={1.6} proOptions={{ hideAttribution: true }}
        onPaneClick={() => setPicker(null)} deleteKeyCode={["Delete", "Backspace"]} colorMode="dark">
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#22262a" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      <div className="canvas-hint">{total} no universo · arraste da saída (●) até uma entrada para conectar · selecione uma ligação e tecle Delete para remover · ⌘/Ctrl + rolar para zoom</div>
      <div className="auto-pill"><i className="dot" />recalcula automaticamente</div>
      {ev.problems.length > 0 && (
        <div className="probs" role="status">
          <b>⚠ {ev.problems.length} problema{ev.problems.length > 1 ? "s" : ""}</b>
          <ul>{ev.problems.map((p, i) => <li key={i}><button className="link" onClick={() => focus(p)} disabled={!p.nodeId}>{p.msg}</button></li>)}</ul>
          <span className="mu">clique para ir até o nó</span>
        </div>
      )}
      {picker && (
        <div className="picker" role="menu" aria-label="adicionar bloco conectado">
          <div className="picker-h">Adicionar após <b>{DEFS[screen.blocks.find((b) => b.id === picker.from)?.type ?? "universe"].short}</b><button className="bn-x" onClick={() => setPicker(null)} aria-label="fechar">×</button></div>
          {PICK.map(([g, ts]) => (
            <div key={g}><div className="pal-g">{g}</div>
              {ts.filter((t) => t !== "result" || !screen.blocks.some((b) => b.type === "result")).map((t) => (
                <button key={t} className="pal-i" role="menuitem" onClick={() => { addAt(t, { x: picker.x, y: picker.y }, picker.from); setPicker(null); }}>
                  <span className="pal-ic">{DEFS[t].icon}</span>{DEFS[t].short}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Adiciona um bloco solto no centro do canvas (clique na paleta). */
export const addFromPalette = (t: BlockType) => document.getElementById("mb3-canvas")?.dispatchEvent(new CustomEvent("mb3-add", { detail: t }));

export function Palette({ onAdd, hasResult }: { onAdd: (t: BlockType) => void; hasResult: boolean }) {
  const groups: [string, BlockType[]][] = [["Entrada", ["universe"]], ["Filtros", FILTER_TYPES.slice(1)], ["Sinais", SIGNAL_TYPES], ["Lógica", ["and", "or"]], ["Saída", ["result"]]];
  return (
    <aside className="palette">
      <div className="pal-t">Blocos · arraste</div>
      {groups.map(([g, ts]) => (
        <div key={g}>
          <div className="pal-g">{g}</div>
          {ts.map((t) => {
            const dis = t === "result" && hasResult;
            return (
              <div key={t} className={"pal-i" + (dis ? " dis" : "")} draggable={!dis} title={dis ? "o grafo já tem um Resultado" : "arraste para o canvas ou clique"}
                onDragStart={(e) => { e.dataTransfer.setData("application/x-block", t); e.dataTransfer.effectAllowed = "move"; }}
                onClick={() => !dis && onAdd(t)}>
                <span className="pal-ic">{DEFS[t].icon}</span>{DEFS[t].short}
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

export default function Canvas(p: CanvasProps) {
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>;
}
