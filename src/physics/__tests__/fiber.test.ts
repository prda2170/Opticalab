import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { componentOutputs, emitterBeam, isEmitter, DEFAULT_WAIST_UM } from '../propagate';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'fiber', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (id: string, cx: number, cy: number, rotation = 0) => at(id, {
  type: 'laser_source', category: 'source', name: id, rotation,
  wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

const coupler = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'fiber_coupler', name: 'FC', category: 'fiber',
  couplingEfficiency: 80, inputNA: 0.12, ...over,
} as OpticalNodeData);

const launcher = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'fiber_launcher', name: 'FL', category: 'fiber',
  focalLength: 11, wavelength: 780, outputPower: 10, polarization: 'H', waist: 1100, mSquared: 1,
  ...over,
} as OpticalNodeData);

const cable = () => ({
  type: 'fiber_cable', name: 'Fiber', category: 'fiber',
  length: 1, pmFiber: true, connectorType: 'FC/APC',
} as OpticalNodeData);

const pd = (id: string, cx: number, cy: number) =>
  at(id, { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, cx, cy);

const inBeam: BeamState = { wavelength: 780, power: 100, polarization: { type: 'H' } };
const AXIS = 33;

// ── Coupling into fibre ends the free-space path ──────────────────────────────

describe('fiber coupler', () => {
  it('reports the coupled power but sends no beam onward', () => {
    const ports = componentOutputs(inBeam, coupler());
    expect(ports).toHaveLength(1);
    expect(ports[0].handle).toBe('fiber');
    expect(ports[0].dumped).toBe(true);
    expect(ports[0].dumpedAs).toBe('coupled in');
    expect(ports[0].beam.power).toBeCloseTo(80, 6);   // 100 mW × 80 %
  });

  it('applies insertion loss on top of the coupling efficiency', () => {
    const ports = componentOutputs(inBeam, coupler({ loss: 50 } as Partial<OpticalNodeData>));
    expect(ports[0].beam.power).toBeCloseTo(40, 6);
  });

  it('terminates the beam in a layout, so nothing continues past it', () => {
    const nodes = [
      laser('L1', 45, AXIS),
      at('FC', coupler() as Partial<OpticalNodeData> & { type: 'fiber_coupler' }, 400, AXIS),
      pd('PD', 800, AXIS),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);

    expect(segments.some(s => s.targetId === 'FC')).toBe(true);
    expect(segments.filter(s => s.sourceId === 'FC')).toHaveLength(0);
    // The detector behind it gets nothing at all.
    expect(nodeBeams.get('PD')).toBeUndefined();
    expect(nodeBeams.get('FC')!.power).toBeCloseTo(100, 6);
  });

  it('stops the beam at its face rather than drawing through the body', () => {
    const nodes = [laser('L1', 45, AXIS), at('FC', coupler() as Partial<OpticalNodeData> & { type: 'fiber_coupler' }, 400, AXIS)];
    const { segments } = autoRoute(nodes, []);
    const g = getNodeGeometry('fiber_coupler');
    expect(segments[0].x2).toBeCloseTo(400 - g.width / 2, 6);
  });
});

// ── A patch cord is not a free-space optic ────────────────────────────────────

describe('fiber cable', () => {
  it('has no optical output', () => {
    expect(componentOutputs(inBeam, cable())).toEqual([]);
  });

  it('stops a beam that lands on it instead of passing it through', () => {
    const nodes = [
      laser('L1', 45, AXIS),
      at('CAB', cable() as Partial<OpticalNodeData> & { type: 'fiber_cable' }, 400, AXIS),
      pd('PD', 800, AXIS),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);
    expect(segments.some(s => s.targetId === 'CAB')).toBe(true);
    expect(segments.filter(s => s.sourceId === 'CAB')).toHaveLength(0);
    expect(nodeBeams.get('PD')).toBeUndefined();
  });
});

// ── Launchers are sources ─────────────────────────────────────────────────────

describe('fiber launcher', () => {
  it('counts as an emitter, alongside lasers', () => {
    expect(isEmitter('fiber_launcher')).toBe(true);
    expect(isEmitter('laser_source')).toBe(true);
    expect(isEmitter('fiber_coupler')).toBe(false);
    expect(isEmitter('fiber_cable')).toBe(false);
  });

  it('launches a beam from its own stated output', () => {
    const beam = emitterBeam(launcher())!;
    expect(beam.wavelength).toBe(780);
    expect(beam.power).toBeCloseTo(10, 6);
    expect(beam.polarization.type).toBe('H');
    expect(beam.w).toBeCloseTo(1100, 6);
    expect(beam.q).toBeDefined();          // seeded at a waist, like a laser
  });

  it('falls back sensibly for a layout saved before it was a source', () => {
    const beam = emitterBeam({ type: 'fiber_launcher', name: 'FL', category: 'fiber', focalLength: 11 } as OpticalNodeData)!;
    expect(beam.wavelength).toBe(780);
    expect(beam.power).toBe(1);
    expect(beam.w).toBeCloseTo(DEFAULT_WAIST_UM, 6);
  });

  it('is not an emitter for anything else', () => {
    expect(emitterBeam(coupler())).toBeNull();
    expect(emitterBeam(cable())).toBeNull();
  });

  it('seeds a trace with no laser present at all', () => {
    const nodes = [
      at('FL', launcher() as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 100, AXIS),
      pd('PD', 600, AXIS),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].sourceId).toBe('FL');
    expect(segments[0].targetId).toBe('PD');
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(10, 6);
  });

  it('starts its beam flush with its output face', () => {
    // Emitter rays already begin on the face, so a further trim would leave the beam
    // hanging in space clear of the icon.
    const g = getNodeGeometry('fiber_launcher');
    const { segments } = autoRoute([
      at('FL', launcher() as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 120, AXIS),
      pd('PD', 600, AXIS),
    ], []);
    expect(segments[0].x1).toBeCloseTo(120 + g.width / 2, 6);
  });

  it('emits along the way it faces', () => {
    const right = autoRoute([at('FL', launcher() as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 100, AXIS)], []);
    expect(right.segments[0].x2).toBeGreaterThan(right.segments[0].x1);

    const left = autoRoute([at('FL', launcher({ rotation: 180 }) as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 500, AXIS)], []);
    expect(left.segments[0].x2).toBeLessThan(left.segments[0].x1);
  });

  it('feeds a full downstream chain', () => {
    const nodes = [
      at('FL', launcher({ outputPower: 40 }) as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 100, AXIS),
      at('M', { type: 'dielectric_mirror', category: 'steering', reflectivity: 50, rotation: 0 }, 500, AXIS),
      pd('PD', 500, AXIS - 300),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(20, 6);
  });

  it('absorbs a beam that arrives at it, and says so', () => {
    // Light hitting a collimator couples back down the fibre — the same hazard as
    // feedback into a diode, so it terminates and warns rather than passing through.
    expect(componentOutputs(inBeam, launcher())).toEqual([]);

    const nodes = [
      laser('L1', 45, AXIS),
      at('FL', launcher({ rotation: 180 }) as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 600, AXIS),
      pd('PD', 1000, AXIS),
    ];
    const { segments, nodeBeams, warnings } = autoRoute(nodes, []);
    expect(segments.some(s => s.targetId === 'FL')).toBe(true);
    expect(nodeBeams.get('PD')).toBeUndefined();          // nothing gets past it
    expect(warnings.map(w => w.nodeId)).toContain('FL');
    expect(warnings.find(w => w.nodeId === 'FL')!.message).toMatch(/fibre/i);
  });

  it('works end to end: launcher → coupler, free space between two fibres', () => {
    const nodes = [
      at('FL', launcher({ outputPower: 25 }) as Partial<OpticalNodeData> & { type: 'fiber_launcher' }, 100, AXIS),
      at('FC', coupler() as Partial<OpticalNodeData> & { type: 'fiber_coupler' }, 600, AXIS),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].free).toBe(false);
    expect(nodeBeams.get('FC')!.power).toBeCloseTo(25, 6);
    // …and 80 % of that makes it into the fibre.
    const [port] = componentOutputs(nodeBeams.get('FC')!, coupler());
    expect(port.beam.power).toBeCloseTo(20, 6);
  });
});
