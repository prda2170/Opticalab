import { describe, it, expect } from 'vitest';
import { faceHalf } from '../autoRoute';
import {
  unitAt, angleOf, boxHalfExtent, rotateBy, mirrorReflect,
  DIR_STEP_DEG, MIRROR_STEP_DEG, type Vec2,
} from '../geometry';
import { getNodeGeometry, artworkOf, bodyBox, angleStepFor, SURFACE_AT_45 } from '../../utils/nodeGeometry';
import { PALETTE } from '../../utils/palette';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AXIS_DIRS: Vec2[] = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }];
const UI_ROTATIONS = [0, 90, 180, 270];

/** Every type you can actually place. */
const TYPES = PALETTE.map(e => e.type) as OpticalNodeData['type'][];

/** Types whose optical body is narrower than their artwork. */
const NARROW: OpticalNodeData['type'][] = TYPES.filter(t => artworkOf(t).beamFaceHalf !== undefined);

/**
 * The trim rule as it stood before exact intersection: `beamFaceHalf` if set, else half
 * the *occupied* box in whichever axis the beam mostly runs along.
 */
function legacyFaceHalf(type: OpticalNodeData['type'], rotation: number, dir: Vec2): number {
  const geo = getNodeGeometry(type, rotation);
  if (geo.beamFaceHalf !== undefined) return geo.beamFaceHalf;
  return Math.abs(dir.dx) > Math.abs(dir.dy) ? geo.width / 2 : geo.height / 2;
}

/** True when `dir` runs across the component's own axis rather than along it. */
function isCrosswise(rotation: number, dir: Vec2): boolean {
  const local = rotateBy(dir, -rotation);
  return Math.abs(local.dx) < Math.abs(local.dy);
}

/** Instrument nodes turned off their own axis — drawn unturned before stage 4. */
const isTurnedBox = (type: OpticalNodeData['type'], rotation: number) =>
  artworkOf(type).symbolType !== 'symbol' && rotation % 180 !== 0;

// ── The three boxes ───────────────────────────────────────────────────────────

describe('artworkOf', () => {
  it('does not depend on rotation — it is the component\'s own frame', () => {
    for (const type of TYPES) {
      const a = artworkOf(type);
      expect(a).toEqual(artworkOf(type));
      expect(getNodeGeometry(type, 0)).toEqual(a);
      expect(getNodeGeometry(type, 180)).toEqual(a);
    }
  });
});

describe('getNodeGeometry — the occupied box', () => {
  it('still swaps width and height for a turned symbol, exactly', () => {
    for (const type of TYPES) {
      const a = artworkOf(type);
      if (a.symbolType !== 'symbol') continue;
      for (const rot of [90, 270]) {
        const g = getNodeGeometry(type, rot);
        expect(g.width).toBe(a.height);     // exact integers, not 65.99999
        expect(g.height).toBe(a.width);
      }
    }
  });

  it('turns instrument nodes too, now that their artwork turns', () => {
    for (const type of TYPES) {
      const a = artworkOf(type);
      if (a.symbolType === 'symbol') continue;
      // Unchanged along the axis it was drawn on...
      expect(getNodeGeometry(type, 0)).toEqual(a);
      expect(getNodeGeometry(type, 180)).toEqual(a);
      // ...and swapped when stood on end, like any other component.
      expect(getNodeGeometry(type, 90).width).toBe(a.height);
      expect(getNodeGeometry(type, 90).height).toBe(a.width);
    }
  });

  it('is the true bounding box at angles between the axes', () => {
    // A 90x66 laser turned 45° occupies (90+66)/√2 square.
    const g = getNodeGeometry('laser_source', 45);
    expect(g.width).toBeCloseTo((90 + 66) * Math.SQRT1_2, 9);
    expect(g.height).toBeCloseTo((90 + 66) * Math.SQRT1_2, 9);
    // A square component is square at every angle only at 0/90; at 45 it grows.
    expect(getNodeGeometry('iris', 45).width).toBeCloseTo(44 * Math.SQRT2, 9);
  });

  it('grows monotonically from axis to diagonal', () => {
    const area = (rot: number) => {
      const g = getNodeGeometry('laser_source', rot);
      return g.width * g.height;
    };
    expect(area(0)).toBeLessThan(area(30));
    expect(area(30)).toBeLessThan(area(45));
  });
});

