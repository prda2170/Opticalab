import { describe, it, expect, beforeEach } from 'vitest';
import type { Node } from '@xyflow/react';
import { buildSnapshot, documentsFromSnapshot, isUsableSnapshot, type SessionSnapshot } from '../session';
import { useWorkspace, newDocument, restoredDocument, UNTITLED } from '../workspaceStore';
import { layoutToJSON, layoutFingerprint } from '../../utils/export';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function node(id: string, over: Partial<OpticalNodeData> = {}, cx = 100, cy = 100): Node<OpticalNodeData> {
  const data = {
    type: 'laser_source', category: 'source', name: id,
    wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1, ...over,
  } as OpticalNodeData;
  const g = getNodeGeometry(data.type, 0);
  return { id, type: 'optical', position: { x: cx - g.width / 2, y: cy - g.height / 2 }, data };
}

/** A stand-in handle: only its identity and survival through the snapshot matter. */
const fakeHandle = (name: string) => ({ name, kind: 'file' }) as unknown as FileSystemFileHandle;

function workspaceWith(...documents: ReturnType<typeof newDocument>[]) {
  useWorkspace.setState({ documents, activeDocId: documents[0].id });
  return useWorkspace.getState();
}

beforeEach(() => {
  const fresh = newDocument();
  useWorkspace.setState({
    documents: [fresh], activeDocId: fresh.id, hydrated: true,
    theme: 'dark', activeView: 'editor', showBeamLabels: false, labelScale: 1,
  });
});

// ── Writing a snapshot ────────────────────────────────────────────────────────

describe('buildSnapshot', () => {
  it('records each document with its name, file and viewport', () => {
    const handle = fakeHandle('bench.json');
    const doc = newDocument('bench', { nodes: [node('L1')] }, handle);
    doc.store.getState().setViewport({ x: 12, y: 34, zoom: 1.5 });

    const snap = buildSnapshot(workspaceWith(doc));

    expect(snap.documents).toHaveLength(1);
    expect(snap.documents[0].name).toBe('bench');
    expect(snap.documents[0].id).toBe(doc.id);
    expect(snap.documents[0].handle).toBe(handle);
    expect(snap.documents[0].viewport).toEqual({ x: 12, y: 34, zoom: 1.5 });
    expect(snap.activeDocId).toBe(doc.id);
  });

  it('stores the layout as the same JSON a save writes, so restore reuses the loader', () => {
    const doc = newDocument('bench', { nodes: [node('L1')] });
    const snap = buildSnapshot(workspaceWith(doc));
    const written = JSON.parse(snap.documents[0].layoutJson);
    expect(written.version).toBeDefined();
    expect(written.nodes).toHaveLength(1);
    expect(Object.keys(written.nodes[0]).sort()).toEqual(['data', 'id', 'position', 'type']);
  });

  it('skips a blank unsaved document — restoring empty tabs is noise', () => {
    const snap = buildSnapshot(useWorkspace.getState());
    expect(snap.documents).toEqual([]);
  });

  it('keeps a blank document that has a file, since that file is a real thing', () => {
    const doc = newDocument('emptied', { nodes: [] }, fakeHandle('emptied.json'));
    const snap = buildSnapshot(workspaceWith(doc));
    expect(snap.documents).toHaveLength(1);
  });

  it('keeps a blank document with unsaved changes', () => {
    // Emptying a saved layout and not saving it is exactly the case worth not losing.
    const doc = newDocument('was-full', { nodes: [node('L1')] });
    doc.store.getState().syncFromCanvas([], []);
    expect(doc.store.getState().dirty).toBe(true);
    const snap = buildSnapshot(workspaceWith(doc));
    expect(snap.documents).toHaveLength(1);
  });

  it('records the preferences, which belong to the window', () => {
    useWorkspace.setState({ theme: 'light', activeView: 'diagram', showBeamLabels: true, labelScale: 1.25 });
    const snap = buildSnapshot(useWorkspace.getState());
    expect(snap.prefs).toEqual({ theme: 'light', activeView: 'diagram', showBeamLabels: true, labelScale: 1.25 });
  });

  it('carries the saved baseline, not just the content', () => {
    const doc = newDocument('bench', { nodes: [node('L1')] });
    const savedAt = doc.store.getState().savedFingerprint;
    doc.store.getState().syncFromCanvas([node('L1'), node('L2', {}, 400)], []);

    const snap = buildSnapshot(workspaceWith(doc));
    expect(snap.documents[0].savedFingerprint).toBe(savedAt);
    // The stored layout is the *current* one; the baseline is what the file holds.
    expect(JSON.parse(snap.documents[0].layoutJson).nodes).toHaveLength(2);
  });
});

