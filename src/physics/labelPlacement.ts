// Where a component's name goes, so that it does not sit on a beam.
//
// Labels used to be drawn directly below every component, which is fine while every beam
// runs horizontally and wrong the moment one does not: a vertical component has its beam
// running straight down through the label, and a diagonal beam cuts across it.
//
// So the side is chosen here, as a post-pass over the finished segments — the same shape as
// `fanCollinearSegments` and `probeSnaps`, and for the same reason: it is cosmetic geometry
// that both views must agree on. Deciding it in a renderer would let the canvas and the
// exported figure disagree, which is the one thing the architecture does not allow.
//
// What is published is a *direction*, not an offset. How far out to sit depends on the icon
// size, the font size and the label's own text, all of which the renderer already knows;
// what needs the beams is only which way to go.
import type { Node } from '@xyflow/react';
import type { OpticalNodeData } from '../types/components';
import type { BeamSegment } from '../types/beam';
import { drawnEndpoints } from './beamLayout';
import { bodyAxis } from './lanes';
import {
  perpOf, rotateBy, unitAt, angleOf, nearestOnSegment, boxHalfExtent,
  type Pt, type Vec2,
} from './geometry';
import { getNodeGeometry, drawnHalfExtents } from '../utils/nodeGeometry';
import { LABEL_BASE_PX } from '../utils/labelLayout';
import { annotationBox } from '../utils/annotations';

/** How far a label wants to stay from any beam, in px, before it counts as clear. */
export const LABEL_CLEARANCE_PX = 7;

/** Gap between the drawn component and its label, at scale 1. */
export const LABEL_GAP_PX = 3;

/**
 * Rough width of a character at a given font size.
 *
 * An estimate on purpose: measuring text needs the DOM, and this module has none. The
 * decision it feeds is coarse — which side of a component to use — so being a pixel or two
 * out on an unusual string does not change the answer.
 */
const CHAR_WIDTH_RATIO = 0.55;

/** Half-extents of the box a label occupies, from its text and font size. */
export function labelHalfExtents(text: string, fontSize = LABEL_BASE_PX): { halfWidth: number; halfHeight: number } {
  return {
    halfWidth: Math.max(1, text.length * fontSize * CHAR_WIDTH_RATIO) / 2,
    halfHeight: fontSize / 2,
  };
}

/**
 * Distance from the label's centre to where it should sit, along `side`.
 *
 * Component's own drawn extent in that direction, plus a gap, plus the label's own extent
 * in that direction — so the label's near edge clears the artwork by `gap` whichever way it
 * goes, and a tall thin component does not push its label as far sideways as it does down.
 *
 * Both views call this, so they cannot drift apart.
 */
export function labelDistance(
  type: OpticalNodeData['type'],
  rotation: number,
  side: Vec2,
  label: { halfWidth: number; halfHeight: number },
  scale = 1,
): number {
  const drawn = drawnHalfExtents(type);
  // The component's extent is measured in its own frame, since that is the frame its
  // artwork is drawn in — exactly as the beam trim does it.
  const local = rotateBy(side, -rotation);
  const iconReach = boxHalfExtent(drawn.halfAlong, drawn.halfCross, local);
  const labelReach = boxHalfExtent(label.halfWidth, label.halfHeight, side);
  return iconReach + LABEL_GAP_PX * scale + labelReach;
}

/**
 * The text a component shows beneath itself, for sizing purposes only.
 *
 * Not the exact string the renderer will draw — a detector's reading is not known here —
 * but the same *length* to within a character or two, which is all the placement needs.
 */
function labelTextFor(node: Node<OpticalNodeData>): string | null {
  const data = node.data;
  const parts: string[] = [];
  if (data.showLabel === true && data.name) parts.push(data.name);
  // A photodiode showing its signal has a second line of about this width.
  if (data.type === 'photodiode' && (data as { showSignal?: boolean }).showSignal === true) {
    parts.push('00.00 V');
  }
  if (parts.length === 0) return null;
  // The wider line decides the box.
  return parts.reduce((a, b) => (b.length > a.length ? b : a));
}

