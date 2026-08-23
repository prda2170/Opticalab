// Opening and saving, for the document you are looking at.
//
// This is where the two stores meet: the *content* is the document's own
// (`useLayout`), while which file it belongs to is the workspace's (`useWorkspace`), because
// that is what the tab strip shows. Keeping both sides here means the toolbar and the
// keyboard shortcuts share one implementation rather than two that drift.
import { useCallback } from 'react';
import { useLayout, useLayoutApi } from './layoutContext';
import { useWorkspace, newDocument, UNTITLED } from './workspaceStore';
import {
  layoutToJSON, layoutFromJSON, saveTextAs, openLayoutFile, writeToHandle,
} from '../utils/export';

const ACCEPT = { 'application/json': ['.json'] };
const DESCRIPTION = 'OpticaLab layout';

/** Strip the extension for display: a tab reads better as "D1_Layout" than "D1_Layout.json". */
const tabName = (fileName: string) => fileName.replace(/\.json$/i, '');

export interface LayoutFileActions {
  /** True when this document differs from the file it came from. */
  dirty: boolean;
  /** True when Save can write straight to a file, with no dialog. */
  canSaveInPlace: boolean;
  /** Write to the document's own file, or fall back to Save As if it has none. */
  save: () => Promise<void>;
  /** Always ask for a destination, and adopt it for later saves. */
  saveAs: () => Promise<void>;
  /**
   * Read a layout file. It lands in *this* document if it is blank and unsaved, and in a
   * new tab otherwise — opening a file should never quietly overwrite a bench.
   */
  open: () => Promise<void>;
}

export function useLayoutFile(): LayoutFileActions {
  const layoutApi = useLayoutApi();
  const dirty = useLayout(s => s.dirty);
  const nodeCount = useLayout(s => s.nodes.length);

  const handle = useWorkspace(s => s.documents.find(d => d.id === s.activeDocId)?.handle ?? null);

  const write = useCallback(async (mode: 'in-place' | 'ask') => {
    const ws = useWorkspace.getState();
    const doc = ws.documents.find(d => d.id === ws.activeDocId);
    if (!doc) return;

    const { nodes, edges } = layoutApi.getState().getLayout();
    const json = layoutToJSON(nodes, edges);

    if (mode === 'in-place' && doc.handle) {
      try {
        await writeToHandle(doc.handle, json);
        layoutApi.getState().markSaved();
      } catch (err) {
        // A lapsed or revoked permission is the usual cause; say so and let them pick again.
        alert(err instanceof Error ? err.message : 'That file could not be written.');
      }
      return;
    }

    const suggested = doc.name === UNTITLED ? 'opticalab_layout.json' : `${doc.name}.json`;
    const result = await saveTextAs(json, suggested, DESCRIPTION, ACCEPT);
    if (result.outcome === 'cancelled') return;
    // A download has no handle, so the next Save has to ask again — but the document is
    // still on disk somewhere, so it counts as saved and the tab takes the name.
    ws.setDocumentFile(doc.id, {
      name: tabName(result.name ?? suggested),
      handle: result.handle ?? null,
    });
    layoutApi.getState().markSaved();
  }, [layoutApi]);

  const open = useCallback(async () => {
    const file = await openLayoutFile();
    if (!file) return;

    let loaded;
    try {
      loaded = layoutFromJSON(file.text);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'That file could not be read.');
      return;
    }

    const ws = useWorkspace.getState();
    const name = tabName(file.name);
    const blankAndUnsaved = nodeCount === 0 && !dirty && !handle;

    if (blankAndUnsaved) {
      layoutApi.getState().loadLayout({ nodes: loaded.nodes, edges: loaded.edges });
      ws.setDocumentFile(ws.activeDocId, { name, handle: file.handle });
    } else {
      ws.openDocument(newDocument(name, { nodes: loaded.nodes, edges: loaded.edges }, file.handle));
    }

    if (loaded.notes.length > 0) {
      alert(`Layout loaded, with changes:\n\n• ${loaded.notes.join('\n\n• ')}`);
    }
  }, [layoutApi, nodeCount, dirty, handle]);

  return {
    dirty,
    canSaveInPlace: handle !== null,
    save: useCallback(() => write('in-place'), [write]),
    saveAs: useCallback(() => write('ask'), [write]),
    open,
  };
}
