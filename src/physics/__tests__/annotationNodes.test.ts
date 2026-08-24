import { describe, it, expect } from 'vitest';
import type { Node } from '@xyflow/react';
import { autoRoute } from '../autoRoute';
import { isOpticalNode, isAnnotationNode, NON_OPTICAL_NODE_TYPES } from '../../types/components';
import type { OpticalNodeData, RegionData, NoteData } from '../../types/components';
import { sizeOf, getNodeGeometry, isKnownComponentType } from '../../utils/nodeGeometry';
import { layoutToJSON, layoutFromJSON, LAYOUT_VERSION, layoutFingerprint } from '../../utils/export';
import { parseRich, richPlain, SYMBOLS } from '../../utils/richText';
import { withAlpha } from '../../utils/annotationStyle';
import {
  stackLayerOf, stackOrderOf, stackZIndex, annotationsInLayer, STACK_BASE,
} from '../../utils/stacking';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const laser = (): Node<OpticalNodeData> => ({
  id: 'L1', type: 'optical', position: { x: 0, y: 0 },
  data: {
    type: 'laser_source', name: 'L1', category: 'source',
    wavelength: 780, outputPower: 100, polarization: 'H',
  } as OpticalNodeData,
});

const region = (over: Partial<RegionData> = {}): Node<OpticalNodeData> => ({
  id: 'R1', type: 'region', position: { x: -40, y: -40 },
  data: {
    type: 'region', name: 'Cooling arm', category: 'utility',
    w: 300, h: 200, shape: 'rect', colour: '#3b82f6', fillOpacity: 0.08,
    caption: 'Cooling arm', ...over,
  } as RegionData as OpticalNodeData,
});

const note = (over: Partial<NoteData> = {}): Node<OpticalNodeData> => ({
  id: 'N1', type: 'note', position: { x: 200, y: 300 },
  data: {
    type: 'note', name: 'Note', category: 'utility',
    text: '\\Delta = 2\\pi\\times80 MHz', fontSize: 12, colour: '#3b82f6',
    align: 'left', w: 180, ...over,
  } as NoteData as OpticalNodeData,
});

// ── They are not optics ───────────────────────────────────────────────────────

describe('regions and notes are annotations, not optics', () => {
  it('are filtered out of the trace', () => {
    expect(isOpticalNode(region())).toBe(false);
    expect(isOpticalNode(note())).toBe(false);
    expect(isAnnotationNode(region())).toBe(true);
    expect(isAnnotationNode(note())).toBe(true);
    // A probe is non-optical too, but it is not an annotation you place for a figure.
    expect(isAnnotationNode({ type: 'power_probe' })).toBe(false);
    expect(NON_OPTICAL_NODE_TYPES.has('region')).toBe(true);
  });

  it('do not block, bend or terminate a beam', () => {
    // A region laid right over the beam path must change nothing at all.
    const bare = autoRoute([laser()], []);
    // Handed the region directly — the tracer filters it itself, so a caller that forgets
    // to cannot turn a highlight into an optic.
    const withRegion = autoRoute([laser(), region(), note()], []);
    expect(withRegion.segments).toHaveLength(bare.segments.length);
    expect(withRegion.segments[0].free).toBe(true);
    // And the router never snaps one onto a beam.
    expect(withRegion.snaps.has('R1')).toBe(false);
  });

  it('get no name label from the placement pass', () => {
    // Their text is their own; `labelSides` is for component names.
    const { labelSides } = autoRoute([laser(), region(), note()], []);
    expect(labelSides.has('R1')).toBe(false);
    expect(labelSides.has('N1')).toBe(false);
  });
});

// ── Per-instance size ─────────────────────────────────────────────────────────

describe('sizeOf', () => {
  it('takes an annotation size from its own data', () => {
    expect(sizeOf(region({ w: 420, h: 90 }))).toEqual({ width: 420, height: 90 });
  });

  it('falls back to the type table for optics', () => {
    expect(sizeOf(laser())).toEqual({
      width: getNodeGeometry('laser_source', 0).width,
      height: getNodeGeometry('laser_source', 0).height,
    });
  });

  it('ignores a nonsense size rather than collapsing the node', () => {
    expect(sizeOf(region({ w: 0, h: -5 }))).toEqual({
      width: getNodeGeometry('region', 0).width,
      height: getNodeGeometry('region', 0).height,
    });
  });

  it('knows both types, so the loader keeps them', () => {
    expect(isKnownComponentType('region')).toBe(true);
    expect(isKnownComponentType('note')).toBe(true);
  });
});

