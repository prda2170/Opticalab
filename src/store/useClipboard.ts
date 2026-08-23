// Cut, copy and paste for the document you are looking at.
//
// The selection comes from the document (`node.selected`, as xyflow reports it); the
// clipboard belongs to the workspace, so what you copy in one tab can be pasted in another.
// Both the toolbar buttons and the keyboard shortcuts go through this, so they cannot drift.
import { useCallback } from 'react';
import { useLayout, useLayoutApi } from './layoutContext';
import { useWorkspace } from './workspaceStore';
import { collectSelection, materialise, clipboardSize } from './clipboard';

export interface ClipboardActions {
  /** How many components are selected right now. */
  selectedCount: number;
  /** How many are waiting on the clipboard. */
  clipboardCount: number;
  copy: () => void;
  cut: () => void;
  paste: () => void;
}

export function useClipboard(): ClipboardActions {
  const layoutApi = useLayoutApi();
  const selectedCount = useLayout(
    s => s.nodes.filter(n => (n as { selected?: boolean }).selected && n.type !== 'beam_endpoint').length,
  );
  const clipboardCount = useWorkspace(s => clipboardSize(s.clipboard));

  const copy = useCallback(() => {
    const { nodes, edges } = layoutApi.getState();
    const ws = useWorkspace.getState();
    const content = collectSelection(nodes, edges, ws.activeDocId);
    // Nothing selected: leave whatever is on the clipboard alone rather than emptying it,
    // which is what every editor does and what a stray Ctrl+C expects.
    if (content) ws.setClipboard(content);
  }, [layoutApi]);

  const cut = useCallback(() => {
    const { nodes, edges } = layoutApi.getState();
    const ws = useWorkspace.getState();
    const content = collectSelection(nodes, edges, ws.activeDocId);
    if (!content) return;
    ws.setClipboard(content);
    layoutApi.getState().removeNodes(content.nodes.map(n => n.id));
  }, [layoutApi]);

  const paste = useCallback(() => {
    const ws = useWorkspace.getState();
    if (!ws.clipboard) return;
    const { nodes, edges } = materialise(ws.clipboard, ws.activeDocId);
    layoutApi.getState().insertNodes(nodes, edges);
  }, [layoutApi]);

  return { selectedCount, clipboardCount, copy, cut, paste };
}
