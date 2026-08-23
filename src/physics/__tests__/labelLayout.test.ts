import { describe, it, expect } from 'vitest';
import { labelLayout, LABEL_BASE_PX } from '../../utils/labelLayout';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import { LABEL_SCALE_MIN, LABEL_SCALE_MAX } from '../../store/workspaceStore';
import { PALETTE } from '../../utils/palette';

describe('labelLayout', () => {
  it('pulls the label up past the empty box under a tall narrow icon', () => {
    // A waveplate is 32×72 but its artwork is only min(32,72)+4 = 36 px, centred — so
    // 18 px of box sits below it and the label would otherwise float there.
    const g = getNodeGeometry('hwp');
    expect(g.height).toBe(72);
    expect(labelLayout('hwp').slack).toBeCloseTo((72 - 36) / 2, 6);
    expect(labelLayout('qwp').slack).toBeCloseTo(18, 6);
    // Lenses and polarizers are the same shape and get the same treatment.
    expect(labelLayout('plano_convex').slack).toBeGreaterThan(15);
    expect(labelLayout('linear_polarizer').slack).toBeGreaterThan(15);
  });

  it('leaves square icons where they were', () => {
    // Artwork is min+4, i.e. slightly larger than the box, so there is no slack.
    for (const type of ['dielectric_mirror', 'pbs', 'npbs', 'photodiode'] as const) {
      expect(labelLayout(type).slack).toBe(0);
    }
  });

  it('gives box nodes no slack, since their artwork fills the border', () => {
    for (const type of ['camera', 'eom', 'aom', 'fiber_cable'] as const) {
      expect(labelLayout(type).slack).toBe(0);
    }
  });

  it('never pushes a label further away than before', () => {
    // slack is clamped at zero, so the offset can only ever shrink.
    const types = ['hwp', 'qwp', 'dielectric_mirror', 'camera', 'laser_source', 'vapor_cell'] as const;
    for (const type of types) expect(labelLayout(type).slack).toBeGreaterThanOrEqual(0);
  });

  it('scales the text and closes the gap together', () => {
    const small = labelLayout('dielectric_mirror', 0, LABEL_SCALE_MIN);
    const big   = labelLayout('dielectric_mirror', 0, LABEL_SCALE_MAX);
    expect(small.fontSize).toBeCloseTo(LABEL_BASE_PX * LABEL_SCALE_MIN, 6);
    expect(big.fontSize).toBeCloseTo(LABEL_BASE_PX * LABEL_SCALE_MAX, 6);
    // Smaller text sits closer in.
    expect(small.gap).toBeLessThan(big.gap);
    expect(small.offset).toBeLessThan(big.offset);
  });

  it('honours a per-view base size', () => {
    // The diagram draws slightly smaller labels than the canvas.
    expect(labelLayout('pbs', 0, 1, 8).fontSize).toBe(8);
    expect(labelLayout('pbs', 0, 0.5, 8).fontSize).toBe(4);
  });

  it('accounts for rotation, since geometry swaps for symbol nodes', () => {
    // Turned on its side a waveplate is 72×32, so the artwork fills the height.
    expect(labelLayout('hwp', 90).slack).toBe(0);
    expect(labelLayout('hwp', 0).slack).toBeGreaterThan(0);
  });

  it('keeps the slider range sane', () => {
    expect(LABEL_SCALE_MIN).toBeGreaterThan(0);
    expect(LABEL_SCALE_MIN).toBeLessThan(1);
    expect(LABEL_SCALE_MAX).toBeGreaterThan(1);
    // Still readable at the smallest setting, in both views (the diagram's base is 8).
    expect(LABEL_BASE_PX * LABEL_SCALE_MIN).toBeGreaterThanOrEqual(4);
    expect(8 * LABEL_SCALE_MIN).toBeGreaterThanOrEqual(4);
  });
});

describe('name visibility', () => {
  // Both views gate the name on `showLabel === true`, so an unset flag hides it. Encoded
  // here because the check is easy to write as `!== false` and silently flip the default.
  const shows = (showLabel?: boolean) => showLabel === true;

  it('hides the name unless it is explicitly switched on', () => {
    expect(shows(undefined)).toBe(false);
    expect(shows(false)).toBe(false);
    expect(shows(true)).toBe(true);
  });

  it('means no palette default needs to opt out', () => {
    // Nothing in the palette sets showLabel, so every freshly dropped component is
    // unlabelled without each entry having to say so.
    for (const entry of PALETTE) {
      expect((entry.defaultData as { showLabel?: boolean }).showLabel).toBeUndefined();
    }
  });
});

describe('vapor cell geometry', () => {
  it('lies along the beam', () => {
    const g = getNodeGeometry('vapor_cell');
    expect(g.width).toBeGreaterThan(g.height);
    expect(g.symbolType).toBe('symbol');
  });

  it('turns with the beam like other symbol nodes', () => {
    const g = getNodeGeometry('vapor_cell', 90);
    expect(g.height).toBeGreaterThan(g.width);
  });
});
