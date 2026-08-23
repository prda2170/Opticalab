import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { nearestBeam, probeBeam, probeLines, probeSnaps, PROBE_REACH } from '../probe';
import { autoRoute } from '../autoRoute';
import { isOpticalNode } from '../../types/components';
import type { OpticalNodeData } from '../../types/components';
import type { BeamSegment, BeamState } from '../../types/beam';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import { mmToPx } from '../scale';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function seg(id: string, x1: number, y1: number, x2: number, y2: number, power = 100): BeamSegment {
  return {
    id, sourceId: `${id}s`, sourceHandle: 'out', targetId: `${id}t`,
    x1, y1, x2, y2,
    beam: { wavelength: 780, power, polarization: { type: 'H' } },
    lengthMm: 0, free: false, wired: false,
  };
}

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number, nodeType = 'optical'): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: nodeType, position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (id: string, cx: number, cy: number, power = 100) => at(id, {
  type: 'laser_source', category: 'source', name: id,
  wavelength: 780, outputPower: power, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

const probe = (id: string, cx: number, cy: number) => at(id, {
  type: 'power_probe', category: 'utility', name: 'P', labelDx: 34, labelDy: -30,
} as Partial<OpticalNodeData> & { type: 'power_probe' }, cx, cy, 'power_probe');

const AXIS = 33;

// ── Finding the beam ──────────────────────────────────────────────────────────

describe('nearestBeam', () => {
  const segs = [seg('a', 0, 100, 200, 100)];

  it('projects a nearby point onto the beam', () => {
    const hit = nearestBeam(segs, { x: 60, y: 108 })!;
    expect(hit.segment.id).toBe('a');
    expect(hit.distance).toBeCloseTo(8, 6);
    expect(hit.point).toEqual({ x: 60, y: 100 });
    expect(hit.along).toBeCloseTo(60, 6);
  });

  it('finds nothing beyond its reach', () => {
    expect(nearestBeam(segs, { x: 60, y: 100 + PROBE_REACH + 1 })).toBeNull();
  });

  it('reaches further than the optic snap distance, being placed by hand', () => {
    expect(PROBE_REACH).toBeGreaterThan(10);
  });

  it('clamps past the end of a beam rather than reading the infinite line', () => {
    const hit = nearestBeam(segs, { x: 260, y: 100 }, 100)!;
    expect(hit.point.x).toBe(200);
    expect(hit.along).toBeCloseTo(200, 6);
  });

  it('picks the closer of two beams', () => {
    const two = [seg('near', 0, 100, 200, 100), seg('far', 0, 120, 200, 120)];
    expect(nearestBeam(two, { x: 50, y: 104 })!.segment.id).toBe('near');
    expect(nearestBeam(two, { x: 50, y: 116 })!.segment.id).toBe('far');
  });

  it('ignores degenerate segments', () => {
    expect(nearestBeam([seg('dot', 50, 50, 50, 50)], { x: 50, y: 50 })).toBeNull();
  });
});

describe('probeBeam', () => {
  it('reports the segment power, which is constant along it', () => {
    const segs = [seg('a', 0, 100, 400, 100, 42)];
    for (const x of [10, 200, 390]) {
      expect(probeBeam(segs, { x, y: 100 })!.beam.power).toBeCloseTo(42, 6);
    }
  });

  it('advances the Gaussian to the probe point, so the spot does vary', () => {
    // A tight waist diverges quickly, so the reading must depend on position.
    const s = seg('a', 0, 100, 400, 100);
    s.beam = {
      wavelength: 780, power: 10, polarization: { type: 'H' },
      q: [0, 1.6], mSquared: 1,
    };
    const near = probeBeam([s], { x: 10, y: 100 })!.beam.w!;
    const far  = probeBeam([s], { x: 390, y: 100 })!.beam.w!;
    expect(far).toBeGreaterThan(near * 2);
  });

  it('returns null where there is no beam', () => {
    expect(probeBeam([seg('a', 0, 100, 200, 100)], { x: 60, y: 400 })).toBeNull();
  });
});

// ── Snapping ──────────────────────────────────────────────────────────────────

describe('probeSnaps', () => {
  const g = getNodeGeometry('power_probe');
  const box = (cx: number, cy: number, locked?: boolean) => ({
    id: 'p', position: { x: cx - g.width / 2, y: cy - g.height / 2 },
    width: g.width, height: g.height, locked,
  });

  it('pulls a probe onto the beam it is near', () => {
    const snaps = probeSnaps([box(60, 108)], [seg('a', 0, 100, 200, 100)]);
    const pos = snaps.get('p')!;
    expect(pos.y + g.height / 2).toBeCloseTo(100, 6);
    expect(pos.x + g.width / 2).toBeCloseTo(60, 6);
  });

  it('leaves a probe alone when it is already on the beam', () => {
    expect(probeSnaps([box(60, 100)], [seg('a', 0, 100, 200, 100)]).size).toBe(0);
  });

  it('leaves a probe alone when no beam is near', () => {
    expect(probeSnaps([box(60, 400)], [seg('a', 0, 100, 200, 100)]).size).toBe(0);
  });

  it('never moves a locked probe', () => {
    expect(probeSnaps([box(60, 108, true)], [seg('a', 0, 100, 200, 100)]).size).toBe(0);
  });
});

// ── Readout ───────────────────────────────────────────────────────────────────

describe('probeLines', () => {
  const beam: BeamState = {
    wavelength: 780, power: 12.5, polarization: { type: 'H' },
    detuningHz: 80e6, w: 802,
  };

  it('shows power alone by default', () => {
    expect(probeLines({}, beam)).toEqual(['12.50 mW']);
  });

  it('adds only what is asked for', () => {
    expect(probeLines({ showWavelength: true }, beam)).toEqual(['12.50 mW', '780 nm']);
    expect(probeLines({ showDetuning: true }, beam)).toEqual(['12.50 mW', '+80 MHz']);
    expect(probeLines({ showSpot: true }, beam)).toEqual(['12.50 mW', 'w = 802 µm']);
  });

  it('omits detuning when there is none', () => {
    expect(probeLines({ showDetuning: true }, { ...beam, detuningHz: 0 })).toEqual(['12.50 mW']);
  });

  it('scales the power unit down to nW', () => {
    expect(probeLines({}, { ...beam, power: 2000 })).toEqual(['2.000 W']);
    expect(probeLines({}, { ...beam, power: 0.05 })).toEqual(['50.0 µW']);
    expect(probeLines({}, { ...beam, power: 2e-6 })).toEqual(['2 nW']);
  });

  it('says so when there is no beam', () => {
    expect(probeLines({ showSpot: true }, null)).toEqual(['no beam']);
  });
});

// ── The probe must not disturb the layout ─────────────────────────────────────

describe('probes are not optics', () => {
  it('is excluded from the traced node set', () => {
    expect(isOpticalNode({ type: 'power_probe' })).toBe(false);
    expect(isOpticalNode({ type: 'beam_endpoint' })).toBe(false);
    expect(isOpticalNode({ type: 'optical' })).toBe(true);
    expect(isOpticalNode({})).toBe(true);           // default node type
  });

  it('leaves the trace identical whether or not one is present', () => {
    const optics = [
      laser('L1', 45, AXIS),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 600, AXIS),
    ];
    const withProbe = [...optics, probe('P1', 300, AXIS)];

    const a = autoRoute(optics.filter(isOpticalNode), []);
    const b = autoRoute(withProbe.filter(isOpticalNode), []);

    // Same beams, same geometry, no extra segment split at the probe.
    expect(b.segments).toHaveLength(a.segments.length);
    expect(b.segments.map(s => [s.id, s.x1, s.y1, s.x2, s.y2]))
      .toEqual(a.segments.map(s => [s.id, s.x1, s.y1, s.x2, s.y2]));
    expect(b.segments[0].beam.power).toBeCloseTo(a.segments[0].beam.power, 9);
  });

  it('reads the beam it sits on in a real layout', () => {
    const nodes = [
      laser('L1', 45, AXIS, 100),
      at('ND', { type: 'nd_filter', category: 'conditioning', od: 1 }, 400, AXIS),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 800, AXIS),
      probe('P1', 250, AXIS),
      probe('P2', 600, AXIS),
    ];
    const { segments } = autoRoute(nodes.filter(isOpticalNode), []);

    // Before the filter: full power. After it: one decade down.
    expect(probeBeam(segments, { x: 250, y: AXIS })!.beam.power).toBeCloseTo(100, 6);
    expect(probeBeam(segments, { x: 600, y: AXIS })!.beam.power).toBeCloseTo(10, 6);
  });

  it('reads a spot size that grows along the beam', () => {
    const nodes = [
      laser('L1', 45, AXIS),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 1400, AXIS),
    ];
    const { segments } = autoRoute(nodes, []);
    const near = probeBeam(segments, { x: 200, y: AXIS })!.beam.w!;
    const far  = probeBeam(segments, { x: 1300, y: AXIS })!.beam.w!;
    expect(far).toBeGreaterThan(near);
  });

  it('reads a focus formed by a lens', () => {
    // Placed at the waist the lens makes, the probe should see the smallest spot.
    const f = 100;
    const nodes = [
      laser('L1', 45, AXIS),
      at('LENS', { type: 'plano_convex', category: 'lens', focalLength: f }, 400, AXIS),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 1000, AXIS),
    ];
    const { segments } = autoRoute(nodes, []);
    const atFocus = probeBeam(segments, { x: 400 + mmToPx(f), y: AXIS })!.beam.w!;
    const past    = probeBeam(segments, { x: 400 + mmToPx(f) + 200, y: AXIS })!.beam.w!;
    expect(atFocus).toBeLessThan(50);        // ≈31 µm at the focus
    expect(past).toBeGreaterThan(atFocus);
  });
});
