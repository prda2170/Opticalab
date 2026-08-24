// Editor panel: sidebar + canvas + properties
import React, { useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Sidebar } from './Sidebar';
import { EditorCanvas } from './EditorCanvas';
import { PropertiesPanel } from './PropertiesPanel';
import { Toolbar } from './Toolbar';
import { useLayout } from '../../store/layoutContext';

export const EditorPanel: React.FC = () => {
  const undo = useLayout(s => s.undo);
  const redo = useLayout(s => s.redo);
  const groupSelected = useLayout(s => s.groupSelected);
  const ungroupSelected = useLayout(s => s.ungroupSelected);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      // Ctrl+G groups the selection, Ctrl+Shift+G takes it apart. `key` is case-folded by
      // Shift, so both cases are checked rather than assuming one.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected(); else groupSelected();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, groupSelected, ungroupSelected]);

  return (
    <ReactFlowProvider>
      <div className="flex flex-col h-full">
        <Toolbar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <EditorCanvas />
          <PropertiesPanel />
        </div>
      </div>
    </ReactFlowProvider>
  );
};
