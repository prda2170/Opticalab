import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { fanCollinearSegments, drawnEndpoints, BEAM_FAN_SEPARATION } from '../beamLayout';
import { autoRoute } from '../autoRoute';
import type { BeamSegment } from '../../types/beam';
import type { OpticalNodeData } from '../../types/components';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function seg(id: string, x1: number, y1: number, x2: number, y2: number): BeamSegment {
  return {
    id, sourceId: `${id}s`, sourceHandle: 'out', targetId: `${id}t`,
    x1, y1, x2, y2,
    beam: { wavelength: 780, power: 1, polarization: { type: 'H' } },
    lengthMm: 0, free: false, wired: false,
  };
}

const SEP = BEAM_FAN_SEPARATION;

// ── Fanning ───────────────────────────────────────────────────────────────────

describe('fanCollinearSegments', () => {
  it('leaves a lone beam alone', () => {
    const segs = [seg('a', 0, 0, 100, 0)];
    fanCollinearSegments(segs);
    expect(segs[0].renderShift).toBeUndefined();
  });

  it('separates two overlapping horizontal beams, keeping the first in place', () => {
    const segs = [seg('a', 0, 50, 200, 50), seg('b', 0, 50, 200, 50)];
    fanCollinearSegments(segs);
    expect(segs[0].renderShift).toBeUndefined();
    expect(segs[1].renderShift).toEqual({ dx: 0, dy: SEP });
  });

  it('separates overlapping vertical beams along x', () => {
    const segs = [seg('a', 50, 0, 50, 200), seg('b', 50, 0, 50, 200)];
    fanCollinearSegments(segs);
    expect(segs[1].renderShift!.dy).toBeCloseTo(0, 9);
    expect(Math.abs(segs[1].renderShift!.dx)).toBeCloseTo(SEP, 9);
  });

  it('fans a third beam to the other side', () => {
    const segs = [seg('a', 0, 50, 200, 50), seg('b', 0, 50, 200, 50), seg('c', 0, 50, 200, 50)];
    fanCollinearSegments(segs);
    expect(segs[0].renderShift).toBeUndefined();
    expect(segs[1].renderShift).toEqual({ dx: 0, dy: SEP });
    expect(segs[2].renderShift).toEqual({ dx: 0, dy: -SEP });
  });

  it('does NOT fan beams that merely meet end-to-end', () => {
    // Every ordinary beam path looks like this. Fanning it would zig-zag the chain.
    const segs = [seg('a', 0, 50, 100, 50), seg('b', 100, 50, 200, 50)];
    fanCollinearSegments(segs);
    expect(segs.every(s => s.renderShift === undefined)).toBe(true);
  });

  it('ignores overlaps below the minimum', () => {
    const segs = [seg('a', 0, 50, 100, 50), seg('b', 99, 50, 200, 50)];   // 1 px
    fanCollinearSegments(segs);
    expect(segs.every(s => s.renderShift === undefined)).toBe(true);
  });

  it('fans a real overlap', () => {
    const segs = [seg('a', 0, 50, 100, 50), seg('b', 90, 50, 200, 50)];   // 10 px
    fanCollinearSegments(segs);
    expect(segs[1].renderShift).toBeDefined();
  });

  it('does not fan beams on different lines', () => {
    const segs = [seg('a', 0, 50, 200, 50), seg('b', 0, 90, 200, 90)];
    fanCollinearSegments(segs);
    expect(segs.every(s => s.renderShift === undefined)).toBe(true);
  });

  it('treats sub-pixel axis differences as the same line', () => {
    const segs = [seg('a', 0, 50, 200, 50), seg('b', 0, 50.4, 200, 50.4)];
    fanCollinearSegments(segs);
    expect(segs[1].renderShift).toBeDefined();
  });

  it('does not fan perpendicular beams that cross', () => {
    const segs = [seg('a', 0, 50, 200, 50), seg('b', 100, -50, 100, 150)];
    fanCollinearSegments(segs);
    expect(segs.every(s => s.renderShift === undefined)).toBe(true);
  });

  it('fans diagonal beams that share a line', () => {
    // Used to be excluded: the old Line could only describe horizontal and vertical
    // beams, so two 45° beams on one axis drew exactly on top of each other.
    const segs = [seg('a', 0, 0, 200, 200), seg('b', 0, 0, 200, 200)];
    fanCollinearSegments(segs);
    expect(segs[0].renderShift).toBeUndefined();
    expect(segs[1].renderShift).toBeDefined();
    // Displaced perpendicular to the beam, so the separation is the full gap.
    expect(Math.hypot(segs[1].renderShift!.dx, segs[1].renderShift!.dy)).toBeCloseTo(SEP, 9);
  });

  it('does not fan diagonal beams that merely cross', () => {
    // Same 45° family, different lines — and the perpendicular one too.
    const segs = [
      seg('a', 0, 0, 200, 200),
      seg('b', 0, 40, 200, 240),      // parallel, 28 px off
      seg('c', 200, 0, 0, 200),       // crosses at right angles
    ];
    fanCollinearSegments(segs);
    expect(segs.every(s => s.renderShift === undefined)).toBe(true);
  });

  it('handles counter-propagating beams on one line', () => {
    // The phase-5 double-pass case: a return beam retracing its own path.
    const segs = [seg('out', 0, 50, 200, 50), seg('back', 200, 50, 0, 50)];
    fanCollinearSegments(segs);
    expect(segs[1].renderShift).toBeDefined();
    expect(Math.abs(segs[1].renderShift!.dy)).toBeCloseTo(SEP, 9);
  });
});