/** The beam axis through a component: what it was aimed at, else its own body axis. */
function beamAxisOf(node: Node<OpticalNodeData>): Vec2 {
  const incoming = (node.data as { beamIncomingDir?: Vec2 }).beamIncomingDir;
  if (incoming && (incoming.dx !== 0 || incoming.dy !== 0)) return incoming;
  return bodyAxis(node.data.rotation ?? 0);
}

/**
 * Candidate sides, best first.
 *
 * Perpendicular to the beam comes first — that is the only direction guaranteed to leave
 * the beam immediately — and of the two perpendiculars, the one pointing further down the
 * screen wins, so the familiar "label underneath" stays put whenever it is free. Then the
 * other perpendicular, then the two diagonals, which are the way out when a bench has beams
 * on both sides. Along the beam is never offered: that is the one direction certain to
 * follow it.
 */
export function candidateSides(axis: Vec2): Vec2[] {
  const deg = angleOf(perpOf(axis));
  const downward = unitAt(deg).dy >= 0 ? deg : deg + 180;
  return [
    unitAt(downward),
    unitAt(downward + 180),
    unitAt(downward + 45),
    unitAt(downward - 45),
    unitAt(downward + 135),
    unitAt(downward - 135),
  ];
}

/**
 * An axis-aligned box that a label has to stay off.
 *
 * `owner` is the node it belongs to, where it has one: a label ignores its own component's
 * body (it is measured off that body to begin with) but not its own annotations.
 */
interface Obstacle {
  centre: Pt;
  halfWidth: number;
  halfHeight: number;
  /** The node this box belongs to, if any. */
  owner?: string;
  /** Node id this box does not apply to — a component's own body. */
  skipFor?: string;
}

/**
 * The annotation stack above each component, as a box.
 *
 * The figure prints λ, f, θ, R… above every component that has them, and a name landing on a
 * neighbour's "R=99.5%" reads no better than one landing on a beam. Reserved for every node,
 * including the one being labelled — its own stack is directly above it, which is precisely
 * the collision "straight up" used to make.
 *
 * The editor canvas does not draw annotations, and still reserves the space. That is
 * deliberate: one placement for both views means a label never moves when you switch to the
 * diagram or export a figure, and a little unused room on the canvas is the cheaper half of
 * that trade.
 */
function annotationObstacles(nodes: Node<OpticalNodeData>[]): Obstacle[] {
  const boxes: Obstacle[] = [];
  for (const node of nodes) {
    const box = annotationBox(node.data);
    if (!box) continue;
    const g = getNodeGeometry(node.data.type, node.data.rotation ?? 0);
    boxes.push({
      owner: node.id,
      centre: {
        x: node.position.x + g.width / 2,
        y: node.position.y + g.height / 2 + box.dy,
      },
      halfWidth: box.halfWidth,
      halfHeight: box.halfHeight,
    });
  }
  return boxes;
}

/**
 * The components themselves.
 *
 * A name on top of the neighbouring cube is no better than a name on top of that cube's
 * "R=99.5%", and once the annotations were taken into account this was what was left. Its own
 * component is excluded — clearing that is `labelDistance`'s job, and it does it more tightly
 * than a bounding box could.
 *
 * The box is the *occupied* one, so a mirror at 45° reserves the square its turned artwork
 * spans. Conservative by √2 along the diagonals, which is the right way to be wrong here.
 */
function bodyObstacles(nodes: Node<OpticalNodeData>[]): Obstacle[] {
  return nodes.map(node => {
    const g = getNodeGeometry(node.data.type, node.data.rotation ?? 0);
    return {
      owner: node.id,
      centre: { x: node.position.x + g.width / 2, y: node.position.y + g.height / 2 },
      halfWidth: g.width / 2,
      halfHeight: g.height / 2,
    };
  });
}

/** The five points of a label box worth testing: its centre and its corners. */
function boxProbes(centre: Pt, halfWidth: number, halfHeight: number): Pt[] {
  return [
    centre,
    { x: centre.x - halfWidth, y: centre.y - halfHeight },
    { x: centre.x + halfWidth, y: centre.y - halfHeight },
    { x: centre.x - halfWidth, y: centre.y + halfHeight },
    { x: centre.x + halfWidth, y: centre.y + halfHeight },
  ];
}

