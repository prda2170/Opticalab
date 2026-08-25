import { describe, it, expect } from 'vitest';
import {
  CHAMBER_DEFAULTS, chamberSpec, portStates, faceStepDeg, faceNormalDeg, nearestFace,
  polygonHalfExtent, circumradiusPx, faceHalfWidthPx, facePositionPx, chamberPassage,
  chamberBlockMessage, NORMAL_TOLERANCE_DEG,
} from '../chamber';
import { mmToPx, PX_PER_MM } from '../scale';
import type { OpticalNodeData } from '../../types/components';

// A chamber's data, defaults unless overridden.
const chamber = (over: Record<string, unknown> = {}) => ({
  type: 'vacuum_chamber', name: 'Chamber', category: 'coldatom', ...over,
} as unknown as OpticalNodeData);

// ── The part ──────────────────────────────────────────────────────────────────

describe('the default chamber is the MCF1000 dodecagon', () => {
  it('carries the numbers off the drawing', () => {
    // MCF_Spherical_Dodecagon_2023_0222.pdf p2: 12 ports at 30°, 5.300 in to each face,
    // 1.500 in bore, 8.300 in vertical bore, 18.42 mm wall at a flat.
    expect(CHAMBER_DEFAULTS.sides).toBe(12);
    expect(CHAMBER_DEFAULTS.inradiusMm).toBeCloseTo(134.62, 2);
    expect(CHAMBER_DEFAULTS.boreMm).toBeCloseTo(38.10, 2);
    expect(CHAMBER_DEFAULTS.tubeMm).toBeCloseTo(18.42, 2);
    expect(CHAMBER_DEFAULTS.topBoreMm).toBeCloseTo(210.82, 2);
  });

  it('is a 10 inch chamber at the app scale', () => {
    const spec = chamberSpec(chamber());
    // 5.300 in at 40 px/in.
    expect(spec.inradiusPx).toBeCloseTo(212, 0);
    expect(2 * spec.inradiusPx).toBeCloseTo(424, 0);      // across flats
    expect(2 * circumradiusPx(spec.inradiusPx, 12)).toBeCloseTo(439, 0);  // across corners
    expect(spec.borePx).toBeCloseTo(60, 0);
  });

  it('agrees with the drawing on the corner-to-sphere check', () => {
    // The preset's own consistency note: across-corners from a 134.62 inradius is 278.74 mm,
    // which should match the quoted 278.03 spherical OD to under a millimetre.
    const acrossCornersMm = 2 * circumradiusPx(mmToPx(134.62), 12) / PX_PER_MM;
    expect(acrossCornersMm).toBeCloseTo(278.74, 1);
    expect(Math.abs(acrossCornersMm - 278.03)).toBeLessThan(1);
  });

  it('agrees with the drawing on the flat width', () => {
    // A 2.75 in CF flange (69.85 mm OD) has to fit the flat: the preset says 72.14 mm.
    const flatMm = 2 * faceHalfWidthPx(mmToPx(134.62), 12) / PX_PER_MM;
    expect(flatMm).toBeCloseTo(72.14, 2);
    expect(flatMm).toBeGreaterThan(69.85);
  });
});

// ── Reading the data ──────────────────────────────────────────────────────────

describe('chamberSpec', () => {
  it('takes the octagon when asked, which is the other part on the shelf', () => {
    // Kimball MCF800-SphOct: 8 ports, 100.5 mm to each face.
    const spec = chamberSpec(chamber({ sides: 8, inradiusMm: 100.5 }));
    expect(spec.sides).toBe(8);
    expect(spec.inradiusPx).toBeCloseTo(mmToPx(100.5), 6);
  });

  it('clamps the side count to something that can be a chamber', () => {
    expect(chamberSpec(chamber({ sides: 2 })).sides).toBe(3);
    expect(chamberSpec(chamber({ sides: 400 })).sides).toBe(24);
    expect(chamberSpec(chamber({ sides: 12.4 })).sides).toBe(12);
  });

  it('ignores nonsense rather than collapsing the chamber', () => {
    expect(chamberSpec(chamber({ inradiusMm: 0 })).inradiusPx).toBeCloseTo(mmToPx(134.62), 6);
    expect(chamberSpec(chamber({ inradiusMm: -5 })).inradiusPx).toBeCloseTo(mmToPx(134.62), 6);
    expect(chamberSpec(chamber({ sides: NaN })).sides).toBe(12);
  });

  it('will not let the bore be wider than the chamber', () => {
    const spec = chamberSpec(chamber({ inradiusMm: 50, boreMm: 500 }));
    expect(spec.borePx).toBeCloseTo(mmToPx(50), 6);
  });

  it('clamps window transmission to a fraction', () => {
    expect(chamberSpec(chamber({ transmission: 99 })).windowT).toBeCloseTo(0.99, 9);
    expect(chamberSpec(chamber({ transmission: 500 })).windowT).toBe(1);
    expect(chamberSpec(chamber({ transmission: -5 })).windowT).toBe(1);   // nonsense -> default
  });
});

