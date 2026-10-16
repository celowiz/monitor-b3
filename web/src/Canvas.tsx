import { track } from "./analytics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, Background, Controls, MiniMap, Handle, Position, useReactFlow, ReactFlowProvider, BaseEdge, getSmoothStepPath, getBezierPath,
  type Node, type Edge, type NodeProps, type NodeChange, type EdgeProps, BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Block, BlockType, DEFS, Screen, blockSummary, isFilter, makeBlock, FILTER_TYPES, SIGNAL_TYPES } from "./engine";
import { BlockEditor } from "./Editors";

interface CanvasProps {
  screen: Screen; counts: Map<string, number>; total: number; filteredCount: number; resultCount: number;
  sectors: string[]; tree: Record<string, string[]>; onChange: (s: Screen) => void; step: number; runId: number;
}
export type Status = "idle" | "running" | "success" | "error";

/** Ordem de execução: filtros em sequência, todos os sinais em paralelo, lógica, resultados. */
export function stepOf(screen: Screen, id: string): number {
  const nf = screen.blocks.filter((b) => isFilter(b.type)).length;
  if (id === "comb") return nf + 1;
  if (id === "res") return nf + 2;
  const b = screen.blocks.find((x) => x.id === id);
  if (!b) return 0;
  return isFilter(b.type) ? screen.blocks.filter((x) => isFilter(x.type)).indexOf(b) : nf;
}
export const totalSteps = (screen: Screen) => screen.blocks.filter((b) => isFilter(b.type)).length + 3;
const statusAt = (step: number, mine: number, err = false): Status => (step < mine ? "idle" : step === mine ? "running" : err ? "error" : "success");

