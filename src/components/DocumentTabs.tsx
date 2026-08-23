// Document tabs: which layouts are open, and which one you are looking at.
//
// Not to be confused with the Editor/Diagram pair in the title bar — those are two *views*
// of whichever document is active, which is why that state is called `activeView`.
//
// Closing asks only when something would actually be lost: a document that matches the
// file it came from closes without a word, and one that does not says so by name. The same
// question is asked of the browser on unload, since a layout lives only in memory until it
// is written somewhere.
import React, { useEffect, useSyncExternalStore } from 'react';
import { useWorkspace, type OpenDocument } from '../store/workspaceStore';

/** Alt-based, because the browser owns Ctrl+T and Ctrl+W and will not give them up. */
const SHORTCUT_HINT = 'Alt+T new · Alt+W close · Alt+1…9 switch';

/**
 * The unsaved marker.
 *
 * Its own component subscribed to its own document's store, so a tab's dot tracks *that*
 * document — the tab strip itself lives outside any LayoutContext and cannot use
 * `useLayout`, and re-rendering the whole strip on every keystroke in any document would
 * be wasteful besides.
 */
const DirtyDot: React.FC<{ doc: OpenDocument }> = ({ doc }) => {
  const dirty = useSyncExternalStore(
    doc.store.subscribe,
    () => doc.store.getState().dirty,
  );
  if (!dirty) return null;
  return (
    <span
      title="Unsaved changes"
      aria-label="unsaved"
      className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"
    />
  );
};

export const DocumentTabs: React.FC = () => {
  const documents    = useWorkspace(s => s.documents);
  const activeDocId  = useWorkspace(s => s.activeDocId);
  const theme        = useWorkspace(s => s.theme);
  const openDocument = useWorkspace(s => s.openDocument);
  const setActiveDoc = useWorkspace(s => s.setActiveDoc);

  const isDark = theme === 'dark';

  /** Ask before dropping unsaved work — and only then. */
  const closeWithGuard = (id: string) => {
    const { documents: docs, closeDocument } = useWorkspace.getState();
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    if (doc.store.getState().dirty
        && !window.confirm(`Close "${doc.name}"? Its changes have not been saved.`)) {
      return;
    }
    closeDocument(id);
  };

  // Leaving the page loses every unsaved document at once, so ask the browser to ask.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const unsaved = useWorkspace.getState().documents.filter(d => d.store.getState().dirty);
      if (unsaved.length === 0) return;
      e.preventDefault();
      // Browsers show their own wording; the string only matters to very old ones.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Keyboard shortcuts, ignored while typing so Alt+W in a name field is not a close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;

      const key = e.key.toLowerCase();
      if (key === 't') { e.preventDefault(); openDocument(); return; }
      if (key === 'w') { e.preventDefault(); closeWithGuard(useWorkspace.getState().activeDocId); return; }
      if (/^[1-9]$/.test(key)) {
        const doc = useWorkspace.getState().documents[Number(key) - 1];
        if (doc) { e.preventDefault(); setActiveDoc(doc.id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openDocument, setActiveDoc]);

  return (
    <div
      className={`flex items-stretch gap-1 px-2 pt-1 overflow-x-auto border-b ${
        isDark ? 'bg-gray-950 border-gray-700' : 'bg-slate-100 border-slate-200'
      }`}
      title={SHORTCUT_HINT}
    >
      {documents.map((doc, i) => {
        const active = doc.id === activeDocId;
        return (
          <div
            key={doc.id}
            onClick={() => setActiveDoc(doc.id)}
            onAuxClick={e => { if (e.button === 1) { e.preventDefault(); closeWithGuard(doc.id); } }}
            title={`${doc.name}${i < 9 ? `  (Alt+${i + 1})` : ''}`}
            className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-t text-xs cursor-pointer select-none whitespace-nowrap border border-b-0 transition-colors ${
              active
                ? isDark
                  ? 'bg-gray-900 border-gray-700 text-gray-100'
                  : 'bg-white border-slate-200 text-slate-900'
                : isDark
                  ? 'bg-transparent border-transparent text-gray-500 hover:text-gray-300'
                  : 'bg-transparent border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <span className="max-w-[14rem] overflow-hidden text-ellipsis">{doc.name}</span>
            <DirtyDot doc={doc} />
            <button
              onClick={e => { e.stopPropagation(); closeWithGuard(doc.id); }}
              title="Close"
              // Only the active tab shows its × until hovered, so a row of tabs stays calm.
              className={`w-4 h-4 flex items-center justify-center rounded leading-none ${
                isDark ? 'hover:bg-gray-700 text-gray-500' : 'hover:bg-slate-200 text-slate-400'
              } ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
            >
              ×
            </button>
          </div>
        );
      })}

      <button
        onClick={() => openDocument()}
        title="New layout (Alt+T)"
        className={`px-2 my-0.5 rounded text-sm leading-none ${
          isDark ? 'text-gray-500 hover:text-gray-200 hover:bg-gray-800' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-200'
        }`}
      >
        +
      </button>
    </div>
  );
};
