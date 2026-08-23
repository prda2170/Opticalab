// Beam state propagating through the optical system

export type Polarization =
  | { type: 'H' }
  | { type: 'V' }
  | { type: 'circular'; handedness: 'L' | 'R' }
  | { type: 'elliptical' }
  | { type: 'custom'; Ex: [number, number]; Ey: [number, number] }; // Jones vector [re,im]

export interface BeamState {
  /**
   * Carrier wavelength, nm. Set by the source and changed only by nonlinear
   * conversion (e.g. SHG halves it). RF-scale shifts do **not** touch this — an
   * 80 MHz AOM shift is 2 parts in 10⁷ of the carrier, invisible in nm and lost
   * to rounding. Those live in `detuningHz`.
   */
  wavelength: number;
  power: number;        // mW
  polarization: Polarization;
  /**
   * Accumulated frequency offset from the carrier, Hz. AOMs/AODs add ±f_RF here;
   * frequency doubling scales it with the carrier. The true optical frequency is
   * c/wavelength + detuningHz.
   */
  detuningHz?: number;

  // ── Gaussian beam ─────────────────────────────────────────────────────────
  /** Complex beam parameter q = (z − z_waist) + i·z_R, in mm, **at this plane**. */
  q?: [number, number];
  /** Beam quality factor (1 = ideal Gaussian). Propagated with the beam. */
  mSquared?: number;
  // The rest are derived from `q` for display — see refreshGaussian() in
  // physics/propagate.ts. Never set them by hand.
  /** 1/e² intensity radius at this plane, μm. */
  w?: number;
  /** Waist radius, μm. */
  w0?: number;
  /** Rayleigh range, mm. */
  zR?: number;
  /** Signed distance to the waist, mm; positive means downstream. */
  waistDistance?: number;
  /** Far-field half-angle divergence, mrad. */
  divergence?: number;
}

export const defaultBeam: BeamState = {
  wavelength: 780,
  power: 1,
  polarization: { type: 'H' },
};

/**
 * One drawn stretch of beam, in canvas coordinates, with the physics that
 * belongs to it.  Produced by the router and consumed by *every* view, so the
 * editor canvas and the diagram can never disagree about where a beam goes.
 */
export interface BeamSegment {
  /** Matches the id of the corresponding edge (auto-routed or user-drawn). */
  id: string;
  sourceId: string;
  sourceHandle: string;
  /** Target node id — a `phantom_*` endpoint id when the beam hits nothing. */
  targetId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Beam state at the *start* of this segment (x1, y1). */
  beam: BeamState;
  /** Physical length of this stretch of beam, mm. */
  lengthMm: number;
  /** True when the beam leaves the layout without hitting a component. */
  free: boolean;
  /** True when the connection came from an explicit user-drawn edge, not ray tracing. */
  wired: boolean;
  /**
   * Display-only perpendicular displacement (px), set by `fanCollinearSegments` so
   * beams sharing a line stay individually visible. The coordinates above remain
   * physically true — renderers add this via `drawnEndpoints`.
   */
  renderShift?: { dx: number; dy: number };
  /** Set when the beam forms a waist part-way along this segment (a visible focus). */
  waist?: {
    /** Canvas position of the focus, on the drawn line. */
    x: number;
    y: number;
    /** Waist radius there, μm. */
    radius: number;
  };
}