describe('portStates', () => {
  it('opens anything unspecified, so a fresh chamber passes light', () => {
    expect(portStates(undefined, 4)).toEqual(['viewport', 'viewport', 'viewport', 'viewport']);
  });

  it('keeps what was set and pads the rest', () => {
    expect(portStates(['closed', 'viewport'], 4))
      .toEqual(['closed', 'viewport', 'viewport', 'viewport']);
  });

  it('trims when the side count drops', () => {
    expect(portStates(['closed', 'closed', 'closed'], 2)).toEqual(['closed', 'closed']);
  });

  it('treats junk entries as open', () => {
    expect(portStates([null, 7, 'window'], 3)).toEqual(['viewport', 'viewport', 'viewport']);
  });
});

// ── Polygon geometry ──────────────────────────────────────────────────────────

describe('polygon geometry', () => {
  const R = 212;

  it('steps by 30° on a dodecagon and 45° on an octagon', () => {
    expect(faceStepDeg(12)).toBe(30);
    expect(faceStepDeg(8)).toBe(45);
    // 30° is a multiple of the 15° beam lattice, so every face normal is reachable.
    expect(faceStepDeg(12) % 15).toBe(0);
  });

  it('reaches the inradius along a face normal', () => {
    for (let i = 0; i < 12; i++) {
      expect(polygonHalfExtent(R, 12, faceNormalDeg(12, i))).toBeCloseTo(R, 9);
    }
  });

  it('reaches the circumradius at a corner', () => {
    // Half a step off a normal is exactly a corner.
    expect(polygonHalfExtent(R, 12, 15)).toBeCloseTo(circumradiusPx(R, 12), 9);
    expect(polygonHalfExtent(R, 8, 22.5)).toBeCloseTo(circumradiusPx(R, 8), 9);
  });

  it('never leaves the ring between inradius and circumradius', () => {
    for (let deg = 0; deg < 360; deg += 0.5) {
      const d = polygonHalfExtent(R, 12, deg);
      expect(d).toBeGreaterThanOrEqual(R - 1e-9);
      expect(d).toBeLessThanOrEqual(circumradiusPx(R, 12) + 1e-9);
    }
  });

  it('has the period of its own faces', () => {
    for (const deg of [0, 7, 13, 29]) {
      expect(polygonHalfExtent(R, 12, deg)).toBeCloseTo(polygonHalfExtent(R, 12, deg + 30), 9);
      expect(polygonHalfExtent(R, 12, deg)).toBeCloseTo(polygonHalfExtent(R, 12, deg + 180), 9);
    }
  });

  it('is symmetric about a face normal', () => {
    expect(polygonHalfExtent(R, 12, 10)).toBeCloseTo(polygonHalfExtent(R, 12, -10), 9);
  });
});

describe('nearestFace', () => {
  it('names the face a direction is aimed at', () => {
    expect(nearestFace(12, 0)).toEqual({ index: 0, offsetDeg: 0 });
    expect(nearestFace(12, 30).index).toBe(1);
    expect(nearestFace(12, 180).index).toBe(6);
  });

  it('reports how far off the normal the direction is, signed', () => {
    expect(nearestFace(12, 10).offsetDeg).toBeCloseTo(10, 9);
    expect(nearestFace(12, 25).offsetDeg).toBeCloseTo(-5, 9);   // nearer face 1
    expect(nearestFace(12, 25).index).toBe(1);
  });

  it('wraps, in both directions', () => {
    expect(nearestFace(12, 360).index).toBe(0);
    expect(nearestFace(12, -30).index).toBe(11);
    expect(nearestFace(12, 350).index).toBe(0);
  });
});

describe('facePositionPx', () => {
  it('puts face 0 on the +x axis at the inradius', () => {
    const spec = chamberSpec(chamber());
    expect(facePositionPx(spec, 0).x).toBeCloseTo(spec.inradiusPx, 9);
    expect(facePositionPx(spec, 0).y).toBeCloseTo(0, 9);
  });

  it('spaces every face equally around the body', () => {
    const spec = chamberSpec(chamber());
    for (let i = 0; i < spec.sides; i++) {
      const p = facePositionPx(spec, i);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(spec.inradiusPx, 6);
    }
    // Opposite faces are exactly antipodal, which is what makes a through-path exist.
    const a = facePositionPx(spec, 2);
    const b = facePositionPx(spec, 8);
    expect(a.x).toBeCloseTo(-b.x, 6);
    expect(a.y).toBeCloseTo(-b.y, 6);
  });
});

