import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  advanceQ, beamRadiusAt, distanceToWaist, divergenceOf, effectiveWavelengthMm,
  rayleighRangeOf, thinLens, transformQ, waistQ, waistRadiusOf,
} from '../gaussian';
import { PX_PER_INCH, MM_PER_INCH, pxToMm, mmToPx, formatSpot, formatLength } from '../scale';
import { advanceBeam, componentOutputs, laserBeam, refreshGaussian, DEFAULT_WAIST_UM } from '../propagate';
import { autoRoute } from '../autoRoute';
import type { OpticalNodeData } from '../../types/components';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Scale ─────────────────────────────────────────────────────────────────────

describe('scale', () => {
  it('maps one grid square to one inch', () => {
    expect(pxToMm(PX_PER_INCH)).toBeCloseTo(MM_PER_INCH, 9);
    expect(mmToPx(MM_PER_INCH)).toBeCloseTo(PX_PER_INCH, 9);
  });

  it('round-trips px → mm → px', () => {
    for (const px of [1, 40, 137.5, 4000]) expect(mmToPx(pxToMm(px))).toBeCloseTo(px, 9);
  });

  it('formats lengths and spots in readable units', () => {
    expect(formatLength(0.25)).toBe('250 µm');
    expect(formatLength(12.34)).toBe('12.3 mm');
    expect(formatLength(2500)).toBe('2.50 m');
    expect(formatSpot(31.03)).toBe('31.0 µm');
    expect(formatSpot(800)).toBe('800 µm');
    expect(formatSpot(1600)).toBe('1.60 mm');
  });
});

// ── Gaussian core ─────────────────────────────────────────────────────────────

describe('gaussian core', () => {
  const W0 = 1;                                   // mm
  const LAMBDA = effectiveWavelengthMm(1000);     // 1000 nm → 1e-3 mm
  const q0 = waistQ(W0, LAMBDA);
  const ZR = Math.PI * W0 * W0 / LAMBDA;          // π × 1 / 1e-3 ≈ 3141.6 mm

  it('derives the Rayleigh range from the waist', () => {
    expect(rayleighRangeOf(q0)).toBeCloseTo(ZR, 6);
  });

  it('reports the waist radius at the waist', () => {
    expect(beamRadiusAt(q0, LAMBDA)).toBeCloseTo(W0, 9);
    expect(distanceToWaist(q0)).toBeCloseTo(0, 12);
  });

  it('expands to √2·w0 after one Rayleigh range', () => {
    expect(beamRadiusAt(advanceQ(q0, ZR), LAMBDA)).toBeCloseTo(W0 * Math.SQRT2, 6);
  });

  it('follows w(z) = w0·√(1+(z/zR)²)', () => {
    for (const z of [0, 100, ZR / 2, ZR, 3 * ZR]) {
      const expected = W0 * Math.sqrt(1 + (z / ZR) ** 2);
      expect(beamRadiusAt(advanceQ(q0, z), LAMBDA)).toBeCloseTo(expected, 6);
    }
  });

  it('approaches the far-field divergence θ = λ/(π·w0)', () => {
    const theta = divergenceOf(q0, LAMBDA);
    expect(theta).toBeCloseTo(LAMBDA / (Math.PI * W0), 12);
    // Far from the waist the radius approaches θ·z.
    const z = 1000 * ZR;
    expect(beamRadiusAt(advanceQ(q0, z), LAMBDA) / (theta * z)).toBeCloseTo(1, 5);
  });

  it('preserves the waist radius under free-space propagation', () => {
    for (const z of [1, 250, 5000]) {
      const q = advanceQ(q0, z);
      expect(waistRadiusOf(q, LAMBDA)).toBeCloseTo(W0, 9);
      expect(distanceToWaist(q)).toBeCloseTo(-z, 9);   // waist is now behind us
    }
  });

  it('shrinks the Rayleigh range and widens divergence for M² > 1', () => {
    const mSq = 4;
    const lambdaEff = effectiveWavelengthMm(1000, mSq);
    const q = waistQ(W0, lambdaEff);
    expect(rayleighRangeOf(q)).toBeCloseTo(ZR / mSq, 6);
    expect(divergenceOf(q, lambdaEff)).toBeCloseTo(divergenceOf(q0, LAMBDA) * mSq, 12);
  });

  it('focuses a collimated beam to the analytic waist and location', () => {
    // Input waist sitting d mm before a lens of focal length f.
    const f = 100, d = 158.75;
    const qAtLens = advanceQ(q0, d);
    const qOut = transformQ(qAtLens, thinLens(f));

    // Standard thin-lens Gaussian relations, with z the input-waist distance:
    //   z' − f = f²(z − f) / ((z − f)² + zR²)      w0' = w0·f / √((z − f)² + zR²)
    const denom = (d - f) ** 2 + ZR ** 2;
    const expectedZ  = f + (f * f * (d - f)) / denom;
    const expectedW0 = W0 * f / Math.sqrt(denom);

    expect(distanceToWaist(qOut)).toBeCloseTo(expectedZ, 6);
    expect(waistRadiusOf(qOut, LAMBDA)).toBeCloseTo(expectedW0, 9);
  });

  it('puts the focus of a well-collimated beam at f with spot λf/(π·w0)', () => {
    const f = 100;                       // f ≪ zR, so this is the collimated limit
    const qOut = transformQ(q0, thinLens(f));
    // The exact focus is f·zR²/(f²+zR²), which is 0.1 % short of f here.
    expect(distanceToWaist(qOut) / f).toBeCloseTo(1, 2);
    expect(waistRadiusOf(qOut, LAMBDA)).toBeCloseTo(LAMBDA * f / (Math.PI * W0), 4);
  });

  it('keeps a diverging lens physical (zR stays positive)', () => {
    const qOut = transformQ(advanceQ(q0, 50), thinLens(-75));
    expect(rayleighRangeOf(qOut)).toBeGreaterThan(0);
    expect(Number.isFinite(beamRadiusAt(qOut, LAMBDA))).toBe(true);
  });
});

