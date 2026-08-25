// A spherical-polygon vacuum chamber, in plan view.
//
// The shape is a regular polygon with one side port per flat, which is what a Kimball
// spherical octagon or dodecagon looks like from above. Everything is parameterised, because
// the same drawing serves both: `sides` and `inradiusMm` are the part, and the defaults are
// the MCF1000-SphDodecagon-H2C12 (10 in, 12 ports), read off the dimensioned drawing.
//
// **What the model claims, and what it does not.** A beam is captured by a component only
// when it passes within `BEAM_SNAP_DIST` of that component's axis, so what this module
// decides is the fate of a beam crossing the chamber *through its centre*:
//
//   - along a face normal, both ports open   -> through, attenuated by two windows
//   - along a face normal, either port shut   -> absorbed at the flange
//   - not along a face normal                 -> absorbed at the wall between flats
//
// A beam crossing the body off-centre is not captured at all, and is drawn straight over the
// chamber. That limitation is the tracer's rather than this module's: a chord through a
// chamber is exactly the case a centre-based hit test cannot see.
import type { OpticalNodeData } from '../types/components';
import { mmToPx } from './scale';
import { norm360 } from './geometry';

/** State of one side port. */
export type PortState = 'closed' | 'viewport';

/**
 * Kimball MCF1000-SphDodecagon-H2C12, part 53-190080 — the 10 in spherical dodecagon.
 *
 * From the dimensioned drawing (MCF_Spherical_Dodecagon_2023_0222.pdf p2): 12 ports at 30
 * degrees, 5.300 in centre to each 2.75 CF face, 1.500 in bore through the wall, 8.300 in
 * bore for the vertical ports. The wall at a flat is 134.62 - 116.20 = 18.42 mm thick.
 */
export const CHAMBER_DEFAULTS = {
  sides: 12,
  inradiusMm: 134.62,
  boreMm: 38.10,
  tubeMm: 18.42,
  topBoreMm: 210.82,
  transmission: 100,
};

