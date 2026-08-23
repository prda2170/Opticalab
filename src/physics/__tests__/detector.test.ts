import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { detectorVolts, formatVoltage, detectorSignalLabel, incidentPower, detectorBeat } from '../detector';
import type { BeamState } from '../../types/beam';
import { autoRoute } from '../autoRoute';
import { PALETTE } from '../../utils/palette';
import type { OpticalNodeData } from '../../types/components';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const pd = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'photodiode', name: 'PD', category: 'detection',
  bandwidth: 100, signalFactor: 1, ...over,
} as OpticalNodeData);

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const AXIS = 33;

const beam = (power: number, over: Partial<BeamState> = {}): BeamState => ({
  wavelength: 780, detuningHz: 0, power, polarization: { type: 'H' }, ...over,
});

// ── Volts from power ──────────────────────────────────────────────────────────

describe('detectorVolts', () => {
  it('multiplies incident power by the signal factor', () => {
    expect(detectorVolts(pd({ signalFactor: 1 }), 12.5)).toBeCloseTo(12.5, 9);
    expect(detectorVolts(pd({ signalFactor: 0.025 }), 100)).toBeCloseTo(2.5, 9);  // 50 Ω
    expect(detectorVolts(pd({ signalFactor: 5 }), 0.4)).toBeCloseTo(2, 9);        // 10 kΩ TIA
  });

  it('is null with no beam on it', () => {
    expect(detectorVolts(pd(), null)).toBeNull();
    expect(detectorVolts(pd(), undefined)).toBeNull();
  });

  it('is null for components that are not monitor photodiodes', () => {
    expect(detectorVolts({ type: 'apd', name: 'APD', category: 'detection', gain: 100, bandwidth: 50 } as OpticalNodeData, 10)).toBeNull();
    expect(detectorVolts({ type: 'camera', name: 'CCD', category: 'detection', resolution: '1', pixelSize: 1, frameRate: 1 } as OpticalNodeData, 10)).toBeNull();
  });

  it('is null when the factor is not a number', () => {
    expect(detectorVolts(pd({ signalFactor: NaN }), 10)).toBeNull();
  });

  it('reports zero for a beam that carries nothing', () => {
    expect(detectorVolts(pd(), 0)).toBe(0);
  });
});

describe('formatVoltage', () => {
  it('steps down through the units a scope would show', () => {
    expect(formatVoltage(2500)).toBe('2.50 kV');
    expect(formatVoltage(12.5)).toBe('12.50 V');
    expect(formatVoltage(1)).toBe('1.00 V');
    expect(formatVoltage(0.25)).toBe('250.0 mV');
    expect(formatVoltage(0.0042)).toBe('4.20 mV');
    expect(formatVoltage(2.5e-5)).toBe('25 µV');
    expect(formatVoltage(0)).toBe('0 V');
  });
});

describe('detectorSignalLabel', () => {
  it('shows nothing unless the component asks for it', () => {
    expect(detectorSignalLabel(pd(), 10)).toBeNull();
    expect(detectorSignalLabel(pd({ showSignal: false }), 10)).toBeNull();
    expect(detectorSignalLabel(pd({ showSignal: true }), 10)).toBe('10.00 V');
  });

  it('marks a detector with nothing on it rather than reading zero', () => {
    expect(detectorSignalLabel(pd({ showSignal: true }), null)).toBe('— V');
  });

  it('shows nothing for a component that has no signal factor', () => {
    expect(detectorSignalLabel(
      { type: 'apd', name: 'APD', category: 'detection', gain: 1, bandwidth: 1, showSignal: true } as OpticalNodeData,
      10,
    )).toBeNull();
  });
});

// ── Through a layout ──────────────────────────────────────────────────────────