describe('bodyBox', () => {
  it('narrows only the axial extent, and only where beamFaceHalf says so', () => {
    for (const type of TYPES) {
      const a = artworkOf(type);
      const b = bodyBox(type);
      expect(b.halfCross).toBe(a.height / 2);
      expect(b.halfAlong).toBe(a.beamFaceHalf ?? a.width / 2);
    }
    expect(NARROW.length).toBeGreaterThan(0);   // the case is actually exercised
  });

  it('gives mirrors the finer angular grain, because reflection doubles it', () => {
    for (const type of TYPES) {
      expect(angleStepFor(type)).toBe(SURFACE_AT_45.has(type) ? 7.5 : 15);
    }
    expect(angleStepFor('dielectric_mirror')).toBe(7.5);
    expect(angleStepFor('qwp')).toBe(15);
  });
});

// ── Equivalence with the old rule, everywhere it was right ────────────────────

describe('exact face trim vs the old two-case rule', () => {
  it('agrees on every placeable type, rotation and axis-aligned beam', () => {
    const differences: string[] = [];
    for (const type of TYPES) {
      for (const rot of UI_ROTATIONS) {
        for (const dir of AXIS_DIRS) {
          const now = faceHalf(type, rot, dir);
          const before = legacyFaceHalf(type, rot, dir);
          if (Math.abs(now - before) > 1e-9) differences.push(`${type} rot${rot} ${JSON.stringify(dir)}: ${before} → ${now}`);
        }
      }
    }
    // Two permitted divergence classes, and nothing else:
    //  1. a narrow-bodied component pinned to a rotation with a beam crossing it side-on,
    //     where the old rule returned the *axial* figure and drew the beam inside the glass;
    //  2. an instrument node stood on end, which used to be drawn (and so trimmed)
    //     unturned even though the physics treated it as turned.
    for (const d of differences) {
      const [type, rotTag] = d.split(' ');
      const rot = Number(rotTag.replace('rot', ''));
      const permitted = NARROW.includes(type as OpticalNodeData['type'])
        || isTurnedBox(type as OpticalNodeData['type'], rot);
      expect(permitted).toBe(true);
    }
    // And every one of those is a crosswise beam, trimmed at the artwork edge instead.
    for (const type of NARROW) {
      for (const rot of UI_ROTATIONS) {
        for (const dir of AXIS_DIRS) {
          const now = faceHalf(type, rot, dir);
          if (isCrosswise(rot, dir)) {
            expect(now).toBe(artworkOf(type).height / 2);
            expect(now).toBeGreaterThan(artworkOf(type).beamFaceHalf!);
          } else {
            expect(now).toBe(artworkOf(type).beamFaceHalf!);
          }
        }
      }
    }
  });

  it('is unchanged for symbol components that carry no beamFaceHalf', () => {
    for (const type of TYPES) {
      if (artworkOf(type).beamFaceHalf !== undefined) continue;
      for (const rot of UI_ROTATIONS) {
        if (isTurnedBox(type, rot)) continue;
        for (const dir of AXIS_DIRS) {
          expect(faceHalf(type, rot, dir)).toBeCloseTo(legacyFaceHalf(type, rot, dir), 9);
        }
      }
    }
  });

  it('trims a turned instrument along its own axis, as it is now drawn', () => {
    // A vertical AOM: 60x44 artwork stood on end, so a vertical beam meets the 60 px face.
    expect(faceHalf('aom', 90, { dx: 0, dy: 1 })).toBe(30);
    // It used to be trimmed by the *unturned* box's half-height, 22 px, because that was
    // what got drawn — the beam stopped 8 px inside the cell.
    expect(artworkOf('aom').height / 2).toBe(22);
    expect(faceHalf('aom', 0, { dx: 1, dy: 0 })).toBe(30);          // unchanged on its axis
  });
});

// ── What the old rule could not do ───────────────────────────────────────────

describe('face trim off-axis', () => {
  it('reaches the corner of a square body along its diagonal', () => {
    // 44x44 iris: the diagonal half-extent is 22√2, not 22.
    expect(faceHalf('iris', 0, unitAt(45))).toBeCloseTo(22 * Math.SQRT2, 9);
    // The old rule said 22 — nine pixels short, i.e. the beam stopped inside the artwork.
    expect(faceHalf('iris', 0, unitAt(45))).toBeGreaterThan(legacyFaceHalf('iris', 0, unitAt(45)));
  });

  it('picks whichever face the beam actually reaches first', () => {
    // 90x66 laser body. At 45° the short (height) face wins: 33/sin45 < 45/cos45.
    expect(faceHalf('laser_source', 0, unitAt(45))).toBeCloseTo(33 * Math.SQRT2, 9);
    // At 30° the long face wins instead: 45/cos30 = 51.96 < 33/sin30 = 66.
    expect(faceHalf('laser_source', 0, unitAt(30))).toBeCloseTo(45 / Math.cos(Math.PI / 6), 9);
  });

  it('lengthens a narrow body\'s trim as the beam tilts off its axis', () => {
    const straight = faceHalf('qwp', 0, unitAt(0));
    const tilted   = faceHalf('qwp', 0, unitAt(15));
    expect(straight).toBe(6);
    expect(tilted).toBeCloseTo(6 / Math.cos(Math.PI / 12), 9);
    expect(tilted).toBeGreaterThan(straight);
  });

  it('turns with the component, so a tilted body meets a tilted beam head-on', () => {
    // A waveplate turned 15° into a beam at 15° is exactly on axis again.
    expect(faceHalf('qwp', 15, unitAt(15))).toBeCloseTo(6, 9);
    expect(faceHalf('qwp', 15, unitAt(0))).toBeCloseTo(6 / Math.cos(Math.PI / 12), 9);
  });

  it('never returns zero or a non-finite trim for a real direction', () => {
    for (const type of TYPES) {
      for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
        const t = faceHalf(type, 0, unitAt(deg));
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeGreaterThan(0);
      }
    }
  });
});

