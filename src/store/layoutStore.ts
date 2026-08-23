// One document's state: its layout, its beam trace, its undo history.
//
// **A factory, not a singleton.** Every open document gets its own store instance, which
// is what makes multiple documents in tabs work without any of them reaching into another.
// Two pieces of state make that the right shape rather than a `Record<DocId, …>`:
// `lastRouteKey` below is a closure variable, and `history`/`future` must never let an undo
// in one document pop another's state. Both come out per-document for free this way.
//
// App-wide preferences — theme, label size, beam labels, which view is showing — live in
// `workspaceStore` instead, because they are properties of the window, not the document.
//
// Components reach the *active* document's store through `useLayout()` in layoutContext.ts;
// nothing imports an instance directly.
import { createStore, type StoreApi } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import type { OpticalNodeData, BeamEdgeData } from '../types/components';
import { isOpticalNode } from '../types/components';
import type { BeamState, BeamSegment } from '../types/beam';
import { autoRoute } from '../physics/autoRoute';
import { layoutFingerprint } from '../utils/export';

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

type HistoryEntry = { nodes: Node<OpticalNodeData>[]; edges: Edge<BeamEdgeData>[] };

export interface LayoutState {
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
  /** node id → which way its label sits, chosen by the tracer to clear the beams. */
  labelSides: Map<string, { dx: number; dy: number }>;
  /** Physical problems the trace found, keyed by the component they belong to. */
  warnings: Map<string, string[]>;

  // UI state. Selection is per document: each tab remembers what was selected in it.
  selectedNodeId: string | null;

  /**
   * True when this document differs from the file it was last saved to (or from empty, for
   * a document that has never been saved). Drives the tab's dot and the close prompt.
   *
   * Compared by *fingerprint*, not by a flag flipped on every action, so it has two
   * properties a flag would not: clicking a component does not count as an edit, and
   * undoing back to the saved state clears it again.
   */
  dirty: boolean;

  /**
   * Fingerprint of the content the file holds — the thing `dirty` is measured against.
   *
   * In state rather than in a closure because it is part of what a document *is*: a session
   * snapshot has to write it down, or a document that was unsaved when the window closed
   * would come back looking saved.
   */
  savedFingerprint: string;

  /**
   * Where this document's canvas is scrolled and zoomed to, or null before it has been
   * looked at. Per document, and load-bearing: switching tabs unmounts the canvas, so
   * without this every switch would re-frame the layout with `fitView`. Session state, not
   * layout data — deliberately not part of `getLayout()`.
   */
  viewport: { x: number; y: number; zoom: number } | null;

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

  /**
   * Add components and wiring — a paste. Snapshots first, so one Ctrl+Z takes it back, and
   * deselects everything already on the canvas so only the new arrivals are selected.
   */
  insertNodes: (nodes: Node<OpticalNodeData>[], edges?: Edge<BeamEdgeData>[]) => void;

  /** Remove components and any wiring that touched them — a cut. Also undoable. */
  removeNodes: (ids: string[]) => void;

  // Undo/redo
  undo: () => void;
  redo: () => void;

  setSelectedNode: (id: string | null) => void;
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  /** Called after a successful write: this state is now what the file holds. */
  markSaved: () => void;

  // Persistence
  loadLayout: (data: { nodes: Node<OpticalNodeData>[]; edges: Edge<BeamEdgeData>[] }) => void;
  getLayout: () => { nodes: Node<OpticalNodeData>[]; edges: Edge<BeamEdgeData>[] };

  // Internal
  recomputeBeams: () => void;
}

/** A single document's store. */
export type LayoutStoreApi = StoreApi<LayoutState>;

/** Everything a document can be created holding. */
export interface LayoutInit {
  nodes?: Node<OpticalNodeData>[];
  edges?: Edge<BeamEdgeData>[];
  /** Where the canvas was, for a document coming back from a previous session. */
  viewport?: { x: number; y: number; zoom: number } | null;
  /**
   * Fingerprint of the state the *file* holds, when that differs from the state being
   * restored — which is how a document that was dirty when the tab closed comes back
   * dirty. Defaults to the given content, i.e. clean.
   */
  savedFingerprint?: string;
}

/**
 * Create a store for one document, optionally pre-loaded — session restore and "open in a
 * new tab" both hand it a layout that has already been read and migrated.
 */
