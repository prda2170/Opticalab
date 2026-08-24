// The Diagram tab: the editor's canvas, and a way to get it out as a figure.
//
// It used to be a second picture of the layout — different node styling, different label
// sizes, arrowheads, per-component annotations, its own spacing. That is why it never looked
// as good as the editor: two renderers, one of them the one nobody was looking at while they
// worked. Now the tab mounts the *same* canvas in `figure` mode, so the answer to "will the
// figure look like this?" is yes by construction.
//
// Export still goes through a flat SVG (`FigureSVG`), because vector art has to open in
// Illustrator and serialised HTML does not. It is rendered off-screen here, at its natural
// size, so Export is instant and always matches what is on screen.
import React, { useRef } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { EditorCanvas } from '../Editor/EditorCanvas';
import { FigureSVG } from './FigureSVG';
import { useLayout } from '../../store/layoutContext';
import { useWorkspace } from '../../store/workspaceStore';
import { downloadSVG, downloadPNG } from '../../utils/export';
import { canvasBg } from '../../utils/canvasStyle';

export const FigurePanel: React.FC = () => {
  const theme = useWorkspace(s => s.theme);
  const nodes = useLayout(s => s.nodes);
  const svgRef = useRef<SVGSVGElement>(null);
  const dark = theme === 'dark';

  const borderColor = dark ? '#374151' : '#e2e8f0';
  const textSecondary = dark ? '#94a3b8' : '#475569';
  const btn = {
    background: dark ? '#1e2030' : '#e2e8f0',
    color: dark ? '#e2e8f0' : '#374151',
  };

  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-full" style={{ background: canvasBg(dark) }}>
        <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap"
          style={{ borderColor, flexShrink: 0 }}>
          <span className="text-xs font-semibold" style={{ color: textSecondary }}>FIGURE</span>
          <div className="flex-1" />
          <button
            onClick={() => svgRef.current && downloadSVG(svgRef.current, 'opticalab_figure.svg')}
            className="px-2 py-0.5 text-xs rounded" title="Export as SVG (vector, opens in Illustrator)"
            style={btn}
          >
            ⤓ SVG
          </button>
          <button
            onClick={() => svgRef.current && downloadPNG(svgRef.current, 'opticalab_figure.png', canvasBg(dark), 2)}
            className="px-2 py-0.5 text-xs rounded" title="Export as PNG (2× scale)"
            style={btn}
          >
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
            <EditorCanvas mode="figure" />
          </div>
        )}

        {/* Off-screen, at natural size: `downloadPNG` rasterises this node, and a zero-sized
            or display:none SVG gives a blank image. */}
        <div style={{ position: 'absolute', left: -100000, top: 0, pointerEvents: 'none' }}
          aria-hidden="true">
          <FigureSVG ref={svgRef} />
        </div>
      </div>
    </ReactFlowProvider>
  );
};
