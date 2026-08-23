// Rename the document you are inside.
//
// A document's *state* lives in its own store, but its *name* is workspace state — the tab
// strip owns it. This is the one place the two meet, so it is worth being explicit rather
// than having the toolbar reach into the workspace's document list by hand.
import { useCallback } from 'react';
import { useWorkspace } from './workspaceStore';

/** Returns a setter that renames whichever document is currently active. */
export function useDocumentName(): (name: string) => void {
  const renameDocument = useWorkspace(s => s.renameDocument);
  return useCallback(
    (name: string) => renameDocument(useWorkspace.getState().activeDocId, name),
    [renameDocument],
  );
}
