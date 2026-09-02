import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute, bodyHalfExtentFor } from '../autoRoute';
import { chamberSpec, polygonPoints, circumradiusPx, portStates } from '../chamber';
import { getNodeGeometry, sizeOf } from '../../utils/nodeGeometry';
import { layoutToJSON, layoutFromJSON } from '../../utils/export';
import { unitAt } from '../geometry';
import { diffractedDirection, DEFAULT_DEFLECT_DEG } from '../diffraction';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const AXIS = 600;

/** Place a node so its centre sits at (cx, cy). */
function at(
  id: string,
  data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] },
  cx: number,
  cy: number,
): Node<OpticalNodeData> {
  const full = { name: id, category: 'coldatom', ...data } as OpticalNodeData;
  const g = sizeOf({ data: full as unknown as { type?: string } });
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const laser = (id = 'L1', cy = AXIS, rotation = 0) => at(id, {
  type: 'laser_source', category: 'source', wavelength: 780, outputPower: 100,
  polarization: 'H', rotation,
}, 200, cy);

const chamber = (over: Record<string, unknown> = {}, cx = 900, cy = AXIS) =>
  at('CH', { type: 'vacuum_chamber', ...over } as Partial<OpticalNodeData> & { type: 'vacuum_chamber' }, cx, cy);

/** A detector far past the chamber, to catch whatever gets through. */
const pd = (cx = 1700, cy = AXIS) => at('PD', {
  type: 'photodiode', category: 'detection', signalFactor: 1, gain: 1,
}, cx, cy);

const arriving = (result: ReturnType<typeof autoRoute>, id: string) => result.nodeBeams.get(id);

// ── Getting light across the chamber ──────────────────────────────────────────

describe('a beam crossing the chamber', () => {
  it('passes through a pair of open ports and reaches the far side', () => {
    const r = autoRoute([laser(), chamber(), pd()], []);
    const out = arriving(r, 'PD');
    expect(out).toBeDefined();
    expect(out!.power).toBeCloseTo(100, 6);      // ideal windows by default
    expect(r.warnings).toHaveLength(0);
  });

  it('is drawn crossing the body rather than stopping at the wall', () => {
    // A chamber is in BEAM_THROUGH_TYPES: the figure shows the beam inside the vacuum,
    // which is the whole point of a MOT drawing.
    const r = autoRoute([laser(), chamber(), pd()], []);
    const intoChamber = r.segments.find(s => s.targetId === 'CH')!;
    const centre = 900;
    expect(intoChamber.x2).toBeCloseTo(centre, 6);
  });

  it('attenuates by both windows', () => {
    const r = autoRoute([laser(), chamber({ transmission: 99 }), pd()], []);
    expect(arriving(r, 'PD')!.power).toBeCloseTo(100 * 0.99 * 0.99, 6);
  });

  it('carries the beam through unchanged in colour and detuning', () => {
    // The shifted light is the diffracted order, and that now leaves the cell at an angle, so
    // the chamber sits on the diffracted line and is turned to meet it square on.
    const cell = { type: 'aom', category: 'modulation', rfFrequency: 80,
      diffractionEfficiency: 100, activeOrder: '+1' } as Partial<OpticalNodeData> & { type: 'aom' };
    const d = diffractedDirection(unitAt(0), 0, cell as OpticalNodeData);
    const along = (r: number) => ({ x: 500 + d.dx * r, y: AXIS + d.dy * r });
    const chamberAt = along(400);
    const pdAt = along(1100);

    const nodes = [
      laser(),
      at('A1', cell, 500, AXIS),
      chamber({ rotation: DEFAULT_DEFLECT_DEG }, chamberAt.x, chamberAt.y),
      pd(pdAt.x, pdAt.y),
    ];
    const out = arriving(autoRoute(nodes, []), 'PD')!;
    expect(out.wavelength).toBe(780);
    expect(out.detuningHz).toBeCloseTo(80e6, 0);
  });
});

// ── Being stopped by the hardware ─────────────────────────────────────────────

describe('a beam the chamber stops', () => {
  it('is absorbed at a blanked entry flange, and says so', () => {
    // Travelling +x, the beam arrives at the port on the far side of the ring: index 6.
    const ports = portStates([], 12);
    ports[6] = 'closed';
    const r = autoRoute([laser(), chamber({ ports }), pd()], []);
    expect(arriving(r, 'PD')).toBeUndefined();
    expect(r.warnings.some(w => w.nodeId === 'CH' && /blanked-off flange/.test(w.message))).toBe(true);
  });

  it('is absorbed inside when the exit flange is blanked', () => {
    const ports = portStates([], 12);
    ports[0] = 'closed';
    const r = autoRoute([laser(), chamber({ ports }), pd()], []);
    expect(arriving(r, 'PD')).toBeUndefined();
    expect(r.warnings.some(w => /absorbed inside the chamber/.test(w.message))).toBe(true);
  });

  it('is absorbed by the wall when it is not square on to a pair of flats', () => {
    // The chamber turned 15° puts a corner where the beam arrives — on the 15° beam
    // lattice that is exactly the case a dodecagon cannot pass.
    const r = autoRoute([laser(), chamber({ rotation: 15 }), pd()], []);
    expect(arriving(r, 'PD')).toBeUndefined();
    expect(r.warnings.some(w => /wall between two flats/.test(w.message))).toBe(true);
  });

  it('passes again when the chamber is turned onto a face normal', () => {
    // 30° is a face step, so the same beam clears it.
    const r = autoRoute([laser(), chamber({ rotation: 30 }), pd()], []);
    expect(arriving(r, 'PD')).toBeDefined();
    expect(r.warnings).toHaveLength(0);
  });

  it('warns once per chamber, not once per bounce', () => {
    const ports = portStates([], 12);
    ports[0] = 'closed';
    const r = autoRoute([laser(), chamber({ ports }), pd()], []);
    expect(r.warnings.filter(w => w.nodeId === 'CH')).toHaveLength(1);
  });

  it('says so for a chamber with no opposite ports at all', () => {
    const r = autoRoute([laser(), chamber({ sides: 7 }), pd()], []);
    expect(arriving(r, 'PD')).toBeUndefined();
    expect(r.warnings.some(w => /even number of sides/.test(w.message))).toBe(true);
  });
});

// ── Where it sits and how big it is ───────────────────────────────────────────

describe('chamber geometry in the layout', () => {
  it('occupies the square across its corners, whatever its rotation', () => {
    const across = 2 * circumradiusPx(chamberSpec(chamber().data).inradiusPx, 12);
    expect(sizeOf(chamber())).toEqual({ width: across, height: across });
    // Rotation-invariant on purpose: a polygon's own bounding square does not grow when
    // turned, unlike the rectangle rule `getNodeGeometry` applies to everything else.
    expect(sizeOf(chamber({ rotation: 45 }))).toEqual({ width: across, height: across });
  });

  it('is a 10 inch part next to a 1 inch mirror', () => {
    const mirror = getNodeGeometry('dielectric_mirror', 0).width;
    expect(sizeOf(chamber()).width / mirror).toBeGreaterThan(9);
  });

  it('takes the octagon size when told it is one', () => {
    const oct = sizeOf(chamber({ sides: 8, inradiusMm: 100.5 }));
    const dodec = sizeOf(chamber());
    expect(oct.width).toBeLessThan(dodec.width);
  });

  it('trims a beam to the polygon, not to a box', () => {
    // Along a face normal the boundary is the inradius; towards a corner it is further out,
    // by exactly 1/cos(15°) on a dodecagon.
    const data = chamber().data;
    const spec = chamberSpec(data);
    expect(bodyHalfExtentFor(data, 0, unitAt(0))).toBeCloseTo(spec.inradiusPx, 6);
    expect(bodyHalfExtentFor(data, 0, unitAt(15)))
      .toBeCloseTo(spec.inradiusPx / Math.cos(Math.PI / 12), 6);
    // And it turns with the chamber.
    expect(bodyHalfExtentFor({ ...data, rotation: 15 } as OpticalNodeData, 15, unitAt(15)))
      .toBeCloseTo(spec.inradiusPx, 6);
  });

  it('is never turned to face a beam', () => {
    // A chamber is bolted down: spinning it to line up with a stray beam would drag every
    // other port across the layout.
    const r = autoRoute([laser(), chamber({ rotation: 30 }), pd()], []);
    expect(r.rotations.get('CH') ?? 30).toBe(30);
  });

  it('draws a corner for every side, on the inradius circle', () => {
    const spec = chamberSpec(chamber().data);
    const pts = polygonPoints(spec.inradiusPx, spec.sides);
    expect(pts).toHaveLength(12);
    const circum = circumradiusPx(spec.inradiusPx, 12);
    for (const p of pts) expect(Math.hypot(p.x, p.y)).toBeCloseTo(circum, 6);
  });
});

// ── Saving ────────────────────────────────────────────────────────────────────

describe('a chamber in the layout file', () => {
  it('round-trips its geometry and every port', () => {
    const ports = portStates([], 12);
    ports[3] = 'closed';
    ports[9] = 'closed';
    const back = layoutFromJSON(layoutToJSON([chamber({ ports, sides: 12, inradiusMm: 134.62 })], []));
    const data = back.nodes[0].data as unknown as Record<string, unknown>;
    expect(data.sides).toBe(12);
    expect(data.inradiusMm).toBeCloseTo(134.62, 2);
    expect((data.ports as string[])[3]).toBe('closed');
    expect((data.ports as string[])[9]).toBe('closed');
    expect((data.ports as string[])[0]).toBe('viewport');
  });
});
