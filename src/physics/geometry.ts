// Shared beam geometry helpers.
//
// Screen coordinates are y-down, so an angle measured anticlockwise in maths is
// *clockwise* on screen: 0° is +x (right), 90° is +y (down), 270° is up. Every angle in
// this file follows that convention, and so does `rotation` on a node.
//
// Directions live on a lattice of DIR_STEP_DEG multiples. Nothing here enforces that —
// the maths is general — but `cleanDir` snaps float dust back onto the lattice so that
// axis-aligned results stay exactly axis-aligned, which the id keys, the collinearity
// tests and a good many assertions rely on.

export interface Vec2 { dx: number; dy: number }
export interface Pt   { x: number; y: number }

/**
 * Angular grain of the layout, in degrees.
 *
 * 15° is the intended lattice; the four axes and the diagonals are the subset in use
 * today. Reflection keeps a direction on the lattice as long as mirror surfaces are on
 * it too: a beam at a·step off a surface at s·step leaves at (2s − a)·step.
 */
export const DIR_STEP_DEG = 15;

/**
 * Angular grain of a *mirror surface*, in degrees — half the beam grain.
 *
 * Reflection doubles the surface angle, so a beam can only be steered onto the 15°
 * lattice by surfaces on a 7.5° one: a beam at a·15° off a surface at s·7.5° leaves at
 * (2s − a)·7.5°, and 2s is a multiple of 15°. Quantising mirrors to 15° instead would
 * confine every beam to 30° multiples.
 */
export const MIRROR_STEP_DEG = DIR_STEP_DEG / 2;

/** Within this many degrees of a lattice direction counts as exactly on it. */
const LATTICE_TOL_DEG = 1e-6;

/** Exact unit vectors for the four axes, so multiples of 90° carry no float dust. */
const AXES: Vec2[] = [
  { dx: 1, dy: 0 },   // 0°   east
  { dx: 0, dy: 1 },   // 90°  south (y-down)
  { dx: -1, dy: 0 },  // 180° west
  { dx: 0, dy: -1 },  // 270° north
];

/** Fold an angle into [0, 360). */
export function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Kill -0 and values that are only floating-point noise away from 0. */
const clean = (n: number) => (Math.abs(n) < 1e-12 ? 0 : n);

/**
 * Smallest absolute difference between two angles, respecting wrap-around.
 *
 * `mod` is the period: 360 for directions, **180 for lines** — a beam and the beam
 * retracing it point opposite ways but lie on the same line.
 */
export function angleDiff(a: number, b: number, mod = 360): number {
  const d = ((a - b) % mod + mod) % mod;
  return Math.min(d, mod - d);
}

/** Nearest multiple of `step` degrees, in [0, 360). */
export function snapAngle(deg: number, step = DIR_STEP_DEG): number {
  return norm360(Math.round(norm360(deg) / step) * step);
}

/** Unit vector at `deg`, clockwise from +x in screen coords. */
export function unitAt(deg: number): Vec2 {
  const a = norm360(deg);
  if (a % 90 === 0) return { ...AXES[a / 90] };
  const r = (a * Math.PI) / 180;
  return { dx: clean(Math.cos(r)), dy: clean(Math.sin(r)) };
}

/** Angle of `d` in degrees, [0, 360). Zero-length vectors report 0. */
export function angleOf(d: Vec2): number {
  if (d.dx === 0 && d.dy === 0) return 0;
  return norm360((Math.atan2(d.dy, d.dx) * 180) / Math.PI);
}

/** Unit vector in the direction of `d`, or `d` itself if it has no length. */
export function normalise(d: Vec2): Vec2 {
  const len = Math.hypot(d.dx, d.dy);
  if (len < 1e-12) return { dx: 0, dy: 0 };
  return { dx: clean(d.dx / len), dy: clean(d.dy / len) };
}

/**
 * Unit vector along `d`, pulled onto the angle lattice when it is within a hair of it.
 *
 * This is float hygiene, not quantisation: a direction that genuinely sits off-lattice
 * is returned as-is rather than silently corrected. What it buys is exactness — a beam
 * reflected twice off 45° surfaces comes back as exactly (1, 0) instead of
 * (0.9999999999999998, 2.2e-16), so id keys, loop detection and collinearity all still
 * see one direction rather than two.
 */
export function cleanDir(d: Vec2, step = DIR_STEP_DEG): Vec2 {
  const a = angleOf(d);
  const k = snapAngle(a, step);
  return angleDiff(a, k) < LATTICE_TOL_DEG ? unitAt(k) : normalise(d);
}

/**
 * Unit vector 90° clockwise from d (screen coords) — the "perpendicular" of a beam.
 *
 * Cleaned, because negating a zero component gives -0, which is numerically equal to 0
 * but not identical to it: it used to reach `renderShift` and edge data as "-0" and
 * needed normalising again downstream (`beamLayout`'s `zero`).
 */