// ── Getting a beam through ────────────────────────────────────────────────────

describe('chamberPassage', () => {
  const spec = (over: Record<string, unknown> = {}) => chamberSpec(chamber(over));

  it('lets a beam through a pair of open ports', () => {
    const p = chamberPassage(spec(), 0);
    expect(p.blocked).toBeNull();
    expect(p.transmission).toBe(1);
    expect(p.exit).toBe(0);
    expect(p.entry).toBe(6);      // the far side of a 12-gon
  });

  it('works along every face normal, not just the axis', () => {
    for (let i = 0; i < 12; i++) {
      const p = chamberPassage(spec(), faceNormalDeg(12, i));
      expect(p.blocked, `face ${i}`).toBeNull();
      expect(p.exit).toBe(i);
      expect(p.entry).toBe((i + 6) % 12);
    }
  });

  it('stops a beam that meets the wall between two flats', () => {
    // 15° off a normal on a dodecagon is exactly a corner.
    expect(chamberPassage(spec(), 15).blocked).toBe('wall');
    expect(chamberPassage(spec(), 15).entry).toBeNull();
    // And anything past the tolerance, however small the chamber's own grain.
    expect(chamberPassage(spec(), NORMAL_TOLERANCE_DEG + 0.5).blocked).toBe('wall');
  });

  it('accepts a beam a hair off normal, since a lattice angle is not exact in floating point', () => {
    expect(chamberPassage(spec(), 1e-9).blocked).toBeNull();
    expect(chamberPassage(spec(), NORMAL_TOLERANCE_DEG - 0.01).blocked).toBeNull();
  });

  it('absorbs at a blanked entry flange', () => {
    // Port 6 is the one the beam arrives at when travelling along +x.
    const ports = portStates([], 12);
    ports[6] = 'closed';
    const p = chamberPassage(spec({ ports }), 0);
    expect(p.blocked).toBe('entry-closed');
    expect(p.transmission).toBe(0);
  });

  it('absorbs inside when the far flange is blanked', () => {
    const ports = portStates([], 12);
    ports[0] = 'closed';
    const p = chamberPassage(spec({ ports }), 0);
    expect(p.blocked).toBe('exit-closed');
    expect(p.entry).toBe(6);       // it did get in
    expect(p.exit).toBe(0);
  });

  it('attenuates by two windows, not one', () => {
    const p = chamberPassage(spec({ transmission: 99 }), 0);
    expect(p.transmission).toBeCloseTo(0.99 * 0.99, 9);
  });

  it('lands a beam on the flange when it misses the bore', () => {
    // Only reachable for a narrow port: the bore radius here is 30 px, and the tracer only
    // captures a beam within 10 px of the axis. A DN16 port is 8 px.
    const narrow = spec({ boreMm: 12.7 });
    expect(chamberPassage(narrow, 0, 4).blocked).toBeNull();
    expect(chamberPassage(narrow, 0, 12).blocked).toBe('aperture');
    expect(chamberPassage(spec(), 0, 12).blocked).toBeNull();   // 1.5 in bore swallows it
  });

  it('says so when the chamber has no opposite ports at all', () => {
    // Every normal on an odd polygon points at a corner, so nothing can cross.
    const p = chamberPassage(spec({ sides: 7 }), 0);
    expect(p.blocked).toBe('no-through-port');
    expect(chamberBlockMessage('no-through-port', spec({ sides: 7 }))).toMatch(/even number of sides/);
  });

  it('has a sentence for every way of being blocked', () => {
    const s = spec();
    for (const block of ['wall', 'entry-closed', 'exit-closed', 'aperture', 'no-through-port'] as const) {
      expect(chamberBlockMessage(block, s).length).toBeGreaterThan(20);
    }
  });

  it('is direction-blind: a beam either way through the same pair passes', () => {
    // A chamber is reciprocal, so the return leg of a double pass has to survive too.
    const forward = chamberPassage(spec(), 0);
    const back = chamberPassage(spec(), 180);
    expect(back.blocked).toBeNull();
    expect(back.entry).toBe(forward.exit);
    expect(back.exit).toBe(forward.entry);
  });
});