// ── Beam state plumbing ───────────────────────────────────────────────────────

describe('beam state', () => {
  const laserData = (over: Partial<OpticalNodeData> = {}) => ({
    type: 'laser_source', name: 'L', category: 'source',
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
    ...over,
  } as OpticalNodeData & { type: 'laser_source' });

  it('seeds a laser beam at its waist', () => {
    const b = laserBeam(laserData());
    expect(b.q).toBeDefined();
    expect(b.w).toBeCloseTo(800, 6);
    expect(b.w0).toBeCloseTo(800, 6);
    expect(b.waistDistance).toBeCloseTo(0, 9);
    expect(b.zR).toBeGreaterThan(0);
  });

  it('falls back to a default waist for layouts saved without one', () => {
    const b = laserBeam(laserData({ waist: undefined } as Partial<OpticalNodeData>));
    expect(b.w).toBeCloseTo(DEFAULT_WAIST_UM, 6);
  });

  it('grows the spot over free space', () => {
    // 20 µm waist has a ~1.6 mm Rayleigh range, so it expands fast.
    const b = laserBeam(laserData({ waist: 20 } as Partial<OpticalNodeData>));
    const after = advanceBeam(b, 100);
    expect(after.w!).toBeGreaterThan(b.w! * 10);
    expect(after.w0!).toBeCloseTo(20, 6);           // waist itself is unchanged
    expect(after.waistDistance!).toBeCloseTo(-100, 6);
  });

  it('leaves a beam without a q untouched', () => {
    const bare = { wavelength: 780, power: 1, polarization: { type: 'H' as const } };
    expect(advanceBeam(bare, 100)).toEqual(bare);
    expect(refreshGaussian(bare)).toEqual(bare);
  });

  it('refocuses through a lens component', () => {
    const b = advanceBeam(laserBeam(laserData()), 150);
    const [port] = componentOutputs(b, {
      type: 'plano_convex', name: 'L1', category: 'lens', focalLength: 100,
    } as OpticalNodeData);
    // A near-collimated 800 µm beam through f = 100 mm focuses tightly, ~f away.
    expect(port.beam.waistDistance!).toBeGreaterThan(90);
    expect(port.beam.waistDistance!).toBeLessThan(101);
    expect(port.beam.w0!).toBeLessThan(50);
    expect(port.beam.power).toBeCloseTo(100, 6);     // ideal lens, no loss
  });

  it('halves the spot by √2 at a doubling crystal', () => {
    const b = laserBeam(laserData());
    const ports = componentOutputs(b, {
      type: 'shg_crystal', name: 'SHG', category: 'steering',
      geometry: 'bulk', temperature: 40, conversionEfficiency: 30,
    } as OpticalNodeData);
    const doubled = ports.find(p => p.handle === 'shg')!;
    expect(doubled.beam.wavelength).toBeCloseTo(390, 6);
    expect(doubled.beam.w!).toBeCloseTo(b.w! / Math.SQRT2, 6);
  });

  it('carries M² through the layout', () => {
    const ideal = laserBeam(laserData());
    const poor  = laserBeam(laserData({ mSquared: 4 } as Partial<OpticalNodeData>));
    expect(poor.mSquared).toBe(4);
    expect(poor.zR!).toBeCloseTo(ideal.zR! / 4, 6);
    expect(advanceBeam(poor, 500).w!).toBeGreaterThan(advanceBeam(ideal, 500).w!);
  });
});

