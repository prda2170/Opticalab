// The chamber, drawn once for both renderers.
//
// The canvas and the figure export are separate renderers on purpose (see FigureSVG), and
// everything they both draw has to come from one place or they drift. For most components
// that shared thing is an icon from `NodeIcons`; a chamber is data-driven enough — sides,
// inradius, per-port state — that it gets its own file.
//
// Plan view: the polygon body, a stub and flange plate on each flat, and the vertical port
// bore as an inner circle. A closed port is filled solid; a viewport is left open with a
// window line across it, which is the distinction the physics acts on.
import React from 'react';
import type { OpticalNodeData } from '../../types/components';
import {
  chamberSpec, faceNormalDeg, faceHalfWidthPx, polygonPoints,
} from '../../physics/chamber';

/** Proportions of the drawn hardware, in px unless noted. */
const ART = {
  /** Flange plate thickness, radially. */
  plate: 7,
  /** How far the flange plate overhangs the bore, each side. */
  plateOverhang: 9,
  bodyStroke: 2,
  portStroke: 1.4,
  windowStroke: 1.2,
  /** Faint inner circle for the top/bottom port bore. */
  boreStroke: 1,
};

/**
 * The chamber as SVG, centred on the origin of its own frame.
 *
 * The caller positions and rotates it: on the canvas that is the node's artwork transform, in
 * the figure the component group's. Nothing here knows where on the bench it is.
 */
export const ChamberArt: React.FC<{
  data: OpticalNodeData;
  /** Body and hardware colour. */
  colour: string;
  /** Interior fill — the canvas uses its node background, the figure its page colour. */
  fill: string;
}> = ({ data, colour, fill }) => {
  const spec = chamberSpec(data);
  const pts = polygonPoints(spec.inradiusPx, spec.sides);
  const flatHalf = faceHalfWidthPx(spec.inradiusPx, spec.sides);
  const boreHalf = spec.borePx / 2;
  // The plate is as wide as the bore plus its overhang, but never wider than the flat it
  // bolts to — a flange that hangs past its own face would be drawing a part that does not fit.
  const plateHalf = Math.min(boreHalf + ART.plateOverhang, flatHalf);

  return (
    <g>
      {/* Body */}
      <polygon
        points={pts.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
        fill={fill}
        stroke={colour}
        strokeWidth={ART.bodyStroke}
        strokeLinejoin="round"
      />

      {/* Vertical port bore — the 10 in CF opening you look down through. Faint, because in
          plan view it is a hole in the top plate rather than an edge. */}
      {spec.topBorePx > 0 && spec.topBorePx / 2 < spec.inradiusPx && (
        <circle
          cx={0} cy={0} r={spec.topBorePx / 2}
          fill="none" stroke={colour} strokeWidth={ART.boreStroke}
          strokeOpacity={0.35} strokeDasharray="4,3"
        />
      )}

      {/* Side ports */}
      {spec.ports.map((state, i) => {
        const closed = state === 'closed';
        const R = spec.inradiusPx;
        return (
          <g key={i} transform={`rotate(${faceNormalDeg(spec.sides, i)})`}>
            {/* Bore through the wall, drawn only where it is open: a closed port has no
                light path to show. */}
            {!closed && (
              <line
                x1={R - spec.tubePx} y1={0} x2={R} y2={0}
                stroke={colour} strokeWidth={ART.portStroke} strokeOpacity={0.25}
              />
            )}
            {/* Tube walls out to the flange face. */}
            <line x1={R} y1={-boreHalf} x2={R + ART.plate} y2={-boreHalf}
              stroke={colour} strokeWidth={ART.portStroke} />
            <line x1={R} y1={boreHalf} x2={R + ART.plate} y2={boreHalf}
              stroke={colour} strokeWidth={ART.portStroke} />
            {/* Flange plate. Solid when blanked off, open when it carries a window. */}
            <rect
              x={R + ART.plate} y={-plateHalf}
              width={ART.plate} height={plateHalf * 2}
              fill={closed ? colour : fill}
              fillOpacity={closed ? 0.85 : 1}
              stroke={colour} strokeWidth={ART.portStroke}
            />
            {/* A viewport gets its window drawn across the aperture; a blank gets a bar
                across the bore, which is what stops the beam. */}
            {closed ? (
              <line x1={R + 1} y1={-boreHalf} x2={R + 1} y2={boreHalf}
                stroke={colour} strokeWidth={ART.bodyStroke} />
            ) : (
              <line
                x1={R + ART.plate + ART.plate / 2} y1={-boreHalf}
                x2={R + ART.plate + ART.plate / 2} y2={boreHalf}
                stroke={colour} strokeWidth={ART.windowStroke} strokeOpacity={0.7}
              />
            )}
          </g>
        );
      })}
    </g>
  );
};
