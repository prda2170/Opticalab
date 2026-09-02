import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { componentOutputs, outputPortFor } from '../propagate';
import { bodyAxis, componentLanes, laneNormal } from '../lanes';
import { DEFAULT_DEFLECT_DEG, diffractedDirection } from '../diffraction';
import { PX_PER_INCH } from '../scale';
import { BEAM_SNAP_DIST } from '../autoRoute';
import { unitAt, angleOf, mirrorReflect } from '../geometry';
import { formatDetuning, opticalFrequencyHz, outputWavelength, C_LIGHT } from '../wavelength';
import { autoRoute } from '../autoRoute';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';
import { getNodeGeometry, occupiedBox } from '../../utils/nodeGeometry';

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
  it('emits both orders as real beams, neither of them swallowed', () => {
    const ports = componentOutputs(inBeam, aom());
    expect(ports.map(p => p.handle)).toEqual(['order1', 'order0']);

    const first = byHandle(ports, 'order1');
    expect(first.kind).toBe('diffract');               // leaves at an angle
    expect(first.dumped).toBeFalsy();
    expect(first.beam.power).toBeCloseTo(80, 6);        // P·η
    expect(first.beam.detuningHz).toBe(80e6);

    // A cell cannot absorb its own 0th order: it comes out, and you block it yourself.
    const zeroth = byHandle(ports, 'order0');
    expect(zeroth.kind).toBe('transmit');               // straight on, undeviated
    expect(zeroth.dumped).toBeFalsy();
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
    expect(ports[0].dumped).toBeFalsy();
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
    expect(byHandle(ports, 'order1').kind).toBe('diffract');
    expect(byHandle(ports, 'order0').beam.power).toBeCloseTo(28, 6);
  });

  it('resolves a handle-less wire to the diffracted order', () => {
    // Both orders are usable beams now, so this is a choice of default rather than the old
    // "never wire to something that is absorbed": the diffracted order is what a wire drawn
    // out of an AOM almost always means.
    const port = outputPortFor(inBeam, aom(), null)!;
    expect(port.handle).toBe('order1');
    // And the 0th order is reachable, and real, when asked for by name.
    const zeroth = outputPortFor(inBeam, aom(), 'order0')!;
    expect(zeroth.dumped).toBeFalsy();
    expect(zeroth.beam.power).toBeCloseTo(18, 6);
  });
});

// ── Lanes ─────────────────────────────────────────────────────────────────────

describe('lanes', () => {
  it('gives ordinary components a single axis through their centre', () => {
    for (const type of ['dielectric_mirror', 'pbs', 'hwp', 'photodiode', 'plano_convex'] as const) {
      expect(componentLanes({ type, name: type, category: 'steering' } as OpticalNodeData)).toEqual([0]);
    }
  });

  it('gives an acousto-optic cell a single axis too, now its orders differ by angle', () => {
    // The cell used to declare a second lane an inch off, because both orders were drawn as
    // parallel beams. They diverge by DEFAULT_DEFLECT_DEG instead now.
    expect(componentLanes(aom())).toEqual([0]);
    expect(componentLanes(aom({ activeOrder: '-1' } as Partial<OpticalNodeData>))).toEqual([0]);
  });

  it('separates the two orders faster than the snap distance can bridge', () => {
    // The old lanes were an inch apart everywhere, so no component could be captured by the
    // wrong order. An angle has to earn that clearance with distance instead — this is how
    // much: about two inches, which is closer than anything gets placed to a cell.
    const clearAt = (2 * BEAM_SNAP_DIST) / (2 * Math.sin((DEFAULT_DEFLECT_DEG * Math.PI) / 360));
    expect(clearAt).toBeLessThan(3 * PX_PER_INCH);
  });

  it('measures a component frame along the component, not the beam', () => {
    expect(bodyAxis(0)).toEqual({ dx: 1, dy: 0 });
    expect(bodyAxis(90)).toEqual({ dx: 0, dy: 1 });
    expect(bodyAxis(180)).toEqual({ dx: -1, dy: 0 });
    expect(bodyAxis(270)).toEqual({ dx: 0, dy: -1 });
    // A component facing +x has its transverse direction in +y, whichever way a beam runs.
    // That is the frame an acousto-optic kick lives in, so it must not follow the beam.
    // (Was `dx: -0` — negating a zero component; `perpOf` now cleans that.)
    expect(laneNormal(0)).toEqual({ dx: 0, dy: 1 });
  });
});

