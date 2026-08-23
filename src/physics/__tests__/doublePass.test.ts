import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { componentOutputs, componentABCD, advanceBeam, laserBeam } from '../propagate';
import { transformQ } from '../gaussian';
import { pxToMm, mmToPx } from '../scale';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState, BeamSegment } from '../../types/beam';
import { getNodeGeometry } from '../../utils/nodeGeometry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function at(id: string, data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] }, cx: number, cy: number): Node<OpticalNodeData> {
  const full = { name: id, category: 'steering', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const retro = (over: Partial<OpticalNodeData> = {}) => ({
  type: 'retroreflector', name: 'RR', category: 'steering',
  reflectivity: 100, focalLength: 100, ...over,
} as OpticalNodeData);

const inBeam: BeamState = { wavelength: 780, power: 100, polarization: { type: 'H' } };

// ── The retro port ────────────────────────────────────────────────────────────

describe('retroreflector', () => {
  it('emits a single retro port', () => {
    const ports = componentOutputs(inBeam, retro());
    expect(ports).toHaveLength(1);
    expect(ports[0].handle).toBe('retro');
    expect(ports[0].kind).toBe('retro');
  });

  it('applies its reflectivity', () => {
    const [port] = componentOutputs(inBeam, retro({ reflectivity: 90 } as Partial<OpticalNodeData>));
    expect(port.beam.power).toBeCloseTo(90, 6);
  });

  it('images its own plane when used as a cat eye', () => {
    // q → q − 2f, which cancels the 2f the beam flies there and back.
    const f = 100;
    const M = componentABCD(retro({ focalLength: f } as Partial<OpticalNodeData>));
    expect(M).toEqual({ A: -1, B: 2 * f, C: 0, D: -1 });
    expect(M.A * M.D - M.B * M.C).toBeCloseTo(1, 12);   // still a valid ray-transfer matrix

    const q: [number, number] = [37, 2577];
    expect(transformQ(q, M)[0]).toBeCloseTo(q[0] - 2 * f, 6);
    expect(transformQ(q, M)[1]).toBeCloseTo(q[1], 6);
  });

  it('hands q back untouched as a corner cube', () => {
    const M = componentABCD(retro({ focalLength: 0 } as Partial<OpticalNodeData>));
    expect(M).toEqual({ A: 1, B: 0, C: 0, D: 1 });
  });

  it('returns a double-passed beam to its original size when placed at f', () => {
    const laser = { type: 'laser_source', name: 'L', category: 'source', wavelength: 780,
      outputPower: 100, polarization: 'H', waist: 800, mSquared: 1 } as OpticalNodeData & { type: 'laser_source' };
    const f = 100;
    const start = laserBeam(laser);

    // Out to the cat eye one focal length away, round trip, and back again.
    const atRetro = advanceBeam(start, f);
    const [port] = componentOutputs(atRetro, retro({ focalLength: f } as Partial<OpticalNodeData>));
    const back = advanceBeam(port.beam, f);

    expect(back.w!).toBeCloseTo(start.w!, 6);
    // A corner cube instead keeps diverging over the same 2f.
    const [cube] = componentOutputs(atRetro, retro({ focalLength: 0 } as Partial<OpticalNodeData>));
    expect(advanceBeam(cube.beam, f).w!).toBeGreaterThan(start.w!);
  });

  it('sends the beam back the way it came, from any direction', () => {
    const AXIS = 100;
    const build = (rotation: number, cx: number, cy: number, rx: number, ry: number) => [
      at('L1', { type: 'laser_source', category: 'source', name: 'L1', rotation,
        wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, cx, cy),
      at('RR', retro() as Partial<OpticalNodeData> & { type: 'retroreflector' }, rx, ry),
    ];

    // Rightward in → leftward out.
    const right = autoRoute(build(0, 45, AXIS, 500, AXIS), []);
    const outR = right.segments.find(s => s.sourceId === 'RR')!;
    expect(outR.x2).toBeLessThan(outR.x1);
    expect(outR.y1).toBeCloseTo(AXIS, 6);

    // Downward in → upward out.
    const down = autoRoute(build(90, 400, 45, 400, 500), []);
    const outD = down.segments.find(s => s.sourceId === 'RR')!;
    expect(outD.y2).toBeLessThan(outD.y1);
  });

  it('draws the return beam alongside the outgoing one', () => {
    const nodes = [
      at('L1', { type: 'laser_source', category: 'source', name: 'L1',
        wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
      } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, 100),
      at('RR', retro() as Partial<OpticalNodeData> & { type: 'retroreflector' }, 500, 100),
    ];
    const { segments } = autoRoute(nodes, []);
    const out = segments.find(s => s.targetId === 'RR')!;
    const back = segments.find(s => s.sourceId === 'RR')!;
    // Physically the same line…
    expect(out.y1).toBeCloseTo(back.y1, 6);
    // …but one of them is displaced for drawing, so both stay visible.
    expect(out.renderShift ?? back.renderShift).toBeDefined();
  });
});

// ── Polarisation through two waveplate passes ────────────────────────────────

describe('quarter-wave plate, crossed twice', () => {
  const qwp = (fastAxisAngle: number) => ({
    type: 'qwp', name: 'QWP', category: 'conditioning', fastAxisAngle,
  } as OpticalNodeData);
  const pass = (beam: BeamState, angle: number) => componentOutputs(beam, qwp(angle))[0].beam;

  it('turns H into named circular light at 45°', () => {
    const out = pass(inBeam, 45);
    expect(out.polarization.type).toBe('circular');
    expect(['L', 'R']).toContain((out.polarization as { handedness: string }).handedness);
  });

  it('turns that circular light into V on the way back', () => {
    // Two passes of a λ/4 make a λ/2 — this is what lets a PBS extract the return beam.
    expect(pass(pass(inBeam, 45), 45).polarization.type).toBe('V');
  });

  it('leaves H alone at 0°, so a PBS would send the beam straight back', () => {
    expect(pass(pass(inBeam, 0), 0).polarization.type).toBe('H');
  });

  it('flips the handedness of circular light, as a half-wave plate must', () => {
    // Two λ/4 passes are a λ/2, and a half-wave plate reverses circular handedness.
    const circular: BeamState = { ...inBeam, polarization: { type: 'circular', handedness: 'L' } };
    expect(pass(pass(circular, 0), 0).polarization).toEqual({ type: 'circular', handedness: 'R' });
    // One pass takes circular light to linear.
    expect(pass(circular, 0).polarization.type).toBe('custom');
  });

  it('still calls a genuinely elliptical state custom', () => {
    // 30° is neither linear nor circular after one pass.
    expect(pass(inBeam, 30).polarization.type).toBe('custom');
  });
});

// ── Case 2: the double-passed AOM ─────────────────────────────────────────────

describe('double-passed AOM', () => {
  const AXIS = 233;
  const F_RF = 80;

  /**
   * The canonical layout: H in through a PBS, an AOM, a λ/4 at 45°, and a cat eye.
   * Two passes of the waveplate rotate H to V, so the PBS reflects the return beam out
   * on a separate port instead of sending it back to the laser.
   */
  const layout = (over: { rfFrequency?: number; efficiency?: number } = {}) => [
    at('L1', {
      type: 'laser_source', category: 'source', name: 'Master',
      wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
    } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, AXIS),
    at('PBS', { type: 'pbs', rotation: 0 }, 300, AXIS),
    at('AOM', {
      type: 'aom', category: 'modulation',
      rfFrequency: over.rfFrequency ?? F_RF, rfPower: 33,
      diffractionEfficiency: over.efficiency ?? 80, transmission: 98, activeOrder: '+1',
    } as Partial<OpticalNodeData> & { type: 'aom' }, 600, AXIS),
    at('QWP', { type: 'qwp', category: 'conditioning', fastAxisAngle: 45 }, 850, AXIS),
    at('RR', retro() as Partial<OpticalNodeData> & { type: 'retroreflector' }, 1050, AXIS),
    // The extracted beam leaves the PBS downwards ("/" reflects a leftward beam down).
    at('OUT', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS + 300),
  ];

  const segTo = (segs: BeamSegment[], id: string) => segs.filter(s => s.targetId === id);

  it('shifts the beam twice, once per pass', () => {
    const { nodeBeams } = autoRoute(layout(), []);
    expect(nodeBeams.get('OUT')!.detuningHz).toBe(2 * F_RF * 1e6);   // +160 MHz
  });

  it('costs the diffraction efficiency twice', () => {
    const { nodeBeams } = autoRoute(layout(), []);
    // η² — the well-known double-pass penalty. 100 mW × 0.8² = 64 mW.
    expect(nodeBeams.get('OUT')!.power).toBeCloseTo(100 * 0.8 * 0.8, 6);
  });

  it('scales as η² when efficiency changes', () => {
    const { nodeBeams } = autoRoute(layout({ efficiency: 50 }), []);
    expect(nodeBeams.get('OUT')!.power).toBeCloseTo(100 * 0.25, 6);
  });

  it('tunes the shift with the drive frequency', () => {
    const { nodeBeams } = autoRoute(layout({ rfFrequency: 110 }), []);
    expect(nodeBeams.get('OUT')!.detuningHz).toBe(220e6);
  });

  it('rotates the polarisation to V so the PBS extracts it', () => {
    const { nodeBeams, segments } = autoRoute(layout(), []);
    expect(nodeBeams.get('OUT')!.polarization.type).toBe('V');
    // The extracted beam leaves the PBS travelling downwards.
    const extracted = segments.find(s => s.targetId === 'OUT')!;
    expect(extracted.sourceId).toBe('PBS');
    expect(extracted.y2).toBeGreaterThan(extracted.y1);
    expect(Math.abs(extracted.x2 - extracted.x1)).toBeLessThan(1);
  });

  it('traverses the AOM, the waveplate and the PBS exactly twice', () => {
    const { segments } = autoRoute(layout(), []);
    expect(segTo(segments, 'AOM')).toHaveLength(2);
    expect(segTo(segments, 'QWP')).toHaveLength(2);
    expect(segTo(segments, 'PBS')).toHaveLength(2);
    expect(segTo(segments, 'RR')).toHaveLength(1);
  });

  it('sends nothing back at the laser', () => {
    const { segments, warnings } = autoRoute(layout(), []);
    // The return beam is V, so the PBS transmits none of it toward the source — and an
    // extinguished port isn't traced, so no beam is drawn back at the laser either.
    expect(segTo(segments, 'L1')).toHaveLength(0);
    expect(warnings).toEqual([]);
  });

  it('draws no beam for the unused polarisation port', () => {
    // A pure-H input leaves the PBS's V port empty; it must not streak off the figure.
    const { segments } = autoRoute(layout(), []);
    for (const s of segments) expect(s.beam.power).toBeGreaterThan(0);
  });

  it('keeps the return beam the same size as the outgoing one at the AOM', () => {
    // The cat eye is 200 px ≈ 127 mm from the AOM here, not its 100 mm focal length,
    // so imaging is imperfect — but the mismatch should stay small.
    const { segments } = autoRoute(layout(), []);
    const [firstPass, returnPass] = segTo(segments, 'AOM').map(s => s.beam.w!);
    expect(Math.abs(returnPass - firstPass) / firstPass).toBeLessThan(0.05);
  });

  it('sends a tighter beam back than a corner cube does', () => {
    // A cat eye re-images, so the return beam is smaller than a plain retro's over the
    // same geometry. (The exact imaging identity is asserted on the physics above —
    // it can't be read off segments, whose beams are stated at their *start*.)
    const withRetro = (focalLength: number) => {
      const nodes = layout();
      const i = nodes.findIndex(n => n.id === 'RR');
      nodes[i] = at('RR', retro({ focalLength }) as Partial<OpticalNodeData> & { type: 'retroreflector' },
        600 + mmToPx(100), AXIS);
      const { segments } = autoRoute(nodes, []);
      return segments.find(s => s.sourceId === 'RR')!.beam.w!;
    };

    expect(withRetro(100)).toBeLessThan(withRetro(0));
    // And the beam meets the lens face, not the bounding box.
    expect(getNodeGeometry('retroreflector').beamFaceHalf).toBe(13);
  });

  it('does not mistake the second pass for a loop', () => {
    const { truncated, segments } = autoRoute(layout(), []);
    expect(truncated).toBe(false);
    // Out and back: laser→PBS, PBS→AOM, AOM→QWP, QWP→RR, and the four return legs.
    expect(segments.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * The arrangement AMO benches actually use: the PBS and the λ/4 both sit *before*
   * the AOM, so the whole double-passed section is AOM → retro. The waveplate is still
   * crossed once each way, so the return beam is V and the PBS sends it out on a
   * different path from the input.
   */
  const qwpBeforeAom = () => [
    at('L1', {
      type: 'laser_source', category: 'source', name: 'Master',
      wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
    } as Partial<OpticalNodeData> & { type: 'laser_source' }, 45, AXIS),
    at('PBS', { type: 'pbs', rotation: 0 }, 300, AXIS),
    at('QWP', { type: 'qwp', category: 'conditioning', fastAxisAngle: 45 }, 450, AXIS),
    at('AOM', {
      type: 'aom', category: 'modulation', rfFrequency: F_RF, rfPower: 33,
      diffractionEfficiency: 80, transmission: 98, activeOrder: '+1',
    } as Partial<OpticalNodeData> & { type: 'aom' }, 700, AXIS),
    at('RR', retro() as Partial<OpticalNodeData> & { type: 'retroreflector' }, 950, AXIS),
    at('OUT', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS + 300),
  ];

  describe('with the PBS and λ/4 before the AOM', () => {
    it('extracts 2×f_RF on a separate path', () => {
      const { nodeBeams, segments } = autoRoute(qwpBeforeAom(), []);
      const out = nodeBeams.get('OUT')!;
      expect(out.detuningHz).toBe(2 * F_RF * 1e6);
      expect(out.power).toBeCloseTo(100 * 0.8 * 0.8, 6);
      expect(out.polarization.type).toBe('V');

      // Input arrives from the left; the extracted beam leaves downwards.
      const extracted = segments.find(s => s.targetId === 'OUT')!;
      expect(extracted.sourceId).toBe('PBS');
      expect(extracted.y2).toBeGreaterThan(extracted.y1);
      const input = segments.find(s => s.targetId === 'PBS' && s.sourceId === 'L1')!;
      expect(input.x2).toBeGreaterThan(input.x1);
    });

    it('crosses the waveplate once each way', () => {
      const { segments } = autoRoute(qwpBeforeAom(), []);
      expect(segTo(segments, 'QWP')).toHaveLength(2);
      const dirs = segTo(segments, 'QWP').map(s => Math.sign(s.x2 - s.x1));
      expect(dirs.sort()).toEqual([-1, 1]);      // one each way
    });

    it('sends the beam through the AOM circularly polarised on both passes', () => {
      // The λ/4 is upstream, so the cell sees circular light — it must not disturb it,
      // and the readout should say so rather than "custom".
      const { segments, nodeBeams } = autoRoute(qwpBeforeAom(), []);
      expect(nodeBeams.get('AOM')!.polarization.type).toBe('circular');
      for (const s of segTo(segments, 'AOM')) {
        expect(s.beam.polarization.type).toBe('circular');
      }
      // The retro sees it too, and the handedness is consistent along the arm.
      expect(nodeBeams.get('RR')!.polarization.type).toBe('circular');
    });

    it('leaves nothing heading back at the laser', () => {
      const { segments, warnings } = autoRoute(qwpBeforeAom(), []);
      expect(segTo(segments, 'L1')).toHaveLength(0);
      expect(warnings).toEqual([]);
      // Every drawn beam carries light.
      for (const s of segments) expect(s.beam.power).toBeGreaterThan(0);
    });

    it('extracts upward instead when the PBS is turned the other way', () => {
      // Bench layouts differ; a "\" PBS sends the V return beam up rather than down.
      const nodes = qwpBeforeAom();
      const i = nodes.findIndex(n => n.id === 'PBS');
      nodes[i] = at('PBS', { type: 'pbs', rotation: 90 }, 300, AXIS);
      const j = nodes.findIndex(n => n.id === 'OUT');
      nodes[j] = at('OUT', { type: 'photodiode', category: 'detection', bandwidth: 100, signalFactor: 1 }, 300, AXIS - 300);

      const { nodeBeams, segments } = autoRoute(nodes, []);
      expect(nodeBeams.get('OUT')!.detuningHz).toBe(2 * F_RF * 1e6);
      expect(nodeBeams.get('OUT')!.power).toBeCloseTo(64, 6);
      const extracted = segments.find(s => s.targetId === 'OUT')!;
      expect(extracted.y2).toBeLessThan(extracted.y1);
    });

    it('matches the other arrangement exactly', () => {
      // Waveplate before or after the cell, the result is the same: it is crossed twice.
      const a = autoRoute(layout(), []).nodeBeams.get('OUT')!;
      const b = autoRoute(qwpBeforeAom(), []).nodeBeams.get('OUT')!;
      expect(b.detuningHz).toBe(a.detuningHz);
      expect(b.power).toBeCloseTo(a.power, 6);
      expect(b.polarization.type).toBe(a.polarization.type);
    });

    it('still works with the −1 order, shifting down twice', () => {
      const nodes = qwpBeforeAom();
      const i = nodes.findIndex(n => n.id === 'AOM');
      nodes[i] = at('AOM', {
        type: 'aom', category: 'modulation', rfFrequency: F_RF, rfPower: 33,
        diffractionEfficiency: 80, transmission: 98, activeOrder: '-1',
      } as Partial<OpticalNodeData> & { type: 'aom' }, 700, AXIS);
      const { nodeBeams } = autoRoute(nodes, []);
      expect(nodeBeams.get('OUT')!.detuningHz).toBe(-2 * F_RF * 1e6);
      expect(nodeBeams.get('OUT')!.power).toBeCloseTo(64, 6);
    });

    it('drops to a single pass if the retro is removed', () => {
      // Sanity check that the doubling really comes from the return trip.
      const nodes = qwpBeforeAom().filter(n => n.id !== 'RR');
      const { nodeBeams, segments } = autoRoute(nodes, []);
      expect(nodeBeams.get('OUT')).toBeUndefined();
      expect(segTo(segments, 'AOM')).toHaveLength(1);
    });
  });

  it('reports the round-trip path length', () => {
    const { segments } = autoRoute(layout(), []);
    const total = segments.reduce((s, seg) => s + (seg.free ? 0 : seg.lengthMm), 0);
    // Roughly twice the ~1000 px from the PBS to the cat eye, plus the extraction arm.
    expect(total).toBeGreaterThan(pxToMm(1800));
  });
});
