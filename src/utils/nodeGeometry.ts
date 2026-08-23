// Node geometry: defines rendering dimensions and style for each component type.
//
// Three different boxes, and mixing them up is the source of every rotation bug this
// project has had:
//
//   • **artwork** — the component's own frame, unrotated. `GEOMETRIES` below is this.
//     Its *width* is along the optical axis, its *height* across it.
//   • **occupied box** — the axis-aligned rectangle the node takes up on the canvas at a
//     given rotation, which is what xyflow positions and what `getNodeGeometry` returns.
//     At 90°/270° this is the artwork with width and height swapped; at other angles it
//     is the true bounding box of the turned artwork.
//   • **body box** — the *optical* extent a beam is trimmed to, which can be narrower
//     than the artwork (a waveplate is 12 px of glass in a 32 px box). In the
//     component's own frame, like the artwork.
import type { OpticalNodeData } from '../types/components';
import { unitAt, rotateBy, dot, DIR_STEP_DEG, MIRROR_STEP_DEG, type Vec2 } from '../physics/geometry';

export type SymbolType = 'symbol' | 'box';

export interface NodeGeometry {
  width: number;
  height: number;
  symbolType: SymbolType;
  /**
   * Half-extent (px) from the node centre to the optical surface, measured **along the
   * component's own axis** — not along the beam. Set it when the visible body is
   * narrower than the artwork box, so a beam is not drawn stopping in mid-air.
   * Computed as `S × (0.5 − rect_x / viewbox_width)` where S is the rendered icon size
   * (= min(w,h) + 4). The cross-axis extent always comes from the artwork height.
   */
  beamFaceHalf?: number;
}

const GEOMETRIES: Partial<Record<OpticalNodeData['type'], NodeGeometry>> = {
  // ── Sources (labeled box) ───────────────────────────────────────────────
  laser_source:      { width: 90, height: 66, symbolType: 'symbol' },
  // Module lying along the beam; a symbol so it turns to face it (the taper is
  // directional), and the beam is trimmed to its facets.
  optical_amplifier: { width: 64, height: 44, symbolType: 'symbol' },

  // ── Conditioning ────────────────────────────────────────────────────────
  // beamFaceHalf: the visible icon rect is narrower than the geometry bounding box.
  // Value = S × (0.5 − rect_x / vb_width) where S = min(w,h)+4.
  isolator:          { width: 44, height: 44, symbolType: 'symbol' },
  linear_polarizer:  { width: 24, height: 68, symbolType: 'symbol', beamFaceHalf: 3 },
  hwp:               { width: 32, height: 72, symbolType: 'symbol', beamFaceHalf: 6 },
  qwp:               { width: 32, height: 72, symbolType: 'symbol', beamFaceHalf: 6 },
  nd_filter:         { width: 24, height: 68, symbolType: 'symbol', beamFaceHalf: 3 },
  iris:              { width: 44, height: 44, symbolType: 'symbol' },
  beam_block:        { width: 28, height: 52, symbolType: 'symbol', beamFaceHalf: 5 },

  // ── Steering & Splitting ─────────────────────────────────────────────────
  dielectric_mirror: { width: 44, height: 44, symbolType: 'symbol' },
  // Beam stops at the lens face, not the bounding box.
  retroreflector:    { width: 44, height: 44, symbolType: 'symbol', beamFaceHalf: 13 },
  dichroic_mirror:   { width: 44, height: 44, symbolType: 'symbol' },
  npbs:              { width: 44, height: 44, symbolType: 'symbol' },
  pbs:               { width: 44, height: 44, symbolType: 'symbol' },
  nonlinear_crystal: { width: 44, height: 44, symbolType: 'symbol' },
  shg_crystal:       { width: 44, height: 44, symbolType: 'symbol' },
  sfg_crystal:       { width: 44, height: 44, symbolType: 'symbol' },

  // ── Lenses ───────────────────────────────────────────────────────────────
  plano_convex:      { width: 24, height: 68, symbolType: 'symbol' },
  plano_concave:     { width: 24, height: 68, symbolType: 'symbol' },

  // ── Fiber ─────────────────────────────────────────────────────────────────
  fiber_coupler:     { width: 44, height: 44, symbolType: 'symbol' },
  fiber_launcher:    { width: 44, height: 44, symbolType: 'symbol' },
  fiber_cable:       { width: 76, height: 36, symbolType: 'box' },

  // ── Modulation ────────────────────────────────────────────────────────────
  // Acousto-optics sit at mirror height rather than spanning both beam lanes. The
  // 0th-order dump lane is one inch off-axis (physics/lanes.ts), well outside the body,
  // and OpticalNode draws a peel-off line from inside the cell to exactly where that
  // beam starts. Height is free to choose here — for a horizontal beam the face trim
  // comes from width/2 — so it only decides how bulky the cell looks.
  aom:               { width: 60, height: 44, symbolType: 'box' },
  aod:               { width: 60, height: 44, symbolType: 'box' },
  eom:               { width: 60, height: 36, symbolType: 'box' },
  slm:               { width: 60, height: 36, symbolType: 'box' },
  galvo:             { width: 44, height: 44, symbolType: 'symbol' },

  // ── Detection ─────────────────────────────────────────────────────────────
  photodiode:        { width: 44, height: 44, symbolType: 'symbol' },
  apd:               { width: 44, height: 44, symbolType: 'symbol' },
  camera:            { width: 60, height: 36, symbolType: 'box' },
  beam_profiler:     { width: 60, height: 36, symbolType: 'box' },

  // ── Cavities ──────────────────────────────────────────────────────────────
  fabry_perot:       { width: 76, height: 36, symbolType: 'box' },
  reference_cavity:  { width: 76, height: 36, symbolType: 'box' },
  delay_line:        { width: 60, height: 36, symbolType: 'box' },

  // ── Cold Atom ─────────────────────────────────────────────────────────────
  // Glass cell drawn side-on, so the tube lies along the beam. Transparent, so the
  // beam is drawn straight through it (BEAM_THROUGH_TYPES in autoRoute).
  vapor_cell:        { width: 88, height: 44, symbolType: 'symbol' },

  // ── Utilities ─────────────────────────────────────────────────────────────
  // Just the probe circle; its readout is drawn outside the box (overflow visible).
  power_probe:       { width: 18, height: 18, symbolType: 'symbol' },
};

