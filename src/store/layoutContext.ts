// How a component reaches "the document I am inside".
//
// Every component that used to import the singleton store now selects through `useLayout`,
// which reads whichever document's store the surrounding provider supplies. That is the
// whole trick behind tabs: the components never learn there is more than one document, and
// switching tabs is a change of provider value, not a change of state.
//
// No JSX here on purpose — `App` renders `<LayoutContext.Provider>` directly, so this file
// exports only a context and two hooks and stays out of the way of fast refresh.
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { LayoutState, LayoutStoreApi } from './layoutStore';

export const LayoutContext = createContext<LayoutStoreApi | null>(null);

/**
 * The active document's store object, for the rare read that must not subscribe —
 * event handlers and effects that want the value *now* rather than on re-render.
 */
export function useLayoutApi(): LayoutStoreApi {
  const store = useContext(LayoutContext);
  if (!store) {
    throw new Error('useLayout must be used inside a LayoutContext.Provider — see App.tsx');
  }
  return store;
}

/**
 * Select from the active document's state, re-rendering when that slice changes.
 *
 * Select **scalars**, not objects: zustand v5 dropped the equality-function argument, and
 * the trace rebuilds `BeamState` objects on every pass, so reference equality never holds
 * for them (see PROJECT_NOTES §5).
 */
export function useLayout<T>(selector: (state: LayoutState) => T): T {
  return useStore(useLayoutApi(), selector);
}
