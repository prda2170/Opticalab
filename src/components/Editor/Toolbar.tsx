// Top toolbar for the Editor panel
import React from 'react';
import { useLayout } from '../../store/layoutContext';
import { useWorkspace, LABEL_SCALE_MIN, LABEL_SCALE_MAX } from '../../store/workspaceStore';
import { useLayoutFile } from '../../store/useLayoutFile';
import { useClipboard } from '../../store/useClipboard';

/**
 * A toolbar button. At module scope, not inside `Toolbar`: a component defined during
 * render is a *new type* on every render, so React unmounts and remounts every button on
 * every keystroke — which is what `react-hooks/static-components` was flagging seven times
 * in this file.
 */
const Btn: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, disabled, title, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="px-2 py-1 rounded text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
  >
    {children}
  </button>
);

export const Toolbar: React.FC = () => {
  const undo             = useLayout(s => s.undo);
  const redo             = useLayout(s => s.redo);
  const history          = useLayout(s => s.history);
  const future           = useLayout(s => s.future);
  const theme            = useWorkspace(s => s.theme);
  const setTheme         = useWorkspace(s => s.setTheme);
  const showBeamLabels   = useWorkspace(s => s.showBeamLabels);
  const toggleBeamLabels = useWorkspace(s => s.toggleBeamLabels);
  const labelScale       = useWorkspace(s => s.labelScale);
  const setLabelScale    = useWorkspace(s => s.setLabelScale);
  const { dirty, canSaveInPlace, save, saveAs, open } = useLayoutFile();
  const { selectedCount, clipboardCount, copy, cut, paste } = useClipboard();

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-800 border-b border-gray-700">
      <Btn onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)">↩ Undo</Btn>
      <Btn onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Y)">↪ Redo</Btn>
      <div className="w-px h-5 bg-gray-600 mx-1" />
      <Btn
        onClick={() => { void save(); }}
        disabled={!dirty && canSaveInPlace}
        title={canSaveInPlace
          ? 'Save to this layout\u2019s own file (Ctrl+S)'
          : 'Choose a file to save to (Ctrl+S)'}
      >
        {dirty ? '💾 Save*' : '💾 Save'}
      </Btn>
      <Btn onClick={() => { void saveAs(); }} title="Save to a different file (Ctrl+Shift+S)">💾 Save As</Btn>
      <Btn onClick={() => { void open(); }} title="Open a layout file (Ctrl+O)">📂 Open</Btn>
      <div className="w-px h-5 bg-gray-600 mx-1" />
      {/* The clipboard belongs to the window, so a copy here pastes into any other tab. */}
      <Btn
        onClick={copy}
        disabled={selectedCount === 0}
        title={selectedCount === 0
          ? 'Select components to copy (Ctrl+C)'
          : `Copy ${selectedCount} component${selectedCount === 1 ? '' : 's'} (Ctrl+C)`}
      >
        ⧉ Copy
      </Btn>
      <Btn
        onClick={cut}
        disabled={selectedCount === 0}
        title={selectedCount === 0 ? 'Select components to cut (Ctrl+X)' : `Cut ${selectedCount} (Ctrl+X)`}
      >
        ✂ Cut
      </Btn>
      <Btn
        onClick={paste}
        disabled={clipboardCount === 0}
        title={clipboardCount === 0
          ? 'Nothing copied yet (Ctrl+V)'
          : `Paste ${clipboardCount} component${clipboardCount === 1 ? '' : 's'} — from any tab (Ctrl+V)`}
      >
        📋 Paste{clipboardCount > 0 ? ` (${clipboardCount})` : ''}
      </Btn>
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
