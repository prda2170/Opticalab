import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { componentOutputs, outputPortFor } from '../propagate';
import { bodyAxis, componentLanes, laneNormal, ORDER_SEPARATION_PX } from '../lanes';
import { BEAM_SNAP_DIST } from '../autoRoute';
import { formatDetuning, opticalFrequencyHz, outputWavelength, C_LIGHT } from '../wavelength';
import { autoRoute } from '../autoRoute';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const inBeam: BeamState = { wavelength: 780, power: 100, polarization: { type: 'H' } };

/** An AOM with datasheet-ish defaults: 80 MHz, η = 80 %, T = 98 %. */
function aom(over: Partial<OpticalNodeData> = {}): OpticalNodeData {
  return {
    type: 'aom', name: 'AOM', category: 'modulation',
    rfFrequency: 80, rfPower: 33, diffractionEfficiency: 80, transmission: 98,
    activeOrder: '+1',
    ...over,
  } as OpticalNodeData;
}

const byHandle = (ports: ReturnType<typeof componentOutputs>, h: string) => ports.find(p => p.handle === h)!;

// ── Detuning formatting ───────────────────────────────────────────────────────

describe('formatDetuning', () => {
  it('formats each magnitude with an explicit sign', () => {
    expect(formatDetuning(80e6)).toBe('+80 MHz');
    expect(formatDetuning(-80e6)).toBe('-80 MHz');
    expect(formatDetuning(160e6)).toBe('+160 MHz');
    expect(formatDetuning(1.5e9)).toBe('+1.5 GHz');
    expect(formatDetuning(-2.5e3)).toBe('-2.5 kHz');
    expect(formatDetuning(250)).toBe('+250 Hz');
    expect(formatDetuning(6.834e9)).toBe('+6.834 GHz');   // Rb ground-state splitting
  });

  it('renders nothing for no detuning', () => {
    expect(formatDetuning(0)).toBe('');
    expect(formatDetuning(undefined)).toBe('');
  });
});

describe('carrier vs detuning', () => {
  it('leaves the carrier wavelength alone at an AOM', () => {
    expect(outputWavelength(780, aom())).toBe(780);
  });

  it('still converts the carrier at a doubling crystal', () => {
    expect(outputWavelength(780, {
      type: 'shg_crystal', name: 'SHG', category: 'steering',
      geometry: 'bulk', temperature: 40, conversionEfficiency: 30,
    } as OpticalNodeData)).toBe(390);
  });

  it('an 80 MHz shift is far below the resolution of a nm carrier', () => {
    // Justifies keeping the two quantities separate: expressing +80 MHz as a
    // wavelength change is a 2e-7 relative perturbation.
    const f = opticalFrequencyHz(780);
    const shifted = (C_LIGHT / (f + 80e6)) * 1e9;
    expect(Math.abs(shifted - 780)).toBeLessThan(2e-4);
    expect(f).toBeCloseTo(3.8435e14, -10);
  });
});

// ── AOM ports ─────────────────────────────────────────────────────────────────

