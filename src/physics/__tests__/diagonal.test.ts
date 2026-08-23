import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute, faceHalf, BEAM_SNAP_DIST } from '../autoRoute';
import { unitAt, angleOf, snapAngle, angleDiff, normalise, dot, mirrorReflect, DIR_STEP_DEG } from '../geometry';
import { bodyAxis, laneNormal, componentLanes, ORDER_SEPARATION_PX } from '../lanes';
import { getNodeGeometry, artworkOf } from '../../utils/nodeGeometry';
import { pxToMm } from '../scale';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Place a node by its centre, using the box it occupies at its own rotation. */
function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (id: string, cx: number, cy: number, rotation: number, power = 100) => at(id, {
  type: 'laser_source', category: 'source', name: id, rotation,
  wavelength: 780, outputPower: power, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

const pd = (id: string, cx: number, cy: number, rotation?: number) =>
  at(id, { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1, rotation }, cx, cy);

/** A point `dist` px from (cx, cy) along `deg`. */
const along = (cx: number, cy: number, deg: number, dist: number) => {
  const u = unitAt(deg);
  return { x: cx + u.dx * dist, y: cy + u.dy * dist };
};

const DIAG = 45;
const LX = 300, LY = 300;                  // laser centre for the diagonal bench
const LASER_REACH = 45;                    // half the 90 px artwork, along its own axis

/** Centre of the laser's output face, for a laser at (LX, LY) turned to `deg`. */
const faceAt = (deg: number) => along(LX, LY, deg, LASER_REACH);

// ── A source firing along a diagonal ─────────────────────────────────────────

describe('a laser on a diagonal', () => {
  it('emits from its output face, along its own axis', () => {
    const { segments } = autoRoute([laser('L1', LX, LY, DIAG)], []);
    const seg = segments.find(s => s.sourceId === 'L1')!;
    const face = faceAt(DIAG);

    expect(seg.x1).toBeCloseTo(face.x, 6);
    expect(seg.y1).toBeCloseTo(face.y, 6);
    expect(normalise({ dx: seg.x2 - seg.x1, dy: seg.y2 - seg.y1 })).toEqual(bodyAxis(DIAG));
  });

  it('works at every angle on the lattice, not just the diagonals', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const { segments } = autoRoute([laser('L1', LX, LY, deg)], []);
      const seg = segments.find(s => s.sourceId === 'L1')!;
      const face = along(LX, LY, deg, LASER_REACH);
      expect(seg.x1).toBeCloseTo(face.x, 6);
      expect(seg.y1).toBeCloseTo(face.y, 6);
      expect(angleDiff(angleOf({ dx: seg.x2 - seg.x1, dy: seg.y2 - seg.y1 }), deg)).toBeLessThan(1e-9);
    }
  });

  it('occupies a bigger box when turned off-axis, but keeps its centre', () => {
    const node = laser('L1', LX, LY, DIAG);
    const g = getNodeGeometry('laser_source', DIAG);
    expect(g.width).toBeGreaterThan(artworkOf('laser_source').width);
    expect(node.position.x + g.width / 2).toBeCloseTo(LX, 9);
    expect(node.position.y + g.height / 2).toBeCloseTo(LY, 9);
  });
});

// ── Components on a diagonal beam ────────────────────────────────────────────

