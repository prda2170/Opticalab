import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute, faceHalf } from '../autoRoute';
import { componentOutputs, isEmitter, emitterBeam } from '../propagate';
import { unitAt } from '../geometry';
import { getNodeGeometry, artworkOf } from '../../utils/nodeGeometry';
import { PALETTE } from '../../utils/palette';
import { transmissionFraction } from '../power';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fa = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'fiber_amplifier', name: 'FA', category: 'source',
  wavelength: 1064, outputPower: 2000, polarization: 'H', waist: 1200, mSquared: 1.05,
  current: 3000, ...over,
} as OpticalNodeData);

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'source', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const PD = { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 } as const;
const AXIS = 300;

/** The layout the whole point of this component: no beam drawn to it. */
const aloneOnTheBench = (over: Partial<OpticalNodeData> = {}) => [
  at('FA', fa(over) as Partial<OpticalNodeData> & { type: 'fiber_amplifier' }, 200, AXIS),
  at('PD', PD, 700, AXIS),
];

// ── It is a source ────────────────────────────────────────────────────────────

describe('a fibre-coupled amplifier needs no beam input', () => {
  it('is an emitter, unlike the free-space amplifier', () => {
    expect(isEmitter('fiber_amplifier')).toBe(true);
    expect(isEmitter('optical_amplifier')).toBe(false);
  });

  it('starts a beam on its own, with nothing feeding it', () => {
    const { segments, nodeBeams } = autoRoute(aloneOnTheBench(), []);
    expect(segments.map(s => `${s.sourceId}->${s.targetId}`)).toEqual(['FA->PD']);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(2000, 6);
  });

  it('emits what it says it emits', () => {
    const beam = emitterBeam(fa({ wavelength: 1550, outputPower: 5000, polarization: 'V' }))!;
    expect(beam.wavelength).toBe(1550);
    expect(beam.power).toBe(5000);
    expect(beam.polarization).toEqual({ type: 'V' });
    // No RF shift on a fresh source beam — `sourceBeam` leaves `detuningHz` unset for
    // every emitter, lasers included, and `formatDetuning` renders that as nothing.
    expect(beam.detuningHz).toBeFalsy();
  });

  it('seeds the Gaussian chain from its collimator, like a laser', () => {
    const { segments } = autoRoute(aloneOnTheBench({ waist: 1200, mSquared: 1.05 }), []);
    const beam = segments[0].beam;
    expect(beam.w).toBeCloseTo(1200, 3);
    expect(beam.w0).toBeCloseTo(1200, 3);
    expect(beam.q).toBeDefined();
    expect(beam.zR).toBeGreaterThan(0);
  });

  it('emits from its output face, on its own axis, at any lattice angle', () => {
    const reach = artworkOf('fiber_amplifier').width / 2;
    for (const deg of [0, 90, 180, 270, 15, 45]) {
      const node = at('FA', fa({ rotation: deg }) as Partial<OpticalNodeData> & { type: 'fiber_amplifier' }, 400, 400);
      const seg = autoRoute([node], []).segments.find(s => s.sourceId === 'FA')!;
      const u = unitAt(deg);
      expect(seg.x1).toBeCloseTo(400 + u.dx * reach, 6);
      expect(seg.y1).toBeCloseTo(400 + u.dy * reach, 6);
    }
  });
});

// ── It is not a pass-through ──────────────────────────────────────────────────

describe('it does not carry a beam through', () => {
  it('absorbs a beam that arrives, like any emitter', () => {
    const arriving: BeamState = {
      wavelength: 780, detuningHz: 0, power: 50, polarization: { type: 'H' },
    };
    expect(componentOutputs(arriving, fa())).toEqual([]);
  });

  it('warns when a beam is sent into it — feedback into a gain medium', () => {
    // A laser firing straight into the amplifier's output face.
    const nodes = [
      at('L1', {
        type: 'laser_source', name: 'L1', wavelength: 1064, outputPower: 100,
        polarization: 'H', waist: 800, mSquared: 1,
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, 800, AXIS),
      at('FA', fa({ rotation: 0 }) as Partial<OpticalNodeData> & { type: 'fiber_amplifier' }, 300, AXIS),
    ];
    nodes[0].data.rotation = 180;   // fire leftwards, into the amplifier
    const { warnings } = autoRoute(nodes, []);
    expect(warnings.some(w => w.nodeId === 'FA' && /feedback/i.test(w.message))).toBe(true);
  });

  it('is absent from the fixed-fraction power table, like the other amplifier', () => {
    expect(transmissionFraction(fa())).toBe(1);
  });
});

// ── Wiring ────────────────────────────────────────────────────────────────────

describe('wiring', () => {
  it('is offered in the palette among the sources', () => {
    const entry = PALETTE.find(e => e.type === 'fiber_amplifier')!;
    expect(entry).toBeDefined();
    expect(entry.category).toBe('source');
    const data = entry.defaultData as Record<string, unknown>;
    expect(data.wavelength).toBe(1064);
    expect(data.outputPower).toBe(2000);
    expect(data.waist).toBe(1200);
    expect(data.current).toBe(3000);
  });

  it('shares the free-space amplifier box, so the two read as siblings', () => {
    expect(artworkOf('fiber_amplifier')).toEqual(artworkOf('optical_amplifier'));
    expect(getNodeGeometry('fiber_amplifier', 90).width).toBe(44);
  });

  it('trims an arriving beam at its own face, and never its departure', () => {
    // Departure is untrimmed because the ray already starts on the face; an arrival is
    // trimmed like any body, or it would be drawn inside the case.
    expect(faceHalf('fiber_amplifier', 0, unitAt(0))).toBe(32);
    const { segments } = autoRoute(aloneOnTheBench(), []);
    expect(segments[0].x1).toBeCloseTo(200 + 32, 6);
  });
});
