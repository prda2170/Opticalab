import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { unitAt, DIR_STEP_DEG } from '../geometry';
import { componentLanes, laneNormal, ORDER_SEPARATION_PX } from '../lanes';
import { getNodeGeometry, artworkOf } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'modulation', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (id: string, cx: number, cy: number, rotation = 0) => at(id, {
  type: 'laser_source', category: 'source', name: id, rotation,
  wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

const aom = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'aom', category: 'modulation', name: 'AOM',
  rfFrequency: 80, rfPower: 33, diffractionEfficiency: 80, transmission: 98,
  activeOrder: '+1', ...over,
} as OpticalNodeData);

/** A source at `deg` and one component 300 px along that heading. */
const bench = (deg: number, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }) => {
  const u = unitAt(deg);
  return [
    laser('L1', 300, 300, deg),
    at('DUT', data, 300 + u.dx * 300, 300 + u.dy * 300),
  ];
};

// ── Instrument nodes turn like everything else ───────────────────────────────

describe('instrument nodes face the beam', () => {
  it('turns an EOM to the beam, where it used to sit square', () => {
    // Box nodes were excluded from auto-rotation while their artwork was drawn unturned.
    // Now that it turns, they align like any other inline device.
    for (const deg of [0, 90, 180, 270]) {
      const { rotations } = autoRoute(bench(deg, { type: 'eom', eomType: 'free_space', transmission: 90, rfFrequency: 9.2, rfPower: 30 }), []);
      expect(rotations.get('DUT')).toBe(deg);
    }
  });

  it('turns a camera to the beam, so its sensor faces the light', () => {
    const { rotations } = autoRoute(bench(90, { type: 'camera', category: 'detection', resolution: '1', pixelSize: 1, frameRate: 1 }), []);
    expect(rotations.get('DUT')).toBe(90);
  });

  it('turns them to off-axis lattice angles too', () => {
    for (const deg of [15, 45, 120, 315]) {
      const { rotations } = autoRoute(bench(deg, { type: 'eom', eomType: 'free_space', transmission: 90, rfFrequency: 9.2, rfPower: 30 }), []);
      expect(rotations.get('DUT')).toBe(deg);
    }
  });

  it('still leaves mirror-like components pointed where the user pointed them', () => {
    // A mirror is aimed, not aligned: its surface sits at 45° across the body.
    const nodes = bench(0, { type: 'pbs', category: 'steering', rotation: 90 });
    expect(autoRoute(nodes, []).rotations.get('DUT')).toBe(90);
  });
});

// ── The acousto-optic exception ──────────────────────────────────────────────

describe('an acousto-optic cell aligns to the beam axis, not its direction', () => {
  it('turns to face a vertical beam', () => {
    const { rotations } = autoRoute(bench(90, aom() as Partial<OpticalNodeData> & { type: 'aom' }), []);
    expect(rotations.get('DUT')).toBe(90);
  });

  it('does not flip for a beam running through it backwards', () => {
    // A lane is a place on the device. Turning the cell to face a reversed beam would put
    // its dumped order on the other side, and a double pass would stop retracing.
    expect(autoRoute(bench(180, aom() as Partial<OpticalNodeData> & { type: 'aom' }), []).rotations.get('DUT')).toBe(0);
    expect(autoRoute(bench(270, aom() as Partial<OpticalNodeData> & { type: 'aom' }), []).rotations.get('DUT')).toBe(90);
  });

  it('keeps the dumped order on the same physical side either way', () => {
    const dumpSide = (deg: number) => {
      const nodes = bench(deg, aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' });
      const { segments } = autoRoute(nodes, []);
      const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
      const diffracted = segments.find(s => s.sourceHandle === 'order1')!;
      // Signed perpendicular offset of the dump lane from the diffracted (centre) lane.
      return Math.round(zeroth.y1 - diffracted.y1);
    };
    // Forwards and backwards along the same axis put the dump on the same side.
    expect(dumpSide(0)).toBe(dumpSide(180));
    expect(dumpSide(0)).not.toBe(0);
  });

  it('puts the dumped order on the cell\'s new normal once it has turned', () => {
    // The reason the lane normal has to follow the rotation this trace decided rather than
    // the one still in the node's data: otherwise a freshly turned cell dumps its 0th
    // order along the beam axis instead of beside it.
    const nodes = bench(90, aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' });
    const { segments, rotations } = autoRoute(nodes, []);
    expect(rotations.get('DUT')).toBe(90);

    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    const diffracted = segments.find(s => s.sourceHandle === 'order1')!;
    // Vertical cell: the two lanes are separated horizontally, by one inch.
    expect(Math.abs(zeroth.x1 - diffracted.x1)).toBeCloseTo(ORDER_SEPARATION_PX, 6);
    expect(Math.abs(zeroth.y1 - diffracted.y1)).toBeLessThan(1e-6);
  });

  it('separates the lanes along the cell normal at every lattice angle', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const nodes = bench(deg, aom({ dumpZeroOrder: false }) as Partial<OpticalNodeData> & { type: 'aom' });
      const { segments, rotations } = autoRoute(nodes, []);
      const zeroth = segments.find(s => s.sourceHandle === 'order0');
      const diffracted = segments.find(s => s.sourceHandle === 'order1');
      if (!zeroth || !diffracted) continue;

      const rot = rotations.get('DUT')!;
      const n = laneNormal(rot);
      const dx = zeroth.x1 - diffracted.x1;
      const dy = zeroth.y1 - diffracted.y1;
      // The whole separation lies along the cell's own normal: one inch across it, and
      // nothing along the beam axis.
      expect(Math.abs(dx * n.dx + dy * n.dy)).toBeCloseTo(ORDER_SEPARATION_PX, 6);
      expect(Math.abs(dx * -n.dy + dy * n.dx)).toBeLessThan(1e-6);
    }
  });
});

// ── Nothing else moved ───────────────────────────────────────────────────────

describe('the rest of the rules are unchanged', () => {
  it('still lets only the first beam aim a component', () => {
    const nodes = [
      laser('L1', 300, 300, 0),
      laser('L2', 600, 100, 90),
      at('EOM', { type: 'eom', eomType: 'free_space', transmission: 90, rfFrequency: 9.2, rfPower: 30 }, 600, 300),
    ];
    const { rotations, nodeArrivals } = autoRoute(nodes, []);
    expect(nodeArrivals.get('EOM')).toHaveLength(2);
    expect(rotations.get('EOM')).toBe(0);          // aimed by L1, not re-aimed by L2
  });

  it('has one artwork box for an instrument, turned by its rotation', () => {
    const a = artworkOf('aom');
    expect(getNodeGeometry('aom', 90).width).toBe(a.height);
    expect(componentLanes(aom()).length).toBe(2);
  });
});