describe('componentOutputs — AOM', () => {
  it('emits a diffracted order and a dumped 0th order', () => {
    const ports = componentOutputs(inBeam, aom());
    expect(ports.map(p => p.handle)).toEqual(['order1', 'order0']);

    const first = byHandle(ports, 'order1');
    expect(first.dumped).toBeFalsy();
    expect(first.beam.power).toBeCloseTo(80, 6);        // P·η
    expect(first.beam.detuningHz).toBe(80e6);

    const zeroth = byHandle(ports, 'order0');
    expect(zeroth.dumped).toBe(true);
    expect(zeroth.beam.power).toBeCloseTo(18, 6);       // P·(T − η)
    expect(zeroth.beam.detuningHz).toBeUndefined();     // undiffracted: no shift
  });

  it('accounts for all the incident power', () => {
    const ports = componentOutputs(inBeam, aom());
    const routed = ports.reduce((s, p) => s + p.beam.power, 0);
    const lost = inBeam.power * (1 - 0.98);             // P·(1 − T)
    expect(routed + lost).toBeCloseTo(inBeam.power, 6);
  });

  it('shifts down for the −1 order', () => {
    const ports = componentOutputs(inBeam, aom({ activeOrder: '-1' } as Partial<OpticalNodeData>));
    expect(byHandle(ports, 'order1').beam.detuningHz).toBe(-80e6);
  });

  it('propagates the undiffracted beam when the 0th order is the active one', () => {
    const ports = componentOutputs(inBeam, aom({ activeOrder: '0' } as Partial<OpticalNodeData>));
    expect(ports).toHaveLength(1);
    expect(ports[0].handle).toBe('order0');
    expect(ports[0].dumped).toBe(false);
    expect(ports[0].beam.power).toBeCloseTo(98, 6);     // P·T
    expect(ports[0].beam.detuningHz).toBeUndefined();
  });

  it('keeps the first-order power of layouts saved before transmission was read', () => {
    // Legacy default was T = η = 80 %. The diffracted order is unchanged; only the
    // 0th order reads zero (nudging the user to set a real transmission).
    const ports = componentOutputs(inBeam, aom({ transmission: 80 } as Partial<OpticalNodeData>));
    expect(byHandle(ports, 'order1').beam.power).toBeCloseTo(80, 6);
    expect(byHandle(ports, 'order0').beam.power).toBeCloseTo(0, 6);
  });

  it('clamps the 0th order at zero when efficiency exceeds transmission', () => {
    const ports = componentOutputs(inBeam, aom({ diffractionEfficiency: 90, transmission: 80 } as Partial<OpticalNodeData>));
    expect(byHandle(ports, 'order0').beam.power).toBe(0);
    expect(byHandle(ports, 'order1').beam.power).toBeCloseTo(90, 6);
  });

  it('applies insertion loss to both orders', () => {
    const ports = componentOutputs(inBeam, aom({ loss: 50 } as Partial<OpticalNodeData>));
    expect(byHandle(ports, 'order1').beam.power).toBeCloseTo(40, 6);
    expect(byHandle(ports, 'order0').beam.power).toBeCloseTo(9, 6);
  });

  it('accumulates detuning through a chain', () => {
    const afterUp   = byHandle(componentOutputs(inBeam,  aom()), 'order1').beam;
    const afterDown = byHandle(componentOutputs(afterUp, aom({ activeOrder: '-1' } as Partial<OpticalNodeData>)), 'order1').beam;
    expect(afterUp.detuningHz).toBe(80e6);
    expect(afterDown.detuningHz).toBe(0);              // +80 then −80 cancels
    const afterUp2 = byHandle(componentOutputs(afterUp, aom()), 'order1').beam;
    expect(afterUp2.detuningHz).toBe(160e6);           // two single passes stack
  });

  it('doubles accumulated detuning at a doubling crystal', () => {
    const shifted = byHandle(componentOutputs(inBeam, aom()), 'order1').beam;
    const ports = componentOutputs(shifted, {
      type: 'shg_crystal', name: 'SHG', category: 'steering',
      geometry: 'bulk', temperature: 40, conversionEfficiency: 30,
    } as OpticalNodeData);
    const doubled = byHandle(ports, 'shg').beam;
    expect(doubled.wavelength).toBe(390);
    expect(doubled.detuningHz).toBe(160e6);
    // The residual fundamental keeps the original shift.
    expect(byHandle(ports, 'fund').beam.detuningHz).toBe(80e6);
  });

  it('treats an AOD as a +1 device with the same bookkeeping', () => {
    const ports = componentOutputs(inBeam, {
      type: 'aod', name: 'AOD', category: 'modulation',
      rfFrequency: 80, rfPower: 33, diffractionEfficiency: 70, transmission: 98,
    } as OpticalNodeData);
    expect(byHandle(ports, 'order1').beam.power).toBeCloseTo(70, 6);
    expect(byHandle(ports, 'order1').beam.detuningHz).toBe(80e6);
    expect(byHandle(ports, 'order0').beam.power).toBeCloseTo(28, 6);
  });

  it('never resolves a handle-less wire to the dumped port', () => {
    const port = outputPortFor(inBeam, aom(), null)!;
    expect(port.handle).toBe('order1');
    expect(port.dumped).toBeFalsy();
    // An explicit handle still works.
    expect(outputPortFor(inBeam, aom(), 'order0')!.dumped).toBe(true);
  });
});

