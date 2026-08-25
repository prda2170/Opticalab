import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type { BeamEdgeData } from '../../types/components';
import { layoutToJSON, layoutFromJSON, LAYOUT_VERSION } from '../../utils/export';
import { autoRoute } from '../autoRoute';
import { detectorVolts } from '../detector';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function at(id: string, data: Record<string, unknown>, cx: number, cy: number) {
  const g = getNodeGeometry(data.type as OpticalNodeData['type'], (data.rotation as number) ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data };
}

const AXIS = 33;

const laser = (over: Record<string, unknown> = {}) => ({
  type: 'laser_source', category: 'source', name: 'L1',
  wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1, ...over,
});

/** A file as an old build would have written it. */
const v1File = (nodes: unknown[], edges: unknown[] = [], version: string | null = '1.0') => JSON.stringify({
  ...(version === null ? {} : { version }),
  metadata: { created: '2026-01-01T00:00:00.000Z', app: 'OpticaLab' },
  nodes,
  edges,
});

// ── Round trip ────────────────────────────────────────────────────────────────

describe('layoutToJSON / layoutFromJSON', () => {
  it('stamps the current schema version', () => {
    const written = JSON.parse(layoutToJSON([], []));
    expect(written.version).toBe(LAYOUT_VERSION);
    expect(written.metadata.app).toBe('OpticaLab');
  });

  it('round-trips a layout unchanged, with nothing to report', () => {
    const nodes = [
      at('L1', laser(), 45, AXIS),
      at('PD', { type: 'photodiode', category: 'detection', name: 'PD', bandwidth: 100, signalFactor: 2 }, 500, AXIS),
    ] as unknown as Node<OpticalNodeData>[];
    const edges = [{ id: 'e1', source: 'L1', target: 'PD' }] as Edge<BeamEdgeData>[];

    const back = layoutFromJSON(layoutToJSON(nodes, edges));
    expect(back.nodes).toEqual(nodes);
    expect(back.edges).toEqual(edges);
    expect(back.fileVersion).toBe(LAYOUT_VERSION);
    expect(back.notes).toEqual([]);
  });
});

// ── Refusals ──────────────────────────────────────────────────────────────────

describe('files it will not read', () => {
  it('rejects text that is not JSON, with a message worth showing', () => {
    expect(() => layoutFromJSON('not a layout')).toThrow(/not valid JSON/i);
  });

  it('rejects JSON that is not a layout', () => {
    expect(() => layoutFromJSON('{"hello":"world"}')).toThrow(/does not look like/i);
    expect(() => layoutFromJSON('[]')).toThrow(/does not look like/i);
  });

  it('refuses a file from a newer major version rather than guessing', () => {
    expect(() => layoutFromJSON(v1File([], [], '2.0'))).toThrow(/newer version/i);
  });

  it('reads a newer *minor* version, since those are additive', () => {
    expect(() => layoutFromJSON(v1File([], [], '1.99'))).not.toThrow();
  });

  it('treats a file with no version as the first release', () => {
    const loaded = layoutFromJSON(v1File([], [], null));
    expect(loaded.fileVersion).toBeNull();
    expect(loaded.notes.join(' ')).toMatch(/brought up to/i);
  });
});

// ── Migration: photodiode responsivity → signal factor ────────────────────────

