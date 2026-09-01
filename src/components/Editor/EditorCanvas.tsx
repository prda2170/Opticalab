// Main React Flow canvas editor — uses ReactFlow's own state hooks to avoid Zustand re-render loops
import React, { useCallback, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ViewportPortal,
  type NodeTypes,
  type EdgeTypes,
  BackgroundVariant,
  useReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
// Override xyflow handle styles AFTER the xyflow CSS so our rules win
import '../../styles/handles.css';

import { useLayout, useLayoutApi } from '../../store/layoutContext';
import { useWorkspace } from '../../store/workspaceStore';
import OpticalNode from '../Nodes/OpticalNode';
import BeamEndpointNode from '../Nodes/BeamEndpointNode';
import PowerProbeNode from '../Nodes/PowerProbeNode';
import RegionNode from '../Nodes/RegionNode';
import NoteNode from '../Nodes/NoteNode';
import BeamEdge from '../Edges/BeamEdge';
import type { OpticalNodeData, BeamEdgeData } from '../../types/components';
import type { PaletteEntry } from '../../types/components';
import { isOpticalNode, isAnnotationNode } from '../../types/components';
import { stackZIndex } from '../../utils/stacking';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import { probeSnaps } from '../../physics/probe';
import { autoRoute } from '../../physics/autoRoute';
import { CANVAS_GRID, canvasBg, gridColour } from '../../utils/canvasStyle';
import {
  groupSiblingMoves, rigidGroupSnaps, groupBounds, selectedGroupIds,
} from '../../utils/grouping';

type AppNode = Node<OpticalNodeData>;
type AppEdge = Edge<BeamEdgeData>;

const nodeTypes: NodeTypes = {
  optical: OpticalNode,
  beam_endpoint: BeamEndpointNode,
  power_probe: PowerProbeNode,
  region: RegionNode,
  note: NoteNode,
};


const edgeTypes: EdgeTypes = { beam: BeamEdge };

/** Breathing room between a group's components and the dashed box around them, px. */
const GROUP_OUTLINE_PAD = 8;

let nodeIdCounter = 1;
const newNodeId = () => `node_${Date.now()}_${nodeIdCounter++}`;

/**
 * How the canvas behaves. `edit` is the editor; `figure` is the Diagram tab, which draws the
 * *same* canvas — that is the whole point of it — with the optics pinned and the interaction
 * chrome out of the way, so what you see is what the figure exports.
 */
export type CanvasMode = 'edit' | 'figure';

export const EditorCanvas: React.FC<{ mode?: CanvasMode }> = ({ mode = 'edit' }) => {
  const isFigure = mode === 'figure';
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<AppNode>([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<AppEdge>([]);

  const canvasVersion   = useLayout(s => s.canvasVersion);
  const theme           = useWorkspace(s => s.theme);
  // Where this document was last looked at. Switching tabs unmounts the canvas, so
  // without this every switch would re-frame the layout from scratch.
  const savedViewport   = useLayout(s => s.viewport);
  const setViewport     = useLayout(s => s.setViewport);
  const setSelectedNode = useLayout(s => s.setSelectedNode);
  const syncFromCanvas  = useLayout(s => s.syncFromCanvas);
  const saveSnapshot    = useLayout(s => s.saveSnapshot);

  // The document's store object, for reads that must not subscribe: the reload effect
  // below wants the state as it is *now*, not as it was when the component last rendered.
  const layoutApi = useLayoutApi();

  const { screenToFlowPosition } = useReactFlow();


  // ── Reload from Zustand on undo/redo/load ──────────────────────────────────
  // Keep existing auto-edges when reloading (they're not stored in Zustand history).
  useEffect(() => {
    const state = layoutApi.getState();
    const loaded = (state.nodes as AppNode[]).map(n => ({
      ...n,
      // The figure pins the optics — it is a view of the bench, not a second place to move
      // it — but regions and notes are exactly what you are there to place, so they stay
      // free in both tabs.
      draggable: !(n.data as OpticalNodeData).locked && (!isFigure || isAnnotationNode(n)),
      zIndex: stackZIndex(n),
    }));
    // Preserve existing phantom endpoint nodes — they are not in Zustand but must
    // survive canvasVersion bumps (e.g. lock/unlock) so beams don't flash invisible.
    setNodes(prev => {
      const phantoms = prev.filter(n => n.type === 'beam_endpoint');
      return [...loaded, ...phantoms];
    });
    setEdges(prev => {
      const autoEdges = prev.filter(e => e.id.startsWith('auto_'));
      const userEdges = state.edges as AppEdge[];
      // Merge: user edges from store + preserved auto edges
      const userIds = new Set(userEdges.map(e => e.id));
      const freshAuto = autoEdges.filter(e => !userIds.has(e.id));
      return [...userEdges, ...freshAuto];
    });
  }, [canvasVersion, layoutApi, setNodes, setEdges, isFigure]);

  // ── Auto-routing ───────────────────────────────────────────────────────────
  // Runs after node changes only (not edge changes, to avoid feedback loops).
  // Computes physics beam paths and snaps nearby components onto those paths.
  const routeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging  = useRef(false);

  useEffect(() => {
    if (routeTimer.current) clearTimeout(routeTimer.current);
    // 50 ms debounce — prevents autoRoute from running during rapid drag events.
    // The timer keeps getting cancelled while the user is dragging and only fires
    // after the drag (or any other node change) settles.
    routeTimer.current = setTimeout(() => {

      // User-drawn edges are anything without our 'auto_' prefix.
      const userEdges = edges.filter(e => !e.id.startsWith('auto_'));
      // Only optics go to the router; phantom endpoints and probes are annotations.
      const realNodes = (nodes as AppNode[]).filter(isOpticalNode);

      const { autoEdges, snaps, rotations, beamInDirs, phantomNodes, segments } =
        autoRoute(realNodes, userEdges as Edge[]);

      // Probes ride on the finished beams, so they are snapped after the trace and
      // merged into the same map the optics' snaps go through.
      for (const [nid, pos] of probeSnaps(
        (nodes as AppNode[])
          .filter(n => n.type === 'power_probe')
          .map(n => {
            const g = getNodeGeometry('power_probe');
            return { id: n.id, position: n.position, width: g.width, height: g.height, locked: (n.data as OpticalNodeData).locked };
          }),
        segments,
      )) {
        snaps.set(nid, pos);
      }

      // A grouped component cannot be snapped on its own without deforming the group, so
      // one member's offset is applied to all of them. See `rigidGroupSnaps`.
      const rigid = rigidGroupSnaps(nodes as Node<OpticalNodeData>[], snaps);

      // Apply position snaps, rotations, and beam-incoming-directions.
      const rotChanged = rotations.size > 0 && [...rotations.entries()].some(
        ([nid, rot]) => {
          const node = (nodes as AppNode[]).find(nn => nn.id === nid);
          return node && ((node.data as OpticalNodeData).rotation ?? 0) !== rot;
        }
      );
      const dirChanged = beamInDirs.size > 0 && [...beamInDirs.entries()].some(
        ([nid, dir]) => {
          const node = (nodes as AppNode[]).find(nn => nn.id === nid);
          const cur  = (node?.data as OpticalNodeData | undefined)?.beamIncomingDir;
          return !cur || cur.dx !== dir.dx || cur.dy !== dir.dy;
        }
      );
      const needNodeUpdate = rigid.size > 0 || rotChanged || dirChanged;
      const newNodes = needNodeUpdate
        ? (nodes as AppNode[]).map(n => {
            const snap  = rigid.get(n.id);
            const rot   = rotations.get(n.id);
            const dir   = beamInDirs.get(n.id);
            // Never move a fixed (locked) component via auto-snap.
            let updated: AppNode = (snap && !(n.data as OpticalNodeData).locked) ? { ...n, position: snap } : n;
            if (rot !== undefined && !((n.data as OpticalNodeData).locked) && ((n.data as OpticalNodeData).rotation ?? 0) !== rot) {
              updated = { ...updated, data: { ...updated.data, rotation: rot } as OpticalNodeData };
            }
            if (dir !== undefined) {
              const cur = (updated.data as OpticalNodeData).beamIncomingDir;
              if (!cur || cur.dx !== dir.dx || cur.dy !== dir.dy) {
                updated = { ...updated, data: { ...updated.data, beamIncomingDir: dir } as OpticalNodeData };
              }
            }
            return updated;
          })
        : (nodes as AppNode[]);

      // Merge user edges + fresh auto edges (deduplicate by id).
      const idSet = new Set(userEdges.map(e => e.id));
      const freshAuto = (autoEdges as AppEdge[]).filter(e => !idSet.has(e.id));
      const merged = [...userEdges, ...freshAuto];

      // Check whether anything actually changed before calling setState.
      // Also detect data changes (e.g. tx/ty updates when a mirror rotates).
      const prevAutoEdgeMap = new Map(edges.filter(e => e.id.startsWith('auto_')).map(e => [e.id, e]));
      const autoChanged =
        prevAutoEdgeMap.size !== autoEdges.length ||
        autoEdges.some(e => {
          const prev = prevAutoEdgeMap.get(e.id);
          if (!prev) return true;
          const pd = prev.data as BeamEdgeData | undefined;
          const nd = e.data as BeamEdgeData | undefined;
          return pd?.tx !== nd?.tx || pd?.ty !== nd?.ty || pd?.sx !== nd?.sx || pd?.sy !== nd?.sy;
        });

      if (autoChanged || needNodeUpdate) {
        // Merge real nodes (with any snaps/rotations applied) + fresh phantom endpoint nodes.
        const baseNodes = needNodeUpdate ? newNodes : (nodes as AppNode[]).filter(n => n.type !== 'beam_endpoint');
        setNodes([...baseNodes, ...(phantomNodes as AppNode[])]);
        setEdges(merged);
      }
    }, 50);

    return () => { if (routeTimer.current) clearTimeout(routeTimer.current); };
  // Only re-run when nodes change; edge changes from routing itself don't re-trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  // ── Sync → Zustand for beam propagation ───────────────────────────────────
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Skip syncing entirely while the user is actively dragging a node.
    // The drag-stop handler will flush the sync when the drag ends.
    if (isDragging.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      syncFromCanvas((nodes as AppNode[]).filter(n => n.type !== 'beam_endpoint'), edges as AppEdge[]);
    }, 150);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [nodes, edges, syncFromCanvas]);

  // ── Node changes: a group moves as one ────────────────────────────────────
  // Done here rather than on selection, so a group holds together whether or not the user
  // clicked every member first — which is what "dragging moves them as a group" means.
  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const extra = groupSiblingMoves(changes, nodes as Node<OpticalNodeData>[]);
      onNodesChangeBase(extra.length > 0 ? [...changes, ...extra] : changes);
    },
    [nodes, onNodesChangeBase],
  );

  /**
   * A click selects what was clicked, and nothing else.
   *
   * This used to expand the selection to the clicked node's whole group, so that Copy, Cut and
   * Delete would act on all of it. That was wrong, and visibly so: **selection has to be
   * literal**. Adding one member to a selection dragged in its siblings from the other side of
   * the bench, a box selection that caught one member silently grew, and — worse — clicking a
   * grouped component could never show its own properties, because two selected nodes switch
   * the panel to the group actions.
   *
   * Grouping does not need it. `groupSiblingMoves` moves a group by delta on any drag, selected
   * or not, which is what "dragging moves them as a group" actually asked for. Copy, Cut and
   * Delete now take exactly what is selected; box-select a group to act on all of it.
   */
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: AppNode) => setSelectedNode(node.id),
    [setSelectedNode],
  );

  // ── Edge changes: block deletion of auto-edges ────────────────────────────
  const onEdgesChange = useCallback(
    (changes: EdgeChange<AppEdge>[]) => {
      const safe = changes.filter(
        c => !(c.type === 'remove' && c.id.startsWith('auto_')),
      );
      onEdgesChangeBase(safe);
    },
    [onEdgesChangeBase],
  );

  // ── Manual connect ─────────────────────────────────────────────────────────
  const onConnect = useCallback(
    (connection: Connection) => {
      saveSnapshot(nodes as AppNode[], edges as AppEdge[]);
      setEdges((prev) =>
        addEdge(
          {
            ...connection,
            type: 'beam',
            data: { wavelength: 780, power: 1, polarization: 'H' } as BeamEdgeData,
          },
          prev,
        ) as AppEdge[],
      );
    },
    [nodes, edges, saveSnapshot, setEdges],
  );

  // ── Drag-and-drop from palette ─────────────────────────────────────────────
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData('application/opticalab-node');
      if (!raw) return;
      const entry: PaletteEntry = JSON.parse(raw);
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      saveSnapshot(nodes as AppNode[], edges as AppEdge[]);
      setNodes((prev) => [
        ...prev,
        {
          id: newNodeId(),
          type: entry.nodeType ?? 'optical',
          position,
          data: { ...entry.defaultData } as OpticalNodeData,
        } as AppNode,
      ]);
    },
    [screenToFlowPosition, nodes, edges, saveSnapshot, setNodes],
  );

  const isDark = theme === 'dark';

  return (
    <div
      className={`flex-1${isFigure ? ' opticalab-figure' : ''}`}
      style={{ background: canvasBg(isDark) }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onNodeDragStart={() => { isDragging.current = true; }}
        onNodeDragStop={() => {
          isDragging.current = false;
          // Flush sync immediately after drag ends so beams update promptly.
          if (syncTimer.current) clearTimeout(syncTimer.current);
          syncFromCanvas((nodes as AppNode[]).filter(n => n.type !== 'beam_endpoint'), edges as AppEdge[]);
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesConnectable={!isFigure}
        onPaneClick={() => setSelectedNode(null)}
        onMoveEnd={(_, viewport) => setViewport(viewport)}
        // Frame the layout only the first time a document is opened; after that, come back
        // to wherever the user left it.
        defaultViewport={savedViewport ?? undefined}
        fitView={savedViewport === null}
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{ type: 'beam' }}
        deleteKeyCode="Delete"
        onNodeClick={onNodeClick}
        // Ctrl (or Cmd) to add to a selection, as asked for. Shift stays because it is also
        // `selectionKeyCode` — Shift-drag draws a selection box — and having the two halves
        // of the same gesture on one modifier is worth keeping.
        multiSelectionKeyCode={['Control', 'Meta', 'Shift']}

        onlyRenderVisibleElements={false}
        style={{ background: 'transparent' }}
      >
        {/* Group outlines. Only while a member is selected, and only on the canvas: a group
            is an editing aid, not part of the layout, so it has no business in the figure.
            `ViewportPortal` puts them in the panned/zoomed frame without making them nodes,
            which keeps them out of the trace and out of the way of clicks. */}
        <ViewportPortal>
          {selectedGroupIds(nodes as Node<OpticalNodeData>[]).map(groupId => {
            const box = groupBounds(nodes as Node<OpticalNodeData>[], groupId);
            if (!box) return null;
            const pad = GROUP_OUTLINE_PAD;
            return (
              <div
                key={groupId}
                style={{
                  position: 'absolute',
                  left: box.x - pad, top: box.y - pad,
                  width: box.width + pad * 2, height: box.height + pad * 2,
                  border: `1px dashed ${isDark ? '#64748b' : '#94a3b8'}`,
                  borderRadius: 6,
                  pointerEvents: 'none',
                }}
              />
            );
          })}
        </ViewportPortal>

        <Background
          variant={BackgroundVariant.Dots}
          color={gridColour(isDark)}
          gap={CANVAS_GRID.gap}   /* one dot per breadboard hole */
          size={CANVAS_GRID.size}
        />
        <Controls
          style={{
            background: isDark ? '#1e2030' : '#fff',
            border: isDark ? '1px solid #374151' : '1px solid #e2e8f0',
          }}
        />
        {!isFigure && <MiniMap
          style={{
            background: isDark ? '#1e2030' : '#f1f5f9',
            border: isDark ? '1px solid #374151' : '1px solid #e2e8f0',
          }}
          nodeColor={(n) => {
            const colors: Record<string, string> = {
              source: '#ef4444', conditioning: '#f97316', steering: '#eab308',
              lens: '#22c55e', fiber: '#3b82f6', modulation: '#a855f7',
              detection: '#6b7280', cavity: '#9ca3af', coldatom: '#92400e',
            };
            return colors[(n.data as OpticalNodeData)?.category ?? ''] ?? '#6b7280';
          }}
        />}
      </ReactFlow>
    </div>
  );
};
