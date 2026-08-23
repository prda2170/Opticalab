import { describe, it, expect } from 'vitest';
import { labelLayout, LABEL_BASE_PX } from '../../utils/labelLayout';
import { labelDistance, labelHalfExtents, LABEL_GAP_PX } from '../labelPlacement';
import { drawnHalfExtents } from '../../utils/nodeGeometry';
import { unitAt } from '../geometry';

// `labelLayout` is now only sizing — where a label goes is `labelPlacement`'s job, since
// that needs the beams. The old `slack` field is gone; what it was compensating for (a
// square glyph sitting in a taller box) is handled by measuring from the glyph instead,
// which is what these tests pin.

describe('labelLayout', () => {
  it('scales the font and the gap together', () => {
    expect(labelLayout().fontSize).toBe(LABEL_BASE_PX);
    expect(labelLayout(2).fontSize).toBe(LABEL_BASE_PX * 2);
    expect(labelLayout(2).gap).toBe(labelLayout(1).gap * 2);
  });

  it('takes a per-view base size, so the diagram can run smaller', () => {
    expect(labelLayout(1, 8).fontSize).toBe(8);
  });

  it('does not take a component or a rotation any more', () => {
    // Sizing is view-wide; only placement cares which component this is.
    expect(labelLayout(1)).toEqual(labelLayout(1));
  });
});

describe('labelDistance', () => {
  const label = labelHalfExtents('M1', LABEL_BASE_PX);

  it('clears the glyph, not the box — what `slack` used to fudge', () => {
    // A waveplate is a 36 px square glyph in a 32×72 box. Measured from the box, a label
    // underneath floated 18 px away from the thing it names.
    const down = labelDistance('qwp', 0, unitAt(90), label);
    expect(down).toBeCloseTo(drawnHalfExtents('qwp').halfCross + LABEL_GAP_PX + label.halfHeight, 9);
    expect(drawnHalfExtents('qwp').halfCross).toBe(18);   // the glyph, not 36
  });

  it('sits further out sideways than downwards for a wide label', () => {
    // Half the text's width has to clear, not half its height.
    const wide = labelHalfExtents('Reference Cavity', LABEL_BASE_PX);
    expect(labelDistance('iris', 0, unitAt(0), wide))
      .toBeGreaterThan(labelDistance('iris', 0, unitAt(90), wide));
  });

  it('accounts for the component turning', () => {
    // An AOM is 60×44: standing it on end swaps which extent faces the label.
    const flat = labelDistance('aom', 0, unitAt(90), label);
    const onEnd = labelDistance('aom', 90, unitAt(90), label);
    expect(onEnd).toBeGreaterThan(flat);
  });

  it('grows with the label scale, but only the parts that scale', () => {
    const small = labelDistance('iris', 0, unitAt(90), labelHalfExtents('M1', LABEL_BASE_PX), 1);
    const big = labelDistance('iris', 0, unitAt(90), labelHalfExtents('M1', LABEL_BASE_PX * 1.5), 1.5);
    expect(big).toBeGreaterThan(small);
    // The icon's own half-extent is unchanged by text size.
    expect(big - small).toBeLessThan(drawnHalfExtents('iris').halfCross);
  });
});
