// Keeping the stored session in step with the open one.
//
// Two jobs, both called once from `App`: read the previous session before the first render,
// and write the current one whenever it settles.
//
// Writes are debounced, because dragging a component fires a great many store updates and
// none of the intermediate ones are worth a database transaction. They are also flushed
// when the page is hidden, which is the last reliable moment a browser gives you — an
// IndexedDB write started during `beforeunload` is not guaranteed to finish, so the
// debounce is deliberately short rather than clever.
import { useWorkspace } from './workspaceStore';
import { buildSnapshot, documentsFromSnapshot, readSnapshot, writeSnapshot } from './session';

/** Long enough to coalesce a drag, short enough that a sudden close rarely loses much. */
const DEBOUNCE_MS = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
/** Unsubscribers for the document stores we are currently watching. */
let documentWatchers: (() => void)[] = [];
let started = false;

function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  void writeSnapshot(buildSnapshot(useWorkspace.getState()));
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; flush(); }, DEBOUNCE_MS);
}

/**
 * Watch every open document, and re-watch when the set changes.
 *
 * A document's content lives in its own store, so the workspace subscription alone would
 * only ever see tabs opening and closing — not a component being dragged inside one.
 */
function watchDocuments() {
  for (const off of documentWatchers) off();
  documentWatchers = useWorkspace.getState().documents.map(doc => doc.store.subscribe(schedule));
}

/**
 * Read the previous session and adopt it.
 *
 * Marks the workspace hydrated either way, so a first run with nothing stored is not
 * mistaken for a load still in flight. Returns how many documents could not be read, for
 * the caller to mention if it wants to.
 */
export async function hydrateSession(): Promise<{ restored: number; dropped: number }> {
  const snapshot = await readSnapshot();
  if (!snapshot) {
    useWorkspace.getState().adoptSession({ documents: [] });
    return { restored: 0, dropped: 0 };
  }

  const { documents, activeDocId, prefs, dropped } = documentsFromSnapshot(snapshot);
  useWorkspace.getState().adoptSession({ documents, activeDocId, prefs });
  return { restored: documents.length, dropped };
}

/** Begin persisting. Safe to call more than once; only the first call does anything. */
export function startSessionPersistence(): () => void {
  if (started) return () => {};
  started = true;

  watchDocuments();
  const offWorkspace = useWorkspace.subscribe((state, prev) => {
    if (state.documents !== prev.documents) watchDocuments();
    schedule();
  });

  // The reliable last chance to write. `beforeunload` is not: a transaction opened there
  // may never commit.
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    document.removeEventListener('visibilitychange', onHide);
    offWorkspace();
    for (const off of documentWatchers) off();
    documentWatchers = [];
    started = false;
  };
}