describe('drawnEndpoints', () => {
  it('returns true coordinates when there is no shift', () => {
    expect(drawnEndpoints(seg('a', 1, 2, 3, 4))).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it('displaces both endpoints equally, preserving length and direction', () => {
    const s = seg('a', 0, 50, 200, 50);
    s.renderShift = { dx: 0, dy: SEP };
    const d = drawnEndpoints(s);
    expect(d).toEqual({ x1: 0, y1: 50 + SEP, x2: 200, y2: 50 + SEP });
    expect(Math.hypot(d.x2 - d.x1, d.y2 - d.y1)).toBeCloseTo(200, 9);
  });
});

// ── Through the router ────────────────────────────────────────────────────────

describe('autoRoute — true ray positions', () => {
  function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
    const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
    const g = getNodeGeometry(full.type, full.rotation ?? 0);
    return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
  }
  const laser = (id: string, cx: number, cy: number, pol: 'H' | 'V') => at(id, {
    type: 'laser_source', category: 'source', name: id,
    wavelength: 780, outputPower: 100, polarization: pol, waist: 800, mSquared: 1,
  } as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);
  const pd = (id: string, cx: number, cy: number) =>
    at(id, { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, cx, cy);

  it('never fans an ordinary beam path', () => {
    const nodes = [
      laser('L1', 45, 33, 'H'),
      at('M', { type: 'dielectric_mirror', reflectivity: 99, rotation: 0 }, 400, 33),
      pd('PD', 400, -200),
    ];
    const { segments } = autoRoute(nodes, []);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(s => s.renderShift === undefined)).toBe(true);
  });

  it('snaps components exactly onto the beam, with no cosmetic displacement', () => {
    // A PBS combiner: H transmits straight through, V comes up from a mirror and
    // reflects onto the same axis. The old router nudged the upstream mirror by
    // 1.5 px to separate the drawn beams; nothing should move now.
    const nodes = [
      laser('L1', 45, 33, 'H'),
      at('PBS', { type: 'pbs', rotation: 0 }, 400, 33),
      laser('L2', 45, 333, 'V'),
      at('M', { type: 'dielectric_mirror', reflectivity: 100, rotation: 0 }, 400, 333),
      pd('PD', 800, 33),
    ];
    const { snaps } = autoRoute(nodes, []);

    // The mirror sits dead on both axes: x = 400 (the vertical leg) and y = 333.
    const mg = getNodeGeometry('dielectric_mirror');
    const mSnap = snaps.get('M');
    if (mSnap) {
      expect(mSnap.x + mg.width / 2).toBeCloseTo(400, 6);
      expect(mSnap.y + mg.height / 2).toBeCloseTo(333, 6);
    }
    const pbsSnap = snaps.get('PBS');
    if (pbsSnap) {
      const pg = getNodeGeometry('pbs');
      expect(pbsSnap.x + pg.width / 2).toBeCloseTo(400, 6);
      expect(pbsSnap.y + pg.height / 2).toBeCloseTo(33, 6);
    }
  });

  it('keeps combined beams physically collinear but draws them apart', () => {
    const nodes = [
      laser('L1', 45, 33, 'H'),
      at('PBS', { type: 'pbs', rotation: 0 }, 400, 33),
      laser('L2', 45, 333, 'V'),
      at('M', { type: 'dielectric_mirror', reflectivity: 100, rotation: 0 }, 400, 333),
      pd('PD', 800, 33),
    ];
    const { segments } = autoRoute(nodes, []);

    // Both the transmitted H beam and the reflected V beam reach the detector.
    const toPd = segments.filter(s => s.targetId === 'PD');
    expect(toPd).toHaveLength(2);

    // Physically they are the same line…
    for (const s of toPd) {
      expect(s.y1).toBeCloseTo(33, 6);
      expect(s.y2).toBeCloseTo(33, 6);
    }
    // …and each carries the full power of its own polarization.
    expect(toPd.map(s => Math.round(s.beam.power)).sort()).toEqual([100, 100]);

    // …but they are drawn on separate lines, so neither is hidden.
    const drawnY = toPd.map(s => drawnEndpoints(s).y1);
    expect(Math.abs(drawnY[0] - drawnY[1])).toBeCloseTo(SEP, 6);
    // One of them stays exactly on the true axis.
    expect(drawnY.some(y => Math.abs(y - 33) < 1e-6)).toBe(true);
  });

  it('gives auto-edges the drawn coordinates so both views agree', () => {
    const nodes = [
      laser('L1', 45, 33, 'H'),
      at('PBS', { type: 'pbs', rotation: 0 }, 400, 33),
      laser('L2', 45, 333, 'V'),
      at('M', { type: 'dielectric_mirror', reflectivity: 100, rotation: 0 }, 400, 333),
      pd('PD', 800, 33),
    ];
    const { segments, autoEdges } = autoRoute(nodes, []);
    for (const s of segments) {
      const edge = autoEdges.find(e => e.id === s.id);
      if (!edge) continue;
      const d = drawnEndpoints(s);
      expect(edge.data!.sx).toBeCloseTo(d.x1, 9);
      expect(edge.data!.sy).toBeCloseTo(d.y1, 9);
      expect(edge.data!.tx).toBeCloseTo(d.x2, 9);
      expect(edge.data!.ty).toBeCloseTo(d.y2, 9);
    }
  });

  it('keeps segment length physical, not affected by the cosmetic shift', () => {
    const nodes = [
      laser('L1', 45, 33, 'H'),
      at('PBS', { type: 'pbs', rotation: 0 }, 400, 33),
      laser('L2', 45, 333, 'V'),
      at('M', { type: 'dielectric_mirror', reflectivity: 100, rotation: 0 }, 400, 333),
      pd('PD', 800, 33),
    ];
    const { segments } = autoRoute(nodes, []);
    for (const s of segments) {
      const trueLen = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      const d = drawnEndpoints(s);
      const drawnLen = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
      expect(drawnLen).toBeCloseTo(trueLen, 6);
    }
  });
});