describe('componentOutputs — where the orders go', () => {
  it('leaves both orders on the entry axis, and turns the diffracted one by angle', () => {
    // Neither order steps sideways: they share an origin inside the crystal. What separates
    // them is `kind`, which the tracer turns into a direction.
    const ports = componentOutputs(inBeam, aom(), { entryLane: 0 });
    expect(byHandle(ports, 'order1').lane).toBe(0);
    expect(byHandle(ports, 'order0').lane).toBe(0);
    expect(byHandle(ports, 'order1').kind).toBe('diffract');
    expect(byHandle(ports, 'order0').kind).toBe('transmit');
  });

  it('keeps the undiffracted beam straight ahead when it is the active order', () => {
    const ports = componentOutputs(inBeam, aom({ activeOrder: '0' } as Partial<OpticalNodeData>), { entryLane: 0 });
    expect(ports).toHaveLength(1);
    expect(ports[0].lane).toBe(0);
    expect(ports[0].kind).toBe('transmit');
  });

  it('deflects to the side the transducer is on, whichever order is driven', () => {
    // Two independent signs: `activeOrder` is the RF drive and sets the sign of the shift,
    // `deflectSide` is which end of the crystal the transducer is bonded to. A transducer can
    // sit on either end, so a −1 shift can perfectly well leave on the clockwise side.
    const forward = unitAt(0);
    const cw  = diffractedDirection(forward, 0, aom({ deflectSide: 'cw' } as Partial<OpticalNodeData>));
    const ccw = diffractedDirection(forward, 0, aom({ deflectSide: 'ccw' } as Partial<OpticalNodeData>));
    expect(angleOf(cw)).toBeCloseTo(DEFAULT_DEFLECT_DEG, 9);
    expect(angleOf(ccw)).toBeCloseTo(360 - DEFAULT_DEFLECT_DEG, 9);

    // Driving −1 changes the shift and nothing about the geometry.
    const minus = aom({ activeOrder: '-1', deflectSide: 'cw' } as Partial<OpticalNodeData>);
    expect(angleOf(diffractedDirection(forward, 0, minus))).toBeCloseTo(DEFAULT_DEFLECT_DEG, 9);
    expect(byHandle(componentOutputs(inBeam, minus), 'order1').beam.detuningHz).toBe(-80e6);
  });

  it('defaults to the centre axis with no context', () => {
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

  /** Where the diffracted order goes from a cell at `(cx, cy)` fed along +x. */
  const diffractedFrom = (cx: number, cy: number, r: number, data = aom()) => {
    const d = diffractedDirection(unitAt(0), 0, data);
    return { x: cx + d.dx * r, y: cy + d.dy * r, dir: d };
  };

  it('routes both orders downstream as real beams', () => {
    // The whole point of the change: the cell puts two beams into the room. The 0th carries
    // straight on to a detector in front of it, and the diffracted one leaves at an angle to
    // a detector placed on that line.
    const shifted = diffractedFrom(400, AXIS_Y, 400);
    const nodes = [
      laserNode,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      pd('PD0', 800, AXIS_Y),
      pd('PD1', shifted.x, shifted.y),
    ];
    const { segments, nodeBeams } = autoRoute(nodes, []);
    expect(segments.filter(s => s.sourceId === 'AOM').map(s => s.sourceHandle).sort())
      .toEqual(['order0', 'order1']);

    // Straight on, unshifted, carrying what was not diffracted.
    expect(nodeBeams.get('PD0')!.power).toBeCloseTo(18, 6);
    expect(nodeBeams.get('PD0')!.detuningHz).toBeUndefined();
    // Off at an angle, carrying the shift.
    expect(nodeBeams.get('PD1')!.power).toBeCloseTo(80, 6);
    expect(nodeBeams.get('PD1')!.detuningHz).toBe(80e6);
    // The beam arriving at the AOM is of course unshifted.
    expect(nodeBeams.get('AOM')!.detuningHz).toBeUndefined();
  });

  it('lets both orders run on as free beams with nothing in their way', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y)];
    const { segments } = autoRoute(nodes, []);
    const leaving = segments.filter(s => s.sourceId === 'AOM');
    expect(leaving).toHaveLength(2);
    expect(leaving.every(s => s.free)).toBe(true);
    expect(leaving.find(s => s.sourceHandle === 'order0')!.beam.power).toBeCloseTo(18, 6);
    expect(leaving.find(s => s.sourceHandle === 'order1')!.beam.power).toBeCloseTo(80, 6);
  });

  it('sends the 0th order along the entry axis and the diffracted one off it', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y)];
    const { segments } = autoRoute(nodes, []);
    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    const first  = segments.find(s => s.sourceHandle === 'order1')!;

    // Undeviated: same axis in and out.
    expect(zeroth.y1).toBeCloseTo(AXIS_Y, 6);
    expect(zeroth.y2).toBeCloseTo(AXIS_Y, 6);
    // Deflected by exactly the drawn angle, to the side the transducer sets.
    const dir = angleOf({ dx: first.x2 - first.x1, dy: first.y2 - first.y1 });
    expect(dir).toBeCloseTo(DEFAULT_DEFLECT_DEG, 6);

    // Both start at the cell's exit face, which is where the crystal ends.
    const g = getNodeGeometry('aom');
    expect(zeroth.x1).toBeCloseTo(400 + g.width / 2, 6);
  });

  it('deflects the other way for a cell whose transducer is on the other end', () => {
    // Independent of `activeOrder`, which only sets the sign of the shift.
    const nodes = [
      laserNode,
      at('AOM', aom({ deflectSide: 'ccw', activeOrder: '-1' }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    const first = segments.find(s => s.sourceHandle === 'order1')!;
    const dir = angleOf({ dx: first.x2 - first.x1, dy: first.y2 - first.y1 });
    expect(dir).toBeCloseTo(360 - DEFAULT_DEFLECT_DEG, 6);   // the other side of the axis
    expect(first.beam.detuningHz).toBe(-80e6);
  });

  it('carries the shift through the rest of the layout', () => {
    // A mirror on the diffracted line, and a detector wherever that mirror sends the beam.
    const m = diffractedFrom(400, AXIS_Y, 300);
    const out = mirrorReflect(m.dir, 0);
    const nodes = [
      laserNode,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('M', { type: 'dielectric_mirror', reflectivity: 100, rotation: 0 }, m.x, m.y),
      pd('PD', m.x + out.dx * 200, m.y + out.dy * 200),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(nodeBeams.get('PD')!.detuningHz).toBe(80e6);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(80, 6);
  });

  it('stacks two AOMs in series along the fold their deflections make', () => {
    // Each cell adds a deflection as well as a shift, so a chain of them walks round the
    // lattice — which is exactly what a real bench does.
    const a1 = diffractedFrom(400, AXIS_Y, 300);
    const second = aom({ rfFrequency: 110 });
    const d2 = diffractedDirection(a1.dir, DEFAULT_DEFLECT_DEG, second);
    const nodes = [
      laserNode,
      at('A1', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('A2', second as Partial<OpticalNodeData> & { type: 'aom' }, a1.x, a1.y),
      pd('PD', a1.x + d2.dx * 300, a1.y + d2.dy * 300),
    ];
    const { nodeBeams } = autoRoute(nodes, []);
    expect(angleOf(d2)).toBeCloseTo(2 * DEFAULT_DEFLECT_DEG, 6);
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
    expect(segments.some(s => s.sourceHandle === 'order1')).toBe(false);
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(98, 6);
    expect(nodeBeams.get('PD')!.detuningHz).toBeUndefined();
  });

  it('finds an AOM already sitting centred on a beam', () => {
    const nodes = [laserNode, at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y), pd('PD', 800)];
    const { segments, snaps } = autoRoute(nodes, []);
    expect(segments.some(s => s.targetId === 'AOM')).toBe(true);
    // Nothing needs moving: the centre is already on the beam.
    expect(snaps.get('AOM')).toBeUndefined();
  });

  it('blocks the 0th order with a beam block while the diffracted order carries on', () => {
    // The bench answer to a cell that no longer swallows anything: put a block in front of it.
    const shifted = diffractedFrom(400, AXIS_Y, 400);
    const nodes = [
      laserNode,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('BLOCK', { type: 'beam_block', category: 'conditioning' }, 700, AXIS_Y),
      pd('PD', shifted.x, shifted.y),
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

  it('does not let one order capture components sitting on the other', () => {
    const shifted = diffractedFrom(400, AXIS_Y, 400);
    const nodes = [
      laserNode,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 400, AXIS_Y),
      at('BLOCK', { type: 'beam_block', category: 'conditioning' }, 700, AXIS_Y),
      pd('PD', shifted.x, shifted.y),
    ];
    const { snaps, segments, rotations } = autoRoute(nodes, []);
    expect(segments.find(s => s.targetId === 'BLOCK')!.sourceHandle).toBe('order0');
    expect(segments.find(s => s.targetId === 'PD')!.sourceHandle).toBe('order1');

    // Neither is dragged onto the other's beam. Both are already on one, so their *centres*
    // must not move — a snap may still be reported, because turning a node to face an oblique
    // beam changes the box its top-left corner belongs to.
    const centreAfter = (id: string, was: { x: number; y: number }) => {
      const snap = snaps.get(id);
      if (!snap) return was;
      const node = nodes.find(n => n.id === id)!;
      const box = occupiedBox(node.data, rotations.get(id) ?? 0);
      return { x: snap.x + box.width / 2, y: snap.y + box.height / 2 };
    };
    const block = centreAfter('BLOCK', { x: 700, y: AXIS_Y });
    expect(block.x).toBeCloseTo(700, 6);
    expect(block.y).toBeCloseTo(AXIS_Y, 6);          // stayed on the 0th order
    const det = centreAfter('PD', { x: shifted.x, y: shifted.y });
    expect(det.x).toBeCloseTo(shifted.x, 6);
    expect(det.y).toBeCloseTo(shifted.y, 6);          // stayed on the diffracted order
  });

  it('deflects towards the same physical side for a beam travelling backwards', () => {
    // The kick belongs to the device, not to the beam, so a cell fed right-to-left bends its
    // diffracted order to the *same* side of the room. This is what makes a double pass
    // retrace: reverse the beam and the rotation sense flips with it, so a second pass undoes
    // the first deflection instead of doubling it. See physics/diffraction.
    const backwards = at('L1', {
      type: 'laser_source', category: 'source', name: 'L1', rotation: 180,
      wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
    } as Partial<OpticalNodeData> & { type: 'laser_source' }, 1000, AXIS_Y);
    const nodes = [
      backwards,
      at('AOM', aom() as Partial<OpticalNodeData> & { type: 'aom' }, 600, AXIS_Y),
    ];
    const { segments } = autoRoute(nodes, []);
    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    const first  = segments.find(s => s.sourceHandle === 'order1')!;

    expect(zeroth.x2).toBeLessThan(zeroth.x1);              // 0th still travels left
    expect(first.x2).toBeLessThan(first.x1);                // so does the diffracted one
    expect(first.y2).toBeGreaterThan(first.y1);             // and still bends downwards
    const dir = angleOf({ dx: first.x2 - first.x1, dy: first.y2 - first.y1 });
    expect(dir).toBeCloseTo(180 - DEFAULT_DEFLECT_DEG, 6);
  });

  it('snaps a mispositioned AOM by its axis', () => {
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