describe('photodiode migration', () => {
  const oldPd = (responsivity?: number) => at('PD', {
    type: 'photodiode', category: 'detection', name: 'PD', bandwidth: 100,
    ...(responsivity === undefined ? {} : { responsivity }),
  }, 500, AXIS);

  it('converts A/W to V/mW on a 50 Ω load', () => {
    const { nodes, notes } = layoutFromJSON(v1File([oldPd(0.5)]));
    const data = nodes[0].data as unknown as Record<string, unknown>;
    expect(data.signalFactor).toBeCloseTo(0.025, 12);   // 0.5 A/W × 50 Ω
    expect(data.responsivity).toBeUndefined();
    expect(notes.join(' ')).toMatch(/50 Ω/);
  });

  it('falls back to 1 V/mW when there was no responsivity either', () => {
    const { nodes, notes } = layoutFromJSON(v1File([oldPd()]));
    expect((nodes[0].data as unknown as Record<string, unknown>).signalFactor).toBe(1);
    expect(notes.join(' ')).toMatch(/defaults to 1 V\/mW/);
  });

  it('gives a reading rather than nothing, which is the point', () => {
    const { nodes } = layoutFromJSON(v1File([oldPd(0.5)]));
    const volts = detectorVolts(nodes[0].data, 100);
    expect(volts).toBeCloseTo(2.5, 9);
    expect(Number.isFinite(volts!)).toBe(true);
  });

  it('leaves a current photodiode alone', () => {
    const current = at('PD', { type: 'photodiode', category: 'detection', name: 'PD', bandwidth: 100, signalFactor: 7 }, 500, AXIS);
    const { nodes, notes } = layoutFromJSON(v1File([current]));
    expect((nodes[0].data as unknown as Record<string, unknown>).signalFactor).toBe(7);
    expect(notes.filter(n => /responsivity|V\/mW/.test(n))).toEqual([]);
  });
});

// ── Migration: amplifier gain/saturation → output power ───────────────────────

describe('optical amplifier migration', () => {
  const oldAmp = (over: Record<string, unknown>) => at('TA', {
    type: 'optical_amplifier', category: 'source', name: 'TA', ...over,
  }, 400, AXIS);

  it('takes the saturated figure as the stated output power', () => {
    const { nodes, notes } = layoutFromJSON(v1File([oldAmp({ gain: 30, saturatedPower: 900 })]));
    const data = nodes[0].data as unknown as Record<string, unknown>;
    expect(data.outputPower).toBe(900);
    expect(data.gain).toBeUndefined();
    expect(data.saturatedPower).toBeUndefined();
    expect(notes.join(' ')).toMatch(/stated output power/);
  });

  it('defaults when the old amplifier was unbounded', () => {
    const { nodes, notes } = layoutFromJSON(v1File([oldAmp({ gain: 20, saturatedPower: 0 })]));
    expect((nodes[0].data as unknown as Record<string, unknown>).outputPower).toBe(1000);
    expect(notes.join(' ')).toMatch(/defaults to 1000 mW/);
  });

  it('never lets a migrated amplifier put NaN on the beam', () => {
    // This is the bug the whole version check exists for: an amplifier with no
    // outputPower used to compute Math.max(0, undefined) = NaN and poison every beam
    // downstream of it.
    const file = v1File([
      at('L1', laser({ outputPower: 30 }), 45, AXIS),
      oldAmp({ gain: 30, saturatedPower: 900 }),
      at('PD', { type: 'photodiode', category: 'detection', name: 'PD', bandwidth: 100, signalFactor: 1 }, 800, AXIS),
    ]);
    const { nodes } = layoutFromJSON(file);
    const { nodeBeams, segments } = autoRoute(nodes, []);

    expect(nodeBeams.get('PD')!.power).toBeCloseTo(900, 6);
    for (const s of segments) expect(Number.isFinite(s.beam.power)).toBe(true);
  });

  it('would have produced NaN without the migration', () => {
    // Guards the guard: feed the same node data straight to the tracer, unmigrated.
    const raw = [
      at('L1', laser({ outputPower: 30 }), 45, AXIS),
      at('TA', { type: 'optical_amplifier', category: 'source', name: 'TA', gain: 30, saturatedPower: 900 }, 400, AXIS),
    ] as unknown as Node<OpticalNodeData>[];
    const { nodeBeams } = autoRoute(raw, []);
    expect(Number.isNaN(nodeBeams.get('TA')!.power)).toBe(false);   // the seed is fine…
    const out = autoRoute(raw, []).segments.find(s => s.sourceId === 'TA');
    // …but what leaves the amplifier is not a number, which is what breaks a layout.
    expect(out === undefined || Number.isNaN(out.beam.power)).toBe(true);
  });
});

// ── Components the app no longer has ─────────────────────────────────────────

