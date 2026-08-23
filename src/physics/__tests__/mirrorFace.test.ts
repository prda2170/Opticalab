import { describe, it, expect } from 'vitest';
import { mirrorHatchSide, angleStepFor, SURFACE_AT_45, artworkOf, getNodeGeometry } from '../../utils/nodeGeometry';
import { unitAt, mirrorReflect, mirrorSurfaceDeg, angleOf, angleDiff, dot, rotateBy, MIRROR_STEP_DEG, DIR_STEP_DEG, type Vec2 } from '../geometry';
import { labelDistance, labelHalfExtents, LABEL_GAP_PX } from '../labelPlacement';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const E: Vec2 = { dx: 1, dy: 0 };
const W: Vec2 = { dx: -1, dy: 0 };

/** The hatch side each of the four old artwork variants drew. */
const SLASH_HATCH_LOWER_RIGHT = 1;
const SLASH_HATCH_UPPER_LEFT = -1;

// ── Which face is polished ────────────────────────────────────────────────────

describe('mirrorHatchSide', () => {
  it('reproduces the four hand-drawn variants it replaced', () => {
    // "/" at rotation 0, beam from the left → hits the upper-left face, hatch lower-right.
    expect(mirrorHatchSide(E, 0)).toBe(SLASH_HATCH_LOWER_RIGHT);   // was MirrorSlashIcon
    // "/" with the beam from the right → hits the lower-right, hatch upper-left.
    expect(mirrorHatchSide(W, 0)).toBe(SLASH_HATCH_UPPER_LEFT);    // was MirrorSlashFlipped
    // "\" (rotation 90) from the left → hatch on the far side of the turned artwork.
    expect(mirrorHatchSide(E, 90)).toBe(SLASH_HATCH_UPPER_LEFT);   // was MirrorBackslashIcon
    expect(mirrorHatchSide(W, 90)).toBe(SLASH_HATCH_LOWER_RIGHT);  // was MirrorBackslashFlipped
  });

  it('puts the polished face towards the beam, whatever the angle', () => {
    for (let rot = 0; rot < 360; rot += MIRROR_STEP_DEG) {
      for (let beam = 0; beam < 360; beam += DIR_STEP_DEG) {
        const d = unitAt(beam);
        // Skip beams running along the surface: no face is "hit".
        if (Math.abs(dot(d, unitAt(mirrorSurfaceDeg(rot) + 90))) < 1e-9) continue;
        const hatch = mirrorHatchSide(d, rot);
        // The hatch is on the far side, so the beam must be approaching the other one.
        const local = rotateBy(d, -rot);
        expect(Math.sign(dot(local, unitAt(45)))).toBe(hatch);
      }
    }
  });

  it('flips when the beam comes back the other way', () => {
    for (let rot = 0; rot < 360; rot += MIRROR_STEP_DEG) {
      const there = mirrorHatchSide(unitAt(30), rot);
      const back  = mirrorHatchSide(unitAt(210), rot);
      expect(back).toBe(there === 1 ? -1 : 1);
    }
  });

  it('agrees with where the beam is actually sent', () => {
    // Sanity tie-in: the reflected direction and the drawn face come from the same
    // surface, so a beam is never drawn hitting the hatched side and reflecting anyway.
    for (let rot = 0; rot < 360; rot += MIRROR_STEP_DEG) {
      const d = unitAt(0);
      const out = mirrorReflect(d, rot);
      const surface = mirrorSurfaceDeg(rot);
      // Angle of incidence equals angle of reflection about the surface.
      expect(angleDiff(angleOf(out), 2 * surface - angleOf(d))).toBeLessThan(1e-9);
    }
  });
});

// ── One artwork per component, turned by rotation ─────────────────────────────

describe('mirror-like components', () => {
  it('are exactly the ones with a surface at 45° to the body', () => {
    expect([...SURFACE_AT_45].sort()).toEqual(
      ['dichroic_mirror', 'dielectric_mirror', 'galvo', 'npbs', 'pbs'],
    );
  });

  it('keep a square artwork, so turning them never changes their footprint on axis', () => {
    for (const type of SURFACE_AT_45) {
      const a = artworkOf(type);
      expect(a.width).toBe(a.height);
      expect(getNodeGeometry(type, 90)).toEqual(a);
    }
  });

  it('grow their box on the diagonal, like any turned square', () => {
    expect(getNodeGeometry('pbs', 45).width).toBeCloseTo(44 * Math.SQRT2, 9);
  });

  it('step on the finer grain; bodies step on the beam grain', () => {
    expect(angleStepFor('dielectric_mirror')).toBe(MIRROR_STEP_DEG);
    expect(angleStepFor('pbs')).toBe(MIRROR_STEP_DEG);
    expect(angleStepFor('laser_source')).toBe(DIR_STEP_DEG);
    expect(angleStepFor('aom')).toBe(DIR_STEP_DEG);
  });
});

// ── Labels beside a turned component ──────────────────────────────

describe('labelDistance at an angle', () => {
  const label = labelHalfExtents('M1', 9);

  it('measures from the icon, not from the box it sits in', () => {
    // A waveplate is 32x72 with a 36 px square icon. The box has 18 px of empty space below
    // the glyph at 0 degrees, which the old `slack` fudge subtracted back off. Measuring
    // from the glyph gets there directly, and works sideways too.
    const down = labelDistance('qwp', 0, unitAt(90), label);
    expect(down).toBeCloseTo(18 + LABEL_GAP_PX + label.halfHeight, 9);
  });

  it('follows the icon as it turns, not the axis-aligned box', () => {
    // The glyph is square, so the distance to its edge grows out to 18*sqrt(2) on the
    // diagonal. The bounding box grows the same way, but a label placed off the box would
    // float; placed off the glyph it stays touching.
    const at45 = labelDistance('qwp', 45, unitAt(90), label);
    expect(at45).toBeCloseTo(18 * Math.SQRT2 + LABEL_GAP_PX + label.halfHeight, 9);
    expect(at45).toBeGreaterThan(labelDistance('qwp', 0, unitAt(90), label));
  });

  it('is the same in every direction for a square icon', () => {
    // A symbol's drawn glyph is square, so turning the *label* around a fixed component
    // changes only the label's own reach, not the icon's.
    const sides = [0, 90, 180, 270].map(deg => labelDistance('qwp', 0, unitAt(deg), label));
    expect(sides[1]).toBeCloseTo(sides[3], 9);   // up and down
    expect(sides[0]).toBeCloseTo(sides[2], 9);   // left and right
  });

  it('respects a rectangular body, which a box icon has', () => {
    // An AOM is 60x44 of artwork: the label sits further out off the long side.
    const offEnd = labelDistance('aom', 0, unitAt(0), label);
    const offSide = labelDistance('aom', 0, unitAt(90), label);
    expect(offEnd - offSide).toBeCloseTo(30 - 22 + (label.halfWidth - label.halfHeight), 9);
  });

  it('always clears the artwork, at every angle on the lattice', () => {
    for (const type of ['qwp', 'laser_source', 'aom', 'iris', 'vapor_cell'] as const) {
      for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
        for (let sideDeg = 0; sideDeg < 360; sideDeg += DIR_STEP_DEG) {
          expect(labelDistance(type, deg, unitAt(sideDeg), label))
            .toBeGreaterThanOrEqual(LABEL_GAP_PX + label.halfHeight);
        }
      }
    }
  });
});
