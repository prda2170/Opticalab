// Jones calculus for polarization propagation
// Jones vectors: [Ex, Ey] as complex numbers [re, im]

export type Complex = [number, number]; // [real, imag]
export type JonesVector = [Complex, Complex];
export type JonesMatrix = [[Complex, Complex], [Complex, Complex]];

// Complex arithmetic helpers
export const cadd = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]];
export const cmul = (a: Complex, b: Complex): Complex => [
  a[0] * b[0] - a[1] * b[1],
  a[0] * b[1] + a[1] * b[0],
];
export const cscale = (a: Complex, s: number): Complex => [a[0] * s, a[1] * s];
export const cexp = (theta: number): Complex => [Math.cos(theta), Math.sin(theta)]; // e^(i*theta)
export const cabs2 = (a: Complex): number => a[0] * a[0] + a[1] * a[1];

// Multiply Jones matrix by vector
export function applyJones(M: JonesMatrix, v: JonesVector): JonesVector {
  return [
    cadd(cmul(M[0][0], v[0]), cmul(M[0][1], v[1])),
    cadd(cmul(M[1][0], v[0]), cmul(M[1][1], v[1])),
  ];
}

// Multiply two Jones matrices: M1 * M2
export function mulJones(M1: JonesMatrix, M2: JonesMatrix): JonesMatrix {
  const el = (r: 0 | 1, c: 0 | 1): Complex =>
    cadd(cmul(M1[r][0], M2[0][c]), cmul(M1[r][1], M2[1][c]));
  return [
    [el(0, 0), el(0, 1)],
    [el(1, 0), el(1, 1)],
  ];
}

const C0: Complex = [0, 0];
const C1: Complex = [1, 0];

// Identity
export const identityMatrix: JonesMatrix = [[C1, C0], [C0, C1]];

// Linear polarizer at angle theta (radians)
export function linearPolarizer(theta: number): JonesMatrix {
  const c = Math.cos(theta), s = Math.sin(theta);
  return [
    [[c * c, 0], [c * s, 0]],
    [[c * s, 0], [s * s, 0]],
  ];
}

// Wave retarder with retardance Gamma and fast axis at theta (radians)
export function waveRetarder(Gamma: number, theta: number): JonesMatrix {
  const c = Math.cos(theta), s = Math.sin(theta);
  // M = R(-theta) * [[e^{-i*Gamma/2}, 0], [0, e^{i*Gamma/2}]] * R(theta)
  const eNeg = cexp(-Gamma / 2); // e^{-i*Gamma/2}
  const ePos = cexp(Gamma / 2);  // e^{+i*Gamma/2}
  // Full formula:
  const m00: Complex = cadd(
    cscale(eNeg, c * c),
    cscale(ePos, s * s)
  );
  const m01: Complex = cadd(
    cscale(eNeg, c * s),
    cscale(ePos, -c * s)
  );
  const m10 = m01;
  const m11: Complex = cadd(
    cscale(eNeg, s * s),
    cscale(ePos, c * c)
  );
  return [[m00, m01], [m10, m11]];
}

// Half-wave plate fast axis at theta (radians)
export function hwpMatrix(theta: number): JonesMatrix {
  return waveRetarder(Math.PI, theta);
}

// Quarter-wave plate fast axis at theta (radians)
export function qwpMatrix(theta: number): JonesMatrix {
  return waveRetarder(Math.PI / 2, theta);
}

// Standard polarization state Jones vectors (normalized)
export const H: JonesVector = [[1, 0], [0, 0]];
export const V: JonesVector = [[0, 0], [1, 0]];
export const LCP: JonesVector = [cscale([1, 0], 1 / Math.SQRT2), cscale([0, 1], 1 / Math.SQRT2)];
export const RCP: JonesVector = [cscale([1, 0], 1 / Math.SQRT2), cscale([0, -1], 1 / Math.SQRT2)];

// Convert polarization tag to Jones vector
import type { Polarization } from '../types/beam';

export function polarizationToJones(pol: Polarization): JonesVector {
  switch (pol.type) {
    case 'H': return H;
    case 'V': return V;
    case 'circular': return pol.handedness === 'L' ? LCP : RCP;
    case 'elliptical': return LCP; // placeholder
    case 'custom': return [pol.Ex as Complex, pol.Ey as Complex];
  }
}

/** Phase of Ey relative to Ex, wrapped to (−π, π]. */
function relativePhase(ex: Complex, ey: Complex): number {
  const d = Math.atan2(ey[1], ey[0]) - Math.atan2(ex[1], ex[0]);
  return Math.atan2(Math.sin(d), Math.cos(d));
}

export function jonesToPolarization(v: JonesVector): Polarization {
  const ex2 = cabs2(v[0]), ey2 = cabs2(v[1]);
  const total = ex2 + ey2;
  if (total < 1e-12) return { type: 'H' };
  const ratio = ey2 / total;
  if (ratio < 0.01) return { type: 'H' };
  if (ratio > 0.99) return { type: 'V' };

  // Equal amplitudes a quarter wave apart is circular light. Worth naming: a λ/4 at
  // 45° produces it, and it fills the double-passed arm of every AOM setup, where
  // reporting "custom" tells the user nothing. Snapping to the canonical LCP/RCP
  // vector discards only a global phase, which nothing here observes.
  if (Math.abs(ratio - 0.5) < 0.01) {
    const d = relativePhase(v[0], v[1]);
    if (Math.abs(Math.abs(d) - Math.PI / 2) < 0.02) {
      return { type: 'circular', handedness: d > 0 ? 'L' : 'R' };
    }
  }

  return { type: 'custom', Ex: v[0], Ey: v[1] };
}

// Compute output polarization through a Jones matrix
export function propagatePolarization(pol: Polarization, M: JonesMatrix): Polarization {
  const v = polarizationToJones(pol);
  const out = applyJones(M, v);
  return jonesToPolarization(out);
}
