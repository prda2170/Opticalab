import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { componentOutputs } from '../propagate';
import { bodyAxis } from '../lanes';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

/** A laser whose *centre* is at (cx, cy), facing along its rotation. */
const laser = (id: string, cx: number, cy: number, rotation = 0, power = 100) => at(id, {
  type: 'laser_source', category: 'source', name: id, rotation,
  wavelength: 780, outputPower: power, polarization: 'H', waist: 800, mSquared: 1,
} as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy);

const mirror = (id: string, cx: number, cy: number, rotation: number) =>
  at(id, { type: 'dielectric_mirror', reflectivity: 100, rotation }, cx, cy);

const pd = (id: string, cx: number, cy: number) =>
  at(id, { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, cx, cy);

const AXIS = 100;

// ── Multi-direction entry ─────────────────────────────────────────────────────

describe('autoRoute — entry from any direction', () => {
  it('reflects two beams that cross at one mirror', () => {
    // The old direction caps rejected a perpendicular second entry outright, so the
    // second beam sailed straight through the mirror.
    const nodes = [
      laser('L1', 45, AXIS),                     // rightward along y = 100
      laser('L2', 400, 45, 90),                  // downward along x = 400
      mirror('M', 400, AXIS, 0),                 // "/" — right→up and down→left
    ];
    const { segments } = autoRoute(nodes, []);

    const arriving = segments.filter(s => s.targetId === 'M');
    expect(arriving).toHaveLength(2);

    const leaving = segments.filter(s => s.sourceId === 'M');
    expect(leaving).toHaveLength(2);
    // One goes up (from the rightward beam), one goes left (from the downward beam).
    expect(leaving.some(s => s.y2 < s.y1 && Math.abs(s.x2 - s.x1) < 1)).toBe(true);
    expect(leaving.some(s => s.x2 < s.x1 && Math.abs(s.y2 - s.y1) < 1)).toBe(true);
  });

  it('emits a turned laser along its own centre-line', () => {
    // The emission point used to come from the *unrotated* geometry, so a vertical
    // laser (66×90 once turned, not 90×66) fired 12 px to the right of its own axis —
    // past BEAM_SNAP_DIST, so anything properly lined up under it was missed.
    const nodes = [laser('L2', 400, 45, 90), pd('PD', 400, 400)];
    const { segments, snaps } = autoRoute(nodes, []);
    const seg = segments.find(s => s.sourceId === 'L2')!;

    expect(seg.targetId).toBe('PD');
    expect(seg.x1).toBeCloseTo(400, 6);
    expect(seg.x2).toBeCloseTo(400, 6);
    expect(snaps.has('PD')).toBe(false);   // nothing to correct
  });

  it('still positions a component from the first beam only', () => {
    const nodes = [
      laser('L1', 45, AXIS),
      laser('L2', 400, 45, 90),
      mirror('M', 400, AXIS + 5, 0),             // 5 px off both beams
    ];
    const { snaps, rotations } = autoRoute(nodes, []);
    const g = getNodeGeometry('dielectric_mirror');
    // Snapped onto the first beam's axis (y = 100), not split between the two.
    expect(snaps.get('M')!.y + g.height / 2).toBeCloseTo(AXIS, 6);
    expect(rotations.get('M')).toBe(0);
  });
});

// ── Loops ─────────────────────────────────────────────────────────────────────

describe('autoRoute — loop detection', () => {
  /**
   * A square ring: the beam is injected through a 50:50 coupler, goes round
   * NPBS → BR → TR → TL → NPBS, and arrives back at BR travelling the way it first
   * did. That is a closed loop and the trace must stop there.
   */
  const ring = () => [
    laser('L1', 45, 433),
    at('NPBS', { type: 'npbs', splitRatio: '50:50', rotation: 90 }, 300, 433),
    mirror('BR', 600, 433, 0),     // right → up
    mirror('TR', 600, 133, 90),    // up → left
    mirror('TL', 300, 133, 0),     // left → down
  ];

  it('traces a ring cavity exactly once round and stops', () => {
    const { segments, truncated } = autoRoute(ring(), []);

    // The beam reached BR twice: once injected, once having gone round.
    const intoBR = segments.filter(s => s.targetId === 'BR');
    expect(intoBR).toHaveLength(2);

    // The loop-closing segment is drawn, but nothing leaves BR a second time.
    expect(segments.filter(s => s.sourceId === 'BR')).toHaveLength(1);

    // It terminated by closing the loop, not by running out of budget.
    expect(truncated).toBe(false);
  });

  it('halves the circulating power on each pass through the coupler', () => {
    const { segments } = autoRoute(ring(), []);
    const intoBR = segments.filter(s => s.targetId === 'BR').map(s => s.beam.power);
    // Injected through the coupler (50 %), then round and through it again (25 %).
    expect(Math.max(...intoBR)).toBeCloseTo(50, 6);
    expect(Math.min(...intoBR)).toBeCloseTo(25, 6);
  });

  it('terminates a ring with perfect mirrors instead of hanging', () => {
    const nodes = ring().map(n =>
      n.data.type === 'dielectric_mirror'
        ? { ...n, data: { ...n.data, reflectivity: 100 } as OpticalNodeData }
        : n,
    );
    const { segments } = autoRoute(nodes, []);
    expect(segments.length).toBeGreaterThan(4);
    expect(segments.length).toBeLessThan(40);
  });
});

// ── Lasers absorb ─────────────────────────────────────────────────────────────

describe('autoRoute — a beam reaching a laser', () => {
  const facing = () => [
    laser('L1', 45, AXIS, 0),
    laser('L2', 600, AXIS, 180),
    pd('PD', 900, AXIS),
  ];

  it('stops at the laser instead of passing through it', () => {
    const { segments, nodeBeams } = autoRoute(facing(), []);
    expect(segments.some(s => s.targetId === 'L2')).toBe(true);
    // Nothing gets past L2 to the detector beyond it.
    expect(nodeBeams.get('PD')).toBeUndefined();
    expect(segments.some(s => s.targetId === 'PD')).toBe(false);
  });

  it('warns about optical feedback, once per laser', () => {
    const { warnings } = autoRoute(facing(), []);
    expect(warnings).toHaveLength(2);
    expect(warnings.map(w => w.nodeId).sort()).toEqual(['L1', 'L2']);
    for (const w of warnings) expect(w.message).toMatch(/isolator/i);
  });

  it('says nothing when no beam reaches a laser', () => {
    const nodes = [laser('L1', 45, AXIS), pd('PD', 600, AXIS)];
    expect(autoRoute(nodes, []).warnings).toEqual([]);
  });

  it('reports no outputs for a laser that is hit', () => {
    const beam: BeamState = { wavelength: 780, power: 100, polarization: { type: 'H' } };
    expect(componentOutputs(beam, laser('L1', 0, 0).data)).toEqual([]);
  });
});

// ── Isolators are one-way ─────────────────────────────────────────────────────

describe('isolator direction', () => {
  const iso = (over: Partial<OpticalNodeData> = {}) => ({
    type: 'isolator', name: 'ISO', category: 'conditioning',
    transmission: 90, isolation: 30, rotation: 0,
    ...over,
  } as OpticalNodeData);
  const beam: BeamState = { wavelength: 780, power: 100, polarization: { type: 'H' } };

  it('transmits along the way it faces', () => {
    const [port] = componentOutputs(beam, iso(), { entryLane: 0, entryDir: bodyAxis(0) });
    expect(port.beam.power).toBeCloseTo(90, 6);
  });

  it('attenuates a beam coming back the other way by its isolation figure', () => {
    const [port] = componentOutputs(beam, iso(), { entryLane: 0, entryDir: { dx: -1, dy: 0 } });
    expect(port.beam.power).toBeCloseTo(100 * 1e-3, 9);   // 30 dB
  });

  it('scales with the isolation figure', () => {
    const at40 = componentOutputs(beam, iso({ isolation: 40 } as Partial<OpticalNodeData>), { entryLane: 0, entryDir: { dx: -1, dy: 0 } })[0];
    expect(at40.beam.power).toBeCloseTo(100 * 1e-4, 9);
  });

  it('follows the component rotation, not the screen', () => {
    // Facing down: a downward beam is forward, an upward one is blocked.
    const forward = componentOutputs(beam, iso({ rotation: 90 } as Partial<OpticalNodeData>), { entryLane: 0, entryDir: { dx: 0, dy: 1 } })[0];
    const reverse = componentOutputs(beam, iso({ rotation: 90 } as Partial<OpticalNodeData>), { entryLane: 0, entryDir: { dx: 0, dy: -1 } })[0];
    expect(forward.beam.power).toBeCloseTo(90, 6);
    expect(reverse.beam.power).toBeCloseTo(0.1, 9);
  });

  it('assumes forward when no direction is given', () => {
    // The properties panel previews outputs without a beam direction.
    expect(componentOutputs(beam, iso())[0].beam.power).toBeCloseTo(90, 6);
  });

  it('protects the upstream laser in a real layout', () => {
    // Two facing lasers put a beam through the isolator in each direction — which the
    // old anti-parallel ban made impossible to model at all.
    const nodes = [
      laser('L1', 45, AXIS, 0),
      at('ISO', iso() as Partial<OpticalNodeData> & { type: 'isolator' }, 300, AXIS),
      laser('L2', 600, AXIS, 180),
    ];
    const { segments } = autoRoute(nodes, []);
    const leaving = segments.filter(s => s.sourceId === 'ISO');
    expect(leaving).toHaveLength(2);

    const forward = leaving.find(s => s.x2 > s.x1)!;
    const reverse = leaving.find(s => s.x2 < s.x1)!;
    expect(forward.beam.power).toBeCloseTo(90, 6);        // 100 mW × 90 %
    expect(reverse.beam.power).toBeCloseTo(0.1, 9);       // 100 mW × 30 dB
    // The attenuated return beam still reaches L1, but four orders down.
    expect(reverse.beam.power / forward.beam.power).toBeLessThan(1e-2);
  });
});
