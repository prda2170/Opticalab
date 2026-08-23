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

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

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
