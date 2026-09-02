import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import {
  DEFAULT_DEFLECT_DEG, deflectDegOf, deflectSignOf, kickVector,
  diffractedDirection, travellingBackwards,
} from '../diffraction';
import { autoRoute } from '../autoRoute';
import { unitAt, angleOf, angleDiff, dot, DIR_STEP_DEG } from '../geometry';
import { laneNormal } from '../lanes';
import { layoutToJSON, layoutFromJSON, LAYOUT_VERSION } from '../../utils/export';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const cell = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'aom', name: 'A1', category: 'modulation',
  rfFrequency: 80, rfPower: 33, diffractionEfficiency: 80, transmission: 98,
  activeOrder: '+1', ...over,
} as OpticalNodeData);

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (cx: number, cy: number, rotation = 0) => at('L1', {
  type: 'laser_source', category: 'source', name: 'L1', rotation,
  wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

// ── The angle ─────────────────────────────────────────────────────────────────

describe('the drawn deflection', () => {
  it('is a lattice angle, so components can align to the diffracted beam', () => {
    // Not a physical claim — a real first-order deflection is θ = λ·f_RF/v_a ≈ 1°, which no
    // figure can show. It is a drawing that has to stay on the grid the router thinks in, or
    // nothing could be placed on the beam it produces.
    expect(DEFAULT_DEFLECT_DEG % DIR_STEP_DEG).toBe(0);
  });

  it('defaults, and takes a per-cell override', () => {
    expect(deflectDegOf(cell())).toBe(DEFAULT_DEFLECT_DEG);
    expect(deflectDegOf(cell({ deflectDeg: 30 } as Partial<OpticalNodeData>))).toBe(30);
    // Nonsense is ignored rather than drawn: a zero or negative deflection would put both
    // orders on one line and make the two beams indistinguishable.
    expect(deflectDegOf(cell({ deflectDeg: 0 } as Partial<OpticalNodeData>))).toBe(DEFAULT_DEFLECT_DEG);
    expect(deflectDegOf(cell({ deflectDeg: -15 } as Partial<OpticalNodeData>))).toBe(DEFAULT_DEFLECT_DEG);
    expect(deflectDegOf(cell({ deflectDeg: NaN } as Partial<OpticalNodeData>))).toBe(DEFAULT_DEFLECT_DEG);
  });
});

// ── Two independent signs ─────────────────────────────────────────────────────

describe('which side the diffracted order leaves on', () => {
  it('is set by the transducer, not by the driven order', () => {
    // The point the user made: a transducer can be bonded to either end of the crystal, so
    // the side the beam leaves on and the sign of the frequency shift are separate facts.
    expect(deflectSignOf(cell({ deflectSide: 'cw' } as Partial<OpticalNodeData>))).toBe(1);
    expect(deflectSignOf(cell({ deflectSide: 'ccw' } as Partial<OpticalNodeData>))).toBe(-1);
    // `activeOrder` says nothing about it.
    expect(deflectSignOf(cell({ activeOrder: '-1' } as Partial<OpticalNodeData>))).toBe(1);
    expect(deflectSignOf(cell({ activeOrder: '-1', deflectSide: 'ccw' } as Partial<OpticalNodeData>))).toBe(-1);
  });

  it('is a place on the crystal, so it turns with the cell', () => {
    // The kick is the acoustic wave's, and that runs across the crystal whichever way the
    // light goes. So it follows the cell's rotation and nothing else.
    for (let rot = 0; rot < 360; rot += DIR_STEP_DEG) {
      const n = laneNormal(rot);
      expect(kickVector(cell(), rot)).toEqual(n);
      expect(kickVector(cell({ deflectSide: 'ccw' } as Partial<OpticalNodeData>), rot))
        .toEqual({ dx: -n.dx, dy: -n.dy });
    }
  });

  it('bends the beam towards the kick from either direction', () => {
    const cw = cell();
    // Fed forwards, +15° on screen; fed backwards along the same axis, 165° — which is the
    // *same* side of the room, because the kick has not moved.
    expect(angleOf(diffractedDirection(unitAt(0), 0, cw))).toBeCloseTo(15, 9);
    expect(angleOf(diffractedDirection(unitAt(180), 0, cw))).toBeCloseTo(165, 9);
    // Both have a positive y component: both bend the way laneNormal(0) points.
    expect(diffractedDirection(unitAt(0), 0, cw).dy).toBeGreaterThan(0);
    expect(diffractedDirection(unitAt(180), 0, cw).dy).toBeGreaterThan(0);
  });

  it('closes a double pass: out at +15°, back at exactly 180°', () => {
    // The whole reason the rule is written in terms of a kick rather than a constant angle.
    const out = diffractedDirection(unitAt(0), 0, cell());
    expect(angleOf(out)).toBeCloseTo(DEFAULT_DEFLECT_DEG, 9);

    // A retro sends it back anti-parallel…
    const returning = { dx: -out.dx, dy: -out.dy };
    expect(angleOf(returning)).toBeCloseTo(180 + DEFAULT_DEFLECT_DEG, 9);

    // …and the second pass takes it back to exactly anti-parallel with the input, so it
    // retraces its own path to the PBS. A constant +15° twice would leave at 195°.
    const back = diffractedDirection(returning, 0, cell());
    expect(angleOf(back)).toBeCloseTo(180, 9);
    expect(angleDiff(angleOf(back), 0, 180)).toBeCloseTo(0, 9);
  });

  it('deflects by the same angle from every direction, on the same side', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      for (const rot of [0, 30, 45, 90]) {
        const inDir = unitAt(deg);
        const out = diffractedDirection(inDir, rot, cell());
        expect(angleDiff(angleOf(out), deg), `${deg}° at rot ${rot}`)
          .toBeCloseTo(DEFAULT_DEFLECT_DEG, 6);
        // And always turned towards the kick: the beam picks up transverse velocity along
        // the acoustic direction. Skipped where the beam already runs along the acoustic
        // axis, which has no side to pick — a tie the code breaks deterministically, and a
        // geometry that could not diffract on a real bench anyway (nowhere near Bragg).
        const kick = kickVector(cell(), rot);
        if (Math.abs(dot(inDir, kick)) < 0.99) {
          const gained = dot({ dx: out.dx - inDir.dx, dy: out.dy - inDir.dy }, kick);
          expect(gained, `side of ${deg}° at rot ${rot}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('reports which way a beam runs through the cell', () => {
    // Only for reading a layout — the deflection itself never needs it, because the kick
    // carries the cell's orientation.
    expect(travellingBackwards(unitAt(0), 0)).toBe(false);
    expect(travellingBackwards(unitAt(180), 0)).toBe(true);
    expect(travellingBackwards(unitAt(90), 90)).toBe(false);
    expect(travellingBackwards(unitAt(270), 90)).toBe(true);
  });
});

// ── An arm left on the wrong order ────────────────────────────────────────────

describe('a layout drawn when the orders shared an axis', () => {
  /** A cell with a detector straight ahead of it — the pre-1.3 way to draw a shifted arm. */
  const onAxis = () => [
    laser(45, 200),
    at('A1', cell() as Partial<OpticalNodeData> & { type: 'aom' }, 400, 200),
    at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 800, 200),
  ];

  it('says so, because the numbers downstream look plausible but are unshifted', () => {
    const { warnings, nodeBeams } = autoRoute(onAxis(), []);
    expect(warnings.map(w => w.nodeId)).toEqual(['A1']);
    expect(warnings[0].message).toContain('diffracted order');
    // The trap it exists for: light arrives, at a believable power, with no shift on it.
    expect(nodeBeams.get('PD')!.power).toBeCloseTo(18, 6);
    expect(nodeBeams.get('PD')!.detuningHz).toBeUndefined();
  });

  it('says nothing once the arm is on the diffracted beam', () => {
    const nodes = onAxis();
    const d = diffractedDirection(unitAt(0), 0, cell());
    nodes[2] = at('PD', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 },
      400 + d.dx * 400, 200 + d.dy * 400);
    const { warnings, nodeBeams } = autoRoute(nodes, []);
    expect(warnings).toEqual([]);
    expect(nodeBeams.get('PD')!.detuningHz).toBe(80e6);
  });

  it('says nothing when the undiffracted order is the one being used', () => {
    // Order 0 explicitly: there is no diffracted beam to have left unused.
    const nodes = onAxis();
    nodes[1] = at('A1', cell({ activeOrder: '0' }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, 200);
    expect(autoRoute(nodes, []).warnings).toEqual([]);
  });

  it('says nothing when both orders run free — nothing is being misled', () => {
    const { warnings } = autoRoute(onAxis().slice(0, 2), []);
    expect(warnings).toEqual([]);
  });
});

// ── The file format ───────────────────────────────────────────────────────────

describe('the 1.3 format bump', () => {
  it('drops the old block-at-the-cell flag and explains what to check', () => {
    const old = JSON.stringify({
      version: '1.2',
      nodes: [{
        id: 'A1', type: 'optical', position: { x: 0, y: 0 },
        data: { ...cell(), dumpZeroOrder: true },
      }],
      edges: [],
    });
    const back = layoutFromJSON(old);
    expect('dumpZeroOrder' in (back.nodes[0].data as Record<string, unknown>)).toBe(false);
    expect(back.notes.join(' ')).toContain('both orders');
    expect(back.notes.join(' ')).toContain('diffracted arm');
  });

  it('keeps the transducer side across a save and reload', () => {
    const nodes = [at('A1', cell({ deflectSide: 'ccw' }) as Partial<OpticalNodeData> & { type: 'aom' }, 400, 200)];
    const back = layoutFromJSON(layoutToJSON(nodes, []));
    expect((back.nodes[0].data as { deflectSide?: string }).deflectSide).toBe('ccw');
    expect(JSON.parse(layoutToJSON(nodes, [])).version).toBe(LAYOUT_VERSION);
    expect(LAYOUT_VERSION).toBe('1.3');
  });

  it('leaves a current file alone', () => {
    const nodes = [at('A1', cell() as Partial<OpticalNodeData> & { type: 'aom' }, 400, 200)];
    expect(layoutFromJSON(layoutToJSON(nodes, [])).notes).toEqual([]);
  });
});
