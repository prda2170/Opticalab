import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { componentOutputs, isEmitter, MIN_POWER_MW } from '../propagate';
import { autoRoute } from '../autoRoute';
import { transmissionFraction } from '../power';
import { PALETTE } from '../../utils/palette';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import { formatCurrent, formatSourcePower } from '../../utils/units';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const amp = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'optical_amplifier', name: 'TA', category: 'source',
  outputPower: 1000, current: 2000, ...over,
} as OpticalNodeData);

const seed = (over: Partial<BeamState> = {}): BeamState => ({
  wavelength: 780,
  detuningHz: 0,
  power: 30,
  polarization: { type: 'H' },
  ...over,
});

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const AXIS = 33;
const out = (node: OpticalNodeData, beam: BeamState) => componentOutputs(beam, node)[0];

const laser = (over: Record<string, unknown> = {}) => ({
  type: 'laser_source', category: 'source', name: 'L1',
  wavelength: 780, outputPower: 30, polarization: 'H', waist: 800, mSquared: 1, ...over,
} as Partial<OpticalNodeData> & { type: 'laser_source' });

const PD = { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 } as const;

// ── Output power ──────────────────────────────────────────────────────────────

describe('componentOutputs — optical amplifier', () => {
  it('delivers the stated output power, whatever the seed', () => {
    const a = amp({ outputPower: 900 });
    expect(out(a, seed({ power: 5 })).beam.power).toBeCloseTo(900, 6);
    expect(out(a, seed({ power: 30 })).beam.power).toBeCloseTo(900, 6);
    expect(out(a, seed({ power: 200 })).beam.power).toBeCloseTo(900, 6);
  });

  it('outputs nothing without a seed — ASE is not modelled', () => {
    expect(out(amp(), seed({ power: 0 })).beam.power).toBe(0);
  });

  it('is not resurrected by a numerically dead beam', () => {
    // A beam that has decayed below the tracer's floor does not count as a seed.
    expect(out(amp(), seed({ power: MIN_POWER_MW / 10 })).beam.power).toBe(0);
    expect(out(amp(), seed({ power: MIN_POWER_MW })).beam.power).toBeCloseTo(1000, 6);
  });

  it('refuses a negative output power rather than draining the beam', () => {
    expect(out(amp({ outputPower: -50 }), seed()).beam.power).toBe(0);
  });

  it('emits a single transmitted port on the entry lane', () => {
    const ports = componentOutputs(seed(), amp());
    expect(ports).toHaveLength(1);
    expect(ports[0].handle).toBe('out');
    expect(ports[0].kind).toBe('transmit');
    expect(ports[0].lane).toBe(0);
  });

  it('is not an emitter: it is a gain stage, not a source of its own', () => {
    expect(isEmitter('optical_amplifier')).toBe(false);
    expect(isEmitter('laser_source')).toBe(true);
  });
});

// ── Everything but power passes through ───────────────────────────────────────

describe('optical amplifier — same frequency, same mode', () => {
  it('leaves the wavelength and RF detuning alone', () => {
    const o = out(amp(), seed({ wavelength: 1064, detuningHz: 80e6 })).beam;
    expect(o.wavelength).toBe(1064);
    expect(o.detuningHz).toBe(80e6);
  });

  it('leaves the polarization alone', () => {
    expect(out(amp(), seed({ polarization: { type: 'V' } })).beam.polarization).toEqual({ type: 'V' });
  });

  it('leaves the Gaussian mode alone — it is a gain medium, not a lens', () => {
    const nodes = [
      at('L1', laser(), 45, AXIS),
      at('TA', amp() as Partial<OpticalNodeData> & { type: 'optical_amplifier' }, 400, AXIS),
      at('PD', PD, 800, AXIS),
    ];
    const { segments } = autoRoute(nodes, []);
    const into  = segments.find(s => s.targetId === 'TA')!;
    const outOf = segments.find(s => s.sourceId === 'TA')!;

    // The waist that seeds the amplifier is the waist that leaves it.
    expect(outOf.beam.w0).toBeCloseTo(into.beam.w0!, 9);
    expect(outOf.beam.wavelength).toBe(into.beam.wavelength);
  });
});

// ── In a layout ───────────────────────────────────────────────────────────────