describe('unknown and removed components', () => {
  it('leaves out a component this build cannot draw, and says which', () => {
    const file = v1File([
      at('L1', laser(), 45, AXIS),
      // Deliberately types this build has never had. `vacuum_chamber` used to stand in here
      // and then became real, which is the hazard with using a plausible name for this.
      { id: 'ETALON', type: 'optical', position: { x: 300, y: 0 }, data: { type: 'gravity_etalon', category: 'coldatom', name: 'Etalon' } },
      { id: 'STAGE', type: 'optical', position: { x: 600, y: 0 }, data: { type: 'rotation_stage', category: 'optomechanics', name: 'Stage' } },
    ]);
    const { nodes, notes } = layoutFromJSON(file);
    expect(nodes.map(n => n.id)).toEqual(['L1']);
    expect(notes.join(' ')).toMatch(/2 components could not be read/);
    expect(notes.join(' ')).toMatch(/gravity_etalon/);
    expect(notes.join(' ')).toMatch(/rotation_stage/);
  });

  it('drops manual connections that pointed at them', () => {
    const file = v1File(
      [
        at('L1', laser(), 45, AXIS),
        { id: 'GONE', type: 'optical', position: { x: 300, y: 0 }, data: { type: 'breadboard', category: 'optomechanics', name: 'BB' } },
      ],
      [{ id: 'e1', source: 'L1', target: 'GONE' }, { id: 'e2', source: 'L1', target: 'L1' }],
    );
    const { edges, notes } = layoutFromJSON(file);
    expect(edges.map(e => e.id)).toEqual(['e2']);
    expect(notes.join(' ')).toMatch(/manual connection/);
  });

  it('skips malformed nodes instead of handing them to the canvas', () => {
    const file = v1File([
      at('L1', laser(), 45, AXIS),
      null,
      { id: 'no-position', data: { type: 'iris' } },
      { position: { x: 1, y: 2 }, data: { type: 'iris' } },            // no id
      { id: 'nan', position: { x: NaN, y: 0 }, data: { type: 'iris' } },
      { id: 'no-data', position: { x: 0, y: 0 } },
    ]);
    const { nodes, notes } = layoutFromJSON(file);
    expect(nodes.map(n => n.id)).toEqual(['L1']);
    expect(notes.join(' ')).toMatch(/5 components could not be read/);
  });

  it('quietly discards saved phantom beam endpoints, which are regenerated anyway', () => {
    const file = v1File([
      at('L1', laser(), 45, AXIS),
      { id: 'phantom_L1_out_e', type: 'beam_endpoint', position: { x: 4000, y: 33 }, data: {} },
    ]);
    const { nodes, notes } = layoutFromJSON(file);
    expect(nodes.map(n => n.id)).toEqual(['L1']);
    expect(notes.join(' ')).not.toMatch(/could not be read/);
  });
});

// ── The real example layout still loads ──────────────────────────────────────

describe('a layout saved by the previous build', () => {
  it('loads, migrates and traces with finite power throughout', () => {
    const file = v1File([
      at('L1', laser({ outputPower: 40 }), 45, AXIS),
      at('TA', { type: 'optical_amplifier', category: 'source', name: 'TA', gain: 25, saturatedPower: 800 }, 300, AXIS),
      at('HWP', { type: 'hwp', category: 'conditioning', name: 'λ/2', fastAxisAngle: 22.5 }, 500, AXIS),
      at('PBS', { type: 'pbs', category: 'steering', name: 'PBS', rotation: 0 }, 700, AXIS),
      at('PD', { type: 'photodiode', category: 'detection', name: 'PD', bandwidth: 100, responsivity: 0.5 }, 900, AXIS),
    ]);
    const { nodes, notes } = layoutFromJSON(file);
    expect(nodes).toHaveLength(5);
    expect(notes.length).toBeGreaterThan(0);

    const { segments, nodeBeams } = autoRoute(nodes, []);
    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) {
      expect(Number.isFinite(s.beam.power)).toBe(true);
      expect(Number.isFinite(s.beam.wavelength)).toBe(true);
    }
    // Amplified to its saturated figure, then split by the PBS.
    expect(nodeBeams.get('HWP')!.power).toBeCloseTo(800, 6);
    expect(Number.isFinite(detectorVolts(nodes[4].data, nodeBeams.get('PD')?.power ?? 0)!)).toBe(true);
  });
});
