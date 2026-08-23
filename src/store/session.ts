// Remembering the open tabs between visits.
//
// One window holding eight benches makes a refresh expensive, and an installed app gets
// treated like a native one — so the workspace is written to IndexedDB and read back on
// start. IndexedDB rather than localStorage for one specific reason: a
// `FileSystemFileHandle` is structured-cloneable, so a restored tab still knows which file
// it belongs to and Save can write back to it after a single permission click.
//
// A document's layout is stored as **layout JSON**, the same format Save writes, so restore
// goes through `layoutFromJSON` and inherits its version check and migrations. A session
// can therefore never resurrect a schema the app no longer understands.
//
// The snapshot is a cache, not user data: anything unreadable is discarded rather than
// repaired. The files on disk are the real thing.
import { layoutToJSON, layoutFromJSON } from '../utils/export';
import {
  restoredDocument, type OpenDocument, type SessionPrefs, type WorkspaceStore,
} from './workspaceStore';

const DB_NAME = 'opticalab';
const DB_VERSION = 1;
const STORE = 'session';
const KEY = 'workspace';

/** Bumped when the snapshot's own shape changes; a mismatch drops the session. */
const SNAPSHOT_VERSION = 1;

export interface SessionDocument {
  id: string;
  name: string;
  /** The layout, in the same JSON a save produces. */
  layoutJson: string;
  /** Fingerprint of the file's content, so unsaved work comes back unsaved. */
  savedFingerprint: string;
  viewport: { x: number; y: number; zoom: number } | null;
  handle: FileSystemFileHandle | null;
}

export interface SessionSnapshot {
  version: number;
  activeDocId: string;
  prefs: SessionPrefs;
  documents: SessionDocument[];
}

// ── Pure: what to write, and what to do with what was read ───────────────────

/**
 * Snapshot the workspace. Documents that are blank *and* unsaved are skipped — restoring a
 * row of empty `Untitled` tabs is noise, and the workspace makes a fresh one anyway.
 */
export function buildSnapshot(state: WorkspaceStore): SessionSnapshot {
  const documents: SessionDocument[] = [];
  for (const doc of state.documents) {
    const layout = doc.store.getState();
    const { nodes, edges } = layout.getLayout();
    if (nodes.length === 0 && doc.handle === null && !layout.dirty) continue;
    documents.push({
      id: doc.id,
      name: doc.name,
      layoutJson: layoutToJSON(nodes, edges),
      // What the *file* holds — kept by the document itself, so a dirty tab comes back dirty.
      savedFingerprint: layout.savedFingerprint,
      viewport: layout.viewport,
      handle: doc.handle,
    });
  }
  return {
    version: SNAPSHOT_VERSION,
    activeDocId: state.activeDocId,
    prefs: {
      theme: state.theme,
      activeView: state.activeView,
      showBeamLabels: state.showBeamLabels,
      labelScale: state.labelScale,
    },
    documents,
  };
}

/** Rebuild documents from a snapshot, dropping any that no longer parse. */
export function documentsFromSnapshot(snapshot: SessionSnapshot): {
  documents: OpenDocument[];
  activeDocId: string;
  prefs: SessionPrefs;
  dropped: number;
} {
  const documents: OpenDocument[] = [];
  let dropped = 0;

  for (const entry of snapshot.documents) {
    try {
      const { nodes, edges } = layoutFromJSON(entry.layoutJson);
      documents.push(restoredDocument(
        entry.id,
        entry.name,
        {
          nodes,
          edges,
          viewport: entry.viewport,
          savedFingerprint: entry.savedFingerprint,
        },
        entry.handle ?? null,
      ));
    } catch {
      // A layout the current build cannot read: better one missing tab than a broken app.
      dropped += 1;
    }
  }

  return { documents, activeDocId: snapshot.activeDocId, prefs: snapshot.prefs, dropped };
}

/** True for something that looks like a snapshot this build can use. */
export function isUsableSnapshot(value: unknown): value is SessionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<SessionSnapshot>;
  return s.version === SNAPSHOT_VERSION && Array.isArray(s.documents) && typeof s.prefs === 'object';
}

// ── IndexedDB, kept as thin as it can be ─────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(snapshot: SessionSnapshot): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(snapshot, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // `put` throws synchronously for a value it cannot clone, which the transaction
      // events never report — hence the wrapping try/catch at the call site.
    });
  } finally {
    db.close();
  }
}

/** Everything but the file handles, which are the only part that can refuse to be cloned. */
function withoutHandles(snapshot: SessionSnapshot): SessionSnapshot {
  return { ...snapshot, documents: snapshot.documents.map(d => ({ ...d, handle: null })) };
}

/**
 * Persist a snapshot. Failure is logged and swallowed: this is a convenience, not data.
 *
 * A file handle is the one field that might not be structured-cloneable, and IndexedDB
 * rejects the *whole* value when any part of it is unclonable — so a single odd handle
 * would otherwise cost the entire session. On that specific failure the snapshot is
 * rewritten without handles: the tabs and their layouts come back, and Save asks for a
 * path again, which is what browsers without the File System Access API do anyway.
 */
export async function writeSnapshot(snapshot: SessionSnapshot): Promise<void> {
  try {
    await put(snapshot);
  } catch (err) {
    const unclonable = err instanceof DOMException && err.name === 'DataCloneError';
    if (!unclonable) {
      console.warn('Could not save the session:', err);
      return;
    }
    try {
      await put(withoutHandles(snapshot));
      console.warn('Session saved without file handles: one could not be stored.');
    } catch (retryErr) {
      console.warn('Could not save the session:', retryErr);
    }
  }
}

/** Read the stored snapshot, or null if there is nothing usable. */
export async function readSnapshot(): Promise<SessionSnapshot | null> {
  try {
    const db = await openDb();
    const value = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return isUsableSnapshot(value) ? value : null;
  } catch (err) {
    console.warn('Could not read the previous session:', err);
    return null;
  }
}

/** Forget the stored session. */
export async function clearSnapshot(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('Could not clear the session:', err);
  }
}
