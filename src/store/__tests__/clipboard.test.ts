import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { collectSelection, materialise, clipboardSize, PASTE_OFFSET_PX } from '../clipboard';
import { newDocument } from '../workspaceStore';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData, BeamEdgeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function node(
  id: string,
  over: Partial<OpticalNodeData> = {},
  cx = 100,
  cy = 100,
  selected = false,
): Node<OpticalNodeData> {
  const data = {
    type: 'laser_source', category: 'source', name: id,
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1, ...over,
  } as OpticalNodeData;
  const g = getNodeGeometry(data.type, 0);
  return {
    id, type: 'optical', selected,
    position: { x: cx - g.width / 2, y: cy - g.height / 2 },
    data,
  };
}

const mirror = (id: string, cx: number, cy: number, selected = false) =>
  node(id, { type: 'dielectric_mirror', category: 'steering', reflectivity: 99.5 } as Partial<OpticalNodeData>, cx, cy, selected);

const probe = (id: string, selected = false) => ({
  id, type: 'power_probe', selected,
  position: { x: 300, y: 300 },
  data: { name: 'P', category: 'utility', type: 'power_probe', labelDx: 34, labelDy: -30 } as OpticalNodeData,
}) as Node<OpticalNodeData>;

const phantom = (id: string) => ({
  id, type: 'beam_endpoint', selected: true, position: { x: 4000, y: 33 }, data: {} as OpticalNodeData,
}) as Node<OpticalNodeData>;

const wire = (id: string, source: string, target: string) =>
  ({ id, source, target, type: 'beam' }) as Edge<BeamEdgeData>;

const DOC = 'doc-a';

// ── What a copy takes ─────────────────────────────────────────────────────────

describe('collectSelection', () => {
  it('takes the selected components and nothing else', () => {
    const nodes = [node('L1', {}, 100, 100, true), node('L2', {}, 400, 100), mirror('M1', 700, 100, true)];
    const content = collectSelection(nodes, [], DOC)!;
    expect(content.nodes.map(n => n.id)).toEqual(['L1', 'M1']);
    expect(content.sourceDocId).toBe(DOC);
  });

  it('is null when nothing is selected, so a stray copy does not empty the clipboard', () => {
    expect(collectSelection([node('L1')], [], DOC)).toBeNull();
    expect(collectSelection([], [], DOC)).toBeNull();
  });

  it('takes a power probe, which is something the user placed', () => {
    const content = collectSelection([probe('P1', true)], [], DOC)!;
    expect(content.nodes.map(n => n.id)).toEqual(['P1']);
  });

  it('never takes a phantom beam endpoint, which the tracer owns', () => {
    const nodes = [node('L1', {}, 100, 100, true), phantom('phantom_L1_out_e')];
    const content = collectSelection(nodes, [], DOC)!;
    expect(content.nodes.map(n => n.id)).toEqual(['L1']);
  });

  it('keeps a user wire only when both ends are coming too', () => {
    const nodes = [node('L1', {}, 100, 100, true), node('L2', {}, 400, 100, true), mirror('M1', 700, 100)];
    const edges = [wire('e-in', 'L1', 'L2'), wire('e-out', 'L2', 'M1')];
    const content = collectSelection(nodes, edges, DOC)!;
    expect(content.edges.map(e => e.id)).toEqual(['e-in']);
  });

  it('never takes a routing edge, which the tracer rebuilds', () => {
    const nodes = [node('L1', {}, 100, 100, true), node('L2', {}, 400, 100, true)];
    const edges = [wire('auto_L1_out_to_L2', 'L1', 'L2')];
    expect(collectSelection(nodes, edges, DOC)!.edges).toEqual([]);
  });

  it('copies the data, so later edits to the original cannot reach the clipboard', () => {
    const original = node('L1', {}, 100, 100, true);
    const content = collectSelection([original], [], DOC)!;
    (original.data as { name: string }).name = 'renamed after copying';
    expect(content.nodes[0].data.name).toBe('L1');
  });
});

// ── What a paste produces ─────────────────────────────────────────────────────