/** A chamber's geometry in px, with every default applied. */
export interface ChamberSpec {
  sides: number;
  inradiusPx: number;
  borePx: number;
  tubePx: number;
  topBorePx: number;
  /** Transmission of one window, as a fraction. */
  windowT: number;
  ports: PortState[];
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Read a chamber's geometry out of its node data, in px, with sane values for anything
 * missing or nonsensical.
 *
 * Three sides is the smallest thing that encloses anything; past about 24 the flats are
 * shorter than a flange and the drawing stops meaning much.
 */
export function chamberSpec(data: OpticalNodeData): ChamberSpec {
  const d = data as unknown as Record<string, unknown>;
  const sides = Math.max(3, Math.min(24, Math.round(positive(d.sides, CHAMBER_DEFAULTS.sides))));
  const inradiusMm = positive(d.inradiusMm, CHAMBER_DEFAULTS.inradiusMm);
  // A bore wider than the chamber is not a chamber.
  const boreMm = Math.min(positive(d.boreMm, CHAMBER_DEFAULTS.boreMm), inradiusMm);
  const t = positive(d.transmission, CHAMBER_DEFAULTS.transmission);
  return {
    sides,
    inradiusPx: mmToPx(inradiusMm),
    borePx: mmToPx(boreMm),
    tubePx: mmToPx(positive(d.tubeMm, CHAMBER_DEFAULTS.tubeMm)),
    topBorePx: mmToPx(positive(d.topBoreMm, CHAMBER_DEFAULTS.topBoreMm)),
    windowT: Math.max(0, Math.min(100, t)) / 100,
    ports: portStates(d.ports, sides),
  };
}

/**
 * Port states, padded or trimmed to the side count.
 *
 * Anything missing reads as a viewport: a chamber you have just dropped should pass light, so
 * that lining a beam up with it is the first thing that works rather than the first thing
 * that fails. Changing `sides` therefore keeps the ports you had set and opens the new ones.
 */
export function portStates(raw: unknown, sides: number): PortState[] {
  const given = Array.isArray(raw) ? raw : [];
  return Array.from({ length: sides }, (_, i) => (given[i] === 'closed' ? 'closed' : 'viewport'));
}

/** Angle between neighbouring face normals, degrees. */
export function faceStepDeg(sides: number): number {
  return 360 / sides;
}

/** Outward normal of face `index`, in the chamber's own frame, degrees. */
export function faceNormalDeg(sides: number, index: number): number {
  return norm360(index * faceStepDeg(sides));
}

/**
 * The face a direction points at, and how far off that face's normal it is.
 *
 * `offsetDeg` is signed and within half a step of zero, so `Math.abs(offsetDeg) < tol` is the
 * test for "square on to a flat".
 */
export function nearestFace(sides: number, dirDeg: number): { index: number; offsetDeg: number } {
  const step = faceStepDeg(sides);
  const raw = norm360(dirDeg) / step;
  const nearest = Math.round(raw);
  return { index: ((nearest % sides) + sides) % sides, offsetDeg: (raw - nearest) * step };
}

/**
 * Distance from the centre to the boundary of a regular polygon, along `dirDeg` in the
 * polygon's own frame.
 *
 * `R / cos(delta)`, where delta is the angle to the nearest face normal: the flat sits at
 * distance R along its normal, and a ray leaving delta off that normal has to go further by
 * exactly that factor. At delta of half a step it reaches a corner, which is the circumradius.
 */
export function polygonHalfExtent(inradiusPx: number, sides: number, dirDeg: number): number {
  const { offsetDeg } = nearestFace(sides, dirDeg);
  return inradiusPx / Math.cos((offsetDeg * Math.PI) / 180);
}

/** Circumradius — centre to corner. */
export function circumradiusPx(inradiusPx: number, sides: number): number {
  return inradiusPx / Math.cos(Math.PI / sides);
}

/** Half the width of one flat. */
export function faceHalfWidthPx(inradiusPx: number, sides: number): number {
  return inradiusPx * Math.tan(Math.PI / sides);
}

/**
 * Corners of the polygon, centred on the origin, in the chamber's own frame.
 *
 * Corners sit half a step off each face normal, which is what puts face 0 straddling the +x
 * axis rather than a corner on it — so a chamber at rotation 0 presents a flat to a beam
 * travelling along x, and every port normal is a multiple of the face step.
 */
export function polygonPoints(inradiusPx: number, sides: number): { x: number; y: number }[] {
  const circum = circumradiusPx(inradiusPx, sides);
  const half = 180 / sides;
  return Array.from({ length: sides }, (_, i) => {
    const rad = ((faceNormalDeg(sides, i) + half) * Math.PI) / 180;
    return { x: circum * Math.cos(rad), y: circum * Math.sin(rad) };
  });
}

/** Centre of face `index` relative to the chamber centre, in the chamber's own frame. */
export function facePositionPx(spec: ChamberSpec, index: number): { x: number; y: number } {
  const rad = (faceNormalDeg(spec.sides, index) * Math.PI) / 180;
  return { x: spec.inradiusPx * Math.cos(rad), y: spec.inradiusPx * Math.sin(rad) };
}

/** How far off a face normal a beam may be and still count as square on, degrees. */
export const NORMAL_TOLERANCE_DEG = 1;

/** Why a beam did not make it through. */
export type ChamberBlock = 'wall' | 'entry-closed' | 'exit-closed' | 'aperture' | 'no-through-port';

export interface ChamberPassage {
  /** Face the beam entered by, or null when it met the wall instead. */
  entry: number | null;
  /** Face it leaves by. */
  exit: number | null;
  /** Set when the beam does not get out; null when it does. */
  blocked: ChamberBlock | null;
  /** Fraction of the power that survives the crossing. 0 when blocked. */
  transmission: number;
}

/**
 * What happens to a beam crossing the chamber along `dirDeg` (chamber frame), offset
 * `offsetPx` from the axis.
 *
 * The beam enters by the face it is coming at — the one whose outward normal is
 * *antiparallel* to travel — and leaves by the face opposite. Only an even-sided chamber has
 * one: on an odd polygon every normal points at a corner, so there is no straight path
 * through at all, which is worth saying rather than silently absorbing.
 */
export function chamberPassage(
  spec: ChamberSpec,
  dirDeg: number,
  offsetPx = 0,
): ChamberPassage {
  // Which flat is the beam aimed at, and is it square on to it?
  const aim = nearestFace(spec.sides, dirDeg);
  if (Math.abs(aim.offsetDeg) > NORMAL_TOLERANCE_DEG) {
    return { entry: null, exit: null, blocked: 'wall', transmission: 0 };
  }
  if (spec.sides % 2 !== 0) {
    return { entry: null, exit: null, blocked: 'no-through-port', transmission: 0 };
  }

  const exit = aim.index;
  const entry = (exit + spec.sides / 2) % spec.sides;

  // A bore is a tube: further off the axis than its radius and the beam is in metal. Only
  // reachable for a narrow port, since a beam more than BEAM_SNAP_DIST from the axis is never
  // captured by the component at all.
  if (Math.abs(offsetPx) > spec.borePx / 2) {
    return { entry, exit, blocked: 'aperture', transmission: 0 };
  }
  if (spec.ports[entry] !== 'viewport') {
    return { entry, exit, blocked: 'entry-closed', transmission: 0 };
  }
  if (spec.ports[exit] !== 'viewport') {
    return { entry, exit, blocked: 'exit-closed', transmission: 0 };
  }

  // Two windows on the way through.
  return { entry, exit, blocked: null, transmission: spec.windowT * spec.windowT };
}

/** Human sentence for a blocked crossing, for the router's warning list. */
export function chamberBlockMessage(block: ChamberBlock, spec: ChamberSpec): string {
  switch (block) {
    case 'entry-closed':
      return 'The beam arrives at a blanked-off flange. Open that port as a viewport, or aim through one that is.';
    case 'exit-closed':
      return 'The beam gets in but the flange opposite is blanked off, so it is absorbed inside the chamber.';
    case 'aperture':
      return `The beam clears the flats but misses the ${Math.round(spec.borePx)} px bore, so it lands on the flange.`;
    case 'no-through-port':
      return `A ${spec.sides}-sided chamber has no pair of opposite ports, so no beam can cross it. Use an even number of sides.`;
    case 'wall':
    default:
      return 'The beam meets the chamber wall between two flats. Line it up with a pair of opposite ports.';
  }
}
