import React from 'react';
import { useLayoutStore } from './store/layoutStore';
import { EditorPanel } from './components/Editor/EditorPanel';
import { DiagramPanel } from './components/Diagram/DiagramPanel';
import { UpdatePrompt } from './components/UpdatePrompt';

const App: React.FC = () => {
  const activeTab = useLayoutStore(s => s.activeTab);
  const setActiveTab = useLayoutStore(s => s.setActiveTab);
  const theme = useLayoutStore(s => s.theme);

  const isDark = theme === 'dark';

  return (
    <div className={`flex flex-col h-screen w-screen overflow-hidden ${isDark ? 'bg-gray-950 text-white' : 'bg-slate-50 text-slate-900'}`}>
      {/* Title bar */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b ${isDark ? 'bg-gray-900 border-gray-700' : 'bg-white border-slate-200'} select-none`}>
        <div className="flex items-center gap-2">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="11" cy="11" r="9" stroke="#3b82f6" strokeWidth="1.5" />
            <line x1="2" y1="11" x2="20" y2="11" stroke="#3b82f6" strokeWidth="1" />
            <line x1="11" y1="2" x2="11" y2="20" stroke="#3b82f6" strokeWidth="1" strokeDasharray="2,2" />
            <circle cx="11" cy="11" r="3" fill="#3b82f6" opacity="0.6" />
          </svg>
          <span className="text-sm font-bold tracking-tight" style={{ color: '#3b82f6' }}>OpticaLab</span>
          <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-400'}`}>Optical System Designer</span>
        </div>

        <div className="flex-1" />

        {/* Tab bar */}
        <div className={`flex rounded-lg overflow-hidden border ${isDark ? 'border-gray-700' : 'border-slate-200'}`}>
          {(['editor', 'diagram'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 text-xs font-medium capitalize transition-colors ${
                activeTab === tab
                  ? isDark
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-500 text-white'
                  : isDark
                    ? 'bg-gray-800 text-gray-400 hover:text-gray-200'
                    : 'bg-white text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab === 'editor' ? '✏️ Editor' : '📐 Diagram'}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'editor' ? <EditorPanel /> : <DiagramPanel />}
      </div>

      {/* Registers the service worker, and offers the reload when a new build lands. */}
      <UpdatePrompt />
    </div>
  );
};

export default App;
