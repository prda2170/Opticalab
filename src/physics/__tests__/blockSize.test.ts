import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute, bodyHalfExtentFor, BEAM_SNAP_DIST } from '../autoRoute';
import { unitAt, DIR_STEP_DEG } from '../geometry';
import {
  artworkOf, artworkFor, occupiedBox, bodyBox, bodyBoxFor, blockSizeOf, drawnHalfExtents,
} from '../../utils/nodeGeometry';
import { layoutToJSON, layoutFromJSON } from '../../utils/export';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const block = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'beam_block', name: 'BB', category: 'conditioning', ...over,
} as OpticalNodeData);

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'conditioning', ...data } as OpticalNodeData;
  const g = occupiedBox(full, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (cy: number) => at('L1', {
  type: 'laser_source', category: 'source', name: 'L1',
  wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, 100, cy);

/** How big the glyph is actually drawn, both dimensions, for a symbol node. */
const glyph = (data: OpticalNodeData) => {
  const a = artworkFor(data);
  const icon = Math.min(a.width, a.height) + 4;
  // The block's rect spans x = 8…16 and y = 3…21 of a 24-unit viewbox (NodeIcons).
  return { width: (8 / 24) * icon, height: (18 / 24) * icon, icon };
};

// ── Two parts, one drawing ────────────────────────────────────────────────────

describe('a beam block comes in two sizes', () => {
  it('is the standard one unless it says otherwise', () => {
    expect(blockSizeOf(block())).toBe('standard');
    expect(blockSizeOf(block({ blockSize: 'small' } as Partial<OpticalNodeData>))).toBe('small');
    // Every layout saved before the option existed, and anything unrecognised.
    expect(blockSizeOf(block({ blockSize: 'tiny' } as unknown as Partial<OpticalNodeData>))).toBe('standard');
    expect(artworkFor(block())).toEqual(artworkOf('beam_block'));
  });

  it('draws the small one smaller and thinner, in both dimensions', () => {
    const big = glyph(block());
    const small = glyph(block({ blockSize: 'small' } as Partial<OpticalNodeData>));
    expect(small.width).toBeLessThan(big.width);
    expect(small.height).toBeLessThan(big.height);
    // Same glyph at a smaller size, so the paddle keeps its proportions.
    expect(small.width / small.height).toBeCloseTo(big.width / big.height, 9);
    expect(small.icon / big.icon).toBeCloseTo(20 / 32, 9);
  });

  it('keeps the trim in step with the glyph, so the beam stops at the paddle', () => {
    // `beamFaceHalf` is a number read off the artwork, so it has to be re-derived per size or
    // a small block would be drawn small and trimmed as though it were the big one.
    for (const size of ['standard', 'small'] as const) {
      const data = block({ blockSize: size } as Partial<OpticalNodeData>);
      const a = artworkFor(data);
      const g = glyph(data);
      expect(a.beamFaceHalf, size).toBeCloseTo(g.width / 2, 0);
      expect(bodyBoxFor(data).halfAlong, size).toBe(a.beamFaceHalf);
    }
  });

  it('measures the instance everywhere the router looks', () => {
    const small = block({ blockSize: 'small' } as Partial<OpticalNodeData>);
    expect(occupiedBox(small, 0)).toMatchObject({ width: 16, height: 30 });
    // Turned: the box swaps at 90° and inflates in between, same rule as everything else.
    expect(occupiedBox(small, 90)).toMatchObject({ width: 30, height: 16 });
    expect(occupiedBox(small, 45).width).toBeCloseTo((16 + 30) * Math.SQRT1_2, 6);
    // Along the beam and across it, at every lattice angle, the small one is the smaller.
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const dir = unitAt(deg);
      expect(bodyHalfExtentFor(small, 0, dir), `${deg}°`)
        .toBeLessThan(bodyHalfExtentFor(block(), 0, dir));
    }
  });

  it('leaves the per-type answers alone, for the callers that only have a type', () => {
    // Label placement still asks by type. A small block's label therefore sits a few px
    // further out than it needs to, which is a bigger gap rather than an overlap.
    expect(artworkOf('beam_block')).toMatchObject({ width: 28, height: 52 });
    expect(bodyBox('beam_block')).toEqual(bodyBoxFor(block()));
    expect(drawnHalfExtents('beam_block').halfCross).toBe(16);
  });
});

// ── Through the tracer ────────────────────────────────────────────────────────

describe('a small block still stops the beam', () => {
  const bench = (size: 'standard' | 'small') => [
    laser(300),
    at('BB', block({ blockSize: size }) as Partial<OpticalNodeData> & { type: 'beam_block' }, 600, 300),
  ];

  it('absorbs everything that reaches it, whatever size it is', () => {
    for (const size of ['standard', 'small'] as const) {
      const { segments, nodeBeams } = autoRoute(bench(size), []);
      expect(nodeBeams.get('BB')!.power, size).toBeCloseTo(100, 6);
      expect(segments.some(s => s.sourceId === 'BB'), size).toBe(false);
      expect(segments.find(s => s.targetId === 'BB')!.free, size).toBe(false);
    }
  });

  it('lets the beam run further, because there is less block to stop at', () => {
    const reach = (size: 'standard' | 'small') =>
      autoRoute(bench(size), []).segments.find(s => s.targetId === 'BB')!.x2;
    expect(reach('small')).toBeGreaterThan(reach('standard'));
    // Exactly the difference in the two face half-extents: 5 px versus 3 px.
    expect(reach('small') - reach('standard')).toBeCloseTo(2, 6);
  });

  it('catches a beam by how close it passes, not by how big it is', () => {
    // The size is a drawing. Capture is `BEAM_SNAP_DIST` about the centre, so shrinking a
    // block never lets a beam through one — it snaps onto the beam instead.
    const nodes = [
      laser(300),
      at('BB', block({ blockSize: 'small' }) as Partial<OpticalNodeData> & { type: 'beam_block' },
        600, 300 + BEAM_SNAP_DIST - 1),
    ];
    const { segments, snaps } = autoRoute(nodes, []);
    expect(segments.find(s => s.targetId === 'BB')).toBeDefined();
    // And it is pulled onto the beam, by its own box.
    const g = occupiedBox(nodes[1].data, 0);
    expect(snaps.get('BB')!.y + g.height / 2).toBeCloseTo(300, 6);
  });

  it('is still the part a figure shows, after a save and reload', () => {
    const nodes = [at('BB', block({ blockSize: 'small' }) as Partial<OpticalNodeData> & { type: 'beam_block' }, 600, 300)];
    const back = layoutFromJSON(layoutToJSON(nodes, []));
    expect((back.nodes[0].data as { blockSize?: string }).blockSize).toBe('small');
    expect(back.notes).toEqual([]);       // an optional field needs no migration
  });
});
