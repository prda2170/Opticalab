// Gaussian beam propagation via the ABCD (ray-transfer) matrix method.
//
// The beam is carried as the complex beam parameter
//     q = (z − z_waist) + i·z_R
// in **millimetres**, defined at whatever plane the beam state applies to.
// Everything here works in mm; callers convert at the boundary (see scale.ts for
// px↔mm, and propagate.ts for the µm display units).
//
// Real beams are handled with the embedded-Gaussian trick: an M² > 1 beam
// propagates exactly like an ideal Gaussian at the effective wavelength M²·λ.

/** Complex number as [real, imag]. */
type C = [number, number];

const cdiv = (a: C, b: C): C => {
  const denom = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / denom, (a[1] * b[0] - a[0] * b[1]) / denom];
};
const cadd = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];

export type ABCDMatrix = { A: number; B: number; C: number; D: number };

/** Transform a complex beam parameter: q_out = (A·q + B) / (C·q + D). */
export function transformQ(q: C, M: ABCDMatrix): C {
  const num: C = cadd([M.A * q[0], M.A * q[1]], [M.B, 0]);
  const den: C = cadd([M.C * q[0], M.C * q[1]], [M.D, 0]);
  return cdiv(num, den);
}

/** Cascade ABCD matrices (rightmost applied first). */
export function cascadeABCD(matrices: ABCDMatrix[]): ABCDMatrix {
  return matrices.reduce((acc, M) => ({
    A: acc.A * M.A + acc.B * M.C,
    B: acc.A * M.B + acc.B * M.D,
    C: acc.C * M.A + acc.D * M.C,
    D: acc.C * M.B + acc.D * M.D,
  }), { A: 1, B: 0, C: 0, D: 1 });
}

// ── Standard elements (all distances in mm) ───────────────────────────────────

export const identityABCD: ABCDMatrix = { A: 1, B: 0, C: 0, D: 1 };
export const freeSpace     = (d: number): ABCDMatrix => ({ A: 1, B: d, C: 0, D: 1 });
export const thinLens      = (f: number): ABCDMatrix => ({ A: 1, B: 0, C: -1 / f, D: 1 });
export const flatInterface = (): ABCDMatrix => identityABCD;
export const curvedMirror  = (R: number): ABCDMatrix => ({ A: 1, B: 0, C: -2 / R, D: 1 });

// ── Beam parameter ↔ physical quantities ──────────────────────────────────────

/**
 * Effective wavelength (mm) for a beam of quality M².
 * An M² beam propagates like an ideal Gaussian at this wavelength.
 */
export function effectiveWavelengthMm(wavelengthNm: number, mSquared = 1): number {
  return wavelengthNm * 1e-6 * Math.max(mSquared, 1);
}

/** q at a waist of radius w0 (mm): z = 0, z_R = π·w0²/λ. */
export function waistQ(w0Mm: number, lambdaEffMm: number): C {
  return [0, (Math.PI * w0Mm * w0Mm) / lambdaEffMm];
}

/** Advance a beam parameter through `d` mm of free space. */
export function advanceQ(q: C, dMm: number): C {
  return [q[0] + dMm, q[1]];
}

/** Rayleigh range (mm) — the imaginary part of q. */
export function rayleighRangeOf(q: C): number { return q[1]; }

/**
 * Signed distance (mm) from the current plane to the waist.
 * Positive means the waist is downstream (the beam is still converging).
 */
export function distanceToWaist(q: C): number { return -q[0]; }

/** 1/e² intensity radius (mm) at the current plane. */
export function beamRadiusAt(q: C, lambdaEffMm: number): number {
  // 1/q = 1/R − i·λ/(π·w²)  ⇒  w = sqrt(−λ / (π·Im(1/q)))
  const imOneOverQ = cdiv([1, 0], q)[1];
  if (!(imOneOverQ < 0)) return NaN; // not a physical beam (z_R ≤ 0)
  return Math.sqrt(-lambdaEffMm / (Math.PI * imOneOverQ));
}

/** Waist radius (mm) of the beam described by q. */
export function waistRadiusOf(q: C, lambdaEffMm: number): number {
  const zR = rayleighRangeOf(q);
  if (!(zR > 0)) return NaN;
  return Math.sqrt((lambdaEffMm * zR) / Math.PI);
}

/** Far-field half-angle divergence (rad) of the beam described by q. */
export function divergenceOf(q: C, lambdaEffMm: number): number {
  const w0 = waistRadiusOf(q, lambdaEffMm);
  if (!Number.isFinite(w0) || w0 === 0) return NaN;
  return lambdaEffMm / (Math.PI * w0);
}
