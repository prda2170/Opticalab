// BeamTailOverlay — renders "infinite" beam tails for unobstructed rays.
// Uses an absolutely-positioned SVG over the ReactFlow canvas, converting
// canvas coordinates to screen coordinates via the xyflow viewport transform.
import React, { memo, useRef } from 'react';
import { wavelengthToRGB } from '../../utils/colormap';

interface FreeTail {
  sourceId:     string;
  sourceHandle: string;
  origin:       { x: number; y: number };
  dir:          { dx: number; dy: number };
  wavelength:   number;
  power:        number;
  pol:          string;
}

interface Viewport { x: number; y: number; zoom: number }

interface Props {
  freeTails: FreeTail[];
  viewport:  Viewport;
}

/** Canvas coordinate → screen pixel, given the xyflow viewport transform. */
function canvasToScreen(cx: number, cy: number, vp: Viewport) {
  return {
    sx: cx * vp.zoom + vp.x,
    sy: cy * vp.zoom + vp.y,
  };
}

const BeamTailOverlay: React.FC<Props> = ({ freeTails, viewport }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Extend each tail 4000 canvas-units beyond its origin so it always exits the viewport.
  const FAR = 4000;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        zIndex: 0,   // below nodes but above background
      }}
    >
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}
      >
        {freeTails.map(tail => {
          const color = wavelengthToRGB(tail.wavelength);
          const { sx: x1, sy: y1 } = canvasToScreen(tail.origin.x, tail.origin.y, viewport);
          const endCanvas = {
            x: tail.origin.x + FAR * tail.dir.dx,
            y: tail.origin.y + FAR * tail.dir.dy,
          };
          const { sx: x2, sy: y2 } = canvasToScreen(endCanvas.x, endCanvas.y, viewport);
          return (
            <line
              key={`${tail.sourceId}_${tail.sourceHandle}`}
              x1={x1} y1={y1}
              x2={x2} y2={y2}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.9}
            />
          );
        })}
      </svg>
    </div>
  );
};

export default memo(BeamTailOverlay);
