import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { componentOutputs } from '../propagate';
import type { OpticalNodeData } from '../../types/components';
import type { BeamSegment, BeamState } from '../../types/beam';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Place a node so its *centre* sits at (cx, cy). */
function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return {
    id,
    type: 'optical',
    position: { x: cx - g.width / 2, y: cy - g.height / 2 },
    data: full,
  };
}

/** A 780 nm / 100 mW / H laser whose output face is at (90, 33) pointing +x. */
function laser(id = 'L1', overrides: Partial<OpticalNodeData> = {}): Node<OpticalNodeData> {
  return at(id, {
    type: 'laser_source', category: 'source', name: id,
    wavelength: 780, outputPower: 100, polarization: 'H',
    ...overrides,
  } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, 33);
}

/** The laser above emits along y = 33. */
const AXIS_Y = 33;

const segTo = (segs: BeamSegment[], targetId: string) => segs.find(s => s.targetId === targetId);
const segFrom = (segs: BeamSegment[], sourceId: string) => segs.filter(s => s.sourceId === sourceId);
const near = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(tol);

// ── Ray tracing ───────────────────────────────────────────────────────────────

describe('autoRoute — tracing', () => {
  it('emits a free beam when a laser hits nothing', () => {
    const { segments, phantomNodes, autoEdges } = autoRoute([laser()], []);

    expect(segments).toHaveLength(1);
    expect(phantomNodes).toHaveLength(1);
    expect(autoEdges).toHaveLength(1);

    const [seg] = segments;
    expect(seg.free).toBe(true);
    expect(seg.wired).toBe(false);
    expect(seg.targetId).toBe(phantomNodes[0].id);
    near(seg.x1, 90);          // laser output face
    near(seg.y1, AXIS_Y);
    near(seg.y2, AXIS_Y);      // travels straight along +x
    expect(seg.x2).toBeGreaterThan(seg.x1);
    expect(seg.beam).toMatchObject({ wavelength: 780, power: 100, polarization: { type: 'H' } });
  });

  it('connects a component on the beam axis and snaps it onto the beam', () => {
    // Detector centre is 6 px off the axis — inside BEAM_SNAP_DIST.
    const pd = at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y + 6);
    const { segments, snaps } = autoRoute([laser(), pd], []);

    expect(segments).toHaveLength(1);
    const seg = segTo(segments, 'PD')!;
    expect(seg.free).toBe(false);
    near(seg.y1, AXIS_Y);
    near(seg.y2, AXIS_Y);      // drawn on the axis, not through the node's old centre

    // The node is repositioned so its centre lands on the beam.
    const snap = snaps.get('PD')!;
    expect(snap).toBeDefined();
    const g = getNodeGeometry('photodiode');
    near(snap.y + g.height / 2, AXIS_Y);
  });

  it('does not connect a component beyond the snap distance', () => {
    const pd = at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y + 40);
    const { segments } = autoRoute([laser(), pd], []);

    expect(segments).toHaveLength(1);
    expect(segments[0].free).toBe(true);
  });

  it('turns the beam 90° at a "/" mirror and 90° the other way at a "\\" mirror', () => {
    const slash = autoRoute([laser(), at('M', { type: 'dielectric_mirror', reflectivity: 99, rotation: 0 }, 300, AXIS_Y)], []);
    const outSlash = segFrom(slash.segments, 'M')[0];
    // "/" with a rightward beam reflects upward (screen y-down → decreasing y).
    near(outSlash.x1, outSlash.x2);
    expect(outSlash.y2).toBeLessThan(outSlash.y1);

    const back = autoRoute([laser(), at('M', { type: 'dielectric_mirror', reflectivity: 99, rotation: 90 }, 300, AXIS_Y)], []);
    const outBack = segFrom(back.segments, 'M')[0];
    near(outBack.x1, outBack.x2);
    expect(outBack.y2).toBeGreaterThan(outBack.y1);
  });

  it('routes a laser → mirror → detector chain with mirror reflectivity applied', () => {
    const nodes = [
      laser(),
      at('M', { type: 'dielectric_mirror', reflectivity: 90, rotation: 0 }, 300, AXIS_Y),
      // "/" mirror sends the beam up, so the detector sits above the mirror.
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y - 200),
    ];
    const { segments, beams } = autoRoute(nodes, []);

    expect(segments.map(s => s.targetId).sort()).toEqual(['M', 'PD']);
    near(segTo(segments, 'M')!.beam.power, 100);
    near(segTo(segments, 'PD')!.beam.power, 90);   // 100 mW × 90 % reflectivity
    // Every emitted segment has a beam registered under the same id.
    for (const seg of segments) expect(beams.get(seg.id)).toEqual(seg.beam);
  });

  it('stops at a detector — nothing propagates past it', () => {
    const nodes = [
      laser(),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y),
      at('PD2', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 600, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);

    expect(segments).toHaveLength(1);
    expect(segTo(segments, 'PD2')).toBeUndefined();
  });

  it('produces stable segment ids across repeated traces', () => {
    const nodes = [laser(), at('M', { type: 'dielectric_mirror', reflectivity: 99, rotation: 0 }, 300, AXIS_Y)];
    const a = autoRoute(nodes, []).segments.map(s => s.id);
    const b = autoRoute(nodes, []).segments.map(s => s.id);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);   // and unique
  });

  it('keeps every traced segment axis-aligned', () => {
    const nodes = [
      laser(),
      at('BS', { type: 'npbs', splitRatio: '50:50', rotation: 0 }, 300, AXIS_Y),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 600, AXIS_Y),
      at('PD2', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y - 200),
    ];
    const { segments } = autoRoute(nodes, []);
    expect(segments.length).toBeGreaterThan(2);
    for (const s of segments) {
      const horizontal = Math.abs(s.y2 - s.y1) < 2;
      const vertical   = Math.abs(s.x2 - s.x1) < 2;
      expect(horizontal || vertical).toBe(true);
    }
  });

  it('reports truncation rather than dropping rays silently', () => {
    // More rays than the trace-step cap allows.
    const COUNT = 400;
    const nodes: Node<OpticalNodeData>[] = [];
    for (let i = 0; i < COUNT; i++) {
      nodes.push(at(`L${i}`, {
        type: 'laser_source', category: 'source', name: `L${i}`,
        wavelength: 780, outputPower: 100, polarization: 'H',
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, 200 * i));
    }
    const result = autoRoute(nodes, []);
    expect(result.truncated).toBe(true);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.segments.length).toBeLessThan(COUNT);
  });

  it('does not report truncation for an ordinary layout', () => {
    const nodes = [
      laser(),
      at('BS', { type: 'npbs', splitRatio: '50:50', rotation: 0 }, 300, AXIS_Y),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 600, AXIS_Y),
    ];
    expect(autoRoute(nodes, []).truncated).toBe(false);
  });
});

