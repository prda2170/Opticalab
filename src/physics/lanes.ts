// Beam lanes — where a component's optical axes sit, and which way it faces.
//
// Every component has exactly one optical axis, through its centre. Acousto-optic devices
// used to have two: their diffracted and undiffracted orders were drawn as parallel beams one
// breadboard hole apart, because the true deflection (θ₁ = λ·f_RF/v_a ≈ 15 mrad, about 7 px
// over a canvas) is too small to separate anything. Both orders are real angled beams now —
// see `physics/diffraction` — so `componentLanes` is down to the one axis for everything.
//
// What survives, and is still load-bearing, is the rule about frames: a component's axes and
// normal are fixed by its **own** rotation, never by which way a beam happens to travel
// through it. A place on a device does not move when a beam traverses it backwards, and that
// invariance is what makes a double-passed cell retrace its own path. See PROJECT_NOTES §4.
import type { OpticalNodeData } from '../types/components';
import { perpOf, unitAt, type Vec2 } from './geometry';

/**
 * The direction a component faces at the given rotation — any angle, not just the four
 * the UI currently offers. Multiples of 90° come back as exact unit vectors.
 *
 * A mirror is the exception: its surface is 45° behind its body axis, so ask
 * `mirrorSurfaceDeg` instead of using this to work out where one faces.
 */
export function bodyAxis(rotation = 0): Vec2 {
  return unitAt(rotation);
}

/**
 * The component's own transverse direction — perpendicular to its body axis, and independent
 * of which way any beam happens to travel through it.
 *
 * This is the frame an acousto-optic cell's momentum kick lives in (`diffraction.kickVector`).
 */
export function laneNormal(rotation = 0): Vec2 {
  return perpOf(bodyAxis(rotation));
}

/**
 * Perpendicular offsets (px) of a component's beam axes, from its centre.
 *
 * Always just `[0]`, the centre. See the note below and the file header.
 */
export function componentLanes(_data: OpticalNodeData): number[] {
  // Nothing declares a second lane any more. Acousto-optic cells used to: their two orders
  // were drawn as parallel beams an inch apart, because the real deflection is too small to
  // see. Now both orders are real beams leaving at an angle (see physics/diffraction), so
  // there is one axis through every component again. The machinery stays because the tracer's
  // hit test is written in terms of it, and a component with a genuine second axis would slot
  // straight back in.
  return [0];
}

/**
 * Components with a physical *side* — the acousto-optic cells, whose transducer is bonded to
 * one end of the crystal.
 *
 * The router aligns these to the beam's **axis** rather than its direction, so a cell fed
 * backwards is not spun through 180°. Spinning it would carry the transducer to the other
 * side and flip which way the diffracted order leaves, which is exactly what must not happen
 * on the return leg of a double pass.
 */
export const SIDED_TYPES = new Set<OpticalNodeData['type']>(['aom', 'aod']);

