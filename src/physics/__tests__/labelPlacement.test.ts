import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  placeLabels, candidateSides, labelDistance, labelHalfExtents,
  LABEL_CLEARANCE_PX, DEFAULT_LABEL_SIDE,
} from '../labelPlacement';
import { autoRoute } from '../autoRoute';
import { unitAt, angleOf, type Vec2 } from '../geometry';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';
import type { BeamSegment } from '../../types/beam';
import { defaultBeam } from '../../types/beam';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A labelled node whose *centre* sits at (cx, cy), positioned as the canvas does it. */
function at(
  id: string,
  type: OpticalNodeData['type'],
  cx: number,
  cy: number,
  extra: Partial<OpticalNodeData> = {},
): Node<OpticalNodeData> {
  const box = getNodeGeometry(type, extra.rotation ?? 0);
  return {
    id,
    type: 'optical',
    position: { x: cx - box.width / 2, y: cy - box.height / 2 },
    data: { type, name: id, category: 'steering', showLabel: true, ...extra } as OpticalNodeData,
  };
}

/** A straight beam between two points; only the coordinates matter here. */
function seg(x1: number, y1: number, x2: number, y2: number): BeamSegment {
  return {
    id: `${x1},${y1}->${x2},${y2}`,
    sourceId: 'src', sourceHandle: 'out', targetId: 'dst',
    x1, y1, x2, y2,
    beam: { ...defaultBeam }, lengthMm: 0, free: false, wired: false,
  };
}

const sideOf = (nodes: Node<OpticalNodeData>[], segments: BeamSegment[], id: string) =>
  placeLabels(nodes, segments).get(id);

// ── Which sides are even considered ───────────────────────────────────────────