/** Closest approach between a label box and any beam or obstacle; Infinity if there are none. */
function clearanceFrom(
  centre: Pt,
  label: { halfWidth: number; halfHeight: number },
  segments: BeamSegment[],
  obstacles: Obstacle[],
  /** Node being labelled; its own body is not something to avoid. */
  self?: string,
): number {
  let worst = Infinity;
  for (const probe of boxProbes(centre, label.halfWidth, label.halfHeight)) {
    for (const seg of segments) {
      const { x1, y1, x2, y2 } = drawnEndpoints(seg);
      if (Math.hypot(x2 - x1, y2 - y1) < 1e-9) continue;
      worst = Math.min(worst, nearestOnSegment(probe, { x: x1, y: y1 }, { x: x2, y: y2 }).distance);
    }
  }
  // Boxes — labels already placed, and every component's annotation stack. Two names on top
  // of one another are as unreadable as a name on a beam, and so is a name on a formula.
  // Compared as boxes, not points, so wide text repels properly.
  for (const other of obstacles) {
    if (other.skipFor === self) continue;
    const gapX = Math.abs(centre.x - other.centre.x) - (label.halfWidth + other.halfWidth);
    const gapY = Math.abs(centre.y - other.centre.y) - (label.halfHeight + other.halfHeight);
    worst = Math.min(worst, Math.max(gapX, gapY));
  }
  return worst;
}

/**
 * Choose a side for every label, avoiding the beams, the annotations and each other.
 *
 * Greedy in node order, which is stable because the node list is: the same layout always
 * places the same way, so labels do not shuffle between renders. A label takes the first
 * candidate that clears `LABEL_CLEARANCE_PX`; if a bench is crowded enough that nothing
 * clears, it takes the roomiest option rather than giving up.
 *
 * Returns only the nodes that actually show a label.
 */
export function placeLabels(
  nodes: Node<OpticalNodeData>[],
  segments: BeamSegment[],
): Map<string, Vec2> {
  const sides = new Map<string, Vec2>();
  // Seeded with everything already on the figure — the components and the formulas above
  // them — then grown as labels are placed, so a name also avoids the names before it.
  const obstacles: Obstacle[] = [
    ...annotationObstacles(nodes),
    ...bodyObstacles(nodes).map(b => ({ ...b, skipFor: b.owner })),
  ];

  for (const node of nodes) {
    const text = labelTextFor(node);
    if (text === null) continue;

    const label = labelHalfExtents(text);
    const rotation = node.data.rotation ?? 0;
    // The box the node *occupies*, which is the turned one — a 90° laser is 66×90, not
    // 90×66. Using the artwork box instead puts a turned component's centre 12 px out, and
    // with it every label hung off that centre.
    const box = getNodeGeometry(node.data.type, rotation);
    // Node positions are top-left; the label is placed relative to the centre.
    const centre = {
      x: node.position.x + box.width / 2,
      y: node.position.y + box.height / 2,
    };

    let best: { side: Vec2; centre: Pt; clearance: number } | null = null;
    for (const side of candidateSides(beamAxisOf(node))) {
      const dist = labelDistance(node.data.type, rotation, side, label);
      const at = { x: centre.x + side.dx * dist, y: centre.y + side.dy * dist };
      const clearance = clearanceFrom(at, label, segments, obstacles, node.id);
      if (clearance >= LABEL_CLEARANCE_PX) { best = { side, centre: at, clearance }; break; }
      if (!best || clearance > best.clearance) best = { side, centre: at, clearance };
    }

    if (!best) continue;
    sides.set(node.id, best.side);
    obstacles.push({ centre: best.centre, halfWidth: label.halfWidth, halfHeight: label.halfHeight });
  }

  return sides;
}

/** Where a label sits by default: below the component, as it always did. */
export const DEFAULT_LABEL_SIDE: Vec2 = { dx: 0, dy: 1 };