function FlowEdge(p: EdgeProps<Edge<{ st: Status; smooth?: boolean; off?: boolean }>>) {
  const args = { sourceX: p.sourceX, sourceY: p.sourceY, targetX: p.targetX, targetY: p.targetY, sourcePosition: p.sourcePosition, targetPosition: p.targetPosition };
  const [path] = p.data?.smooth ? getSmoothStepPath({ ...args, borderRadius: 10 }) : getBezierPath(args);
  const st = p.data?.st ?? "idle";
  const cls = `fe fe-${p.data?.off ? "off" : st}`;
  return (
    <>
      <BaseEdge id={p.id} path={path} className={cls} />
      {st === "running" && !p.data?.off && (
        <circle r="3.2" className="fe-dot">
          <animateMotion dur="0.55s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}
const edgeTypes = { flow: FlowEdge };

type BlockData = { block: Block; count?: number; inCount?: number; status: Status; sectors: string[]; tree: Record<string, string[]>; set: (b: Block) => void; remove: () => void; canRemove: boolean };

function BlockNode({ data }: NodeProps<Node<BlockData>>) {
  const { block, count, inCount, status, sectors, tree, set, remove, canRemove } = data;
  const def = DEFS[block.type];
  const sig = !isFilter(block.type);
  return (
    <div className={`bn ${sig ? "sig" : "flt"} ${block.enabled ? "on" : "off"} st-${status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="bn-cap">{sig ? "sinal" : block.type === "universe" ? "entrada" : "filtro"}</div>
      <div className="bn-head">
        <span className="bn-ic">{def.icon}</span>
        <span className="bn-t">{def.label}</span>
        <span className="bn-n mono" title={sig ? "entram → disparam" : "entram → saem"}>
          {status === "idle" || status === "running" ? (status === "running" ? "…" : "–") : <>{inCount ?? "–"} → <b>{count ?? "–"}</b></>}
        </span>
        <button className={"tg nodrag" + (block.enabled ? " on" : "")} aria-label="ligar/desligar"
          onClick={() => set({ ...block, enabled: !block.enabled })}><i /></button>
        {canRemove && <button className="bn-x nodrag" aria-label="remover bloco" onClick={remove}>×</button>}
      </div>
      <div className="bn-sum">{blockSummary(block)}</div>
      <div className="bn-ed"><BlockEditor block={block} sectors={sectors} tree={tree} onParams={(p) => set({ ...block, params: { ...block.params, ...p } })} /></div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function CombNode({ data }: NodeProps<Node<{ mode: "and" | "or"; set: (m: "and" | "or") => void; active: number; status: Status; inCount: number; out: number }>>) {
  return (
    <div className={`bn comb st-${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="bn-cap">lógica</div>
      <div className="bn-head"><span className="bn-ic">&amp;</span><span className="bn-t">E / OU</span>
        {data.status === "success" && <span className="bn-n mono">{data.inCount} → <b>{data.out}</b></span>}</div>
      <div className="seg nodrag big">
        <button className={data.mode === "and" ? "on" : ""} onClick={() => data.set("and")}>E</button>
        <button className={data.mode === "or" ? "on" : ""} onClick={() => data.set("or")}>OU</button>
      </div>
      <div className="bn-sum">{data.active ? `${data.active} sinal(is) ativo(s)` : "sem sinais: só filtros"}</div>
      <Handle type="source" position={Position.Right} />
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

function ResNode({ data }: NodeProps<Node<{ n: number; f: number; status: Status }>>) {
  return (
    <div className={`bn res st-${data.status}`}>
      <Handle type="target" position={Position.Left} />
      <div className="bn-cap">saída</div>
      <div className="bn-head"><span className="bn-ic">≡</span><span className="bn-t">Resultados</span></div>
      <div className="res-n mono">{data.status === "idle" ? "–" : <CountUp to={data.n} run={data.status === "running"} />}</div>
      <div className="bn-sum">ativos passam agora · {data.f} após filtros</div>
    </div>
  );
}

const nodeTypes = { block: BlockNode, comb: CombNode, res: ResNode };
const prevCount = (screen: Screen, id: string, counts: Map<string, number>, total: number, filtered: number) => {
  const b = screen.blocks.find((x) => x.id === id)!;
  if (!isFilter(b.type)) return filtered;
  const fs = screen.blocks.filter((x) => isFilter(x.type));
  const i = fs.indexOf(b);
  return i === 0 ? total : counts.get(fs[i - 1].id) ?? total;
};

export function layout(blocks: Block[]) {
  const pos = new Map<string, { x: number; y: number }>();
  const filters = blocks.filter((b) => isFilter(b.type));
  const sigs = blocks.filter((b) => !isFilter(b.type));
  const per = 5, rowH = 175, colW = 280;
  const H = Math.max(Math.min(sigs.length, per) * rowH, 300);
  filters.forEach((b, i) => pos.set(b.id, { x: i * 285, y: H / 2 - 80 }));
  const sx = filters.length * 285 + 50;
  sigs.forEach((b, i) => pos.set(b.id, { x: sx + Math.floor(i / per) * colW, y: (i % per) * rowH }));
  const cx = sx + Math.max(1, Math.ceil(sigs.length / per)) * colW + 40;
  return { pos, combX: cx, resX: cx + 220, midY: H / 2 - 80 };
}

function Inner({ screen, counts, total, filteredCount, resultCount, sectors, tree, onChange, step }: CanvasProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const rf = useReactFlow();
  const auto = useMemo(() => layout(screen.blocks), [screen.blocks]);

  const setBlock = useCallback((b: Block) => onChange({ ...screen, blocks: screen.blocks.map((x) => (x.id === b.id ? b : x)) }), [screen, onChange]);
  const removeBlock = useCallback((id: string) => onChange({ ...screen, blocks: screen.blocks.filter((x) => x.id !== id) }), [screen, onChange]);

  const nodes: Node[] = useMemo(() => {
    const ns: Node[] = screen.blocks.map((b) => ({
      id: b.id, type: "block", position: b.pos ?? auto.pos.get(b.id)!, dragHandle: ".bn-head",
      data: { block: b, count: counts.get(b.id), inCount: prevCount(screen, b.id, counts, total, filteredCount),
        status: !b.enabled && step > stepOf(screen, b.id) ? "idle" : statusAt(step, stepOf(screen, b.id), isFilter(b.type) && b.enabled && (counts.get(b.id) ?? 0) === 0), sectors, tree, set: setBlock, remove: () => removeBlock(b.id),
        canRemove: !(b.type === "universe" && screen.blocks.filter((x) => x.type === "universe").length === 1) },
    }));
    ns.push({ id: "comb", type: "comb", position: { x: auto.combX, y: auto.midY + 20 }, draggable: true,
      data: { mode: screen.combine, set: (m: "and" | "or") => onChange({ ...screen, combine: m }), active: screen.blocks.filter((b) => !isFilter(b.type) && b.enabled).length,
        status: statusAt(step, stepOf(screen, "comb")), inCount: filteredCount, out: resultCount } });
    ns.push({ id: "res", type: "res", position: { x: auto.resX, y: auto.midY + 10 }, data: { n: resultCount, f: filteredCount, status: statusAt(step, stepOf(screen, "res"), resultCount === 0) } });
    return ns;
  }, [screen, counts, sectors, tree, auto, setBlock, removeBlock, onChange, resultCount, filteredCount, step, total]);

  const edges: Edge[] = useMemo(() => {
    const es: Edge[] = [];
    const filters = screen.blocks.filter((b) => isFilter(b.type));
    const sigs = screen.blocks.filter((b) => !isFilter(b.type));
    const st = (target: string): Status => statusAt(step, stepOf(screen, target));
    const E = (id: string, source: string, target: string, smooth = false, off = false): Edge =>
      ({ id, source, target, type: "flow", data: { st: st(target), smooth, off } });
    for (let i = 1; i < filters.length; i++) es.push(E(`e${i}`, filters[i - 1].id, filters[i].id));
    const last = filters[filters.length - 1]?.id;
    if (sigs.length) {
      for (const s of sigs) {
        if (last) es.push(E(`s-${s.id}`, last, s.id, true, !s.enabled));
        es.push(E(`c-${s.id}`, s.id, "comb", true, !s.enabled));
      }
    } else if (last) es.push(E("fc", last, "comb"));
    es.push(E("cr", "comb", "res"));
    return es;
  }, [screen, step]);

  const onNodesChange = useCallback((chs: NodeChange[]) => {
    let changed = false;
    const blocks = screen.blocks.map((b) => {
      const c = chs.find((x) => x.type === "position" && x.id === b.id && (x as any).position);
      if (c) { changed = true; return { ...b, pos: (c as any).position }; }
      return b;
    });
    const rem = chs.filter((x) => x.type === "remove").map((x) => (x as any).id);
    if (changed || rem.length) onChange({ ...screen, blocks: blocks.filter((b) => !rem.includes(b.id) || b.type === "universe") });
  }, [screen, onChange]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-block") as BlockType;
    if (!type) return;
    const b = makeBlock(type);
    b.pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    onChange(insertBlock(screen, b));
  }, [rf, screen, onChange]);

  return (
    <div className="canvas" ref={wrap} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop}>
      <ReactFlow zoomOnScroll={false} panOnScroll={false} preventScrolling={false} zoomOnPinch zoomActivationKeyCode={["Meta","Control"]} panOnDrag nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
        fitView fitViewOptions={{ padding: 0.12 }} minZoom={0.3} maxZoom={1.6} proOptions={{ hideAttribution: true }}
        nodesConnectable={false} deleteKeyCode={["Delete", "Backspace"]} colorMode="dark">
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#22262a" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => (n.type === "block" ? ((n.data as any).block.enabled ? "#3fb8a9" : "#2c3136") : "#8b9196")} maskColor="rgba(10,11,12,.7)" style={{ background: "#101214" }} />
      </ReactFlow>
      <div className="canvas-hint">{total} no universo · arraste blocos da paleta ou clique para adicionar · ⌘/Ctrl + rolar para zoom</div>
    </div>
  );
}

export function insertBlock(screen: Screen, b: Block): Screen {
  track("block_add", { block_type: b.type });
  const blocks = [...screen.blocks];
  if (isFilter(b.type)) {
    const lastF = blocks.map((x) => isFilter(x.type)).lastIndexOf(true);
    blocks.splice(lastF + 1, 0, b);
  } else blocks.push(b);
  return { ...screen, blocks };
}

export function Palette({ onAdd }: { onAdd: (t: BlockType) => void }) {
  const groups: [string, BlockType[]][] = [["Entrada", ["universe"]], ["Filtros", FILTER_TYPES.slice(1)], ["Sinais", SIGNAL_TYPES]];
  return (
    <aside className="palette">
      <div className="pal-t">Blocos</div>
      {groups.map(([g, ts]) => (
        <div key={g}>
          <div className="pal-g">{g}</div>
          {ts.map((t) => (
            <div key={t} className="pal-i" draggable title="arraste para o canvas ou clique"
              onDragStart={(e) => { e.dataTransfer.setData("application/x-block", t); e.dataTransfer.effectAllowed = "move"; }}
              onClick={() => onAdd(t)}>
              <span className="pal-ic">{DEFS[t].icon}</span>{DEFS[t].short}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}

export default function Canvas(p: CanvasProps) {
  return <ReactFlowProvider><Inner {...p} /></ReactFlowProvider>;
}