describe('optical amplifier — in a layout', () => {
  it('puts its stated power on the beam downstream', () => {
    const nodes = [
      at('L1', laser({ outputPower: 20 }), 45, AXIS),
      at('TA', amp({ outputPower: 500 }) as Partial<OpticalNodeData> & { type: 'optical_amplifier' }, 400, AXIS),
      at('PD', PD, 900, AXIS),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(nodeBeams.get('TA')!.power).toBeCloseTo(20, 6);   // seed arriving
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(500, 6);  // what leaves the amplifier
  });

  it('does not care how much seed it gets, only that it gets some', () => {
    const build = (seedPower: number) => {
      const nodes = [
        at('L1', laser({ outputPower: seedPower }), 45, AXIS),
        at('TA', amp({ outputPower: 1000 }) as Partial<OpticalNodeData> & { type: 'optical_amplifier' }, 400, AXIS),
        at('PD', PD, 900, AXIS),
      ];
      return autoRoute(nodes, []).nodeBeams.get('PD')!.power;
    };
    expect(build(5)).toBeCloseTo(1000, 6);
    expect(build(40)).toBeCloseTo(1000, 6);
  });

  it('goes dark when its seed is blocked', () => {
    const nodes = [
      at('L1', laser(), 45, AXIS),
      at('BB', { type: 'beam_block', category: 'conditioning' }, 250, AXIS),
      at('TA', amp() as Partial<OpticalNodeData> & { type: 'optical_amplifier' }, 400, AXIS),
      at('PD', PD, 900, AXIS),
    ];
    const { segments } = autoRoute(nodes, []);
    expect(segments.find(s => s.sourceId === 'TA')).toBeUndefined();
  });

  it('passes the beam straight through, on the same axis', () => {
    const nodes = [
      at('L1', laser(), 45, AXIS),
      at('TA', amp() as Partial<OpticalNodeData> & { type: 'optical_amplifier' }, 400, AXIS),
      at('PD', PD, 900, AXIS),
    ];
    const outOf = autoRoute(nodes, []).segments.find(s => s.sourceId === 'TA')!;
    expect(outOf.targetId).toBe('PD');
    expect(outOf.y1).toBeCloseTo(AXIS, 6);
    expect(outOf.y2).toBeCloseTo(AXIS, 6);
  });
});

// ── Drive current: bookkeeping only ───────────────────────────────────────────

describe('drive current', () => {
  it('changes nothing about the beam', () => {
    const quiet = out(amp({ current: 0 }), seed()).beam;
    const hot   = out(amp({ current: 3000 }), seed()).beam;
    expect(hot.power).toBeCloseTo(quiet.power, 9);
    expect(hot.wavelength).toBe(quiet.wavelength);
  });

  it('is optional, so layouts written before it still route', () => {
    const bare = amp() as Record<string, unknown>;
    delete bare.current;
    expect(out(bare as OpticalNodeData, seed()).beam.power).toBeCloseTo(1000, 6);
  });

  it('reads in mA for a diode and amps for an amplifier', () => {
    expect(formatCurrent(150)).toBe('150 mA');
    expect(formatCurrent(999)).toBe('999 mA');
    expect(formatCurrent(2000)).toBe('2.00 A');
    expect(formatCurrent(2350)).toBe('2.35 A');
    expect(formatCurrent(0)).toBe('0 mA');
  });

  it('quotes a source power in mW up to a watt', () => {
    expect(formatSourcePower(30)).toBe('30 mW');
    expect(formatSourcePower(999)).toBe('999 mW');
    expect(formatSourcePower(1000)).toBe('1.00 W');
    expect(formatSourcePower(1500)).toBe('1.50 W');
  });

  it('is recorded on both a laser and an amplifier by default', () => {
    const l = PALETTE.find(e => e.type === 'laser_source')!.defaultData as Record<string, unknown>;
    const a = PALETTE.find(e => e.type === 'optical_amplifier')!.defaultData as Record<string, unknown>;
    expect(l.current).toBe(150);
    expect(a.current).toBe(2000);
  });

  it('does not change what a laser emits', () => {
    const build = (current: number) => {
      const nodes = [
        at('L1', laser({ outputPower: 40, current }), 45, AXIS),
        at('PD', PD, 600, AXIS),
      ];
      return autoRoute(nodes, []).nodeBeams.get('PD')!.power;
    };
    expect(build(0)).toBeCloseTo(build(250), 9);
  });
});

// ── Wiring ────────────────────────────────────────────────────────────────────

describe('optical amplifier — wiring', () => {
  it('is offered in the palette alongside the laser', () => {
    const entry = PALETTE.find(e => e.type === 'optical_amplifier')!;
    expect(entry).toBeDefined();
    expect(entry.category).toBe('source');
    const data = entry.defaultData as Record<string, unknown>;
    expect(data.outputPower).toBe(1000);
    expect(data.name).toBe('TA');
    // The gain/saturation parameterisation is gone.
    expect(data.gain).toBeUndefined();
    expect(data.saturatedPower).toBeUndefined();
  });

  it('has geometry, so the router can trim the beam to its facets', () => {
    const g = getNodeGeometry('optical_amplifier');
    expect(g.width).toBe(64);
    expect(g.height).toBe(44);
    // A symbol, so it rotates to face the beam — the taper is directional.
    expect(g.symbolType).toBe('symbol');
    expect(getNodeGeometry('optical_amplifier', 90).width).toBe(44);
  });

  it('is deliberately absent from the fixed-fraction power table', () => {
    // Its output bears no fixed relation to its input, so it cannot be a factor.
    expect(transmissionFraction(amp())).toBe(1);
  });
});
