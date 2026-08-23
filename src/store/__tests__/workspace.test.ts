import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspace, newDocument, UNTITLED, activeDocument, LABEL_SCALE_MIN, LABEL_SCALE_MAX } from '../workspaceStore';
import { createLayoutStore } from '../layoutStore';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';
import type { Node } from '@xyflow/react';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const laser = (id: string, cx = 100, cy = 100): Node<OpticalNodeData> => {
  const data = {
    type: 'laser_source', category: 'source', name: id,
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1,
  } as OpticalNodeData;
  const g = getNodeGeometry(data.type, 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data };
};

/** Back to one blank document, as if the app had just started. */
function reset() {
  const fresh = newDocument();
  useWorkspace.setState({ documents: [fresh], activeDocId: fresh.id });
  return fresh;
}

beforeEach(() => { reset(); });

const ws = () => useWorkspace.getState();

// ── Opening ───────────────────────────────────────────────────────────────────

describe('opening documents', () => {
  it('starts with exactly one blank, untitled document', () => {
    expect(ws().documents).toHaveLength(1);
    expect(ws().documents[0].name).toBe(UNTITLED);
    expect(ws().documents[0].store.getState().nodes).toEqual([]);
  });

  it('adds a document and shows it', () => {
    const id = ws().openDocument();
    expect(ws().documents).toHaveLength(2);
    expect(ws().activeDocId).toBe(id);
  });

  it('gives every document its own identity', () => {
    ws().openDocument();
    ws().openDocument();
    const ids = ws().documents.map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('can open a document that already has a layout in it', () => {
    const doc = newDocument('D1', { nodes: [laser('L1')], edges: [] });
    ws().openDocument(doc);
    expect(activeDocument(ws()).name).toBe('D1');
    expect(activeDocument(ws()).store.getState().nodes).toHaveLength(1);
  });
});

// ── Isolation: the whole point of a store per document ───────────────────────

describe('documents do not leak into each other', () => {
  it('keeps layouts separate', () => {
    const a = activeDocument(ws());
    a.store.getState().loadLayout({ nodes: [laser('L1'), laser('L2', 400)], edges: [] });

    const bId = ws().openDocument();
    const b = ws().documents.find(d => d.id === bId)!;

    expect(a.store.getState().nodes).toHaveLength(2);
    expect(b.store.getState().nodes).toHaveLength(0);
  });

  it('keeps undo history separate', () => {
    const a = activeDocument(ws());
    const bId = ws().openDocument();
    const b = ws().documents.find(d => d.id === bId)!;

    a.store.getState().saveSnapshot([laser('L1')], []);
    expect(a.store.getState().history).toHaveLength(1);
    expect(b.store.getState().history).toHaveLength(0);

    // Undo in B must not reach into A.
    b.store.getState().undo();
    expect(a.store.getState().history).toHaveLength(1);
  });

  it('keeps selection and viewport separate', () => {
    const a = activeDocument(ws());
    const bId = ws().openDocument();
    const b = ws().documents.find(d => d.id === bId)!;

    a.store.getState().setSelectedNode('L1');
    a.store.getState().setViewport({ x: 10, y: 20, zoom: 2 });

    expect(b.store.getState().selectedNodeId).toBeNull();
    expect(b.store.getState().viewport).toBeNull();
    expect(a.store.getState().viewport).toEqual({ x: 10, y: 20, zoom: 2 });
  });

  it('traces each document independently, memoising per document', () => {
    // Two identical layouts: each store must produce its own segments, not share a cache.
    const a = activeDocument(ws());
    const bId = ws().openDocument();
    const b = ws().documents.find(d => d.id === bId)!;

    const nodes = [laser('L1')];
    a.store.getState().loadLayout({ nodes, edges: [] });
    b.store.getState().loadLayout({ nodes, edges: [] });

    expect(a.store.getState().segments.length).toBeGreaterThan(0);
    expect(b.store.getState().segments.length).toBe(a.store.getState().segments.length);
    expect(b.store.getState().segments).not.toBe(a.store.getState().segments);
  });
});

// ── Closing ───────────────────────────────────────────────────────────────────

describe('closing documents', () => {
  it('removes the one asked for', () => {
    const id = ws().openDocument();
    ws().closeDocument(id);
    expect(ws().documents.map(d => d.id)).not.toContain(id);
  });

  it('never leaves the workspace empty — the last close starts a fresh document', () => {
    const only = ws().documents[0];
    only.store.getState().loadLayout({ nodes: [laser('L1')], edges: [] });

    ws().closeDocument(only.id);

    expect(ws().documents).toHaveLength(1);
    expect(ws().documents[0].id).not.toBe(only.id);
    expect(ws().documents[0].name).toBe(UNTITLED);
    expect(ws().documents[0].store.getState().nodes).toEqual([]);
    expect(ws().activeDocId).toBe(ws().documents[0].id);
  });

  it('falls to the right-hand neighbour when closing the active tab', () => {
    const a = ws().documents[0].id;
    const b = ws().openDocument();
    const c = ws().openDocument();
    ws().setActiveDoc(b);

    ws().closeDocument(b);
    expect(ws().activeDocId).toBe(c);
    expect(ws().documents.map(d => d.id)).toEqual([a, c]);
  });

  it('falls left when closing the last tab', () => {
    const a = ws().documents[0].id;
    const b = ws().openDocument();
    ws().setActiveDoc(b);

    ws().closeDocument(b);
    expect(ws().activeDocId).toBe(a);
  });

  it('leaves the active tab alone when closing another', () => {
    const a = ws().documents[0].id;
    const b = ws().openDocument();
    ws().setActiveDoc(a);

    ws().closeDocument(b);
    expect(ws().activeDocId).toBe(a);
  });

  it('ignores an id that is not open', () => {
    const before = ws().documents.map(d => d.id);
    ws().closeDocument('nope');
    expect(ws().documents.map(d => d.id)).toEqual(before);
  });
});

// ── Switching and naming ──────────────────────────────────────────────────────

describe('switching and naming', () => {
  it('activates an open document', () => {
    const id = ws().openDocument();
    ws().setActiveDoc(ws().documents[0].id);
    expect(ws().activeDocId).toBe(ws().documents[0].id);
    ws().setActiveDoc(id);
    expect(ws().activeDocId).toBe(id);
  });

  it('refuses to activate an id that is not open, rather than blanking the editor', () => {
    const current = ws().activeDocId;
    ws().setActiveDoc('nope');
    expect(ws().activeDocId).toBe(current);
  });

  it('falls back to the first document if the active id ever dangles', () => {
    useWorkspace.setState({ activeDocId: 'gone' });
    expect(activeDocument(ws())).toBe(ws().documents[0]);
  });

  it('renames one document without touching the others', () => {
    const a = ws().documents[0].id;
    const b = ws().openDocument();
    ws().renameDocument(a, 'D1_Layout');
    expect(ws().documents.find(d => d.id === a)!.name).toBe('D1_Layout');
    expect(ws().documents.find(d => d.id === b)!.name).toBe(UNTITLED);
  });
});

// ── Preferences are the window's, not the document's ─────────────────────────

describe('preferences', () => {
  it('are unaffected by switching documents', () => {
    ws().setTheme('light');
    ws().setLabelScale(1.25);
    ws().toggleBeamLabels();

    ws().openDocument();
    ws().setActiveDoc(ws().documents[0].id);

    expect(ws().theme).toBe('light');
    expect(ws().labelScale).toBe(1.25);
    expect(ws().showBeamLabels).toBe(true);

    ws().setTheme('dark');            // leave the store as it was found
    ws().toggleBeamLabels();
    ws().setLabelScale(1);
  });

  it('clamps the label scale to the slider range', () => {
    ws().setLabelScale(99);
    expect(ws().labelScale).toBe(LABEL_SCALE_MAX);
    ws().setLabelScale(0);
    expect(ws().labelScale).toBe(LABEL_SCALE_MIN);
    ws().setLabelScale(1);
  });

  it('are not in the document store at all', () => {
    const state = createLayoutStore().getState() as unknown as Record<string, unknown>;
    for (const pref of ['theme', 'labelScale', 'showBeamLabels', 'activeView', 'activeTab']) {
      expect(state[pref]).toBeUndefined();
    }
  });
});
