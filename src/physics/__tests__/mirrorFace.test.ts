import { describe, it, expect } from 'vitest';
import { mirrorHatchSide, angleStepFor, SURFACE_AT_45, artworkOf, getNodeGeometry } from '../../utils/nodeGeometry';
import { unitAt, mirrorReflect, mirrorSurfaceDeg, angleOf, angleDiff, dot, rotateBy, MIRROR_STEP_DEG, DIR_STEP_DEG, type Vec2 } from '../geometry';
import { labelLayout } from '../../utils/labelLayout';

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

// ── Labels under a turned component ──────────────────────────────────────────

describe('label slack at an angle', () => {
  it('is unchanged on the axes', () => {
    // A waveplate is 32x72 with a 36 px square icon: 18 px of empty box below it at 0°,
    // and none at 90°, where the box is only 32 tall.
    expect(labelLayout('qwp', 0).slack).toBeCloseTo(18, 9);
    expect(labelLayout('qwp', 90).slack).toBe(0);
    expect(labelLayout('hwp', 180).slack).toBeCloseTo(18, 9);
  });

  it('accounts for a square icon standing taller when turned', () => {
    // At 45° the 36 px icon is 36√2 = 50.9 tall inside a 73.5 tall box → 11.3 of slack,
    // not the 18.75 the old formula gave by ignoring the turn.
    const at45 = labelLayout('qwp', 45).slack;
    expect(at45).toBeCloseTo((getNodeGeometry('qwp', 45).height - 36 * Math.SQRT2) / 2, 9);
    expect(at45).toBeLessThan(18);
    expect(at45).toBeGreaterThan(0);
  });

  it('never goes negative, whatever the angle', () => {
    for (const type of ['qwp', 'laser_source', 'aom', 'iris', 'vapor_cell'] as const) {
      for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
        expect(labelLayout(type, deg).slack).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('leaves instrument nodes flush with their border', () => {
    // Box artwork fills its border exactly, so there is no empty band to pull through.
    expect(labelLayout('aom', 0).slack).toBe(0);
    expect(labelLayout('aom', 90).slack).toBe(0);
  });
});
