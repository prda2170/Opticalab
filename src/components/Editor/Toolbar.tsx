// Top toolbar for the Editor panel
import React from 'react';
import { useLayoutStore, LABEL_SCALE_MIN, LABEL_SCALE_MAX } from '../../store/layoutStore';
import { layoutToJSON, layoutFromJSON, saveTextAs } from '../../utils/export';

export const Toolbar: React.FC = () => {
  const undo             = useLayoutStore(s => s.undo);
  const redo             = useLayoutStore(s => s.redo);
  const history          = useLayoutStore(s => s.history);
  const future           = useLayoutStore(s => s.future);
  const loadLayout       = useLayoutStore(s => s.loadLayout);
  const getLayout        = useLayoutStore(s => s.getLayout);
  const theme            = useLayoutStore(s => s.theme);
  const setTheme         = useLayoutStore(s => s.setTheme);
  const showBeamLabels   = useLayoutStore(s => s.showBeamLabels);
  const toggleBeamLabels = useLayoutStore(s => s.toggleBeamLabels);
  const labelScale       = useLayoutStore(s => s.labelScale);
  const setLabelScale    = useLayoutStore(s => s.setLabelScale);

  const handleSave = async () => {
    const { nodes, edges } = getLayout();
    await saveTextAs(
      layoutToJSON(nodes, edges),
      'opticalab_layout.json',
      'OpticaLab layout',
      { 'application/json': ['.json'] },
    );
  };

  const handleLoad = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const { nodes, edges, notes } = layoutFromJSON(text);
        loadLayout({ nodes, edges });
        // Every note means the file and what is now on screen differ — a migrated field
        // or a component left out — so say so rather than letting it pass silently.
        if (notes.length > 0) {
          alert(`Layout loaded, with changes:\n\n• ${notes.join('\n\n• ')}`);
        }
      } catch (err) {
        alert(err instanceof Error ? err.message : 'That file could not be read.');
      }
    };
    input.click();
  };

  const Btn: React.FC<{ onClick: () => void; disabled?: boolean; title: string; children: React.ReactNode }> = ({ onClick, disabled, title, children }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  );

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
      <Btn onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)">↩ Undo</Btn>
      <Btn onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Y)">↪ Redo</Btn>
      <div className="w-px h-5 bg-gray-600 mx-1" />
      <Btn onClick={handleSave} title="Save layout to JSON">💾 Save</Btn>
      <Btn onClick={handleLoad} title="Load layout from JSON">📂 Load</Btn>
      <div className="w-px h-5 bg-gray-600 mx-1" />
      <Btn
        onClick={toggleBeamLabels}
        title="Toggle beam property labels"
      >
        {showBeamLabels ? '🔆 Labels On' : '🔅 Labels Off'}
      </Btn>
      <div className="w-px h-5 bg-gray-600 mx-1" />
      {/* Component label size. Smaller text also sits closer to its icon. */}
      <label className="flex items-center gap-1.5 text-xs text-gray-400 select-none"
        title="Component label size">
        <span aria-hidden>A</span>
        <input
          type="range"
          min={LABEL_SCALE_MIN} max={LABEL_SCALE_MAX} step={0.05}
          value={labelScale}
          onChange={e => setLabelScale(parseFloat(e.target.value))}
          className="w-20 accent-blue-500 cursor-pointer"
        />
        <span className="tabular-nums w-8 text-gray-500">{labelScale.toFixed(2)}×</span>
      </label>

      <div className="flex-1" />
      <Btn onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
        {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
      </Btn>
    </div>
  );
};