describe('a bench built along a diagonal', () => {
  /** laser → λ/4 → PD, all on one 45° line. */
  const bench = () => {
    const p1 = along(LX, LY, DIAG, 200);
    const p2 = along(LX, LY, DIAG, 400);
    return [
      laser('L1', LX, LY, DIAG),
      at('QWP', { type: 'qwp', category: 'conditioning', fastAxisAngle: 0 }, p1.x, p1.y),
      pd('PD', p2.x, p2.y),
    ];
  };

  it('finds every component on the beam', () => {
    const { segments } = autoRoute(bench(), []);
    const chain = segments.map(s => `${s.sourceId}->${s.targetId}`);
    expect(chain).toEqual(['L1->QWP', 'QWP->PD']);
  });

  it('turns each component to face the beam', () => {
    const { rotations } = autoRoute(bench(), []);
    expect(rotations.get('QWP')).toBe(DIAG);
    expect(rotations.get('PD')).toBe(DIAG);
  });

  it('trims the beam to the faces the beam actually meets', () => {
    const { segments } = autoRoute(bench(), []);
    const [first, second] = segments;

    // The waveplate is turned to face the beam, so its trim is its axial figure.
    const qwpTrim = faceHalf('qwp', DIAG, unitAt(DIAG));
    expect(qwpTrim).toBeCloseTo(6, 9);

    const gap1 = Math.hypot(first.x2 - first.x1, first.y2 - first.y1);
    expect(gap1).toBeCloseTo(200 - LASER_REACH - qwpTrim, 6);

    const pdTrim = faceHalf('photodiode', DIAG, unitAt(DIAG));
    const gap2 = Math.hypot(second.x2 - second.x1, second.y2 - second.y1);
    expect(gap2).toBeCloseTo(200 - qwpTrim - pdTrim, 6);
  });

  it('keeps the beam exactly on the diagonal, with no drift down the chain', () => {
    const { segments } = autoRoute(bench(), []);
    for (const s of segments) {
      expect(angleDiff(angleOf({ dx: s.x2 - s.x1, dy: s.y2 - s.y1 }), DIAG)).toBeLessThan(1e-9);
      // Every endpoint lies on the line through the laser centre at 45°.
      for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
        const perp = (x - LX) * -unitAt(DIAG).dy + (y - LY) * unitAt(DIAG).dx;
        expect(Math.abs(perp)).toBeLessThan(1e-6);
      }
    }
  });

  it('measures physical length along the diagonal, not along x', () => {
    const { segments } = autoRoute(bench(), []);
    const first = segments[0];
    const drawn = Math.hypot(first.x2 - first.x1, first.y2 - first.y1);
    expect(first.lengthMm).toBeCloseTo(pxToMm(drawn), 9);
  });

  it('still snaps a component that sits slightly off the diagonal', () => {
    const nudged = bench();
    nudged[1].position = { x: nudged[1].position.x + 4, y: nudged[1].position.y - 4 };
    const { segments, snaps } = autoRoute(nudged, []);
    expect(segments.map(s => s.targetId)).toContain('QWP');
    expect(snaps.has('QWP')).toBe(true);
  });

  it('misses one that is further off than the snap distance', () => {
    const off = bench();
    const push = BEAM_SNAP_DIST * 2;
    off[1].position = { x: off[1].position.x + push, y: off[1].position.y - push };
    const { segments } = autoRoute(off, []);
    // The waveplate is skipped; the beam runs straight to the detector.
    expect(segments.map(s => `${s.sourceId}->${s.targetId}`)).toEqual(['L1->PD']);
  });
});

// ── Folding a diagonal beam ──────────────────────────────────────────────────

describe('mirrors and diagonal beams', () => {
  it('folds a diagonal beam onto an axis with a half-step mirror', () => {
    // Beam at 45°, mirror surface at 22.5° → out along 0°. `rotation` is 45° ahead of
    // the surface, so 67.5. This is why the mirror lattice is 7.5°.
    expect(angleOf(mirrorReflect(unitAt(45), 67.5))).toBeCloseTo(0, 9);
    // Symmetric, as reflection must be: the same surface swaps 0° and 45°.
    expect(angleOf(mirrorReflect(unitAt(0), 67.5))).toBeCloseTo(45, 9);
  });

  it('routes the fold through the tracer, end to end', () => {
    // Laser at 45°, mirror 300 px along that diagonal turned to send the beam east.
    const m = along(LX, LY, DIAG, 300);
    const nodes = [
      laser('L1', LX, LY, DIAG),
      at('M1', { type: 'dielectric_mirror', category: 'steering', reflectivity: 100, rotation: 67.5 }, m.x, m.y),
      pd('PD', m.x + 250, m.y),
    ];
    const { segments } = autoRoute(nodes, []);
    expect(segments.map(s => `${s.sourceId}->${s.targetId}`)).toEqual(['L1->M1', 'M1->PD']);

    const out = segments[1];
    expect(out.y1).toBeCloseTo(out.y2, 6);      // leaves horizontally
    expect(out.x2).toBeGreaterThan(out.x1);     // and eastward
  });

  it('sends a diagonal beam straight back off a mirror square to it', () => {
    // Surface at 135° is square across a 45° beam.
    expect(mirrorReflect(unitAt(45), 180)).toEqual(unitAt(225));
  });
});

// ── Lanes at an angle ────────────────────────────────────────────────────────

describe('lanes on a turned component', () => {
  it('stacks lanes perpendicular to the body, whatever its angle', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      expect(dot(bodyAxis(deg), laneNormal(deg))).toBeCloseTo(0, 12);
      expect(Math.hypot(laneNormal(deg).dx, laneNormal(deg).dy)).toBeCloseTo(1, 12);
    }
  });

  it('keeps the dump lane one inch off the axis at 45°', () => {
    const aom = { type: 'aom', name: 'AOM', category: 'modulation', rfFrequency: 80, rfPower: 33,
      diffractionEfficiency: 80, transmission: 98, activeOrder: '+1', rotation: 45 } as OpticalNodeData;
    const lanes = componentLanes(aom);
    expect(lanes[0]).toBe(0);
    expect(Math.abs(lanes[1])).toBe(ORDER_SEPARATION_PX);
    // The offset is a distance along laneNormal, so the lane really is an inch away.
    const n = laneNormal(45);
    const offset = { x: n.dx * lanes[1], y: n.dy * lanes[1] };
    expect(Math.hypot(offset.x, offset.y)).toBeCloseTo(ORDER_SEPARATION_PX, 9);
  });
});

// ── Auto-rotation ────────────────────────────────────────────────────────────