describe('signal in a real layout', () => {
  it('reads the power that actually lands on the detector', () => {
    const nodes = [
      at('L1', {
        type: 'laser_source', category: 'source', name: 'L1',
        wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, AXIS),
      at('ND', { type: 'nd_filter', category: 'conditioning', od: 1 }, 400, AXIS),
      at('PD', pd({ signalFactor: 2, showSignal: true }) as Partial<OpticalNodeData> & { type: 'photodiode' }, 800, AXIS),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    const power = nodeBeams.get('PD')!.power;

    expect(power).toBeCloseTo(10, 6);                        // 100 mW through OD 1
    expect(detectorVolts(nodes[2].data, power)).toBeCloseTo(20, 6);   // × 2 V/mW
    expect(detectorSignalLabel(nodes[2].data, power)).toBe('20.00 V');
  });

  it('scales with the beam that reaches it, not the source power', () => {
    const build = (od: number) => {
      const nodes = [
        at('L1', {
          type: 'laser_source', category: 'source', name: 'L1',
          wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
        } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, AXIS),
        at('ND', { type: 'nd_filter', category: 'conditioning', od }, 400, AXIS),
        at('PD', pd({ showSignal: true }) as Partial<OpticalNodeData> & { type: 'photodiode' }, 800, AXIS),
      ];
      const { nodeBeams } = autoRoute(nodes, []);
      return detectorSignalLabel(nodes[2].data, nodeBeams.get('PD')!.power);
    };
    expect(build(0)).toBe('100.00 V');
    expect(build(2)).toBe('1.00 V');
    expect(build(4)).toBe('10.0 mV');   // ~3 significant figures at every magnitude
  });
});

// ── Two beams on one photodiode ───────────────────────────────────────────────

describe('incidentPower', () => {
  it('adds up every beam on the detector', () => {
    expect(incidentPower([beam(10), beam(2.5)])).toBeCloseTo(12.5, 9);
    expect(incidentPower([beam(1), beam(1), beam(1)])).toBeCloseTo(3, 9);
  });

  it('is the single beam when only one arrives', () => {
    expect(incidentPower([beam(7)])).toBeCloseTo(7, 9);
  });

  it('is null when nothing arrives, so "dark" stays distinct from "zero"', () => {
    expect(incidentPower([])).toBeNull();
    expect(incidentPower(undefined)).toBeNull();
    expect(incidentPower(null)).toBeNull();
  });
});

describe('two beams arriving at one photodiode', () => {
  /** L1 → PD from the left, L2 → PD from above. Both land on the active area. */
  const twoOnOne = (pA: number, pB: number, over: Partial<OpticalNodeData> = {}) => {
    const nodes = [
      at('L1', {
        type: 'laser_source', category: 'source', name: 'L1',
        wavelength: 780, outputPower: pA, polarization: 'H', waist: 800, mSquared: 1,
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, 120, 300),
      at('L2', {
        type: 'laser_source', category: 'source', name: 'L2', rotation: 90,
        wavelength: 780, outputPower: pB, polarization: 'H', waist: 800, mSquared: 1,
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, 600, 120),
      at('PD', pd({ signalFactor: 1, showSignal: true, ...over }) as Partial<OpticalNodeData> & { type: 'photodiode' }, 600, 300),
    ];
    return autoRoute(nodes, []);
  };

  it('records both arrivals, not just the strongest', () => {
    const { nodeArrivals } = twoOnOne(30, 10);
    const arrivals = nodeArrivals.get('PD')!;
    expect(arrivals).toHaveLength(2);
    expect(arrivals.map(b => Math.round(b.power)).sort((x, y) => x - y)).toEqual([10, 30]);
  });

  it('reads the total power, not one beam', () => {
    const { nodeArrivals } = twoOnOne(30, 10);
    const arrivals = nodeArrivals.get('PD')!;
    expect(incidentPower(arrivals)).toBeCloseTo(40, 6);
    expect(detectorSignalLabel(pd({ signalFactor: 1, showSignal: true }), incidentPower(arrivals))).toBe('40.00 V');
  });

  it('still exposes the strongest arrival for optics that act on one beam', () => {
    const { nodeBeams, nodeArrivals } = twoOnOne(30, 10);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(30, 6);
    expect(incidentPower(nodeArrivals.get('PD'))).toBeCloseTo(40, 6);
  });

  it('draws both beams all the way to the detector', () => {
    const { segments } = twoOnOne(30, 10);
    const onto = segments.filter(s => s.targetId === 'PD');
    expect(onto).toHaveLength(2);
    expect(onto.every(s => !s.free)).toBe(true);
    // One arrives horizontally, one vertically.
    expect(onto.some(s => Math.abs(s.y2 - s.y1) < 1e-6)).toBe(true);
    expect(onto.some(s => Math.abs(s.x2 - s.x1) < 1e-6)).toBe(true);
  });

  it('gives both beams an edge into the detector, so xyflow keeps them', () => {
    const { autoEdges } = twoOnOne(30, 10);
    const into = autoEdges.filter(e => e.target === 'PD');
    expect(into).toHaveLength(2);
    expect(into.every(e => e.targetHandle === 'in')).toBe(true);
    expect(new Set(into.map(e => e.id)).size).toBe(2);   // distinct ids
  });

  it('does not let the second beam reposition the detector', () => {
    const { snaps } = twoOnOne(30, 10);
    // Placed exactly on both beams already, so nothing needs moving.
    expect(snaps.has('PD')).toBe(false);
  });

  it('scales with both beams: dimming either one lowers the reading', () => {
    const read = (a: number, b: number) =>
      incidentPower(twoOnOne(a, b).nodeArrivals.get('PD'))!;
    expect(read(30, 10)).toBeCloseTo(40, 6);
    expect(read(30, 5)).toBeCloseTo(35, 6);
    expect(read(15, 10)).toBeCloseTo(25, 6);
  });
});

describe('detectorBeat', () => {
  const twoBeams = (dA: number, dB: number, lamB = 780) => [
    beam(1, { detuningHz: dA }),
    beam(1, { wavelength: lamB, detuningHz: dB }),
  ];

  it('reports the frequency difference between two beams', () => {
    const b = detectorBeat(pd({ bandwidth: 100 }), twoBeams(0, 80e6))!;
    expect(b.hz).toBeCloseTo(80e6, 0);
    expect(b.withinBandwidth).toBe(true);    // 80 MHz on a 100 MHz diode
  });

  it('knows when the beat is faster than the detector', () => {
    const b = detectorBeat(pd({ bandwidth: 50 }), twoBeams(0, 80e6))!;
    expect(b.withinBandwidth).toBe(false);
  });

  it('counts the carrier difference too, not just the RF shifts', () => {
    const b = detectorBeat(pd({ bandwidth: 100 }), twoBeams(0, 0, 1064))!;
    expect(b.hz).toBeGreaterThan(1e14);      // hundreds of THz apart
    expect(b.withinBandwidth).toBe(false);
  });

  it('is null when there is nothing to beat', () => {
    expect(detectorBeat(pd(), [beam(1)])).toBeNull();          // one beam
    expect(detectorBeat(pd(), twoBeams(0, 0))).toBeNull();     // identical frequency
    expect(detectorBeat(pd(), [])).toBeNull();
  });

  it('picks the closest pair when three beams land', () => {
    const b = detectorBeat(pd({ bandwidth: 100 }), [
      beam(1, { detuningHz: 0 }),
      beam(1, { detuningHz: 80e6 }),
      beam(1, { detuningHz: 90e6 }),
    ])!;
    expect(b.hz).toBeCloseTo(10e6, 0);       // the 80/90 MHz pair
  });

  it('is left out of the reading — powers add, fields do not', () => {
    // Two 1 mW beams read 2 mW, with no interference term either way.
    expect(incidentPower(twoBeams(0, 80e6))).toBeCloseTo(2, 9);
  });
});

describe('palette', () => {
  it('gives a photodiode a signal factor rather than a responsivity', () => {
    const entry = PALETTE.find(e => e.type === 'photodiode')!;
    const data = entry.defaultData as Record<string, unknown>;
    expect(data.signalFactor).toBe(1);
    expect(data.responsivity).toBeUndefined();
  });

  it('leaves the readout off by default, like the name label', () => {
    const entry = PALETTE.find(e => e.type === 'photodiode')!;
    expect((entry.defaultData as Record<string, unknown>).showSignal).toBeUndefined();
  });
});