describe('materialise', () => {
  const content = () => collectSelection(
    [node('L1', {}, 100, 100, true), mirror('M1', 400, 100, true)],
    [wire('e1', 'L1', 'M1')],
    DOC,
  )!;

  it('gives every component a fresh id, and rewires the copied edges onto them', () => {
    const { nodes, edges } = materialise(content(), 'doc-b');
    expect(nodes.map(n => n.id)).not.toContain('L1');
    expect(new Set(nodes.map(n => n.id)).size).toBe(2);
    expect(edges[0].source).toBe(nodes[0].id);
    expect(edges[0].target).toBe(nodes[1].id);
    expect(edges[0].id).not.toBe('e1');
  });

  it('keeps the geometry when pasting into another document', () => {
    const src = content();
    const { nodes } = materialise(src, 'doc-b');
    expect(nodes[0].position).toEqual(src.nodes[0].position);
    // The spacing between the copied components is what makes the paste useful.
    expect(nodes[1].position.x - nodes[0].position.x)
      .toBe(src.nodes[1].position.x - src.nodes[0].position.x);
  });

  it('offsets by one hole when pasting back into the document it came from', () => {
    const src = content();
    const { nodes } = materialise(src, DOC);
    expect(nodes[0].position.x).toBe(src.nodes[0].position.x + PASTE_OFFSET_PX);
    expect(nodes[0].position.y).toBe(src.nodes[0].position.y + PASTE_OFFSET_PX);
  });

  it('selects what it pasted, so it can be dragged straight away', () => {
    const { nodes } = materialise(content(), 'doc-b');
    expect(nodes.every(n => (n as { selected?: boolean }).selected)).toBe(true);
  });

  it('pastes a locked component unlocked, since it has just been moved', () => {
    const locked = collectSelection([node('L1', { locked: true }, 100, 100, true)], [], DOC)!;
    const { nodes } = materialise(locked, 'doc-b');
    expect((nodes[0].data as { locked?: boolean }).locked).toBe(false);
  });

  it('drops the stale measurement so xyflow sizes the copy itself', () => {
    const measured = collectSelection(
      [{ ...node('L1', {}, 100, 100, true), measured: { width: 90, height: 80 } }],
      [], DOC,
    )!;
    const { nodes } = materialise(measured, 'doc-b');
    expect((nodes[0] as { measured?: unknown }).measured).toBeUndefined();
  });

  it('can be pasted twice without an id collision', () => {
    const src = content();
    const first = materialise(src, 'doc-b');
    const second = materialise(src, 'doc-b');
    const ids = [...first.nodes, ...second.nodes].map(n => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('clipboardSize', () => {
  it('counts what is waiting, and copes with an empty clipboard', () => {
    expect(clipboardSize(null)).toBe(0);
    expect(clipboardSize(collectSelection([node('L1', {}, 100, 100, true)], [], DOC))).toBe(1);
  });
});

// ── Through the document stores: the point of the whole thing ────────────────

describe('moving components between documents', () => {
  it('pastes a copied selection into a different document', () => {
    const from = newDocument('from', { nodes: [node('L1', {}, 100, 100, true), mirror('M1', 400, 100, true)] });
    const to = newDocument('to');

    const content = collectSelection(from.store.getState().nodes, from.store.getState().edges, from.id)!;
    const { nodes, edges } = materialise(content, to.id);
    to.store.getState().insertNodes(nodes, edges);

    const pasted = to.store.getState();
    expect(pasted.nodes).toHaveLength(2);
    expect(pasted.nodes.map(n => n.data.name)).toEqual(['L1', 'M1']);
    // And the source is untouched.
    expect(from.store.getState().nodes).toHaveLength(2);
  });

  it('traces the pasted components — a paste is a layout change', () => {
    const from = newDocument('from', { nodes: [node('L1', {}, 100, 100, true)] });
    const to = newDocument('to');
    const content = collectSelection(from.store.getState().nodes, [], from.id)!;
    to.store.getState().insertNodes(...Object.values(materialise(content, to.id)) as [never, never]);
    expect(to.store.getState().segments.length).toBeGreaterThan(0);
  });

  it('marks the receiving document dirty, and leaves the source clean', () => {
    const from = newDocument('from', { nodes: [node('L1', {}, 100, 100, true)] });
    const to = newDocument('to');
    const content = collectSelection(from.store.getState().nodes, [], from.id)!;
    to.store.getState().insertNodes(...Object.values(materialise(content, to.id)) as [never, never]);

    expect(to.store.getState().dirty).toBe(true);
    expect(from.store.getState().dirty).toBe(false);
  });

  it('deselects what was already there, so a paste is the new selection', () => {
    const doc = newDocument('doc', { nodes: [node('OLD', {}, 700, 700, true)] });
    const content = collectSelection([node('L1', {}, 100, 100, true)], [], 'elsewhere')!;
    doc.store.getState().insertNodes(...Object.values(materialise(content, doc.id)) as [never, never]);

    const nodes = doc.store.getState().nodes;
    expect(nodes.find(n => n.id === 'OLD')!.selected).toBe(false);
    expect(nodes.filter(n => (n as { selected?: boolean }).selected)).toHaveLength(1);
  });

  it('is undoable in one step', () => {
    const doc = newDocument('doc', { nodes: [node('L1', {}, 100, 100)] });
    const content = collectSelection([node('X1', {}, 500, 500, true)], [], 'elsewhere')!;
    doc.store.getState().insertNodes(...Object.values(materialise(content, doc.id)) as [never, never]);
    expect(doc.store.getState().nodes).toHaveLength(2);

    doc.store.getState().undo();
    expect(doc.store.getState().nodes.map(n => n.id)).toEqual(['L1']);
    expect(doc.store.getState().dirty).toBe(false);
  });

  it('cut removes the components and any wire that touched them', () => {
    const doc = newDocument('doc', {
      nodes: [node('L1', {}, 100, 100, true), node('L2', {}, 400, 100)],
      edges: [wire('e1', 'L1', 'L2')],
    });
    doc.store.getState().removeNodes(['L1']);

    const after = doc.store.getState();
    expect(after.nodes.map(n => n.id)).toEqual(['L2']);
    expect(after.edges).toEqual([]);
    expect(after.dirty).toBe(true);
  });

  it('cut is undoable too', () => {
    const doc = newDocument('doc', { nodes: [node('L1', {}, 100, 100, true), node('L2', {}, 400, 100)] });
    doc.store.getState().removeNodes(['L1']);
    doc.store.getState().undo();
    expect(doc.store.getState().nodes.map(n => n.id)).toEqual(['L1', 'L2']);
  });

  it('removing nothing does nothing at all', () => {
    const doc = newDocument('doc', { nodes: [node('L1')] });
    const before = doc.store.getState().canvasVersion;
    doc.store.getState().removeNodes([]);
    expect(doc.store.getState().canvasVersion).toBe(before);
    expect(doc.store.getState().history).toEqual([]);
  });
});

// ── Groups survive the clipboard, as new groups ───────────────────────────────

describe('pasting a group', () => {
  const doc = () => newDocument().id;

  it('keeps the members together', () => {
    const nodes = [
      mirror('M1', 100, 100, true), mirror('M2', 200, 100, true),
    ].map(n => ({ ...n, data: { ...n.data, groupId: 'g1' } as OpticalNodeData }));
    const content = collectSelection(nodes, [], 'src')!;
    const { nodes: pasted } = materialise(content, doc());
    const groups = new Set(pasted.map(n => (n.data as { groupId?: string }).groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it('gives each paste its own group, so two copies are two groups', () => {
    // Otherwise pasting twice makes one four-component lump that drags as a unit.
    const nodes = [
      mirror('M1', 100, 100, true), mirror('M2', 200, 100, true),
    ].map(n => ({ ...n, data: { ...n.data, groupId: 'g1' } as OpticalNodeData }));
    const content = collectSelection(nodes, [], 'src')!;
    const first = materialise(content, doc()).nodes[0].data as { groupId?: string };
    const second = materialise(content, doc()).nodes[0].data as { groupId?: string };
    expect(first.groupId).not.toBe(second.groupId);
    // And neither is the original group id.
    expect(first.groupId).not.toBe('g1');
  });

  it('leaves an ungrouped component ungrouped', () => {
    const content = collectSelection([mirror('M1', 100, 100, true)], [], 'src')!;
    const pasted = materialise(content, doc()).nodes[0].data as { groupId?: string };
    expect(pasted.groupId).toBeUndefined();
  });

  it('copies a partial group as a group of what was copied', () => {
    // Selecting two of three members and pasting gives a pair that moves together — the
    // member left behind is not silently dragged along by the copy.
    const nodes = [
      mirror('M1', 100, 100, true), mirror('M2', 200, 100, true), mirror('M3', 300, 100, false),
    ].map(n => ({ ...n, data: { ...n.data, groupId: 'g1' } as OpticalNodeData }));
    const { nodes: pasted } = materialise(collectSelection(nodes, [], 'src')!, doc());
    expect(pasted).toHaveLength(2);
    const groups = new Set(pasted.map(n => (n.data as { groupId?: string }).groupId));
    expect(groups.size).toBe(1);
  });
});
