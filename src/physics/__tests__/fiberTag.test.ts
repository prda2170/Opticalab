import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { fiberFedBeam, fiberInputOf, MIN_POWER_MW } from '../propagate';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import { diffractedDirection } from '../diffraction';
import { unitAt } from '../geometry';
import { layoutToJSON, layoutFromJSON } from '../../utils/export';
import type { OpticalNodeData } from '../../types/components';
import type { BeamState } from '../../types/beam';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Place a node so its centre sits at (cx, cy). */
function at(
  id: string,
  data: Partial<OpticalNodeData> & { type: OpticalNodeData['type'] },
  cx: number,
  cy: number,
): Node<OpticalNodeData> {
  const full = { name: id, category: 'fiber', ...data } as OpticalNodeData;
  const g = getNodeGeometry(full.type, full.rotation ?? 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data: full };
}

const AXIS = 300;

/** 780 nm, 100 mW, H, emitting along +x on y = AXIS. */
const laser = (id = 'L1') => at(id, {
  type: 'laser_source', category: 'source', wavelength: 780, outputPower: 100, polarization: 'H',
}, 200, AXIS);

/** An acousto-optic cell in the beam, so there is a detuning to carry. */
const aom = (id = 'A1', mhz = 160) => at(id, {
  type: 'aom', category: 'modulation', rfFrequency: mhz, diffractionEfficiency: 100, order: 1,
}, 500, AXIS);

const coupler = (id = 'FC1', eta = 70, cx = 800, cy = AXIS) => at(id, {
  type: 'fiber_coupler', couplingEfficiency: eta, inputNA: 0.12, focalLength: 11,
}, cx, cy);

/**
 * A cell and a coupler on its **diffracted** order.
 *
 * Both orders are real beams now, and it is the diffracted one that carries the RF shift these
 * tests are about — so the coupler sits on the deflected line rather than straight ahead of the
 * cell, exactly as it would on the bench.
 */
const shifted = (eta = 70, mhz = 160) => {
  const cell = aom('A1', mhz);
  const d = diffractedDirection(unitAt(0), 0, cell.data);
  return [cell, coupler('FC1', eta, 500 + d.dx * 300, AXIS + d.dy * 300)];
};

/** A launcher somewhere else entirely, pointing +x. */
const launcher = (id: string, tag: string | undefined, cy: number) => at(id, {
  type: 'fiber_launcher', focalLength: 11, wavelength: 1064, outputPower: 5,
  polarization: 'V', waist: 800, fiberInputId: tag,
}, 200, cy);

const amp = (id: string, tag: string | undefined, cy: number) => at(id, {
  type: 'fiber_amplifier', category: 'source', wavelength: 1064, outputPower: 2000,
  polarization: 'V', waist: 800, fiberInputId: tag,
}, 200, cy);

/** The beam a node emits, as traced. */
const emitted = (segments: { sourceId: string; beam: BeamState }[], id: string) =>
  segments.find(s => s.sourceId === id)?.beam;

// ── What a tag carries ────────────────────────────────────────────────────────

