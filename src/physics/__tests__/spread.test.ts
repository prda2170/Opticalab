import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { makeSpread, DEFAULT_SPREAD } from '../spread';
import { autoRoute } from '../autoRoute';
import { angleOf, angleDiff, unitAt, DIR_STEP_DEG } from '../geometry';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** A node whose centre sits at (cx, cy). */
function at(
  id: string,
  type: OpticalNodeData['type'],
  cx: number,
  cy: number,
  extra: Partial<OpticalNodeData> = {},
): Node<OpticalNodeData> {
  const box = getNodeGeometry(type, extra.rotation ?? 0);
  return {
    id, type: 'optical',
    position: { x: cx - box.width / 2, y: cy - box.height / 2 },
    data: { type, name: id, category: 'steering', ...extra } as OpticalNodeData,
  };
}

const laser = (cx: number, cy: number, rotation = 0) => at('L1', 'laser_source', cx, cy, {
  category: 'source', wavelength: 780, outputPower: 100, polarization: 'H', rotation,
});

const centreOf = (n: Node<OpticalNodeData>) => {
  const g = getNodeGeometry(n.data.type, n.data.rotation ?? 0);
  return { x: n.position.x + g.width / 2, y: n.position.y + g.height / 2 };
};

/** A laser into a mirror into a photodiode: two segments, one of them a fold. */
function bench(): Node<OpticalNodeData>[] {
  return [
    laser(200, 200),
    at('M1', 'dielectric_mirror', 600, 200, { reflectivity: 99, rotation: 0 }),
    at('PD', 'photodiode', 600, 600, { category: 'detection', responsivity: 0.5, gain: 1 }),
  ];
}

// ── The identity ──────────────────────────────────────────────────────────────

describe('makeSpread at factor 1', () => {
  it('changes nothing at all', () => {
    const nodes = bench();
    const { segments } = autoRoute(nodes, []);
    const one = makeSpread(nodes, 1);
    for (const seg of segments) {
      expect(one.segment(seg)).toEqual({ x1: seg.x1, y1: seg.y1, x2: seg.x2, y2: seg.y2 });
    }
    expect(one.point({ x: 123, y: -45 })).toEqual({ x: 123, y: -45 });
  });

  it('is what the figure would show if it did not spread', () => {
    // Documents the default rather than asserting a taste: the diagram opens spread, and
    // this is the number it opens at.
    expect(DEFAULT_SPREAD).toBeGreaterThan(1);
  });
});

// ── What spreading must preserve ──────────────────────────────────────────────

