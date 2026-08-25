// Beam lanes — parallel beam axes through a single component.
//
// Most components have exactly one optical axis, through their centre. Acousto-optic
// devices have two, because the diffracted and undiffracted orders leave along
// different paths and each needs somewhere for a beam to live and for the user to put
// a beam block.
//
// The real first-order deflection is tiny — θ₁ = λ·f_RF/v_a ≈ 15 mrad, about 7 px of
// separation over 300 mm of canvas — so drawing the true angle would separate nothing
// and place nothing. Instead the orders get parallel lanes one breadboard hole apart,
// and the true angle is reported as physics. See PROJECT_NOTES §4.
//
// Lane offsets are measured along the component's **own** normal, fixed by its
// rotation — never relative to the beam direction. A lane is a place on the device, so
// it must not move when a beam traverses it backwards; that is what makes a
// double-passed AOM retrace its own path.
import type { OpticalNodeData } from '../types/components';
import { PX_PER_INCH } from './scale';
import { perpOf, unitAt, type Vec2 } from './geometry';

/**
 * Schematic separation between an acousto-optic device's two beam axes.
 *
 * One inch, so both lanes land on the hole grid. It must stay comfortably above
 * 2 × BEAM_SNAP_DIST (20 px) or the lanes would capture each other's beams, and above
 * a beam block's half-height (26 px) so a block on the dump lane doesn't cover the
 * main beam. Fixed rather than per-component because `getNodeGeometry` would have to
 * see node data to size the body around a variable separation.
 */
export const ORDER_SEPARATION_PX = PX_PER_INCH;

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
 * Direction in which this component's lane offsets are measured — perpendicular to
 * its body axis, and independent of which way any beam happens to travel.
 */
export function laneNormal(rotation = 0): Vec2 {
  return perpOf(bodyAxis(rotation));
}

/**
 * Perpendicular offsets (px) of a component's beam axes, from its centre.
 *
 * Lane 0 is always 0 — the centre — so every single-lane component behaves exactly as
 * it did before lanes existed, and an AOM already sitting on a beam keeps working.
 * Lane 1, where present, is the dump lane the undiffracted order peels off onto; its
 * sign follows the diffracted order the device is set up for.
 */
export function componentLanes(data: OpticalNodeData): number[] {
  switch (data.type) {
    case 'aom':
      return [0, (data.activeOrder === '-1' ? -1 : 1) * ORDER_SEPARATION_PX];
    case 'aod':
      return [0, ORDER_SEPARATION_PX];
    default:
      return [0];
  }
}

/**
 * Which way along its own axis a device's unused order leaves, as +1 or -1 in the
 * component's **own** frame.
 *
 * Needed because a multi-lane component aligns to the beam's *axis*, not its direction
 * (`autoRoute` uses `beamAngle % 180`), and deliberately so: a lane is a place on the
 * device, so it must not flip when a beam traverses it backwards — that invariance is what
 * lets a double-passed cell retrace its own path. The consequence is that an acousto-optic
 * cell fed right-to-left keeps rotation 0, and anything drawn along `+x` in its own frame
 * then points *upstream*. The dumped order leaves with the beam, so it needs this sign.
 *
 * Only the **along-axis** sign flips. The perpendicular lane offset must not: that is the
 * physical side the transducer put it on.
 *
 * `+1` with no beam, which is what an unlit component on the palette or a fresh drop shows.
 */
export function laneExitSign(data: OpticalNodeData): 1 | -1 {
  const incoming = (data as { beamIncomingDir?: Vec2 }).beamIncomingDir;
  if (!incoming || (incoming.dx === 0 && incoming.dy === 0)) return 1;
  const axis = bodyAxis(data.rotation ?? 0);
  return incoming.dx * axis.dx + incoming.dy * axis.dy >= 0 ? 1 : -1;
}

/** True when a component has more than one beam axis. */
export function hasMultipleLanes(data: OpticalNodeData): boolean {
  return componentLanes(data).length > 1;
}