// ── They survive a save ───────────────────────────────────────────────────────

describe('annotations in the layout file', () => {
  it('round-trip with everything that matters', () => {
    const json = layoutToJSON([laser(), region(), note()], []);
    const back = layoutFromJSON(json);
    expect(back.nodes).toHaveLength(3);
    const r = back.nodes.find(n => n.id === 'R1')!;
    const n = back.nodes.find(n => n.id === 'N1')!;
    expect(r.type).toBe('region');
    expect(r.data).toMatchObject({ w: 300, h: 200, shape: 'rect', caption: 'Cooling arm' });
    expect(n.data).toMatchObject({ text: '\\Delta = 2\\pi\\times80 MHz', fontSize: 12 });
  });

  it('are written at the version that introduced them', () => {
    expect(LAYOUT_VERSION).toBe('1.2');
    expect(JSON.parse(layoutToJSON([], [])).version).toBe('1.2');
  });

  it('still load from a file written before they existed', () => {
    const old = JSON.stringify({ version: '1.1', nodes: [laser()], edges: [] });
    expect(layoutFromJSON(old).nodes).toHaveLength(1);
  });

  it('count as unsaved work — moving one dirties the document', () => {
    const before = layoutFingerprint([laser(), region()], []);
    const moved = [laser(), { ...region(), position: { x: 10, y: 10 } }];
    expect(layoutFingerprint(moved, [])).not.toBe(before);
    const recoloured = [laser(), region({ colour: '#ef4444' })];
    expect(layoutFingerprint(recoloured, [])).not.toBe(before);
  });
});

// ── Note markup ───────────────────────────────────────────────────────────────

describe('parseRich', () => {
  const flat = (src: string) => parseRich(src).map(richPlain);

  it('substitutes symbol names', () => {
    expect(flat('\\Delta = 2\\pi\\times80 MHz')).toEqual(['Δ = 2π×80 MHz']);
    expect(flat('\\lambda/2')).toEqual(['λ/2']);
    expect(flat('\\hbar\\omega')).toEqual(['ℏω']);
  });

  it('leaves an unknown name as typed, so a typo is visible', () => {
    expect(flat('\\lamda = 780')).toEqual(['\\lamda = 780']);
  });

  it('escapes a literal backslash, caret or underscore', () => {
    expect(flat('\\\\ \\^ \\_')).toEqual(['\\ ^ _']);
  });

  it('reads braced and bare scripts', () => {
    const [runs] = parseRich('^{87}Rb');
    expect(runs[0]).toEqual({ text: '87', script: 'sup' });
    expect(runs[1]).toEqual({ text: 'Rb', script: 'normal' });

    const [bare] = parseRich('F_2');
    expect(bare).toEqual([
      { text: 'F', script: 'normal' },
      { text: '2', script: 'sub' },
    ]);
  });

  it('allows symbols inside a script', () => {
    const [runs] = parseRich('e^{-\\Gamma t}');
    expect(runs.find(r => r.script === 'sup')?.text).toBe('-Γ t');
  });

  it('keeps lines separate, and never returns an empty line', () => {
    const lines = parseRich('one\n\ntwo');
    expect(lines).toHaveLength(3);
    expect(richPlain(lines[1])).toBe('');
  });

  it('merges adjacent runs of the same script', () => {
    const [runs] = parseRich('\\lambda = 780 nm');
    expect(runs).toHaveLength(1);
  });

  it('covers the symbols a cold-atom caption reaches for', () => {
    for (const name of ['lambda', 'Delta', 'pi', 'mu', 'hbar', 'times', 'to', 'pm', 'approx']) {
      expect(SYMBOLS[name]).toBeTruthy();
    }
  });
});

