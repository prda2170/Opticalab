// The Diagram tab: the editor's canvas, the annotation tools, and a way out as a figure.
//
// It used to be a second picture of the layout — different node styling, different label
// sizes, arrowheads, per-component annotations, its own spacing. That is why it never looked
// as good as the editor: two renderers, one of them the one nobody was looking at while they
// worked. Now the tab mounts the *same* canvas in `figure` mode, so the answer to "will the
// figure look like this?" is yes by construction.
//
// What the tab adds is the part a figure needs and a bench editor does not: highlight regions
// and text notes. Both are ordinary nodes (see RegionNode/NoteNode), so they are draggable and
// resizable here, saved with the layout, and undoable — none of which is new code.
//
// Export still goes through a flat SVG (`FigureSVG`), because vector art has to open in
// Illustrator and serialised HTML does not. It is rendered off-screen here, at its natural
// size, so Export is instant and always matches what is on screen.
import React, { useCallback, useRef } from 'react';
import { ReactFlowProvider, useReactFlow, type Node } from '@xyflow/react';
import { EditorCanvas } from '../Editor/EditorCanvas';
import { PropertiesPanel } from '../Editor/PropertiesPanel';
import { FigureSVG } from './FigureSVG';
import { useLayout } from '../../store/layoutContext';
import { useWorkspace } from '../../store/workspaceStore';
import { downloadSVG, downloadPNG } from '../../utils/export';
import { canvasBg } from '../../utils/canvasStyle';
import { PALETTE } from '../../utils/palette';
import type { OpticalNodeData } from '../../types/components';

let annotationCounter = 1;

/** Toolbar and canvas, inside the flow provider so the tools can place things in view. */
const FigureBody: React.FC = () => {
  const theme = useWorkspace(s => s.theme);
  const nodes = useLayout(s => s.nodes);
  const insertNodes = useLayout(s => s.insertNodes);
  const setSelectedNode = useLayout(s => s.setSelectedNode);
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();
  const dark = theme === 'dark';

  /** Drop a fresh annotation in the middle of what the user is looking at. */
  const addAnnotation = useCallback((type: 'region' | 'note') => {
    const entry = PALETTE.find(e => e.type === type);
    if (!entry) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const centre = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 0, y: 0 };
    const data = { ...entry.defaultData } as OpticalNodeData;
    // Centred on the view, not hanging off its top-left corner.
    const w = typeof (data as { w?: number }).w === 'number' ? (data as { w: number }).w : 180;
    const h = typeof (data as { h?: number }).h === 'number' ? (data as { h: number }).h : 40;
    const node: Node<OpticalNodeData> = {
      id: `annot_${Date.now()}_${annotationCounter++}`,
      type,
      position: { x: Math.round(centre.x - w / 2), y: Math.round(centre.y - h / 2) },
      data,
      selected: true,
    };
    insertNodes([node]);
    setSelectedNode(node.id);
  }, [insertNodes, screenToFlowPosition, setSelectedNode]);

  const borderColor = dark ? '#374151' : '#e2e8f0';
  const textSecondary = dark ? '#94a3b8' : '#475569';
  const btn = {
    background: dark ? '#1e2030' : '#e2e8f0',
    color: dark ? '#e2e8f0' : '#374151',
  };

  return (
    <div className="flex flex-col h-full" style={{ background: canvasBg(dark) }}>
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap"
        style={{ borderColor, flexShrink: 0 }}>
        <span className="text-xs font-semibold" style={{ color: textSecondary }}>FIGURE</span>
        <div className="flex-1" />

        <button onClick={() => addAnnotation('region')}
          className="px-2 py-0.5 text-xs rounded" style={btn}
          title="Highlight an area of the layout. Drag it by its border; resize from the corners.">
          ▭ Region
        </button>
        <button onClick={() => addAnnotation('note')}
          className="px-2 py-0.5 text-xs rounded" style={btn}
          title="Add text. Takes \lambda-style symbol names and ^{}/_{} scripts.">
          T Note
        </button>

        <div style={{ width: 1, height: 16, background: borderColor }} />
        <button
          onClick={() => svgRef.current && downloadSVG(svgRef.current, 'opticalab_figure.svg')}
          className="px-2 py-0.5 text-xs rounded" style={btn}
          title="Export as SVG (vector — opens in Illustrator or Inkscape)">
          ⤓ SVG
        </button>
        <button
          onClick={() => svgRef.current && downloadPNG(svgRef.current, 'opticalab_figure.png', canvasBg(dark), 2)}
          className="px-2 py-0.5 text-xs rounded" style={btn}
          title="Export as PNG (2× scale)">
          ⤓ PNG
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm"
          style={{ color: dark ? '#64748b' : '#94a3b8' }}>
          No components in layout. Build a layout in the Editor tab.
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <div ref={canvasRef} className="flex flex-1 overflow-hidden">
            <EditorCanvas mode="figure" />
          </div>
          <PropertiesPanel />
        </div>
      )}

      {/* Off-screen, at natural size: `downloadPNG` rasterises this node, and a zero-sized
          or display:none SVG gives a blank image. */}
      <div style={{ position: 'absolute', left: -100000, top: 0, pointerEvents: 'none' }}
        aria-hidden="true">
        <FigureSVG ref={svgRef} />
      </div>
    </div>
  );
};

export const FigurePanel: React.FC = () => (
  <ReactFlowProvider>
    <FigureBody />
  </ReactFlowProvider>
);