// ── Lanes ─────────────────────────────────────────────────────────────────────

describe('lanes', () => {
  it('gives ordinary components a single axis through their centre', () => {
    for (const type of ['dielectric_mirror', 'pbs', 'hwp', 'photodiode', 'plano_convex'] as const) {
      expect(componentLanes({ type, name: type, category: 'steering' } as OpticalNodeData)).toEqual([0]);
    }
  });

  it('gives an AOM a centre lane plus a dump lane one inch off', () => {
    expect(componentLanes(aom())).toEqual([0, ORDER_SEPARATION_PX]);
    // The dump lane follows the order the cell is set up for.
    expect(componentLanes(aom({ activeOrder: '-1' } as Partial<OpticalNodeData>))).toEqual([0, -ORDER_SEPARATION_PX]);
  });

  it('separates lanes by more than the snap distance can bridge', () => {
    // Otherwise a beam on one lane would capture components sitting on the other.
    expect(ORDER_SEPARATION_PX).toBeGreaterThan(2 * BEAM_SNAP_DIST);
  });

  it('measures lane offsets along the component, not the beam', () => {
    expect(bodyAxis(0)).toEqual({ dx: 1, dy: 0 });
    expect(bodyAxis(90)).toEqual({ dx: 0, dy: 1 });
    expect(bodyAxis(180)).toEqual({ dx: -1, dy: 0 });
    expect(bodyAxis(270)).toEqual({ dx: 0, dy: -1 });
    // A component facing +x has its lanes stacked in +y, whichever way a beam runs.
    // (Was `dx: -0` — negating a zero component; `perpOf` now cleans that.)
    expect(laneNormal(0)).toEqual({ dx: 0, dy: 1 });
  });
});

describe('componentOutputs — AOM lanes', () => {
  it('keeps the diffracted order on the entry lane and peels the 0th order off', () => {
    const ports = componentOutputs(inBeam, aom(), { entryLane: 0 });
    expect(byHandle(ports, 'order1').lane).toBe(0);
    expect(byHandle(ports, 'order0').lane).toBe(1);
  });

  it('mirrors that when the beam arrives on the dump lane', () => {
    // The double-pass case: a return beam retraces the entry lane either way.
    const ports = componentOutputs(inBeam, aom(), { entryLane: 1 });
    expect(byHandle(ports, 'order1').lane).toBe(1);
    expect(byHandle(ports, 'order0').lane).toBe(0);
  });

  it('keeps the undiffracted beam straight ahead when it is the active order', () => {
    const ports = componentOutputs(inBeam, aom({ activeOrder: '0' } as Partial<OpticalNodeData>), { entryLane: 0 });
    expect(ports).toHaveLength(1);
    expect(ports[0].lane).toBe(0);
  });

  it('defaults to the centre lane with no context', () => {
    expect(byHandle(componentOutputs(inBeam, aom()), 'order1').lane).toBe(0);
  });
});

// ── Through the router ────────────────────────────────────────────────────────