// ── Physics through the router ────────────────────────────────────────────────

describe('autoRoute — physics', () => {
  it('threads polarization through a waveplate into a PBS split', () => {
    const build = (fastAxisAngle: number) => [
      laser(),
      at('HWP', { type: 'hwp', category: 'conditioning', fastAxisAngle }, 200, AXIS_Y),
      at('PBS', { type: 'pbs', rotation: 0 }, 400, AXIS_Y),
      at('T', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 700, AXIS_Y),
      at('R', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 400, AXIS_Y - 200),
    ];

    // λ/2 at 22.5° rotates H to 45°, splitting the PBS 50/50.
    const half = autoRoute(build(22.5), []);
    expect(segTo(half.segments, 'T')!.beam.power).toBeCloseTo(50, 6);
    expect(segTo(half.segments, 'R')!.beam.power).toBeCloseTo(50, 6);

    // λ/2 at 0° leaves H untouched — everything transmits and no beam takes the
    // reflected arm at all (an extinguished port isn't traced).
    const none = autoRoute(build(0), []);
    expect(segTo(none.segments, 'T')!.beam.power).toBeCloseTo(100, 6);
    expect(segTo(none.segments, 'R')).toBeUndefined();

    // λ/2 at 45° rotates H to V — everything reflects.
    const full = autoRoute(build(45), []);
    expect(segTo(full.segments, 'T')).toBeUndefined();
    expect(segTo(full.segments, 'R')!.beam.power).toBeCloseTo(100, 6);
  });

  it('applies the split ratio and insertion loss at an NPBS', () => {
    const nodes = [
      laser(),
      at('BS', { type: 'npbs', splitRatio: '70:30', rotation: 0, loss: 10 }, 300, AXIS_Y),
      at('T', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 600, AXIS_Y),
      at('R', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y - 200),
    ];
    const { segments } = autoRoute(nodes, []);
    // 70:30 is R:T, and 10 % insertion loss applies to both ports.
    expect(segTo(segments, 'R')!.beam.power).toBeCloseTo(100 * 0.7 * 0.9, 6);
    expect(segTo(segments, 'T')!.beam.power).toBeCloseTo(100 * 0.3 * 0.9, 6);
  });

  it('sends a beam through or off a dichroic depending on its edge wavelength', () => {
    const build = (wavelength: number) => [
      laser('L1', { wavelength }),
      at('DM', { type: 'dichroic_mirror', edgeWavelength: 600, mirrorType: 'LP', rotation: 0 }, 300, AXIS_Y),
      at('T', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 600, AXIS_Y),
      at('R', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y - 200),
    ];
    // Long-pass: 780 nm > 600 nm edge → transmitted.
    const long = autoRoute(build(780), []);
    expect(segTo(long.segments, 'T')).toBeDefined();
    expect(segTo(long.segments, 'R')).toBeUndefined();

    // 532 nm < 600 nm edge → reflected.
    const short = autoRoute(build(532), []);
    expect(segTo(short.segments, 'T')).toBeUndefined();
    expect(segTo(short.segments, 'R')).toBeDefined();
  });

  it('emits both the doubled and residual beams from an SHG crystal', () => {
    const nodes = [
      laser(),
      at('SHG', { type: 'shg_crystal', geometry: 'bulk', temperature: 40, conversionEfficiency: 30 }, 300, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    const out = segFrom(segments, 'SHG');
    expect(out).toHaveLength(2);

    const doubled = out.find(s => s.sourceHandle === 'shg')!;
    const residual = out.find(s => s.sourceHandle === 'fund')!;
    near(doubled.beam.wavelength, 390);
    expect(doubled.beam.power).toBeCloseTo(30, 6);
    near(residual.beam.wavelength, 780);
    expect(residual.beam.power).toBeCloseTo(70, 6);
  });

  it('records the beam arriving at each component', () => {
    const nodes = [
      laser(),
      at('M', { type: 'dielectric_mirror', reflectivity: 50, rotation: 0 }, 300, AXIS_Y),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS_Y - 200),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(nodeBeams.get('M')!.power).toBeCloseTo(100, 6);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(50, 6);
  });
});

// ── User-drawn wiring ─────────────────────────────────────────────────────────

describe('autoRoute — explicit user wiring', () => {
  it('resolves a user-drawn edge with the same physics as the tracer', () => {
    // The detector is nowhere near the beam axis, but the user wired it up.
    const nodes = [
      laser(),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 900, 900),
    ];
    const userEdges: Edge[] = [{ id: 'e1', source: 'L1', sourceHandle: 'out', target: 'PD', targetHandle: 'in' }];

    const { segments, beams, nodeBeams } = autoRoute(nodes, userEdges);
    const wired = segments.find(s => s.wired)!;
    expect(wired.id).toBe('e1');
    expect(wired.beam.power).toBeCloseTo(100, 6);
    expect(beams.get('e1')!.wavelength).toBe(780);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(100, 6);
  });

  it('does not create an auto-edge for a user-wired connection', () => {
    const nodes = [
      laser(),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 900, 900),
    ];
    const userEdges: Edge[] = [{ id: 'e1', source: 'L1', sourceHandle: 'out', target: 'PD', targetHandle: 'in' }];
    const { autoEdges } = autoRoute(nodes, userEdges);
    expect(autoEdges.some(e => e.id === 'e1')).toBe(false);
  });

  it('resolves a multi-hop user-wired chain regardless of edge order', () => {
    const nodes = [
      laser(),
      at('ND', { type: 'nd_filter', category: 'conditioning', od: 1 }, 900, 900),
      at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 1200, 900),
    ];
    // Deliberately out of order: the second hop is listed first.
    const userEdges: Edge[] = [
      { id: 'e2', source: 'ND', sourceHandle: 'out', target: 'PD', targetHandle: 'in' },
      { id: 'e1', source: 'L1', sourceHandle: 'out', target: 'ND', targetHandle: 'in' },
    ];
    const { beams } = autoRoute(nodes, userEdges);
    expect(beams.get('e1')!.power).toBeCloseTo(100, 6);
    expect(beams.get('e2')!.power).toBeCloseTo(10, 6);   // OD 1 → ×0.1
  });
});

