import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  unitAt, angleOf, normalise, cleanDir, perpOf, dot, reflectAbout,
  mirrorReflect, mirrorSurfaceDeg, norm360, dirKey, DIR_STEP_DEG,
  type Vec2,
} from '../geometry';
import { bodyAxis, laneNormal } from '../lanes';
import { autoRoute } from '../autoRoute';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const E: Vec2 = { dx: 1, dy: 0 };    // east
const S: Vec2 = { dx: 0, dy: 1 };    // south (y-down)
const W: Vec2 = { dx: -1, dy: 0 };
const N: Vec2 = { dx: 0, dy: -1 };

/** The lattice the layout is meant to live on. */
const LATTICE = Array.from({ length: 360 / DIR_STEP_DEG }, (_, i) => i * DIR_STEP_DEG);

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (cx: number, cy: number, rotation: number) => at('L1', {
  type: 'laser_source', category: 'source', name: 'L1', rotation,
  wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

// ── Angles in, vectors out ────────────────────────────────────────────────────

describe('unitAt', () => {
  it('gives the four axes exactly, with no floating-point dust', () => {
    expect(unitAt(0)).toEqual(E);
    expect(unitAt(90)).toEqual(S);     // y-down: 90° is downward
    expect(unitAt(180)).toEqual(W);
    expect(unitAt(270)).toEqual(N);
  });

  it('wraps, so a rotation can be written however it comes', () => {
    expect(unitAt(360)).toEqual(E);
    expect(unitAt(-90)).toEqual(N);
    expect(unitAt(450)).toEqual(S);
  });

  it('has no negative zero, which would leak into ids and shift values', () => {
    for (const deg of LATTICE) {
      const u = unitAt(deg);
      expect(Object.is(u.dx, -0)).toBe(false);
      expect(Object.is(u.dy, -0)).toBe(false);
    }
  });

  it('is a unit vector at every lattice angle', () => {
    for (const deg of LATTICE) {
      expect(Math.hypot(unitAt(deg).dx, unitAt(deg).dy)).toBeCloseTo(1, 12);
    }
  });

  it('handles the diagonals and the new 15° steps', () => {
    const r2 = Math.SQRT1_2;
    expect(unitAt(45).dx).toBeCloseTo(r2, 12);
    expect(unitAt(45).dy).toBeCloseTo(r2, 12);
    expect(unitAt(15).dx).toBeCloseTo(Math.cos(Math.PI / 12), 12);
    expect(unitAt(15).dy).toBeCloseTo(Math.sin(Math.PI / 12), 12);
    // 30° up-and-to-the-right, i.e. negative dy on screen.
    expect(unitAt(330).dy).toBeLessThan(0);
    expect(unitAt(330).dx).toBeGreaterThan(0);
  });
});

describe('angleOf', () => {
  it('inverts unitAt across the whole lattice', () => {
    for (const deg of LATTICE) {
      expect(angleOf(unitAt(deg))).toBeCloseTo(deg, 9);
    }
  });

  it('reports zero for a direction with no length, rather than NaN', () => {
    expect(angleOf({ dx: 0, dy: 0 })).toBe(0);
  });

  it('ignores magnitude', () => {
    expect(angleOf({ dx: 5, dy: 0 })).toBe(0);
    expect(angleOf({ dx: 0, dy: 0.001 })).toBe(90);
  });
});

describe('norm360', () => {
  it('folds any angle into [0, 360)', () => {
    expect(norm360(0)).toBe(0);
    expect(norm360(360)).toBe(0);
    expect(norm360(-15)).toBe(345);
    expect(norm360(-360)).toBe(0);
    expect(norm360(725)).toBe(5);
  });
});

// ── Float hygiene ─────────────────────────────────────────────────────────────

describe('cleanDir', () => {
  it('pulls a direction that is a hair off the lattice back onto it, exactly', () => {
    expect(cleanDir({ dx: 0.9999999999999998, dy: 2.2e-16 })).toEqual(E);
    expect(cleanDir({ dx: -1e-17, dy: -0.9999999999999999 })).toEqual(N);
  });

  it('leaves a direction that is genuinely off-lattice alone — it is not a quantiser', () => {
    const odd = cleanDir({ dx: Math.cos(0.13), dy: Math.sin(0.13) });
    expect(angleOf(odd)).toBeCloseTo((0.13 * 180) / Math.PI, 9);
  });

  it('returns a unit vector', () => {
    const d = cleanDir({ dx: 3, dy: 4 });
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(1, 12);
  });

  it('survives a zero vector', () => {
    expect(cleanDir({ dx: 0, dy: 0 })).toEqual({ dx: 1, dy: 0 });
  });
});

describe('perpOf and dot', () => {
  it('perpendicular is 90° clockwise on screen', () => {
    expect(perpOf(E)).toEqual(S);
    expect(perpOf(S)).toEqual(W);
    expect(dot(E, perpOf(E))).toBe(0);
    for (const deg of LATTICE) {
      expect(dot(unitAt(deg), perpOf(unitAt(deg)))).toBeCloseTo(0, 12);
    }
  });
});

// ── Reflection ────────────────────────────────────────────────────────────────

describe('mirrorReflect — unchanged for the rotations the UI offers', () => {
  // The tables the old reflectSlash/reflectBackslash implemented, verbatim.
  const SLASH: [Vec2, Vec2][] = [[E, N], [N, E], [S, W], [W, S]];
  const BACKSLASH: [Vec2, Vec2][] = [[E, S], [S, E], [N, W], [W, N]];

  it('rotation 0 and 180 are "/" surfaces', () => {
    for (const [inDir, outDir] of SLASH) {
      expect(mirrorReflect(inDir, 0)).toEqual(outDir);
      expect(mirrorReflect(inDir, 180)).toEqual(outDir);
    }
  });

  it('rotation 90 and 270 are "\\" surfaces', () => {
    for (const [inDir, outDir] of BACKSLASH) {
      expect(mirrorReflect(inDir, 90)).toEqual(outDir);
      expect(mirrorReflect(inDir, 270)).toEqual(outDir);
    }
  });

  it('reflecting twice off the same surface returns the beam to itself', () => {
    for (const rot of [0, 90, 180, 270]) {
      for (const d of [E, S, W, N]) {
        expect(mirrorReflect(mirrorReflect(d, rot), rot)).toEqual(d);
      }
    }
  });
});

describe('mirrorSurfaceDeg', () => {
  it('puts the surface 45° behind the body axis', () => {
    expect(mirrorSurfaceDeg(0)).toBe(315);    // "/" — lower-left to upper-right
    expect(mirrorSurfaceDeg(90)).toBe(45);    // "\"
    expect(mirrorSurfaceDeg(180)).toBe(135);
    expect(mirrorSurfaceDeg(270)).toBe(225);
  });
});

describe('reflection off surfaces the old code could not express', () => {
  it('turns a beam by twice the angle between beam and surface', () => {
    // Surface 30° off the beam → 60° turn, not the 90° a 45° mirror gives.
    expect(angleOf(mirrorReflect(E, 15))).toBeCloseTo(300, 9);
    expect(angleOf(mirrorReflect(E, 75))).toBeCloseTo(60, 9);
    // 15° of mirror rotation buys 30° of beam deviation.
    expect(angleOf(mirrorReflect(E, 30))).toBeCloseTo(330, 9);
    expect(angleOf(mirrorReflect(E, 45))).toBeCloseTo(0, 9);
  });

  it('leaves a beam running along the surface untouched', () => {
    // rotation 45 → surface at 0°, parallel to an eastward beam.
    expect(mirrorReflect(E, 45)).toEqual(E);
  });

  it('sends a beam hitting a surface head-on straight back', () => {
    // rotation 135 → surface at 90°, square across an eastward beam.
    expect(mirrorReflect(E, 135)).toEqual(W);
  });

  it('keeps every lattice beam on the lattice, exactly', () => {
    for (const rot of LATTICE) {
      for (const beam of LATTICE) {
        const out = mirrorReflect(unitAt(beam), rot);
        const deg = angleOf(out);
        // angleOf of an irrational direction carries ~1e-14 of its own, so compare to
        // the nearest lattice angle rather than testing the modulus for zero.
        const k = Math.round(deg / DIR_STEP_DEG) * DIR_STEP_DEG;
        expect(Math.abs(deg - k)).toBeLessThan(1e-9);
        // Exact, not merely close: ids and loop keys compare these.
        expect(out).toEqual(unitAt(k));
      }
    }
  });

  it('reflectAbout is the same law, addressed by surface rather than rotation', () => {
    for (const rot of LATTICE) {
      expect(reflectAbout(E, mirrorSurfaceDeg(rot))).toEqual(mirrorReflect(E, rot));
    }
  });
});

// ── Component axes ────────────────────────────────────────────────────────────

describe('bodyAxis', () => {
  it('still gives the four axes exactly', () => {
    expect(bodyAxis(0)).toEqual(E);
    expect(bodyAxis(90)).toEqual(S);
    expect(bodyAxis(180)).toEqual(W);
    expect(bodyAxis(270)).toEqual(N);
  });

  it('now answers for any angle', () => {
    expect(angleOf(bodyAxis(15))).toBeCloseTo(15, 9);
    expect(angleOf(bodyAxis(255))).toBeCloseTo(255, 9);
  });

  it('lane normals stay perpendicular to the body at every angle', () => {
    for (const deg of LATTICE) {
      expect(dot(bodyAxis(deg), laneNormal(deg))).toBeCloseTo(0, 12);
    }
  });
});

// ── Ids ───────────────────────────────────────────────────────────────────────

describe('dirKey', () => {
  it('keeps the compass letters, so existing ids are untouched', () => {
    expect(dirKey(E)).toBe('e');
    expect(dirKey(S)).toBe('s');
    expect(dirKey(W)).toBe('w');
    expect(dirKey(N)).toBe('n');
  });

  it('is unfazed by float dust on an axis', () => {
    expect(dirKey({ dx: 0.9999999999999998, dy: -2.2e-16 })).toBe('e');
  });

  it('names off-axis directions distinctly', () => {
    const keys = LATTICE.map(d => dirKey(unitAt(d)));
    expect(new Set(keys).size).toBe(LATTICE.length);
    expect(dirKey(unitAt(45))).toBe('d45');
    expect(dirKey(unitAt(315))).toBe('d315');
  });
});

// ── Emitters, through the real router ─────────────────────────────────────────

describe('emitterOrigin, via autoRoute', () => {
  const CX = 400, CY = 300, REACH = 45;   // half the laser artwork's 90 px length

  it('emits from the middle of the output face at every rotation', () => {
    const expected: Record<number, [number, number]> = {
      0:   [CX + REACH, CY],
      90:  [CX, CY + REACH],
      180: [CX - REACH, CY],
      270: [CX, CY - REACH],
    };
    for (const rot of [0, 90, 180, 270]) {
      const { segments } = autoRoute([laser(CX, CY, rot)], []);
      const seg = segments.find(s => s.sourceId === 'L1')!;
      const [ex, ey] = expected[rot];
      expect(seg.x1).toBeCloseTo(ex, 6);
      expect(seg.y1).toBeCloseTo(ey, 6);
    }
  });

  it('fires along its own body axis', () => {
    for (const rot of [0, 90, 180, 270]) {
      const { segments } = autoRoute([laser(CX, CY, rot)], []);
      const seg = segments.find(s => s.sourceId === 'L1')!;
      const dir = normalise({ dx: seg.x2 - seg.x1, dy: seg.y2 - seg.y1 });
      expect(dir).toEqual(bodyAxis(rot));
    }
  });
});
