import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { createLayoutStore } from '../layoutStore';
import { newDocument, useWorkspace, UNTITLED } from '../workspaceStore';
import { layoutToJSON, layoutFromJSON, layoutFingerprint } from '../../utils/export';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData, BeamEdgeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function node(id: string, over: Partial<OpticalNodeData> = {}, cx = 100, cy = 100): Node<OpticalNodeData> {
  const data = {
    type: 'laser_source', category: 'source', name: id,
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1, ...over,
  } as OpticalNodeData;
  const g = getNodeGeometry(data.type, 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data };
}

/** A node as xyflow hands it back: transient fields and all. */
function asRendered(n: Node<OpticalNodeData>) {
  return { ...n, selected: true, dragging: false, draggable: true, measured: { width: 90, height: 80 } };
}

const store = (nodes: Node<OpticalNodeData>[] = [], edges: Edge<BeamEdgeData>[] = []) =>
  createLayoutStore({ nodes, edges });

// ── What lands in the file ────────────────────────────────────────────────────

describe('what a saved file contains', () => {
  it('keeps only the layout, not xyflow\'s transient state', () => {
    const written = JSON.parse(layoutToJSON([asRendered(node('L1'))], []));
    expect(Object.keys(written.nodes[0]).sort()).toEqual(['data', 'id', 'position', 'type']);
    for (const junk of ['selected', 'dragging', 'draggable', 'measured']) {
      expect(written.nodes[0][junk]).toBeUndefined();
    }
  });

  it('keeps a user edge\'s wiring but not its beam state', () => {
    const edge = {
      id: 'e1', source: 'L1', target: 'PD', sourceHandle: 'out', targetHandle: 'in', type: 'beam',
      data: { wavelength: 780, power: 100, polarization: 'H', sx: 0, sy: 0, tx: 1, ty: 1 },
    } as Edge<BeamEdgeData>;
    const written = JSON.parse(layoutToJSON([], [edge]));
    expect(written.edges[0]).toEqual({
      id: 'e1', source: 'L1', target: 'PD', sourceHandle: 'out', targetHandle: 'in', type: 'beam',
    });
  });

  it('still round-trips through the loader', () => {
    const back = layoutFromJSON(layoutToJSON([asRendered(node('L1'))], []));
    expect(back.nodes).toHaveLength(1);
    expect(back.nodes[0].data.name).toBe('L1');
    expect(back.notes).toEqual([]);
  });
});

describe('layoutFingerprint', () => {
  it('ignores selection, drag and measurement', () => {
    const plain = node('L1');
    expect(layoutFingerprint([asRendered(plain)], [])).toBe(layoutFingerprint([plain], []));
  });

  it('notices a move, a rename and a new component', () => {
    const base = layoutFingerprint([node('L1')], []);
    expect(layoutFingerprint([node('L1', {}, 300, 100)], [])).not.toBe(base);
    expect(layoutFingerprint([node('L1', { name: 'Seed' })], [])).not.toBe(base);
    expect(layoutFingerprint([node('L1'), node('L2', {}, 400)], [])).not.toBe(base);
  });
});

// ── Dirty ─────────────────────────────────────────────────────────────────────