// ── Reading one back ──────────────────────────────────────────────────────────

describe('documentsFromSnapshot', () => {
  const snapshotOf = (docs: ReturnType<typeof newDocument>[]) => buildSnapshot(workspaceWith(...docs));

  it('brings a document back with its id, name, file and viewport', () => {
    const handle = fakeHandle('bench.json');
    const doc = newDocument('bench', { nodes: [node('L1')] }, handle);
    doc.store.getState().setViewport({ x: 5, y: 6, zoom: 2 });

    const { documents, activeDocId } = documentsFromSnapshot(snapshotOf([doc]));

    expect(documents).toHaveLength(1);
    expect(documents[0].id).toBe(doc.id);
    expect(documents[0].name).toBe('bench');
    expect(documents[0].handle).toBe(handle);
    expect(documents[0].store.getState().viewport).toEqual({ x: 5, y: 6, zoom: 2 });
    expect(activeDocId).toBe(doc.id);
  });

  it('brings the layout back, traced and ready', () => {
    const doc = newDocument('bench', { nodes: [node('L1')] });
    const { documents } = documentsFromSnapshot(snapshotOf([doc]));
    const restored = documents[0].store.getState();

    expect(restored.nodes).toHaveLength(1);
    expect(restored.nodes[0].data.name).toBe('L1');
    expect(restored.segments.length).toBeGreaterThan(0);   // recomputed, not stored
  });

  it('comes back clean when it was saved', () => {
    const doc = newDocument('bench', { nodes: [node('L1')] });
    const { documents } = documentsFromSnapshot(snapshotOf([doc]));
    expect(documents[0].store.getState().dirty).toBe(false);
  });

  it('comes back dirty when it was not', () => {
    // The property the stored baseline exists for.
    const doc = newDocument('bench', { nodes: [node('L1')] });
    doc.store.getState().syncFromCanvas([node('L1'), node('L2', {}, 400)], []);

    const { documents } = documentsFromSnapshot(snapshotOf([doc]));
    const restored = documents[0].store.getState();
    expect(restored.nodes).toHaveLength(2);      // the unsaved work is there
    expect(restored.dirty).toBe(true);           // and still marked unsaved
  });

  it('round-trips several documents in order', () => {
    const a = newDocument('A', { nodes: [node('L1')] });
    const b = newDocument('B', { nodes: [node('L2')] });
    const c = newDocument('C', { nodes: [node('L3')] });
    const snap = buildSnapshot(workspaceWith(a, b, c));
    useWorkspace.setState({ activeDocId: b.id });

    const { documents } = documentsFromSnapshot({ ...snap, activeDocId: b.id });
    expect(documents.map(d => d.name)).toEqual(['A', 'B', 'C']);
    expect(documents.map(d => d.id)).toEqual([a.id, b.id, c.id]);
  });

  it('drops a document whose layout no longer parses, and says how many', () => {
    const good = newDocument('good', { nodes: [node('L1')] });
    const snap = buildSnapshot(workspaceWith(good));
    const broken: SessionSnapshot = {
      ...snap,
      documents: [
        ...snap.documents,
        { id: 'x', name: 'broken', layoutJson: '{ not json', savedFingerprint: '', viewport: null, handle: null },
        { id: 'y', name: 'from-the-future', layoutJson: JSON.stringify({ version: '9.0', nodes: [], edges: [] }), savedFingerprint: '', viewport: null, handle: null },
      ],
    };

    const { documents, dropped } = documentsFromSnapshot(broken);
    expect(documents.map(d => d.name)).toEqual(['good']);
    expect(dropped).toBe(2);
  });

  it('migrates an old layout on the way back in', () => {
    // A session written by an older build carries an older file format; restore goes
    // through the same loader as Open, so it gets the same migrations.
    const legacy = JSON.stringify({
      version: '1.0',
      nodes: [{ id: 'PD', type: 'optical', position: { x: 0, y: 0 },
        data: { type: 'photodiode', category: 'detection', name: 'PD', bandwidth: 100, responsivity: 0.5 } }],
      edges: [],
    });
    const snap: SessionSnapshot = {
      version: 1, activeDocId: 'd1',
      prefs: { theme: 'dark', activeView: 'editor', showBeamLabels: false, labelScale: 1 },
      documents: [{ id: 'd1', name: 'old', layoutJson: legacy, savedFingerprint: '', viewport: null, handle: null }],
    };

    const { documents } = documentsFromSnapshot(snap);
    const data = documents[0].store.getState().nodes[0].data as unknown as Record<string, unknown>;
    expect(data.signalFactor).toBeCloseTo(0.025, 12);
    expect(data.responsivity).toBeUndefined();
  });

  it('restores the preferences', () => {
    useWorkspace.setState({ theme: 'light', labelScale: 0.75 });
    const doc = newDocument('bench', { nodes: [node('L1')] });
    const { prefs } = documentsFromSnapshot(buildSnapshot(workspaceWith(doc)));
    expect(prefs.theme).toBe('light');
    expect(prefs.labelScale).toBe(0.75);
  });
});

