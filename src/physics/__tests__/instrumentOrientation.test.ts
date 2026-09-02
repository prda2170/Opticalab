import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { DEFAULT_DEFLECT_DEG } from '../diffraction';
import { autoRoute } from '../autoRoute';
import { unitAt, DIR_STEP_DEG, angleOf, angleDiff, dot } from '../geometry';
import { componentLanes, bodyAxis } from '../lanes';
import { PX_PER_INCH } from '../scale';
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

  it('leaves both orders from the same crystal, not from parallel lanes', () => {
    // The orders used to be drawn an inch apart on parallel lanes, because the true deflection
    // is too small to see. They come out of one crystal now and diverge by angle instead, so
    // what has to follow the rotation the trace settled on is the kick direction, not an offset.
    const nodes = bench(90, aom() as Partial<OpticalNodeData> & { type: 'aom' });
    const { segments, rotations } = autoRoute(nodes, []);
    expect(rotations.get('DUT')).toBe(90);

    const zeroth = segments.find(s => s.sourceHandle === 'order0')!;
    const diffracted = segments.find(s => s.sourceHandle === 'order1')!;

    // They leave the exit face a few px apart — one of them is already turning — and nowhere
    // near the inch the old lane offset put between them.
    const gap = Math.hypot(zeroth.x1 - diffracted.x1, zeroth.y1 - diffracted.y1);
    expect(gap).toBeLessThan(PX_PER_INCH / 2);

    // Same origin, properly: run the diffracted beam backwards and it meets the 0th order's
    // line inside the cell, rather than running alongside it forever.
    const d0 = { dx: zeroth.x2 - zeroth.x1, dy: zeroth.y2 - zeroth.y1 };
    const d1 = { dx: diffracted.x2 - diffracted.x1, dy: diffracted.y2 - diffracted.y1 };
    const den = d1.dx * d0.dy - d1.dy * d0.dx;
    expect(Math.abs(den)).toBeGreaterThan(1e-9);
    const t = ((zeroth.x1 - diffracted.x1) * d0.dy - (zeroth.y1 - diffracted.y1) * d0.dx) / den;
    const meet = { x: diffracted.x1 + d1.dx * t, y: diffracted.y1 + d1.dy * t };
    expect(t).toBeLessThan(0);   // behind the diffracted beam's start: inside the crystal
    // Within the cell body of the exit face, which is where the crystal is.
    expect(Math.hypot(meet.x - zeroth.x1, meet.y - zeroth.y1)).toBeLessThan(PX_PER_INCH);
  });

  it('sends the 0th order straight on and the diffracted one 15° off, at every lattice angle', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const nodes = bench(deg, aom() as Partial<OpticalNodeData> & { type: 'aom' });
      const { segments, rotations } = autoRoute(nodes, []);
      const zeroth = segments.find(s => s.sourceHandle === 'order0');
      const diffracted = segments.find(s => s.sourceHandle === 'order1');
      if (!zeroth || !diffracted) continue;

      const zeroDeg = angleOf({ dx: zeroth.x2 - zeroth.x1, dy: zeroth.y2 - zeroth.y1 });
      const diffDeg = angleOf({ dx: diffracted.x2 - diffracted.x1, dy: diffracted.y2 - diffracted.y1 });
      // Undeviated: the 0th order carries on exactly along the beam that fed it.
      expect(Math.abs(angleDiff(zeroDeg, deg)), `0th at ${deg}°`).toBeLessThan(1e-6);
      // And the diffracted order is exactly the deflection away from it…
      expect(angleDiff(diffDeg, zeroDeg), `1st at ${deg}°`).toBeCloseTo(DEFAULT_DEFLECT_DEG, 6);
      // …on the side the *cell* dictates. The kick is bolted to the crystal, so a cell fed
      // against its own body axis bends the beam the other way round the screen — which is
      // precisely what lets a second pass undo the first deflection.
      const rot = rotations.get('DUT')!;
      const forward = dot(unitAt(deg), bodyAxis(rot)) >= 0 ? 1 : -1;
      const cross = Math.sign(
        (zeroth.x2 - zeroth.x1) * (diffracted.y2 - diffracted.y1)
        - (zeroth.y2 - zeroth.y1) * (diffracted.x2 - diffracted.x1),
      );
      expect(cross, `side at ${deg}°`).toBe(forward);
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
    // One axis per component again: the orders leave at an angle, not on parallel lanes.
    expect(componentLanes(aom()).length).toBe(1);
  });
});