// ── componentOutputs, directly ────────────────────────────────────────────────

describe('componentOutputs', () => {
  const inBeam: BeamState = { wavelength: 780, power: 100, polarization: { type: 'H' } };

  it('returns no ports for terminators', () => {
    for (const type of ['beam_block', 'photodiode', 'apd', 'camera', 'beam_profiler'] as const) {
      expect(componentOutputs(inBeam, { type, name: type, category: 'detection' } as OpticalNodeData)).toEqual([]);
    }
  });

  it('applies insertion loss on every port of a splitter', () => {
    const ports = componentOutputs(inBeam, { type: 'npbs', name: 'BS', category: 'steering', splitRatio: '50:50', loss: 20 } as OpticalNodeData);
    expect(ports).toHaveLength(2);
    for (const p of ports) expect(p.beam.power).toBeCloseTo(100 * 0.5 * 0.8, 6);
  });

  it('applies insertion loss on a PBS', () => {
    const ports = componentOutputs(inBeam, { type: 'pbs', name: 'PBS', category: 'steering', loss: 20 } as OpticalNodeData);
    const trans = ports.find(p => p.handle === 'trans')!;
    expect(trans.beam.power).toBeCloseTo(100 * 1.0 * 0.8, 6);
    expect(trans.beam.polarization).toEqual({ type: 'H' });
  });

  it('marks reflected ports as reflect and transmitted ports as transmit', () => {
    const pbs = componentOutputs(inBeam, { type: 'pbs', name: 'PBS', category: 'steering' } as OpticalNodeData);
    expect(pbs.find(p => p.handle === 'refl')!.kind).toBe('reflect');
    expect(pbs.find(p => p.handle === 'trans')!.kind).toBe('transmit');

    const mirror = componentOutputs(inBeam, { type: 'dielectric_mirror', name: 'M', category: 'steering', reflectivity: 99 } as OpticalNodeData);
    expect(mirror).toHaveLength(1);
    expect(mirror[0].kind).toBe('reflect');
  });

  it('shifts the frequency at an AOM, leaving the carrier alone', () => {
    const [port] = componentOutputs(inBeam, {
      type: 'aom', name: 'AOM', category: 'modulation',
      rfFrequency: 80, rfPower: 33, diffractionEfficiency: 80, transmission: 98, activeOrder: '+1',
    } as OpticalNodeData);
    expect(port.handle).toBe('order1');
    expect(port.beam.power).toBeCloseTo(80, 6);
    // The RF shift lives in detuningHz — the carrier wavelength is untouched.
    expect(port.beam.wavelength).toBe(780);
    expect(port.beam.detuningHz).toBe(80e6);
  });

  it('leaves an unrecognised component as a lossless pass-through', () => {
    const [port] = componentOutputs(inBeam, {
      type: 'delay_line', name: 'Delay', category: 'cavity', delayLength: 1,
    } as OpticalNodeData);
    expect(port.handle).toBe('out');
    expect(port.kind).toBe('transmit');
    expect(port.beam.power).toBeCloseTo(100, 6);
  });
});