describe('the dirty flag', () => {
  it('is clear for a new empty document', () => {
    expect(store().getState().dirty).toBe(false);
  });

  it('is clear for a document opened from a file', () => {
    expect(store([node('L1')]).getState().dirty).toBe(false);
  });

  it('goes dirty when a component is edited', () => {
    const s = store([node('L1')]);
    s.getState().updateNodeData('L1', { name: 'Seed' });
    expect(s.getState().dirty).toBe(true);
  });

  it('goes dirty when the canvas gains a component', () => {
    const s = store();
    s.getState().syncFromCanvas([node('L1')], []);
    expect(s.getState().dirty).toBe(true);
  });

  it('does not go dirty for a selection change alone', () => {
    // The canvas syncs on any node change, selection included. Clicking a component is
    // not an edit, and a flag flipped per action would have said it was.
    const s = store([node('L1')]);
    s.getState().syncFromCanvas([asRendered(node('L1'))], []);
    expect(s.getState().dirty).toBe(false);
  });

  it('does not go dirty for the auto-routing edges the tracer adds', () => {
    const s = store([node('L1')]);
    const auto = { id: 'auto_L1_out_to_PD', source: 'L1', target: 'PD' } as Edge<BeamEdgeData>;
    s.getState().syncFromCanvas([node('L1')], [auto]);
    expect(s.getState().dirty).toBe(false);
  });

  it('clears on markSaved', () => {
    const s = store([node('L1')]);
    s.getState().updateNodeData('L1', { name: 'Seed' });
    s.getState().markSaved();
    expect(s.getState().dirty).toBe(false);
  });

  it('goes dirty again after a further edit', () => {
    const s = store([node('L1')]);
    s.getState().markSaved();
    s.getState().updateNodeData('L1', { outputPower: 50 });
    expect(s.getState().dirty).toBe(true);
  });

  it('clears when an undo returns the document to its saved state', () => {
    // The property a boolean flag could not give: the file and the document agree again.
    const s = store([node('L1')]);
    s.getState().saveSnapshot([node('L1')], []);
    s.getState().syncFromCanvas([node('L1'), node('L2', {}, 400)], []);
    expect(s.getState().dirty).toBe(true);

    s.getState().undo();
    expect(s.getState().nodes).toHaveLength(1);
    expect(s.getState().dirty).toBe(false);
  });

  it('re-baselines on load, so an opened file starts clean', () => {
    const s = store([node('L1')]);
    s.getState().updateNodeData('L1', { name: 'edited' });
    expect(s.getState().dirty).toBe(true);

    s.getState().loadLayout({ nodes: [node('X1')], edges: [] });
    expect(s.getState().dirty).toBe(false);
  });

  it('is per document', () => {
    const a = newDocument('A', { nodes: [node('L1')] });
    const b = newDocument('B', { nodes: [node('L1')] });
    a.store.getState().updateNodeData('L1', { name: 'changed' });
    expect(a.store.getState().dirty).toBe(true);
    expect(b.store.getState().dirty).toBe(false);
  });
});

// ── File identity on the document ────────────────────────────────────────────

describe('which file a document belongs to', () => {
  it('starts with no file at all', () => {
    const doc = newDocument();
    expect(doc.name).toBe(UNTITLED);
    expect(doc.handle).toBeNull();
  });

  it('records a name and handle, and can be given one later', () => {
    const fresh = newDocument();
    useWorkspace.setState({ documents: [fresh], activeDocId: fresh.id });

    // A stand-in for the real thing: only its identity matters here.
    const handle = { name: 'bench.json', kind: 'file' } as unknown as FileSystemFileHandle;
    useWorkspace.getState().setDocumentFile(fresh.id, { name: 'bench', handle });

    const after = useWorkspace.getState().documents[0];
    expect(after.name).toBe('bench');
    expect(after.handle).toBe(handle);
  });

  it('carries a handle from the moment a document is opened from a file', () => {
    const handle = { name: 'D1.json', kind: 'file' } as unknown as FileSystemFileHandle;
    const doc = newDocument('D1', { nodes: [node('L1')] }, handle);
    expect(doc.handle).toBe(handle);
    expect(doc.store.getState().dirty).toBe(false);
  });

  it('leaves other documents\' files alone', () => {
    const a = newDocument('A');
    const b = newDocument('B');
    useWorkspace.setState({ documents: [a, b], activeDocId: a.id });
    const handle = { name: 'a.json', kind: 'file' } as unknown as FileSystemFileHandle;
    useWorkspace.getState().setDocumentFile(a.id, { name: 'a', handle });

    const [docA, docB] = useWorkspace.getState().documents;
    expect(docA.handle).toBe(handle);
    expect(docB.handle).toBeNull();
    expect(docB.name).toBe('B');
  });
});
