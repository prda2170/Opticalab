import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { OpticalNodeData, BeamEdgeData } from '../types/components';
import { isOpticalNode } from '../types/components';
import type { BeamState, BeamSegment } from '../types/beam';
import { autoRoute } from '../physics/autoRoute';

// Fingerprint of everything the beam trace depends on: node data *and* positions
// (beam geometry moves when nodes move) plus user-drawn wiring.
function routeKey(nodes: Node<OpticalNodeData>[], userEdges: Edge[]): string {
  const nk = nodes
    .filter(isOpticalNode)
    .map(n => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)}:${JSON.stringify(n.data)}`)
    .sort()
    .join('|');
  const ek = userEdges
    .map(e => `${e.source}:${e.sourceHandle ?? ''}>${e.target}:${e.targetHandle ?? ''}`)
    .sort()
    .join('|');
  return `${nk}##${ek}`;
}

/** Range the component-label size slider spans, as a multiple of the base size. */
export const LABEL_SCALE_MIN = 0.5;
export const LABEL_SCALE_MAX = 1.5;

type HistoryEntry = { nodes: Node<OpticalNodeData>[]; edges: Edge<BeamEdgeData>[] };

interface LayoutStore {
  // Persisted canvas state (kept in sync with ReactFlow's local state via syncFromCanvas)
  nodes: Node<OpticalNodeData>[];
  edges: Edge<BeamEdgeData>[];

  // ── Beam trace output (single source of truth, from autoRoute) ─────────────
  /** Every drawn beam stretch, in canvas coordinates. Rendered by the Diagram panel. */
  segments: BeamSegment[];
  /** edge id → beam travelling along it */
  beamMap: Map<string, BeamState>;
  /** node id → beam arriving at that node (strongest, when several arrive) */
  nodeBeams: Map<string, BeamState>;
  /** node id → every beam arriving at that node. A detector reads their total. */
  nodeArrivals: Map<string, BeamState[]>;
  /** Physical problems the trace found, keyed by the component they belong to. */
  warnings: Map<string, string[]>;

  // UI state
  selectedNodeId: string | null;
  theme: 'light' | 'dark';
  activeTab: 'editor' | 'diagram';

  // Version counter: increment to tell EditorCanvas to reload nodes/edges from store
  canvasVersion: number;

  // Undo/redo history
  history: HistoryEntry[];
  future: HistoryEntry[];

  // Called by EditorCanvas whenever its local nodes/edges change
  syncFromCanvas: (nodes: Node<OpticalNodeData>[], edges: Edge<BeamEdgeData>[]) => void;

  // Called before destructive user actions (add, connect, delete)
  saveSnapshot: (nodes: Node<OpticalNodeData>[], edges: Edge<BeamEdgeData>[]) => void;

  // Update a single node's data (increments canvasVersion so EditorCanvas reloads)
  updateNodeData: (id: string, data: Partial<OpticalNodeData>) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;

  // Settings
  setSelectedNode: (id: string | null) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setActiveTab: (tab: 'editor' | 'diagram') => void;
  showBeamLabels: boolean;
  toggleBeamLabels: () => void;
  /** Multiplier on component label text size, clamped to [LABEL_SCALE_MIN, MAX]. */
  labelScale: number;
  setLabelScale: (scale: number) => void;

  // Persistence
  loadLayout: (data: { nodes: Node<OpticalNodeData>[]; edges: Edge<BeamEdgeData>[] }) => void;
  getLayout: () => { nodes: Node<OpticalNodeData>[]; edges: Edge<BeamEdgeData>[] };

  // Internal
  recomputeBeams: () => void;
}

export const useLayoutStore = create<LayoutStore>((set, get) => {
  // Last routeKey we traced, so pure re-renders don't re-run the engine.
  let lastRouteKey = '';

  /** Run the one engine over the given layout and publish its beam output. */
  const trace = (nodes: Node<OpticalNodeData>[], userEdges: Edge[], force = false) => {
    const key = routeKey(nodes, userEdges);
    if (!force && key === lastRouteKey) return;
    lastRouteKey = key;
    const { segments, beams, nodeBeams, nodeArrivals, warnings: found } = autoRoute(
      nodes.filter(isOpticalNode),
      userEdges,
    );
    const warnings = new Map<string, string[]>();
    for (const w of found) {
      const list = warnings.get(w.nodeId);
      if (list) list.push(w.message);
      else warnings.set(w.nodeId, [w.message]);
    }
    set({ segments, beamMap: beams, nodeBeams, nodeArrivals, warnings });
  };

  return {
    nodes: [],
    edges: [],
    segments: [],
    beamMap: new Map(),
    nodeBeams: new Map(),
    nodeArrivals: new Map(),
    warnings: new Map(),
    selectedNodeId: null,
    theme: 'dark',
    activeTab: 'editor',
    canvasVersion: 0,
    history: [],
    future: [],
    showBeamLabels: false,
    labelScale: 1,

    syncFromCanvas: (nodes, edges) => {
      // Only user-drawn edges are persisted; auto_ routing edges are always
      // re-derived by the engine and never stored or saved.
      const userEdges = edges.filter(e => !e.id.startsWith('auto_'));
      set({ nodes, edges: userEdges });
      trace(nodes, userEdges);
    },

    saveSnapshot: (nodes, edges) => {
      set((state) => ({
        history: [...state.history.slice(-49), { nodes: [...nodes], edges: [...edges] }],
        future: [],
      }));
    },

    updateNodeData: (id, data) => {
      set((state) => ({
        nodes: state.nodes.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...data } as OpticalNodeData } : n,
        ),
        canvasVersion: state.canvasVersion + 1, // signal EditorCanvas to reload
      }));
      get().recomputeBeams();
    },

    undo: () => {
      const { history, nodes, edges, future } = get();
      if (history.length === 0) return;
      const prev = history[history.length - 1];
      set((state) => ({
        history: state.history.slice(0, -1),
        future: [{ nodes: [...nodes], edges: [...edges] }, ...future.slice(0, 49)],
        nodes: prev.nodes,
        edges: prev.edges,
        canvasVersion: state.canvasVersion + 1,
      }));
      get().recomputeBeams();
    },

    redo: () => {
      const { future, nodes, edges, history } = get();
      if (future.length === 0) return;
      const next = future[0];
      set((state) => ({
        future: state.future.slice(1),
        history: [...history.slice(-49), { nodes: [...nodes], edges: [...edges] }],
        nodes: next.nodes,
        edges: next.edges,
        canvasVersion: state.canvasVersion + 1,
      }));
      get().recomputeBeams();
    },

    setSelectedNode: (id) => set({ selectedNodeId: id }),
    setTheme: (theme) => set({ theme }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    toggleBeamLabels: () => set(s => ({ showBeamLabels: !s.showBeamLabels })),
    setLabelScale: (scale) =>
      set({ labelScale: Math.min(LABEL_SCALE_MAX, Math.max(LABEL_SCALE_MIN, scale)) }),

    loadLayout: (data) => {
      set((state) => ({
        nodes: data.nodes,
        edges: data.edges,
        history: [],
        future: [],
        canvasVersion: state.canvasVersion + 1,
      }));
      get().recomputeBeams();
    },

    getLayout: () => {
      const { nodes, edges } = get();
      return { nodes, edges };
    },

    // Re-trace from store state. Needed because the Diagram tab unmounts the
    // editor canvas, so the store must be able to run the engine on its own.
    recomputeBeams: () => {
      const { nodes, edges } = get();
      trace(nodes, edges, true);
    },
  };
});