describe('autoRoute — AOM', () => {
  function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
    const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
    const g = getNodeGeometry(full.type, full.rotation ?? 0);
    return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
  }
  const AXIS_Y = 33;
  const laserNode = at('L1', {
    type: 'laser_source', category: 'source', name: 'L1',
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
  } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, AXIS_Y);
  const pd = (id: string, cx: number, cy = AXIS_Y) =>
    at(id, { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, cx, cy);

  it('routes only the diffracted order downstream', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y), pd('PD', 800)];
    const { segments, beams, nodeBeams } = autoRoute(nodes, []);

    // One beam in, one beam out — the dumped order produces no segment.
    expect(segments.map(s => s.targetId).sort()).toEqual(['AOM', 'PD']);
    const out = segments.find(s => s.sourceId === 'AOM')!;
    expect(out.sourceHandle).toBe('order1');
    expect(out.beam.power).toBeCloseTo(80, 6);
    expect(out.beam.detuningHz).toBe(80e6);
    expect(beams.get(out.id)!.detuningHz).toBe(80e6);
    expect(nodeBeams.get('PD')!.detuningHz).toBe(80e6);
    // The beam arriving at the AOM is of course unshifted.
    expect(nodeBeams.get('AOM')!.detuningHz).toBeUndefined();
  });

  it('reports the dumped power without routing it', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y)];
    const { segments, nodeBeams } = autoRoute(nodes, []);
    // Only the diffracted order leaves (as a free beam); nothing on the 0th.
    const leaving = segments.filter(s => s.sourceId === 'AOM');
    expect(leaving).toHaveLength(1);

    // …but the dump is still accounted for, via the port table.
    const dumped = byHandle(componentOutputs(nodeBeams.get('AOM')!, aom()), 'order0');
    expect(dumped.beam.power).toBeCloseTo(18, 6);
  });

  it('carries the shift through the rest of the layout', () => {
    const nodes = [
      laserNode,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('M', { type: 'dielectric_mirror', reflectivity: 100, rotation: 0 }, 700, AXIS_Y),
      pd('PD', 700, AXIS_Y - 200),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(nodeBeams.get('PD')!.detuningHz).toBe(80e6);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(80, 6);
  });

  it('stacks two AOMs in series', () => {
    const nodes = [
      laserNode,
      at('A1', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('A2', aom({ rfFrequency: 110 }) as Partial<OpticalNodeData> & { type: 'aom' }, 700, AXIS_Y),
      pd('PD', 1000),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(nodeBeams.get('PD')!.detuningHz).toBe(190e6);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(100 * 0.8 * 0.8, 6);
  });

  it('passes the undiffracted beam through when the 0th order is active', () => {
    const nodes = [
      laserNode,
      at('AOM', aom({ activeOrder: '0' }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      pd('PD', 800),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);
    const out = segments.find(s => s.sourceId === 'AOM')!;
    expect(out.sourceHandle).toBe('order0');
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(98, 6);
    expect(nodeBeams.get('PD')!.detuningHz).toBeUndefined();
  });

  // ── Lanes through the router ────────────────────────────────────────────────

  const DUMP_Y = AXIS_Y + ORDER_SEPARATION_PX;

  it('finds an AOM already sitting centred on a beam', () => {
    // Lane 0 is the centre, so lanes must not break existing layouts.
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y), pd('PD', 800)];
    const { segments, snaps } = autoRoute(nodes, []);
    expect(segments.some(s => s.targetId === 'AOM')).toBe(true);
    // Nothing needs moving: the centre is already on the beam.
    expect(snaps.get('AOM')).toBeUndefined();
  });

  it('keeps the diffracted order on the entry axis', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y), pd('PD', 800)];
    const { segments } = autoRoute(nodes, []);
    const out = segments.find(s => s.sourceHandle === 'order1')!;
    expect(out.y1).toBeCloseTo(AXIS_Y, 6);
    expect(out.y2).toBeCloseTo(AXIS_Y, 6);
    expect(out.targetId).toBe('PD');
  });

  it('routes the 0th order onto its own lane when asked', () => {
    const nodes = [
      laserNode,
      at('AOM', aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    expect(zeroth).toBeDefined();
    expect(zeroth.y1).toBeCloseTo(DUMP_Y, 6);
    expect(zeroth.y2).toBeCloseTo(DUMP_Y, 6);
    expect(zeroth.beam.power).toBeCloseTo(18, 6);
    // It starts exactly at the cell's exit face, not its centre. The icon's peel-off
    // line is drawn to this same point, so the two must not drift apart — and it is
    // why the body no longer has to be tall enough to contain the dump lane.
    const g = getNodeGeometry('aom');
    expect(zeroth.x1).toBeCloseTo(400 + g.width / 2, 6);
    expect(Math.abs(DUMP_Y - AXIS_Y)).toBeGreaterThan(g.height / 2);   // lane is outside the body
  });

  it('emits no 0th-order beam while it is blocked at the cell', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y)];
    const { segments } = autoRoute(nodes, []);
    expect(segments.some(s => s.sourceHandle === 'order0')).toBe(false);
  });

  it('puts the dump lane on the other side for the −1 order', () => {
    const nodes = [
      laserNode,
      at('AOM', aom({ activeOrder: '-1', dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    expect(zeroth.y1).toBeCloseTo(AXIS_Y - ORDER_SEPARATION_PX, 6);
  });

  it('blocks the 0th order with a beam block while the diffracted order carries on', () => {
    // Case 1, end to end.
    const nodes = [
      laserNode,
      at('AOM', aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('BLOCK', { type: 'beam_block', category: 'conditioning' }, 700, DUMP_Y),
      pd('PD', 800, AXIS_Y),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);

    // The 0th order terminates on the block…
    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    expect(zeroth.targetId).toBe('BLOCK');
    expect(zeroth.free).toBe(false);
    expect(nodeBeams.get('BLOCK')!.power).toBeCloseTo(18, 6);
    // …nothing continues past it…
    expect(segments.some(s => s.sourceId === 'BLOCK')).toBe(false);
    // …and the diffracted order reaches the detector untouched.
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(80, 6);
    expect(nodeBeams.get('PD')!.detuningHz).toBe(80e6);
  });

  it('does not let one lane capture components sitting on the other', () => {
    const nodes = [
      laserNode,
      at('AOM', aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('BLOCK', { type: 'beam_block', category: 'conditioning' }, 700, DUMP_Y),
      pd('PD', 800, AXIS_Y),
    ];
    const { snaps } = autoRoute(nodes, []);
    // Neither the block nor the detector is dragged onto the other's lane.
    const bg = getNodeGeometry('beam_block');
    const bSnap = snaps.get('BLOCK');
    if (bSnap) expect(bSnap.y + bg.height / 2).toBeCloseTo(DUMP_Y, 6);
    const pg = getNodeGeometry('photodiode');
    const pSnap = snaps.get('PD');
    if (pSnap) expect(pSnap.y + pg.height / 2).toBeCloseTo(AXIS_Y, 6);
  });

  it('keeps the dump lane on the same physical side for a beam travelling backwards', () => {
    // A lane is a place on the device, so it must not flip when the beam reverses —
    // this is what makes a double-passed cell retrace its own path.
    const backwards = at('L1', {
      type: 'laser_source', category: 'source', name: 'L1', rotation: 180,
      wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
    } as Partial<OpticalNodeData> & { type: 'laser_source' }, 1000, AXIS_Y);
    const nodes = [
      backwards,
      at('AOM', aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' }, 600, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    expect(zeroth.x2).toBeLessThan(zeroth.x1);              // travelling left
    expect(zeroth.y1).toBeCloseTo(DUMP_Y, 6);               // still below centre
  });

  it('snaps a mispositioned AOM by its centre lane', () => {
    const nodes = [
      laserNode,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y + 6),
      pd('PD', 800),
    ];
    const { snaps } = autoRoute(nodes, []);
    const g = getNodeGeometry('aom');
    const snap = snaps.get('AOM')!;
    expect(snap).toBeDefined();
    expect(snap.y + g.height / 2).toBeCloseTo(AXIS_Y, 6);
  });
});