describe('candidateSides', () => {
  it('never offers a direction along the beam', () => {
    // Along the beam is the one direction guaranteed to follow it, so it is not on the list
    // at all — not even as the last resort.
    for (let deg = 0; deg < 360; deg += 15) {
      const axis = unitAt(deg);
      for (const side of candidateSides(axis)) {
        const along = Math.abs(side.dx * axis.dx + side.dy * axis.dy);
        expect(along).toBeLessThan(0.95);
      }
    }
  });

  it('prefers straight down for a horizontal beam, keeping the familiar look', () => {
    expect(candidateSides({ dx: 1, dy: 0 })[0]).toEqual({ dx: 0, dy: 1 });
    expect(candidateSides({ dx: -1, dy: 0 })[0]).toEqual({ dx: 0, dy: 1 });
  });

  it('goes sideways for a vertical beam, where down would be on the beam', () => {
    expect(Math.abs(candidateSides({ dx: 0, dy: 1 })[0].dy)).toBeLessThan(1e-9);
    expect(Math.abs(candidateSides({ dx: 0, dy: -1 })[0].dx)).toBeCloseTo(1, 9);
  });

  it('offers the downhill perpendicular first for a diagonal beam', () => {
    // A beam heading down-right has perpendiculars at 135° and -45°; the label takes the
    // one below the beam, matching the horizontal case.
    const first = candidateSides(unitAt(45))[0];
    expect(first.dy).toBeGreaterThan(0);
    expect(Math.abs(angleOf(first) - 135)).toBeLessThan(1e-6);
  });

  it('offers every candidate exactly once', () => {
    const keys = candidateSides(unitAt(15)).map(s => `${s.dx.toFixed(6)},${s.dy.toFixed(6)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── Choosing a side ───────────────────────────────────────────────────────────

describe('placeLabels', () => {
  it('skips components that are not showing a label', () => {
    const nodes = [at('A', 'iris', 200, 200, { showLabel: false })];
    expect(placeLabels(nodes, []).size).toBe(0);
  });

  it('leaves a label below a horizontal beam, as it always was', () => {
    const nodes = [at('A', 'iris', 200, 200)];
    expect(sideOf(nodes, [seg(100, 200, 300, 200)], 'A')).toEqual(DEFAULT_LABEL_SIDE);
  });

  it('moves the label off a vertical beam — the bug this pass exists for', () => {
    // A vertical beam runs straight down through where the label used to be drawn.
    const nodes = [at('A', 'iris', 200, 200, { rotation: 90, beamIncomingDir: { dx: 0, dy: 1 } })];
    const side = sideOf(nodes, [seg(200, 100, 200, 300)], 'A')!;
    expect(Math.abs(side.dy)).toBeLessThan(1e-9);
    expect(Math.abs(side.dx)).toBeCloseTo(1, 9);
  });

  it('flips to the far side when the near one is taken by another beam', () => {
    // Second beam placed exactly where the label would go: a dump lane, or a return pass.
    const nodes = [at('A', 'iris', 200, 200)];
    const label = labelHalfExtents('A');
    const blocked = 200 + labelDistance('iris', 0, DEFAULT_LABEL_SIDE, label);
    const side = sideOf(nodes, [seg(100, 200, 300, 200), seg(100, blocked, 300, blocked)], 'A')!;
    expect(side).toEqual({ dx: 0, dy: -1 });
  });

  it('falls back to a diagonal when both perpendiculars are blocked', () => {
    const nodes = [at('A', 'iris', 200, 200)];
    const label = labelHalfExtents('A');
    const reach = labelDistance('iris', 0, DEFAULT_LABEL_SIDE, label);
    const side = sideOf(nodes, [
      seg(100, 200, 300, 200),
      seg(100, 200 + reach, 300, 200 + reach),
      seg(100, 200 - reach, 300, 200 - reach),
    ], 'A')!;
    expect(Math.abs(side.dx)).toBeGreaterThan(0.1);
    expect(Math.abs(side.dy)).toBeGreaterThan(0.1);
  });

  it('takes the roomiest side rather than giving up on a crowded bench', () => {
    // Beams from every direction through the component: nothing clears, but a label still
    // has to go somewhere, and it should be the least bad place.
    const nodes = [at('A', 'iris', 200, 200)];
    const segments: BeamSegment[] = [];
    for (let deg = 0; deg < 180; deg += 5) {
      const u = unitAt(deg);
      segments.push(seg(200 - u.dx * 400, 200 - u.dy * 400, 200 + u.dx * 400, 200 + u.dy * 400));
    }
    const side = sideOf(nodes, segments, 'A');
    expect(side).toBeDefined();
    expect(Math.hypot(side!.dx, side!.dy)).toBeCloseTo(1, 9);
  });

  it('keeps two labels off each other', () => {
    // Long names on neighbouring components: both want to sit below, and both below is
    // one unreadable pile of text.
    const nodes = [
      at('A', 'iris', 200, 200, { name: 'Repump shutter' }),
      at('B', 'iris', 230, 200, { name: 'Cooling shutter' }),
    ];
    const sides = placeLabels(nodes, [seg(100, 200, 400, 200)]);
    expect(sides.get('A')).toEqual(DEFAULT_LABEL_SIDE);
    expect(sides.get('B')!.dy).toBeLessThan(0);
  });

  it('is stable: the same layout always places the same way', () => {
    const nodes = [
      at('A', 'iris', 200, 200, { name: 'Repump shutter' }),
      at('B', 'iris', 230, 200, { name: 'Cooling shutter' }),
    ];
    const segments = [seg(100, 200, 400, 200)];
    expect([...placeLabels(nodes, segments)]).toEqual([...placeLabels(nodes, segments)]);
  });

  it('clears every beam by the stated margin when it says it has', () => {
    // The contract, checked directly: the chosen box is at least LABEL_CLEARANCE_PX from
    // any beam whenever such a side exists.
    const nodes = [at('A', 'iris', 200, 200)];
    const segments = [seg(100, 200, 300, 200)];
    const side = sideOf(nodes, segments, 'A')!;
    const dist = labelDistance('iris', 0, side, labelHalfExtents('A'));
    // The label box's nearest edge to the beam line y = 200.
    const nearEdge = Math.abs(side.dy * dist) - labelHalfExtents('A').halfHeight;
    expect(nearEdge).toBeGreaterThanOrEqual(LABEL_CLEARANCE_PX);
  });
});

// ── Through the tracer ────────────────────────────────────────────────────────

describe('autoRoute publishes label sides', () => {
  const laser = (rotation: number): Node<OpticalNodeData> => at('L1', 'laser_source', 200, 200, {
    category: 'source', wavelength: 780, outputPower: 100, polarization: 'H', rotation,
  });

  it('places a label off the beam a component actually emits', () => {
    const flat = autoRoute([laser(0)], []).labelSides.get('L1')!;
    expect(flat).toEqual(DEFAULT_LABEL_SIDE);

    // Turned 90°, the laser fires downwards — so the label has to move sideways. This is
    // the case that needs the *traced* rotation, not the stale one.
    const turned = autoRoute([laser(90)], []).labelSides.get('L1')!;
    expect(Math.abs(turned.dy)).toBeLessThan(1e-9);
  });

  it('sees the rotation the trace chose, not the one that was stored', () => {
    // An AOM stored flat but hit by a vertical beam is turned by the router to face it.
    // Its label must respect the new orientation, or it lands on the beam.
    const nodes: Node<OpticalNodeData>[] = [
      laser(90),
      at('A1', 'aom', 200, 400, {
        category: 'modulation', rotation: 0,
        rfFrequency: 80, diffractionEfficiency: 80, order: 1,
      }),
    ];
    const { rotations, labelSides } = autoRoute(nodes, []);
    expect(rotations.get('A1')).toBe(90);
    const side = labelSides.get('A1')!;
    expect(Math.abs(side.dy)).toBeLessThan(0.71);   // not straight down the beam
  });

  it('gives no side to an unlabelled component', () => {
    const nodes = [laser(0), at('I1', 'iris', 400, 200, { showLabel: false })];
    const { labelSides } = autoRoute(nodes, []);
    expect(labelSides.has('I1')).toBe(false);
    expect(labelSides.has('L1')).toBe(true);
  });

  it('is a Map of unit vectors, whatever the layout', () => {
    const { labelSides } = autoRoute([laser(45)], []);
    for (const side of labelSides.values()) {
      expect(Math.hypot(side.dx, side.dy)).toBeCloseTo(1, 9);
    }
  });
});

// A label side is only ever a direction; how far out is `labelDistance`'s business, and
// both views call it. Nothing here should ever return an offset in px.
describe('the published value', () => {
  it('is a direction, not a distance', () => {
    const nodes = [at('A', 'iris', 200, 200), at('B', 'vapor_cell', 500, 200, {
      category: 'coldatom', species: 'Rb', length: 70, temperature: 25,
    })];
    for (const side of placeLabels(nodes, [seg(100, 200, 600, 200)]).values()) {
      expect(Math.hypot(side.dx, side.dy)).toBeCloseTo(1, 9);
    }
  });

  it('scales the distance, not the side, when the label grows', () => {
    const side: Vec2 = DEFAULT_LABEL_SIDE;
    const short = labelDistance('iris', 0, side, labelHalfExtents('A', 9));
    const long = labelDistance('iris', 0, side, labelHalfExtents('A very long name', 9));
    // Downwards, a wider label does not need to sit further out.
    expect(long).toBeCloseTo(short, 9);
  });
});