describe('auto-rotation', () => {
  it('is unchanged for axis-aligned beams', () => {
    const cases: [number, number][] = [[0, 0], [90, 90], [180, 180], [270, 270]];
    for (const [beamDeg, expected] of cases) {
      const target = along(LX, LY, beamDeg, 300);
      const { rotations } = autoRoute([laser('L1', LX, LY, beamDeg), pd('PD', target.x, target.y)], []);
      expect(rotations.get('PD')).toBe(expected);
    }
  });

  it('faces the beam at every lattice angle', () => {
    for (let deg = 0; deg < 360; deg += DIR_STEP_DEG) {
      const target = along(LX, LY, deg, 300);
      const { rotations } = autoRoute([laser('L1', LX, LY, deg), pd('PD', target.x, target.y)], []);
      expect(rotations.get('PD')).toBe(snapAngle(deg));
    }
  });

  it('leaves mirrors and box nodes on their user-set angle', () => {
    const m = along(LX, LY, DIAG, 300);
    const nodes = [
      laser('L1', LX, LY, DIAG),
      at('M1', { type: 'dielectric_mirror', category: 'steering', reflectivity: 100, rotation: 67.5 }, m.x, m.y),
    ];
    const { rotations } = autoRoute(nodes, []);
    expect(rotations.get('M1')).toBe(67.5);
  });

  it('does not re-aim a component once a first beam has set it', () => {
    // Two lasers, 90° apart, meeting at one detector: the first arrival wins.
    const cross = along(LX, LY, 0, 400);
    const nodes = [
      laser('L1', LX, LY, 0),
      laser('L2', cross.x, cross.y - 400, 90),
      pd('PD', cross.x, cross.y),
    ];
    const { rotations, nodeArrivals } = autoRoute(nodes, []);
    expect(nodeArrivals.get('PD')).toHaveLength(2);
    expect(rotations.get('PD')).toBe(0);          // set by L1, not re-aimed by L2
  });
});

// ── Emitters are "through" in one direction only ─────────────────────────────

describe('a beam arriving back at its own laser', () => {
  // Not an angle question — it was wrong on the axes too, but a diagonal double pass is
  // what made it visible, because the return leg measured longer than the outbound one.
  const build = (deg: number) => {
    const r = along(LX, LY, deg, 400);
    return [
      laser('L1', LX, LY, deg),
      at('RR', { type: 'retroreflector', category: 'steering', reflectivity: 100, focalLength: 0 }, r.x, r.y),
    ];
  };

  it('stops at the laser\'s output face, not inside its case', () => {
    const { segments } = autoRoute(build(0), []);
    const back = segments.find(s => s.targetId === 'L1')!;
    expect(back.x2).toBeCloseTo(LX + LASER_REACH, 6);   // the face, not LX
    expect(back.y2).toBeCloseTo(LY, 6);
  });

  it('still lets a departing beam start on the face, untrimmed', () => {
    const { segments } = autoRoute(build(0), []);
    const out = segments.find(s => s.sourceId === 'L1')!;
    expect(out.x1).toBeCloseTo(LX + LASER_REACH, 6);
  });

  it('measures the return path as the same length as the outbound one', () => {
    for (const deg of [0, 45, 90, 135]) {
      const { segments } = autoRoute(build(deg), []);
      const out  = segments.find(s => s.targetId === 'RR')!;
      const back = segments.find(s => s.sourceId === 'RR')!;
      expect(back.lengthMm).toBeCloseTo(out.lengthMm, 6);
    }
  });
});

// ── Diagonal double pass ─────────────────────────────────────────────────────

describe('a double pass along a diagonal', () => {
  const build = () => {
    const r = along(LX, LY, DIAG, 400);
    return [
      laser('L1', LX, LY, DIAG),
      at('RR', { type: 'retroreflector', category: 'steering', reflectivity: 100, focalLength: 0 }, r.x, r.y),
    ];
  };

  it('sends the beam back down the same diagonal', () => {
    const { segments } = autoRoute(build(), []);
    const back = segments.find(s => s.sourceId === 'RR')!;
    expect(angleDiff(angleOf({ dx: back.x2 - back.x1, dy: back.y2 - back.y1 }), DIAG + 180)).toBeLessThan(1e-9);
  });

  it('fans the return beam for display, without moving the physics', () => {
    const { segments } = autoRoute(build(), []);
    const back = segments.find(s => s.sourceId === 'RR')!;
    // Used to be undefined: diagonal beams were excluded from fanning, so the return
    // pass drew exactly on top of the outgoing one.
    expect(back.renderShift).toBeDefined();
    const shift = back.renderShift!;
    // Displaced perpendicular to the beam, so the beam's own direction is untouched.
    expect(Math.abs(dot({ dx: shift.dx, dy: shift.dy }, unitAt(DIAG)))).toBeLessThan(1e-9);
  });

  it('reports a physical length equal to the outbound leg', () => {
    const { segments } = autoRoute(build(), []);
    const out = segments.find(s => s.targetId === 'RR')!;
    const back = segments.find(s => s.sourceId === 'RR')!;
    expect(back.lengthMm).toBeCloseTo(out.lengthMm, 6);
  });
});