describe('a fibre-fed output carries the light that went in', () => {
  const bench = (tag = 'FC1') => [
    laser(), ...shifted(), launcher('FL1', tag, 700),
  ];

  it('carries the wavelength and the RF detuning', () => {
    const { segments } = autoRoute(bench(), []);
    const out = emitted(segments, 'FL1')!;
    expect(out).toBeDefined();
    expect(out.wavelength).toBe(780);            // not the launcher's own 1064
    expect(out.detuningHz).toBeCloseTo(160e6, 0); // the AOM upstream of the coupler
  });

  it('carries the coupled power, efficiency included', () => {
    // 100 mW through a 100%-efficient AOM into a 70% coupler.
    const out = emitted(autoRoute(bench(), []).segments, 'FL1')!;
    expect(out.power).toBeCloseTo(70, 6);
  });

  it('tracks a change in coupling efficiency', () => {
    const half = [laser(), ...shifted(35), launcher('FL1', 'FC1', 700)];
    expect(emitted(autoRoute(half, []).segments, 'FL1')!.power).toBeCloseTo(35, 6);
  });

  it('does not carry polarisation — the fibre key angle is arbitrary', () => {
    // PM fibre preserves the state, but its orientation relative to the bench is whatever
    // the connector was keyed to, so the far end is whatever the launcher says it is.
    const out = emitted(autoRoute(bench(), []).segments, 'FL1')!;
    expect(out.polarization).toEqual({ type: 'V' });
  });

  it('does not carry the spatial mode — a fibre is a mode filter', () => {
    // The output waist is the collimator's, not whatever was converging into the coupler.
    const out = emitted(autoRoute(bench(), []).segments, 'FL1')!;
    expect(out.w0).toBeCloseTo(800, 3);
  });

  it('leaves an untagged launcher exactly as it was', () => {
    const free = [laser(), ...shifted(), launcher('FL1', undefined, 700)];
    const out = emitted(autoRoute(free, []).segments, 'FL1')!;
    expect(out.wavelength).toBe(1064);
    expect(out.power).toBe(5);
    expect(out.detuningHz).toBeFalsy();
  });
});

// ── An amplifier states its own power ─────────────────────────────────────────

describe('a fibre-fed amplifier', () => {
  it('keeps its stated output power, and carries λ and detuning', () => {
    // It is a gain stage: the pump sets the output, not the seed.
    const nodes = [laser(), ...shifted(), amp('FA1', 'FC1', 700)];
    const out = emitted(autoRoute(nodes, []).segments, 'FA1')!;
    expect(out.power).toBe(2000);
    expect(out.wavelength).toBe(780);
    expect(out.detuningHz).toBeCloseTo(160e6, 0);
  });

  it('goes dark when its seed does, and says why', () => {
    // The whole point of tagging: unplug the arm upstream and the figure shows it.
    const nodes = [...shifted(), amp('FA1', 'FC1', 700)];   // no laser at all
    const { segments, warnings } = autoRoute(nodes, []);
    expect(emitted(segments, 'FA1')).toBeUndefined();
    expect(warnings.some(w => w.nodeId === 'FA1' && /No light/i.test(w.message))).toBe(true);
  });
});

// ── Chains, loops and broken tags ─────────────────────────────────────────────