// ── Adopting it ───────────────────────────────────────────────────────────────

describe('adoptSession', () => {
  it('replaces the starting document with the restored set', () => {
    const restored = [
      restoredDocument('id-a', 'A', { nodes: [node('L1')] }, null),
      restoredDocument('id-b', 'B', { nodes: [node('L2')] }, null),
    ];
    useWorkspace.getState().adoptSession({ documents: restored, activeDocId: 'id-b' });

    const ws = useWorkspace.getState();
    expect(ws.documents.map(d => d.name)).toEqual(['A', 'B']);
    expect(ws.activeDocId).toBe('id-b');
    expect(ws.hydrated).toBe(true);
  });

  it('keeps the blank starting document when there is nothing stored', () => {
    useWorkspace.setState({ hydrated: false });
    useWorkspace.getState().adoptSession({ documents: [] });

    const ws = useWorkspace.getState();
    expect(ws.documents).toHaveLength(1);
    expect(ws.documents[0].name).toBe(UNTITLED);
    expect(ws.hydrated).toBe(true);
  });

  it('falls back to the first document if the stored active id is gone', () => {
    const restored = [restoredDocument('id-a', 'A', { nodes: [] }, null)];
    useWorkspace.getState().adoptSession({ documents: restored, activeDocId: 'id-missing' });
    expect(useWorkspace.getState().activeDocId).toBe('id-a');
  });

  it('applies stored preferences', () => {
    useWorkspace.getState().adoptSession({
      documents: [],
      prefs: { theme: 'light', activeView: 'diagram', showBeamLabels: true, labelScale: 1.5 },
    });
    const ws = useWorkspace.getState();
    expect(ws.theme).toBe('light');
    expect(ws.activeView).toBe('diagram');
    expect(ws.showBeamLabels).toBe(true);
    expect(ws.labelScale).toBe(1.5);
  });
});

// ── Guarding the stored shape ─────────────────────────────────────────────────

describe('isUsableSnapshot', () => {
  const valid: SessionSnapshot = {
    version: 1, activeDocId: 'a',
    prefs: { theme: 'dark', activeView: 'editor', showBeamLabels: false, labelScale: 1 },
    documents: [],
  };

  it('accepts a snapshot from this build', () => {
    expect(isUsableSnapshot(valid)).toBe(true);
  });

  it('rejects anything else, rather than half-restoring it', () => {
    expect(isUsableSnapshot({ ...valid, version: 2 })).toBe(false);
    expect(isUsableSnapshot({ ...valid, documents: 'nope' })).toBe(false);
    expect(isUsableSnapshot(null)).toBe(false);
    expect(isUsableSnapshot('a string')).toBe(false);
    expect(isUsableSnapshot(undefined)).toBe(false);
  });
});

// ── The fingerprint is the same one Save uses ────────────────────────────────

describe('consistency with saving', () => {
  it('a restored document saves to the same bytes it would have before', () => {
    const doc = newDocument('bench', { nodes: [node('L1'), node('L2', {}, 400)] });
    const before = layoutToJSON(...Object.values(doc.store.getState().getLayout()) as [never, never]);

    const { documents } = documentsFromSnapshot(buildSnapshot(workspaceWith(doc)));
    const after = layoutToJSON(...Object.values(documents[0].store.getState().getLayout()) as [never, never]);

    // Only the `created` timestamp in the metadata may differ.
    const strip = (s: string) => JSON.parse(s).nodes;
    expect(strip(after)).toEqual(strip(before));
    const restored = documents[0].store.getState();
    expect(restored.savedFingerprint).toBe(layoutFingerprint(restored.nodes, restored.edges));
  });
});