const FALLBACK: NodeGeometry = { width: 60, height: 36, symbolType: 'box' };

/**
 * The component's artwork in its own frame, unrotated. Width is along its optical axis.
 *
 * Anything that needs a size *independent of rotation* — how big to draw the icon, how
 * far an emitter's face is from its centre — wants this, not the occupied box.
 */
export function artworkOf(type: OpticalNodeData['type']): NodeGeometry {
  return GEOMETRIES[type] ?? FALLBACK;
}

/**
 * The axis-aligned box the node occupies at this rotation — what xyflow lays out and
 * what every `position = centre − size/2` calculation needs.
 *
 * The bounding box of the turned artwork: `(w|cos θ| + h|sin θ|, w|sin θ| + h|cos θ|)`.
 * At 90°/270° that reduces *exactly* to a width/height swap, since `unitAt` returns exact
 * axis vectors there.
 *
 * Instrument ("box") nodes turn too, as of stage 4. They used to be drawn identically at
 * every rotation while the physics treated them as turned — so a vertical AOM was trimmed
 * as though it were horizontal, and its dump lane left the side of an unturned box.
 */
export function getNodeGeometry(type: OpticalNodeData['type'], rotation = 0): NodeGeometry {
  const base = artworkOf(type);
  if (rotation % 180 === 0) return base;
  const { dx: cos, dy: sin } = unitAt(rotation);
  const c = Math.abs(cos);
  const s = Math.abs(sin);
  return {
    ...base,
    width:  base.width * c + base.height * s,
    height: base.width * s + base.height * c,
  };
}

/**
 * The optical body a beam is trimmed to, in the component's own frame: half-extents
 * along its axis and across it.
 *
 * `beamFaceHalf` narrows the *along* extent only. The cross extent is the artwork's,
 * so a beam arriving side-on at a component that has been pinned to a rotation stops at
 * the edge of the artwork rather than at the optical face — which is what you want, since
 * trimming a crosswise beam by the axial figure would draw it inside the glass.
 */
export function bodyBox(type: OpticalNodeData['type']): { halfAlong: number; halfCross: number } {
  const g = artworkOf(type);
  return {
    halfAlong: g.beamFaceHalf ?? g.width / 2,
    halfCross: g.height / 2,
  };
}


/**
 * Components whose optical surface lies at 45° across their body: mirrors, splitters and
 * the galvo. `mirrorSurfaceDeg` describes where that surface actually points, and the
 * router leaves their rotation alone rather than turning them to face the beam.
 */
export const SURFACE_AT_45 = new Set<OpticalNodeData['type']>([
  'dielectric_mirror', 'dichroic_mirror', 'galvo', 'pbs', 'npbs',
]);

/**
 * The angular grain this component's rotation should snap to.
 *
 * Mirrors get the finer grain because reflection doubles the surface angle: only a 7.5°
 * surface lattice can put a beam on every 15° heading. Everything else is a body lying
 * along the beam, so it wants the beam grain itself.
 */
export function angleStepFor(type: OpticalNodeData['type']): number {
  return SURFACE_AT_45.has(type) ? MIRROR_STEP_DEG : DIR_STEP_DEG;
}

/**
 * Which side of a mirror's drawn surface the substrate hatching goes on: +1 for the
 * lower-right of the artwork's "/", −1 for the upper-left.
 *
 * The polished face is the one the beam arrives at, so this is worked out in the
 * *artwork* frame — take the incoming direction back through the node's rotation and
 * compare it with the artwork's own surface normal (+45°, down-right). It replaces two
 * booleans (`slashFront`, `backslashFront`) that only had answers for the two 45°
 * surfaces the old four-variant artwork could draw.
 */
export function mirrorHatchSide(beamIn: Vec2, rotation = 0): 1 | -1 {
  const local = rotateBy(beamIn, -rotation);
  return dot(local, unitAt(45)) > 0 ? 1 : -1;
}

/**
 * Whether this is a component type the app still knows about.
 *
 * Keyed off the geometry table, which every component needs an entry in, so a type that
 * was removed from the app (the `optomechanics` mounts, the vacuum chamber) or was never
 * real answers `false`. Used when loading a saved layout, to drop nodes the app can no
 * longer draw or trace rather than rendering them as mystery boxes.
 */
export function isKnownComponentType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(GEOMETRIES, type);
}