describe('resolving the tags', () => {
  it('resolves a chain of two fibres, in either node order', () => {
    // FL1 feeds a beam into FC2, which feeds FL2. The second can only be seeded after the
    // first has been traced, so this is the fixed point doing its job.
    const build = (reversed: boolean) => {
      const chain = [
        laser(), coupler('FC1', 50, 800),
        launcher('FL1', 'FC1', 700),
        at('FC2', { type: 'fiber_coupler', couplingEfficiency: 50, inputNA: 0.12, focalLength: 11 }, 800, 700),
        launcher('FL2', 'FC2', 1100),
      ];
      return reversed ? [...chain].reverse() : chain;
    };
    for (const reversed of [false, true]) {
      const out = emitted(autoRoute(build(reversed), []).segments, 'FL2')!;
      expect(out, `reversed=${reversed}`).toBeDefined();
      expect(out.power).toBeCloseTo(25, 6);   // 100 mW × 50% × 50%
      expect(out.wavelength).toBe(780);
    }
  });

  it('terminates on a fibre loop instead of amplifying forever', () => {
    // A launcher whose own beam comes back to the coupler that feeds it. Each output seeds
    // at most once, so this settles rather than running away.
    const nodes = [
      laser(), coupler('FC1', 50, 800), launcher('FL1', 'FC1', 700),
      at('M1', { type: 'dielectric_mirror', category: 'steering', reflectivity: 100, rotation: 90 }, 800, 700),
    ];
    const { segments, truncated } = autoRoute(nodes, []);
    expect(truncated).toBe(false);
    expect(segments.length).toBeLessThan(20);
  });

  it('warns and stays dark when two outputs claim one fibre', () => {
    const nodes = [
      laser(), coupler(), launcher('FL1', 'FC1', 700), launcher('FL2', 'FC1', 1100),
    ];
    const { segments, warnings } = autoRoute(nodes, []);
    // One of them gets the light; the other is told why it has none.
    const lit = ['FL1', 'FL2'].filter(id => emitted(segments, id));
    expect(lit).toHaveLength(1);
    expect(warnings.some(w => /One fibre feeds one output/.test(w.message))).toBe(true);
  });

  it('warns when the tagged coupler is gone, and does not fall back to free-running', () => {
    // Deleting the coupler, or pasting a launcher into another document, leaves a dangling
    // tag. Emitting its stated power instead would be a quiet lie.
    const nodes = [launcher('FL1', 'FC_missing', 700)];
    const { segments, warnings } = autoRoute(nodes, []);
    expect(emitted(segments, 'FL1')).toBeUndefined();
    expect(warnings.some(w => w.nodeId === 'FL1' && /no longer in this layout/.test(w.message))).toBe(true);
  });

  it('does not let a tagged output aim itself at its own coupler by accident', () => {
    // Sanity: a tag is not a beam path. The launcher emits along its own body axis, from
    // its own output face, wherever the coupler happens to sit.
    const nodes = [laser(), coupler(), launcher('FL1', 'FC1', 700)];
    const seg = autoRoute(nodes, []).segments.find(s => s.sourceId === 'FL1')!;
    expect(seg.y1).toBeCloseTo(700, 6);
    expect(seg.x2).toBeGreaterThan(seg.x1);
  });
});

// ── The seed function on its own ──────────────────────────────────────────────

describe('fiberFedBeam', () => {
  const coupled: BeamState = {
    wavelength: 795, power: 12, polarization: { type: 'H' }, detuningHz: -80e6,
  };
  const launcherData = launcher('FL1', 'FC1', 0).data;

  it('is null for a dark or negligible seed', () => {
    expect(fiberFedBeam(launcherData, null)).toBeNull();
    expect(fiberFedBeam(launcherData, { ...coupled, power: MIN_POWER_MW / 2 })).toBeNull();
  });

  it('is null for anything that is not a fibre output', () => {
    expect(fiberFedBeam(laser().data, coupled)).toBeNull();
    expect(fiberFedBeam(coupler().data, coupled)).toBeNull();
  });

  it('carries a negative detuning as faithfully as a positive one', () => {
    expect(fiberFedBeam(launcherData, coupled)!.detuningHz).toBe(-80e6);
  });

  it('leaves the beam free of a detuning field when there is none to carry', () => {
    const { detuningHz, ...rest } = coupled;
    void detuningHz;
    expect(fiberFedBeam(launcherData, rest as BeamState)!.detuningHz).toBeFalsy();
  });

  it('reports the tag through `fiberInputOf`, and only for fibre outputs', () => {
    expect(fiberInputOf(launcherData)).toBe('FC1');
    expect(fiberInputOf(launcher('FL2', undefined, 0).data)).toBeNull();
    expect(fiberInputOf(launcher('FL3', '', 0).data)).toBeNull();
    expect(fiberInputOf(laser().data)).toBeNull();
  });
});

// ── Saving ────────────────────────────────────────────────────────────────────

describe('the tag in the layout file', () => {
  it('round-trips, and needed no format bump of its own — it is an optional field', () => {
    const nodes = [laser(), coupler(), launcher('FL1', 'FC1', 700)];
    const back = layoutFromJSON(layoutToJSON(nodes, []));
    expect(fiberInputOf(back.nodes.find(n => n.id === 'FL1')!.data)).toBe('FC1');
    // A file written before tags existed still loads clean, which is the actual claim.
    const older = JSON.stringify({ version: '1.2', nodes: [laser(), coupler()], edges: [] });
    expect(layoutFromJSON(older).nodes).toHaveLength(2);
  });
});