export function perpOf(d: Vec2): Vec2 { return { dx: clean(-d.dy), dy: clean(d.dx) }; }

/** True when d points predominantly along the x axis. */
export function isHorizontal(d: Vec2): boolean { return Math.abs(d.dx) > Math.abs(d.dy); }

export function dot(a: Vec2, b: Vec2): number { return a.dx * b.dx + a.dy * b.dy; }

/**
 * Rotate `d` by `deg` (clockwise on screen). Exact for multiples of 90°, since the
 * sine and cosine come from `unitAt`.
 *
 * Pass a negative angle to take a canvas-frame direction *into* a component's own frame.
 */
export function rotateBy(d: Vec2, deg: number): Vec2 {
  const { dx: cos, dy: sin } = unitAt(deg);
  return {
    dx: clean(d.dx * cos - d.dy * sin),
    dy: clean(d.dx * sin + d.dy * cos),
  };
}

/**
 * Distance from the centre of an axis-aligned box to its boundary, along `localDir`.
 *
 * The standard ray/slab exit for a ray starting at the centre: whichever face the ray
 * reaches first. Exact at any angle, and it reduces to `halfAlong` or `halfCross` when
 * the direction is axis-aligned — which is what the old `isHorizontal ? w/2 : h/2` gave.
 *
 * `localDir` must be in the box's own frame and should be a unit vector; a zero vector
 * yields Infinity, which callers treat as "no trim".
 */
export function boxHalfExtent(halfAlong: number, halfCross: number, localDir: Vec2): number {
  const ax = Math.abs(localDir.dx);
  const ay = Math.abs(localDir.dy);
  const tAlong = ax < 1e-12 ? Infinity : halfAlong / ax;
  const tCross = ay < 1e-12 ? Infinity : halfCross / ay;
  return Math.min(tAlong, tCross);
}

/**
 * Distance from a point to a line *segment* (not the infinite line), and how far along
 * the segment the closest approach falls.
 *
 * Used for two unrelated things that both need it: finding which beam a power probe is
 * nearest, and keeping a component's label clear of the beams around it.
 */
export function nearestOnSegment(
  p: Pt,
  a: Pt,
  b: Pt,
): { distance: number; along: number; point: Pt } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) {
    return { distance: Math.hypot(p.x - a.x, p.y - a.y), along: 0, point: { x: a.x, y: a.y } };
  }
  // Clamped, so a point past the end of a beam measures to the end rather than to the
  // infinite line it lies on.
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { distance: Math.hypot(p.x - point.x, p.y - point.y), along: t * Math.sqrt(len2), point };
}

/**
 * Reflect `d` off a surface lying along `surfaceDeg`.
 *
 * `d − 2(d·n)n` about the surface normal, which is the general law — it turns a beam by
 * twice the angle between beam and surface, so a surface 15° off a beam sends it 30°
 * away. The old implementation could only express the two 45° surfaces, where that turn
 * happens to be exactly 90°.
 */
export function reflectAbout(d: Vec2, surfaceDeg: number): Vec2 {
  const n = unitAt(surfaceDeg + 90);
  const k = 2 * dot(d, n);
  return cleanDir({ dx: d.dx - k * n.dx, dy: d.dy - k * n.dy });
}

/**
 * The surface angle of a mirror-like component at the given rotation.
 *
 * A mirror's artwork is drawn at 45° across its box, so its surface is 45° *behind* the
 * body axis every other component uses: rotation 0 is "/" (a surface along −45°, i.e.
 * lower-left→upper-right in y-down coords) and rotation 90 is "\". Anything that needs
 * to know where a mirror actually faces should come through here rather than test the
 * rotation against 90/270.
 */
export function mirrorSurfaceDeg(rotation = 0): number {
  return norm360(rotation - 45);
}

/**
 * Reflect a direction off a mirror-like component at the given rotation.
 *
 * Used by the router (beam direction) and by OpticalNode (handle placement), so the two
 * can never disagree about where a reflected beam goes. For the four rotations the UI
 * currently offers this reproduces the old "/" and "\" tables exactly.
 */
export function mirrorReflect(d: Vec2, rotation = 0): Vec2 {
  return reflectAbout(d, mirrorSurfaceDeg(rotation));
}

/**
 * Short stable label for a direction, for use in generated ids.
 *
 * The four axes keep their compass letters, so every id that existed before the angle
 * generalisation still reads the same. Off-axis directions are named by their angle.
 */
export function dirKey(d: Vec2): string {
  const a = angleOf(cleanDir(d));
  switch (a) {
    case 0:   return 'e';
    case 90:  return 's';
    case 180: return 'w';
    case 270: return 'n';
    default:  return `d${Number(a.toFixed(2))}`;
  }
}
