// Which way a diffracted order leaves an acousto-optic cell.
//
// Both orders are real beams: the 0th carries straight on undeviated, and the diffracted one
// leaves at an angle. That is what a bench looks like, and it is why you bolt a beam block in
// front of the 0th order rather than pretending the cell swallowed it.
//
// **The drawn angle is a caricature, deliberately.** A real first-order deflection is
// θ = λ·f_RF/v_a ≈ 15 mrad, about a degree — invisible at any figure scale, which is why this
// used to be drawn as two parallel lanes an inch apart. Drawing it as a lattice angle keeps
// the geometry honest in kind (two beams, diverging, one of them shifted) while staying on the
// 15° grid, so every component downstream can still align to the beam it sits on. The true
// angle is reported as physics, not drawn.
//
// **Two independent signs**, which is the part worth being careful about:
//
//   - `activeOrder` (+1/−1) sets the *frequency* shift. It is the RF drive.
//   - `deflectSide` (cw/ccw) sets which *side* the diffracted beam leaves on. It is where the
//     transducer is bonded.
//
// A transducer can sit on either end of the crystal, so these are genuinely separate facts
// about a part and neither implies the other.
import type { OpticalNodeData } from '../types/components';
import { bodyAxis, laneNormal } from './lanes';
import { perpOf, rotateBy, dot, type Vec2 } from './geometry';

/**
 * Drawn deflection of the diffracted order, degrees.
 *
 * A multiple of `DIR_STEP_DEG` on purpose: the diffracted beam has to be a direction the
 * lattice can express, or the components you put on it cannot align to it.
 */
export const DEFAULT_DEFLECT_DEG = 15;

/** Which way round the diffracted order tilts, in the cell's own frame. */
export type DeflectSide = 'cw' | 'ccw';

/** Drawn deflection angle for this cell, degrees. */
export function deflectDegOf(data: OpticalNodeData): number {
  const raw = (data as { deflectDeg?: unknown }).deflectDeg;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DEFLECT_DEG;
}

/**
 * Which side the diffracted order leaves on, as +1 (clockwise on screen, since y runs down)
 * or −1.
 *
 * Independent of `activeOrder`: see the note at the top of the file.
 */
export function deflectSignOf(data: OpticalNodeData): 1 | -1 {
  return (data as { deflectSide?: unknown }).deflectSide === 'ccw' ? -1 : 1;
}

/**
 * The fixed transverse kick this cell gives a diffracted beam, as a unit vector in the lab.
 *
 * Fixed to the *device*, not to the beam: the acoustic wave runs one way through the crystal
 * whichever way the light goes. That is the whole reason `diffractedDirection` cannot simply
 * add a constant angle.
 */
export function kickVector(data: OpticalNodeData, rotation: number): Vec2 {
  const n = laneNormal(rotation);
  const s = deflectSignOf(data);
  return { dx: n.dx * s, dy: n.dy * s };
}

/**
 * Direction a diffracted beam leaves in, given the direction it arrived in.
 *
 * The beam is rotated by the deflection angle, and the *sense* of that rotation is whichever
 * one turns it towards the cell's fixed kick vector. Getting this from the kick rather than
 * from a constant angle is what makes a double pass close:
 *
 *   forward   0°   → +15°   (turned towards the kick)
 *   return  195°   → 180°   (turned towards the same kick, which is now the other way round)
 *
 * so the returning beam comes back exactly anti-parallel to the input and retraces it. Add a
 * constant +15° twice instead and the return leaves at 195°, missing the input by 15°, and a
 * double pass silently stops working.
 */
export function diffractedDirection(
  incoming: Vec2,
  rotation: number,
  data: OpticalNodeData,
): Vec2 {
  const deg = deflectDegOf(data);
  const kick = kickVector(data, rotation);
  // Rotating `incoming` by +deg moves it towards perpOf(incoming); pick the sense that heads
  // for the kick instead of away from it.
  const towardsKick = dot(perpOf(incoming), kick) >= 0 ? 1 : -1;
  return rotateBy(incoming, towardsKick * deg);
}

/**
 * True when a beam travelling `dir` runs against the cell's body axis.
 *
 * Only used for reporting — the deflection itself never needs it, because the kick vector
 * carries the device's orientation. Kept because it is the question anyone reading a
 * double-pass layout asks first.
 */
export function travellingBackwards(dir: Vec2, rotation: number): boolean {
  return dot(dir, bodyAxis(rotation)) < 0;
}