describe('withAlpha', () => {
  it('turns a hex colour into a wash', () => {
    expect(withAlpha('#3b82f6', 0.08)).toBe('rgba(59, 130, 246, 0.08)');
  });

  it('clamps, and passes anything unparseable through', () => {
    expect(withAlpha('#000000', 5)).toBe('rgba(0, 0, 0, 1)');
    expect(withAlpha('currentColor', 0.5)).toBe('currentColor');
  });
});

// ── Stacking ──────────────────────────────────────────────────────────────────

describe('stacking', () => {
  it('defaults by type: a wash goes behind, a caption in front', () => {
    // Neither field is set on an existing layout, so the default has to be the useful one.
    expect(stackLayerOf(region().data)).toBe('behind');
    expect(stackLayerOf(note().data)).toBe('front');
    expect(stackOrderOf(region().data)).toBe(0);
  });

  it('takes an explicit layer over the default', () => {
    expect(stackLayerOf(region({ layer: 'front' }).data)).toBe('front');
    expect(stackLayerOf(note({ layer: 'behind' }).data)).toBe('behind');
  });

  it('puts a behind-layer annotation under the optics and a front one over the beams', () => {
    // The beam edge layer sits at CSS z-index 10 and the optics at 0, so these two bases are
    // what "behind the bench" and "in front of everything" actually mean.
    expect(stackZIndex(region())!).toBeLessThan(0);
    expect(stackZIndex(note())!).toBeGreaterThan(10);
    expect(stackZIndex(region())).toBe(STACK_BASE.behind);
    expect(stackZIndex(note())).toBe(STACK_BASE.front);
  });

  it('moves within a layer without crossing into the other', () => {
    // Forward/back is ±1, and no realistic number of nudges escapes its layer.
    const raised = stackZIndex(region({ zOrder: 40 }))!;
    const lowered = stackZIndex(note({ zOrder: -40 }))!;
    expect(raised).toBeLessThan(0);
    expect(lowered).toBeGreaterThan(10);
    expect(stackZIndex(region({ zOrder: 3 }))!).toBeGreaterThan(stackZIndex(region({ zOrder: 1 }))!);
  });

  it('leaves optics where xyflow puts them', () => {
    // Moving them would change how every existing layout draws.
    expect(stackZIndex(laser())).toBeUndefined();
  });

  it('ignores a nonsense order rather than dropping the node out of its layer', () => {
    expect(stackOrderOf({ ...region().data, zOrder: NaN } as OpticalNodeData)).toBe(0);
    expect(stackOrderOf({ ...region().data, zOrder: 'front' } as unknown as OpticalNodeData)).toBe(0);
  });

  it('paints a layer furthest-first, and keeps optics out of it', () => {
    const nodes = [
      laser(),
      { ...region(), id: 'A', data: { ...region().data, zOrder: 2 } },
      { ...region(), id: 'B', data: { ...region().data, zOrder: -1 } },
      { ...note(), id: 'C' },
    ] as Node<OpticalNodeData>[];
    expect(annotationsInLayer(nodes, 'behind').map(n => n.id)).toEqual(['B', 'A']);
    expect(annotationsInLayer(nodes, 'front').map(n => n.id)).toEqual(['C']);
  });

  it('is stable for equal orders, so a figure does not shuffle between renders', () => {
    const nodes = [
      { ...region(), id: 'first' },
      { ...region(), id: 'second' },
      { ...region(), id: 'third' },
    ] as Node<OpticalNodeData>[];
    expect(annotationsInLayer(nodes, 'behind').map(n => n.id)).toEqual(['first', 'second', 'third']);
    expect(annotationsInLayer(nodes, 'behind')).toEqual(annotationsInLayer(nodes, 'behind'));
  });

  it('survives a save, so a figure reopens stacked as it was left', () => {
    const stacked = region({ layer: 'front', zOrder: 3 });
    const back = layoutFromJSON(layoutToJSON([stacked], []));
    expect(stackLayerOf(back.nodes[0].data)).toBe('front');
    expect(stackOrderOf(back.nodes[0].data)).toBe(3);
  });

  it('counts as unsaved work when it changes', () => {
    expect(layoutFingerprint([region({ zOrder: 1 })], []))
      .not.toBe(layoutFingerprint([region({ zOrder: 2 })], []));
  });
});
