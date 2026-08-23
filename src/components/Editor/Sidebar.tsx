// Left sidebar: component palette with collapsible categories
import React, { useState } from 'react';
import { PALETTE, CATEGORY_LABELS } from '../../utils/palette';
import { CATEGORY_COLORS, type ComponentCategory } from '../../types/components';
import { getNodeIcon } from '../Nodes/NodeIcons';
import type { PaletteEntry } from '../../types/components';

const CATEGORY_ORDER: ComponentCategory[] = [
  'source', 'conditioning', 'steering', 'lens', 'fiber',
  'modulation', 'detection', 'cavity', 'coldatom', 'utility',
];

interface PaletteItemProps {
  entry: PaletteEntry;
}

const PaletteItem: React.FC<PaletteItemProps> = ({ entry }) => {
  const color = CATEGORY_COLORS[entry.category];

  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/opticalab-node', JSON.stringify(entry));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-2 px-2 py-1.5 rounded cursor-grab hover:bg-gray-700 active:cursor-grabbing transition-colors"
      title={entry.label}
    >
      <div style={{ color }} className="flex-shrink-0">
        {getNodeIcon(entry.type, 18, color)}
      </div>
      <span className="text-xs text-gray-300 truncate">{entry.label}</span>
    </div>
  );
};

export const Sidebar: React.FC = () => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (cat: string) =>
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));

  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    label: CATEGORY_LABELS[cat],
    color: CATEGORY_COLORS[cat],
    items: PALETTE.filter(p => p.category === cat),
  }));

  return (
    <div className="w-52 bg-gray-900 border-r border-gray-700 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700">
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Components</div>
        <div className="text-xs text-gray-600 mt-0.5">Drag to canvas</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {grouped.map(({ cat, label, color, items }) => (
          <div key={cat}>
            <button
              onClick={() => toggle(cat)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800 transition-colors"
            >
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-xs font-medium text-gray-300 flex-1 text-left">{label}</span>
              <span className="text-gray-500 text-xs">{collapsed[cat] ? '▶' : '▼'}</span>
            </button>
            {!collapsed[cat] && (
              <div className="pb-1">
                {items.map(entry => (
                  <PaletteItem key={entry.type} entry={entry} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