describe('boxHalfExtent', () => {
  it('reduces to the half-extent on axis', () => {
    expect(boxHalfExtent(30, 22, { dx: 1, dy: 0 })).toBe(30);
    expect(boxHalfExtent(30, 22, { dx: 0, dy: -1 })).toBe(22);
  });

  it('is symmetric in the four quadrants', () => {
    const d = unitAt(20);
    for (const deg of [20, 160, 200, 340]) {
      expect(boxHalfExtent(30, 22, unitAt(deg))).toBeCloseTo(boxHalfExtent(30, 22, d), 9);
    }
  });

  it('reports Infinity for a zero direction, which callers read as no trim', () => {
    expect(boxHalfExtent(30, 22, { dx: 0, dy: 0 })).toBe(Infinity);
  });
});

describe('rotateBy', () => {
  it('is exact at multiples of 90°', () => {
    expect(rotateBy({ dx: 1, dy: 0 }, 90)).toEqual({ dx: 0, dy: 1 });
    expect(rotateBy({ dx: 0, dy: 1 }, -90)).toEqual({ dx: 1, dy: 0 });
    expect(rotateBy({ dx: 1, dy: 0 }, 180)).toEqual({ dx: -1, dy: 0 });
  });

  it('composes, and inverts with a negative angle', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const there = rotateBy({ dx: 1, dy: 0 }, deg);
      const back = rotateBy(there, -deg);
      expect(back.dx).toBeCloseTo(1, 12);
      expect(back.dy).toBeCloseTo(0, 12);
    }
  });

  it('preserves length', () => {
    const d = rotateBy({ dx: 3, dy: 4 }, 37);
    expect(Math.hypot(d.dx, d.dy)).toBeCloseTo(5, 12);
  });
});

// ── The chosen lattice: 15° beams, 7.5° mirrors ───────────────────────────────

describe('lattice choice', () => {
  it('puts mirror surfaces on half the beam grain', () => {
    expect(DIR_STEP_DEG).toBe(15);
    expect(MIRROR_STEP_DEG).toBe(7.5);
  });

  it('reaches every 15° beam direction from a 7.5° mirror lattice', () => {
    // From an eastward beam, sweep the mirror over its lattice and collect what comes out.
    const reached = new Set<number>();
    for (let s = 0; s < 360; s += MIRROR_STEP_DEG) {
      // `rotation` is 45° ahead of the surface, so sweep rotations to sweep surfaces.
      reached.add(Math.round(angleOf(mirrorReflect(unitAt(0), s))));
    }
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      expect(reached.has(deg)).toBe(true);
    }
  });

  it('would only reach 30° multiples if mirrors were quantised to 15°', () => {
    // This is the whole reason the mirror lattice is finer than the beam lattice.
    const coarse = new Set<number>();
    for (let s = 0; s < 360; s += DIR_STEP_DEG) {
      coarse.add(Math.round(angleOf(mirrorReflect(unitAt(0), s))));
    }
    expect(coarse.has(30)).toBe(true);
    expect(coarse.has(15)).toBe(false);
    expect(coarse.has(45)).toBe(false);
  });

  it('keeps every 15° beam on the lattice after a 7.5° reflection, exactly', () => {
    for (let s = 0; s < 360; s += MIRROR_STEP_DEG) {
      for (let a = 0; a < 360; a += DIR_STEP_DEG) {
        const out = mirrorReflect(unitAt(a), s);
        const deg = angleOf(out);
        const k = Math.round(deg / DIR_STEP_DEG) * DIR_STEP_DEG;
        expect(Math.abs(deg - k)).toBeLessThan(1e-9);
        expect(out).toEqual(unitAt(k));
      }
    }
  });
});
