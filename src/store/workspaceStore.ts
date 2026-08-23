// The window: which documents are open, which one is showing, and the preferences that
// belong to the app rather than to any one layout.
//
// One store for the whole app, holding a *list of document stores* — see layoutStore.ts for
// why each document owns its own. Anything that would be wrong to reset when you switch
// tabs (the theme, the label size) lives here; anything that describes a particular bench
// lives in that bench's own store.
import { create } from 'zustand';
import { createLayoutStore, type LayoutStoreApi } from './layoutStore';
import type { Node, Edge } from '@xyflow/react';
import type { OpticalNodeData, BeamEdgeData } from '../types/components';

/** Range the component-label size slider spans, as a multiple of the base size. */
export const LABEL_SCALE_MIN = 0.5;
export const LABEL_SCALE_MAX = 1.5;

/** Name a new, never-saved document gets on its tab. */
export const UNTITLED = 'Untitled';

export interface OpenDocument {
  /**
   * Stable identity, independent of the name: two documents can be called the same thing,
   * a rename must not look like a different document, and session restore needs a key that
   * survives a reload.
   */
  id: string;
  /** Shown on the tab — the file's name once saved, `UNTITLED` before that. */
  name: string;
  /** This document's own state. Not serialisable; restored sessions rebuild it. */
  store: LayoutStoreApi;
}

/** `crypto.randomUUID` is in every browser this app runs in; the fallback is for safety. */
function documentId(): string {
  const c = globalThis.crypto;
  if (c && 'randomUUID' in c) return c.randomUUID();
  return `doc-${Math.random().toString(36).slice(2)}`;
}

export function newDocument(
  name = UNTITLED,
  initial?: { nodes?: Node<OpticalNodeData>[]; edges?: Edge<BeamEdgeData>[] },
): OpenDocument {
  return { id: documentId(), name, store: createLayoutStore(initial) };
}

interface WorkspaceStore {
  // ── Open documents ────────────────────────────────────────────────────────
  documents: OpenDocument[];
  activeDocId: string;

  // ── Preferences: window-wide, deliberately not per document ───────────────
  theme: 'light' | 'dark';
  /** Which view of the active document is showing. Not to be confused with a doc tab. */
  activeView: 'editor' | 'diagram';
  showBeamLabels: boolean;
  /** Multiplier on component label text size, clamped to [LABEL_SCALE_MIN, MAX]. */
  labelScale: number;

  setTheme: (theme: 'light' | 'dark') => void;
  setActiveView: (view: 'editor' | 'diagram') => void;
  toggleBeamLabels: () => void;
  setLabelScale: (scale: number) => void;

  // ── Documents ─────────────────────────────────────────────────────────────
  /** Add a document and show it. With no argument, an empty `Untitled`. */
  openDocument: (doc?: OpenDocument) => string;
  /**
   * Close a document. Never leaves the workspace empty — closing the last one replaces it
   * with a fresh blank document, so there is always somewhere to draw.
   */
  closeDocument: (id: string) => void;
  setActiveDoc: (id: string) => void;
  /** Rename a tab — what Save/Load use to show which file a document came from. */
  renameDocument: (id: string, name: string) => void;
}

const first = newDocument();

export const useWorkspace = create<WorkspaceStore>((set) => ({
  documents: [first],
  activeDocId: first.id,

  theme: 'dark',
  activeView: 'editor',
  showBeamLabels: false,
  labelScale: 1,

  setTheme: (theme) => set({ theme }),
  setActiveView: (activeView) => set({ activeView }),
  toggleBeamLabels: () => set(s => ({ showBeamLabels: !s.showBeamLabels })),
  setLabelScale: (scale) =>
    set({ labelScale: Math.min(LABEL_SCALE_MAX, Math.max(LABEL_SCALE_MIN, scale)) }),

  openDocument: (doc = newDocument()) => {
    set(s => ({ documents: [...s.documents, doc], activeDocId: doc.id }));
    return doc.id;
  },

  closeDocument: (id) => set(s => {
    const remaining = s.documents.filter(d => d.id !== id);
    if (remaining.length === 0) {
      // Keep exactly one document alive rather than rendering an empty shell.
      const fresh = newDocument();
      return { documents: [fresh], activeDocId: fresh.id };
    }
    if (id !== s.activeDocId) return { documents: remaining, activeDocId: s.activeDocId };
    // Closing the tab you were on: fall to its right-hand neighbour, or the new last one,
    // which is what every editor does.
    const wasAt = s.documents.findIndex(d => d.id === id);
    const next = remaining[Math.min(wasAt, remaining.length - 1)];
    return { documents: remaining, activeDocId: next.id };
  }),

  setActiveDoc: (id) => set(s => (s.documents.some(d => d.id === id) ? { activeDocId: id } : {})),

  renameDocument: (id, name) => set(s => ({
    documents: s.documents.map(d => (d.id === id ? { ...d, name } : d)),
  })),
}));

/**
 * The store of the document currently showing.
 *
 * Falls back to the first open document if the active id ever dangles, so a bad id can
 * never blank the editor. There is always at least one document open.
 */
export function activeDocument(state: WorkspaceStore): OpenDocument {
  return state.documents.find(d => d.id === state.activeDocId) ?? state.documents[0];
}
