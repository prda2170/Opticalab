// Cosmetic separation of beams that share a line.
//
// Beams really can be collinear and overlapping — two co-propagating beams on one
// axis, or a retroreflected beam retracing its own path — and drawn literally, one
// would hide the others completely.
//
// This runs as a post-pass over the finished segment list and writes a display-only
// `renderShift`. Segment coordinates stay physically true, so `lengthMm`, waist
// positions and hit points are unaffected; only the drawing moves. Keeping this out
// of the tracer is what lets rays carry their real positions.
import type { BeamSegment } from '../types/beam';
import { perpOf, angleOf, angleDiff, unitAt } from './geometry';

/** Perpendicular gap (canvas px) between beams that share a line. */
export const BEAM_FAN_SEPARATION = 3;

/**
 * How far out the fan may go, in steps, before beams start doubling up.
 * A resonator can put dozens of passes on one line; spreading them all would smear
 * the beam across the figure, so past this the offsets repeat.
 */
const MAX_FAN_STEPS = 3;

/** Two parallel segments count as sharing a line if their offsets agree within this (px). */
const COLLINEAR_TOL = 0.75;

/** Normalise -0 to 0, so shifts serialise cleanly into edge data. */
const zero = (n: number) => (n === 0 ? 0 : n);

/**
 * Minimum overlap (px) before two collinear segments are fanned apart.
 * Segments that merely meet end-to-end at a component — every ordinary beam path —
 * must not be fanned, or a whole chain would zig-zag.
 */
const MIN_OVERLAP = 2;

/** Two segments count as sharing a direction if their angles agree to within this (deg). */
const PARALLEL_TOL_DEG = 0.05;

/**
 * The infinite line a segment lies on, in a form that works at any angle.
 *
 * Direction is folded to [0°, 180°) so a beam and the beam retracing it describe the same
 * line, and position is the signed perpendicular distance from the canvas origin. The
 * previous form — a boolean plus "the constant coordinate" — could only describe
 * horizontal and vertical lines, so diagonal beams were excluded from fanning and a 45°
 * double pass drew both passes exactly on top of each other.
 */
interface Line {
  /** Direction of the line in [0, 180). */
  dirDeg: number;
  /** Signed perpendicular distance from the origin to the line. */
  offset: number;
  /** Extent along the line's own direction, sorted. */
  lo: number;
  hi: number;
}

function lineOf(seg: BeamSegment): Line | null {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  if (Math.hypot(dx, dy) < 1e-9) return null;

  // Fold the direction onto a half-circle: a line has no sense of travel, and a
  // retroreflected beam has to land in the same group as the beam it retraces.
  const dirDeg = angleOf({ dx, dy }) % 180;
  const along  = unitAt(dirDeg);
  const normal = perpOf(along);

  const a1 = seg.x1 * along.dx + seg.y1 * along.dy;
  const a2 = seg.x2 * along.dx + seg.y2 * along.dy;
  return {
    dirDeg,
    offset: seg.x1 * normal.dx + seg.y1 * normal.dy,
    lo: Math.min(a1, a2),
    hi: Math.max(a1, a2),
  };
}

/** Do these two stretches of beam lie on the same line *and* genuinely overlap? */
function overlaps(a: Line, b: Line): boolean {
  // mod 180: parallel is enough, direction of travel is irrelevant.
  if (angleDiff(a.dirDeg, b.dirDeg, 180) > PARALLEL_TOL_DEG) return false;
  if (Math.abs(a.offset - b.offset) > COLLINEAR_TOL) return false;
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > MIN_OVERLAP;
}

/**
 * Assign `renderShift` to every segment that shares a line with another.
 *
 * The first segment of each group keeps its true position (shift 0) and the rest
 * alternate outwards, so a beam is never displaced unless it would otherwise be
 * hidden. Mutates the segments in place.
 */
export function fanCollinearSegments(segments: BeamSegment[]): void {
  const lines = new Map<string, Line>();
  for (const s of segments) {
    const l = lineOf(s);
    if (l) lines.set(s.id, l);
  }

  // Greedy grouping. Segment counts are small (tens), and this is exact where
  // bucketing by rounded coordinate would split beams that straddle a boundary.
  const groups: BeamSegment[][] = [];
  for (const seg of segments) {
    const line = lines.get(seg.id);
    if (!line) continue;
    const group = groups.find(g => g.some(other => overlaps(line, lines.get(other.id)!)));
    if (group) group.push(seg);
    else groups.push([seg]);
  }

  for (const group of groups) {
    if (group.length < 2) continue;
    group.forEach((seg, i) => {
      if (i === 0) return;                       // first beam stays on its true line
      const step = Math.min(Math.ceil(i / 2), MAX_FAN_STEPS) * BEAM_FAN_SEPARATION;
      const shift = (i % 2 === 1 ? 1 : -1) * step;
      const dx = seg.x2 - seg.x1;
      const dy = seg.y2 - seg.y1;
      const len = Math.hypot(dx, dy) || 1;
      const p = perpOf({ dx: dx / len, dy: dy / len });
      seg.renderShift = { dx: zero(p.dx * shift), dy: zero(p.dy * shift) };
    });
  }
}

/** Segment endpoints as drawn, including any cosmetic separation. */
export function drawnEndpoints(seg: BeamSegment): { x1: number; y1: number; x2: number; y2: number } {
  const s = seg.renderShift;
  if (!s) return { x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 };
  return { x1: seg.x1 + s.dx, y1: seg.y1 + s.dy, x2: seg.x2 + s.dx, y2: seg.y2 + s.dy };
}
