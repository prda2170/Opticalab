// Document tabs: which layouts are open, and which one you are looking at.
//
// Not to be confused with the Editor/Diagram pair in the title bar — those are two *views*
// of whichever document is active, which is why that state is called `activeView`.
//
// Closing asks first when a document has anything on its canvas, because a layout lives
// only in memory until it is saved. That is a stand-in: once documents track a dirty flag
// against their file (phase 3), the question should be asked only when there is something
// unsaved, and a saved-and-unchanged document should close without a word.
import React, { useEffect } from 'react';
import { useWorkspace } from '../store/workspaceStore';

/** Alt-based, because the browser owns Ctrl+T and Ctrl+W and will not give them up. */
const SHORTCUT_HINT = 'Alt+T new · Alt+W close · Alt+1…9 switch';

export const DocumentTabs: React.FC = () => {
  const documents    = useWorkspace(s => s.documents);
  const activeDocId  = useWorkspace(s => s.activeDocId);
  const theme        = useWorkspace(s => s.theme);
  const openDocument = useWorkspace(s => s.openDocument);
  const setActiveDoc = useWorkspace(s => s.setActiveDoc);

  const isDark = theme === 'dark';

  /** Ask before dropping a bench that has anything on it. */
  const closeWithGuard = (id: string) => {
    const { documents: docs, closeDocument } = useWorkspace.getState();
    const doc = docs.find(d => d.id === id);
    if (!doc) return;
    const count = doc.store.getState().nodes.length;
    if (count > 0 && !window.confirm(`Close "${doc.name}"? It has ${count} component${count === 1 ? '' : 's'} and is not saved anywhere.`)) {
      return;
    }
    closeDocument(id);
  };

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