describe('makeSpread', () => {
  const K = 1.4;

  it('moves components apart by the factor, exactly', () => {
    const nodes = bench();
    const s = makeSpread(nodes, K);
    const [a, b] = [centreOf(nodes[0]), centreOf(nodes[1])];
    const before = Math.hypot(b.x - a.x, b.y - a.y);
    const A = s.point(a), B = s.point(b);
    expect(Math.hypot(B.x - A.x, B.y - A.y)).toBeCloseTo(before * K, 9);
  });

  it('keeps every beam at the angle it was traced at', () => {
    // The whole point of a uniform scaling: a 15° beam is still at 15°, so the figure does
    // not quietly show angles the bench cannot make.
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const u = unitAt(deg);
      const nodes = [
        laser(400, 400, deg),
        at('I1', 'iris', 400 + u.dx * 300, 400 + u.dy * 300, { category: 'conditioning', diameter: 10 }),
      ];
      const { segments } = autoRoute(nodes, []);
      const s = makeSpread(nodes, K);
      for (const seg of segments) {
        const before = angleOf({ dx: seg.x2 - seg.x1, dy: seg.y2 - seg.y1 });
        const e = s.segment(seg);
        const after = angleOf({ dx: e.x2 - e.x1, dy: e.y2 - e.y1 });
        expect(Math.abs(angleDiff(before, after))).toBeLessThan(1e-6);
      }
    }
  });

  it('leaves each beam touching the same face of the same icon', () => {
    // The correction that earns the transform its keep: face trims are component size, not
    // bench distance. Scale them and every optic gets a gap between it and its beam.
    const nodes = bench();
    const { segments } = autoRoute(nodes, []);
    const s = makeSpread(nodes, K);
    for (const seg of segments) {
      if (seg.free) continue;
      const target = nodes.find(n => n.id === seg.targetId);
      if (!target) continue;
      const c = centreOf(target);
      const trimBefore = Math.hypot(c.x - seg.x2, c.y - seg.y2);
      const e = s.segment(seg);
      const C = s.point(c);
      expect(Math.hypot(C.x - e.x2, C.y - e.y2)).toBeCloseTo(trimBefore, 6);
    }
  });

  it('holds an emitter output face against its own icon too', () => {
    const nodes = bench();
    const { segments } = autoRoute(nodes, []);
    const s = makeSpread(nodes, K);
    const first = segments.find(seg => seg.sourceId === 'L1')!;
    const c = centreOf(nodes[0]);
    const before = Math.hypot(first.x1 - c.x, first.y1 - c.y);
    const e = s.segment(first);
    const C = s.point(c);
    expect(Math.hypot(e.x1 - C.x, e.y1 - C.y)).toBeCloseTo(before, 6);
  });

  it('makes the free-space run longer, which is the point', () => {
    const nodes = bench();
    const { segments } = autoRoute(nodes, []);
    const s = makeSpread(nodes, K);
    const seg = segments.find(x => x.targetId === 'M1')!;
    const before = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
    const e = s.segment(seg);
    const after = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    expect(after).toBeGreaterThan(before);
    // The *centre* separation scales by k; the two face trims don't scale at all. So the
    // visible run of free space grows by slightly more than k — which is what "space the
    // components further apart" means when the components stay the same size.
    const gap = Math.hypot(centreOf(nodes[1]).x - centreOf(nodes[0]).x,
                           centreOf(nodes[1]).y - centreOf(nodes[0]).y);
    expect(after).toBeCloseTo(gap * K - (gap - before), 6);
    expect(after).toBeGreaterThan(before * K);
  });

  it('does not touch the traced numbers', () => {
    // Spreading is drawing. If it changed `lengthMm` the figure would print path lengths
    // and spot sizes for a bench that does not exist.
    const nodes = bench();
    const { segments } = autoRoute(nodes, []);
    const lengths = segments.map(s => s.lengthMm);
    const spots = segments.map(s => s.beam.w);
    makeSpread(nodes, 2.5).segment(segments[0]);
    expect(segments.map(s => s.lengthMm)).toEqual(lengths);
    expect(segments.map(s => s.beam.w)).toEqual(spots);
  });

  it('scales a free beam, which has no far component to hold on to', () => {
    const nodes = [laser(200, 200)];
    const { segments } = autoRoute(nodes, []);
    const free = segments[0];
    expect(free.free).toBe(true);
    const e = makeSpread(nodes, K).segment(free);
    expect(e.x2).toBeCloseTo(free.x2 * K, 9);
  });

  it('keeps a waist marker on its own beam', () => {
    const nodes = [
      laser(200, 200),
      at('LN', 'plano_convex', 500, 200, { category: 'lens', focalLength: 100, diameter: 25 }),
      at('PD', 'photodiode', 900, 200, { category: 'detection', responsivity: 0.5, gain: 1 }),
    ];
    const { segments } = autoRoute(nodes, []);
    const withWaist = segments.find(s => s.waist);
    expect(withWaist).toBeDefined();
    const s = makeSpread(nodes, K);
    const e = s.segment(withWaist!);
    const w = s.waist(withWaist!)!;
    // On the line, and between the ends.
    const cross = (e.x2 - e.x1) * (w.y - e.y1) - (e.y2 - e.y1) * (w.x - e.x1);
    const offLine = Math.abs(cross) / Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
    expect(offLine).toBeLessThan(1e-6);
    const t = ((w.x - e.x1) * (e.x2 - e.x1) + (w.y - e.y1) * (e.y2 - e.y1))
      / ((e.x2 - e.x1) ** 2 + (e.y2 - e.y1) ** 2);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThanOrEqual(1);
  });

  it('reports null for a segment with no waist', () => {
    const nodes = bench();
    const { segments } = autoRoute(nodes, []);
    const plain = segments.find(s => !s.waist)!;
    expect(makeSpread(nodes, K).waist(plain)).toBeNull();
  });

  it('keeps a dumped order parallel to where it was', () => {
    // The lane-offset case, which is why perpendicular offsets scale: an acousto-optic
    // cell's 0th order leaves an inch off-axis, so the source centre is *not* on that beam.
    // Hold the offset fixed while the centres move apart and the beam tilts.
    const nodes = [
      laser(200, 200),
      at('A1', 'aom', 600, 200, {
        category: 'modulation', rfFrequency: 80, diffractionEfficiency: 80, order: 1,
      }),
    ];
    const { segments } = autoRoute(nodes, []);
    const s = makeSpread(nodes, K);
    for (const seg of segments) {
      const before = angleOf({ dx: seg.x2 - seg.x1, dy: seg.y2 - seg.y1 });
      const e = s.segment(seg);
      const after = angleOf({ dx: e.x2 - e.x1, dy: e.y2 - e.y1 });
      expect(Math.abs(angleDiff(before, after))).toBeLessThan(1e-6);
    }
  });
});