export function createLayoutStore(initial?: LayoutInit): LayoutStoreApi {
  const store = createStore<LayoutState>()((set, get) => {
    // Last routeKey we traced, so pure re-renders don't re-run the engine.
    let lastRouteKey = '';

    /** Run the one engine over the given layout and publish its beam output. */
    const trace = (nodes: Node<OpticalNodeData>[], userEdges: Edge[], force = false) => {
      const key = routeKey(nodes, userEdges);
      if (!force && key === lastRouteKey) return;
      lastRouteKey = key;
      const { segments, beams, nodeBeams, nodeArrivals, labelSides, warnings: found } = autoRoute(
        nodes.filter(isOpticalNode),
        userEdges,
      );
      const warnings = new Map<string, string[]>();
      for (const w of found) {
        const list = warnings.get(w.nodeId);
        if (list) list.push(w.message);
        else warnings.set(w.nodeId, [w.message]);
      }
      set({ segments, beamMap: beams, nodeBeams, nodeArrivals, labelSides, warnings });
    };

    const startNodes = initial?.nodes ?? [];
    const startEdges = initial?.edges ?? [];

    /**
     * A document opened from a file starts at that file's content; a new document starts at
     * empty, which is what "unchanged" means for something never saved. A restored document
     * brings its own, so unsaved work still looks unsaved after a reload.
     */
    const startFingerprint = initial?.savedFingerprint
      ?? layoutFingerprint(startNodes, startEdges);

    /** Recompute `dirty` from the current content. Cheap, and called only on mutation. */
    const refreshDirty = () => {
      const { nodes, edges, savedFingerprint } = get();
      set({ dirty: layoutFingerprint(nodes, edges) !== savedFingerprint });
    };

    return {
      nodes: startNodes,
      edges: startEdges,
      segments: [],
      beamMap: new Map(),
      nodeBeams: new Map(),
      nodeArrivals: new Map(),
      labelSides: new Map(),
      warnings: new Map(),
      selectedNodeId: null,
      dirty: layoutFingerprint(startNodes, startEdges) !== startFingerprint,
      savedFingerprint: startFingerprint,
      viewport: initial?.viewport ?? null,
      canvasVersion: 0,
      history: [],
      future: [],

      syncFromCanvas: (nodes, edges) => {
        // Only user-drawn edges are persisted; auto_ routing edges are always
        // re-derived by the engine and never stored or saved.
        const userEdges = edges.filter(e => !e.id.startsWith('auto_'));
        set({
          nodes,
          edges: userEdges,
          dirty: layoutFingerprint(nodes, userEdges) !== get().savedFingerprint,
        });
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
        refreshDirty();
      },

      insertNodes: (incoming, incomingEdges = []) => {
        const { nodes, edges } = get();
        get().saveSnapshot(nodes, edges);
        set(state => ({
          nodes: [
            ...state.nodes.map(n => ({ ...n, selected: false })),
            ...incoming,
          ],
          edges: [...state.edges, ...incomingEdges],
          canvasVersion: state.canvasVersion + 1,
        }));
        get().recomputeBeams();
        refreshDirty();
      },

      removeNodes: (ids) => {
        if (ids.length === 0) return;
        const { nodes, edges } = get();
        get().saveSnapshot(nodes, edges);
        const gone = new Set(ids);
        set(state => ({
          nodes: state.nodes.filter(n => !gone.has(n.id)),
          // An edge to a component that is gone would dangle.
          edges: state.edges.filter(e => !gone.has(e.source) && !gone.has(e.target)),
          selectedNodeId: gone.has(state.selectedNodeId ?? '') ? null : state.selectedNodeId,
          canvasVersion: state.canvasVersion + 1,
        }));
        get().recomputeBeams();
        refreshDirty();
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
        refreshDirty();
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
        refreshDirty();
      },

      setSelectedNode: (id) => set({ selectedNodeId: id }),
      setViewport: (viewport) => set({ viewport }),

      markSaved: () => {
        const { nodes, edges } = get();
        set({ savedFingerprint: layoutFingerprint(nodes, edges), dirty: false });
      },

      loadLayout: (data) => {
        set((state) => ({
          nodes: data.nodes,
          edges: data.edges,
          history: [],
          future: [],
          // Loading defines a new baseline: the document now matches what is on disk.
          savedFingerprint: layoutFingerprint(data.nodes, data.edges),
          dirty: false,
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

  // Trace straight away when created with content. Without this a document restored from a
  // session — or opened into a new tab — holds components and no beams until something
  // else provokes a trace: the editor canvas does so on mount, but the Diagram view only
  // renders `segments`, and `activeView` is itself restored, so it can be the first thing
  // you see.
  if (store.getState().nodes.length > 0) store.getState().recomputeBeams();

  return store;
}