// ── End to end through the router ─────────────────────────────────────────────

describe('autoRoute — Gaussian propagation', () => {
  function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
    const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
    const g = getNodeGeometry(full.type, full.rotation ?? 0);
    return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
  }
  const laserNode = at('L1', {
    type: 'laser_source', category: 'source', name: 'L1',
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
  } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, 33);
  const AXIS_Y = 33;
  /** Laser output face: position.x (0) + geometry width (90). Rays start here. */
  const OUTPUT_X = 90;

  it('reports a growing spot at successive components', () => {
    const nodes = [
      laserNode,
      at('ND', { type: 'nd_filter', category: 'conditioning', od: 0 }, 400, AXIS_Y),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 1200, AXIS_Y),
    ];
    const { nodeBeams } = autoRoute(nodes, []);

    const wAtND = nodeBeams.get('ND')!.w!;
    const wAtPD = nodeBeams.get('PD')!.w!;
    // An 800 µm waist has a metres-long Rayleigh range, so growth over ~half a
    // metre of bench is real but small — and strictly monotonic.
    expect(wAtND).toBeGreaterThan(800);
    expect(wAtPD).toBeGreaterThan(wAtND);
    expect(wAtPD).toBeLessThan(850);

    // The spot at each plane matches w(z) computed from the physical distance.
    const seed = laserBeam(laserNode.data as OpticalNodeData & { type: 'laser_source' });
    expect(wAtND).toBeCloseTo(advanceBeam(seed, pxToMm(400 - OUTPUT_X)).w!, 6);
    expect(wAtPD).toBeCloseTo(advanceBeam(seed, pxToMm(1200 - OUTPUT_X)).w!, 6);
  });

  it('places a focus marker one focal length past a lens', () => {
    const LENS_X = 400, PD_X = 1000;
    const nodes = [
      laserNode,
      at('LENS', { type: 'plano_convex', category: 'lens', focalLength: 100 }, LENS_X, AXIS_Y),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, PD_X, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);

    const afterLens = segments.find(s => s.sourceId === 'LENS')!;
    expect(afterLens.waist).toBeDefined();

    // The focus sits ≈100 mm downstream of the lens, i.e. ≈157.5 px.
    expect(afterLens.waist!.x).toBeCloseTo(LENS_X + mmToPx(100), 0);
    expect(afterLens.waist!.y).toBeCloseTo(AXIS_Y, 6);
    // Focused spot ≈ λf/(π·w0) ≈ 31 µm.
    expect(afterLens.waist!.radius).toBeGreaterThan(25);
    expect(afterLens.waist!.radius).toBeLessThan(40);
  });

  it('marks no focus on a collimated beam straight out of the laser', () => {
    const nodes = [
      laserNode,
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 900, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    expect(segments[0].waist).toBeUndefined();
  });

  it('records the physical length of every segment', () => {
    const nodes = [
      laserNode,
      at('M', { type: 'dielectric_mirror', reflectivity: 99, rotation: 0 }, 400, AXIS_Y),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 400, AXIS_Y - 200),
    ];
    const { segments } = autoRoute(nodes, []);
    const toMirror = segments.find(s => s.targetId === 'M')!;
    const toPd     = segments.find(s => s.targetId === 'PD')!;
    expect(toMirror.lengthMm).toBeCloseTo(pxToMm(400 - OUTPUT_X), 6);
    // The mirror→detector leg is trimmed at the detector face, so it is slightly
    // shorter than the 200 px centre-to-centre spacing.
    expect(toPd.lengthMm).toBeGreaterThan(pxToMm(150));
    expect(toPd.lengthMm).toBeLessThanOrEqual(pxToMm(200));
  });

  it('propagates the beam along a user-drawn wire', () => {
    const nodes = [
      laserNode,
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 45 + 400, 33),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, [
      { id: 'e1', source: 'L1', sourceHandle: 'out', target: 'PD', targetHandle: 'in' },
    ]);
    const wire = segments.find(s => s.wired)!;
    expect(wire.lengthMm).toBeCloseTo(pxToMm(400), 6);
    // The beam at the far end has expanded relative to the near end.
    expect(nodeBeams.get('PD')!.w!).toBeGreaterThan(wire.beam.w!);
  });
});
