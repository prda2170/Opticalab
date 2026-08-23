// Spacing the figure out without lying about it.
//
// A bench that is dense enough to align is denser than a figure wants to be: components an
// inch apart leave no room for a name, and a reader cannot tell two nearby beams apart. The
// diagram therefore draws the layout **spread**: every distance between components is
// multiplied by a factor, while the components themselves stay the size they are.
//
// This is a display transform, like `renderShift` — the traced geometry is untouched, so
// `lengthMm`, spot sizes and detunings in the figure are still the ones the tracer computed
// for the real bench. Zooming would scale the icons too, which is a different thing entirely
// and does nothing for crowding.
//
// The transform is a uniform scaling about the origin, which is what makes it safe: it maps
// every straight line to a straight line and preserves every angle exactly, so a 15° beam is
// still at 15° and components on a beam are still on it. Two corrections keep it honest:
//
//   1. **Face trims don't scale.** A beam stops at a component's surface, a distance fixed by
//      the component's own size. Scale it and the beam stops short of an icon that did not
//      grow, leaving a gap at every optic. So each endpoint is pulled back *along the beam*
//      by the part of the scaling that belongs to the trim.
//   2. **Perpendicular offsets do scale.** A dumped order leaving one inch off-axis is a
//      bench distance, not a feature of the device, and scaling it is what keeps the beam
//      exactly parallel to where it was. The component artwork that points at that lane
//      (`aom`'s dump stub) has to scale its offset to match — hence `factor` is exposed.
import type { Node } from '@xyflow/react';
import type { OpticalNodeData } from '../types/components';
import type { BeamSegment } from '../types/beam';
import { drawnEndpoints } from './beamLayout';
import { getNodeGeometry } from '../utils/nodeGeometry';
import type { Pt } from './geometry';

/** How far apart the diagram spreads a layout out of the box. */
export const DEFAULT_SPREAD = 1.4;

/** Drawn endpoints of one segment, after spreading. */
export interface SpreadSegment { x1: number; y1: number; x2: number; y2: number }

export interface SpreadTransform {
  /** The spacing factor. 1 is the bench as traced. */
  factor: number;
  /** A point that belongs to the bench rather than to a component: a node centre, a probe. */
  point(p: Pt): Pt;
  /** A beam, spread but still touching the same faces of the same icons. */
  segment(seg: BeamSegment): SpreadSegment;
  /** Where this segment's waist marker goes, or null if it has none. */
  waist(seg: BeamSegment): Pt | null;
}

/** Centre of every real node, in traced coordinates. */
function centreMap(nodes: Node<OpticalNodeData>[]): Map<string, Pt> {
  const centres = new Map<string, Pt>();
  for (const node of nodes) {
    const g = getNodeGeometry(node.data.type, node.data.rotation ?? 0);
    centres.set(node.id, {
      x: node.position.x + g.width / 2,
      y: node.position.y + g.height / 2,
    });
  }
  return centres;
}

/**
 * Build the transform for one layout.
 *
 * `factor = 1` is the identity, to the last decimal place — the diagram at rest draws exactly
 * what the tracer produced.
 */
export function makeSpread(nodes: Node<OpticalNodeData>[], factor: number): SpreadTransform {
  const centres = centreMap(nodes);
  const k = factor;

  const segment = (seg: BeamSegment): SpreadSegment => {
    const { x1, y1, x2, y2 } = drawnEndpoints(seg);
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (k === 1 || len < 1e-9) return { x1: x1 * k, y1: y1 * k, x2: x2 * k, y2: y2 * k };

    // Unit vector along the beam, from its own endpoints: no angle arithmetic, so a beam at
    // any lattice angle (or a user-wired one that is off it) is treated identically.
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;

    // How far the drawn beam sits from each component's centre, measured along the beam.
    // This is the face trim, and it must survive the scaling unchanged. A free beam has no
    // component at its far end, so there is nothing to hold on to and it simply scales.
    const from = centres.get(seg.sourceId);
    const to = centres.get(seg.targetId);
    const trimStart = from ? (x1 - from.x) * ux + (y1 - from.y) * uy : 0;
    const trimEnd = to ? (to.x - x2) * ux + (to.y - y2) * uy : 0;
    const back = (k - 1) * trimStart;
    const fwd = (k - 1) * trimEnd;

    return {
      x1: x1 * k - back * ux, y1: y1 * k - back * uy,
      x2: x2 * k + fwd * ux, y2: y2 * k + fwd * uy,
    };
  };

  return {
    factor: k,
    point: (p: Pt) => ({ x: p.x * k, y: p.y * k }),
    segment,
    waist: (seg: BeamSegment) => {
      if (!seg.waist) return null;
      const { x1, y1, x2, y2 } = drawnEndpoints(seg);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const drawn = segment(seg);
      if (len < 1e-9) return { x: drawn.x1, y: drawn.y1 };
      // Proportionally along the drawn beam, so the marker cannot drift off either end
      // however the trims at the two ends compare.
      const t = ((seg.waist.x - x1) * (x2 - x1) + (seg.waist.y - y1) * (y2 - y1)) / (len * len);
      return {
        x: drawn.x1 + t * (drawn.x2 - drawn.x1),
        y: drawn.y1 + t * (drawn.y2 - drawn.y1),
      };
    },
  };
}
