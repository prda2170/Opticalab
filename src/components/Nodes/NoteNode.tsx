// Free text on the bench, on the canvas.
//
// The runs come from `utils/richText`, which the SVG export parses too — so `Δ = 2π×80 MHz`
// lands the same way in the figure as it does here. Editing is in the properties panel:
// inline editing on the canvas would fight xyflow for the keyboard, and a note is usually
// typed once.
import React from 'react';
import { NodeResizer, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { useLayout } from '../../store/layoutContext';
import type { NoteData } from '../../types/components';
import { parseRich, SCRIPT_SCALE, SCRIPT_RISE } from '../../utils/richText';
import { NOTE_STYLE } from '../../utils/annotationStyle';

const NoteNode: React.FC<NodeProps<Node<NoteData>>> = ({ id, data, selected }) => {
  const { updateNodeData } = useReactFlow();
  const setSelectedNode = useLayout(s => s.setSelectedNode);
  const lines = parseRich(data.text);
  const size = data.fontSize;

  return (
    <>
      {/* Width only: the height is whatever the text needs. */}
      <NodeResizer
        isVisible={selected}
        color={data.colour}
        minWidth={NOTE_STYLE.minWidth}
        minHeight={size}
        onResize={(_, params) => updateNodeData(id, { w: params.width })}
      />
      <div
        title={data.name}
        onMouseDown={() => setSelectedNode(id)}
        style={{
          width: data.w,
          padding: NOTE_STYLE.pad,
          fontSize: size,
          lineHeight: NOTE_STYLE.lineHeight,
          color: data.colour,
          textAlign: data.align,
          fontFamily: 'system-ui, sans-serif',
          fontWeight: 500,
          cursor: 'move',
          userSelect: 'none',
          // A note is text, not a box: no border, no background, nothing to compete with
          // the layout it is annotating.
          outline: selected ? `1px dashed ${data.colour}` : 'none',
        }}
      >
        {lines.map((runs, li) => (
          <div key={li} style={{ minHeight: size * NOTE_STYLE.lineHeight }}>
            {runs.map((run, ri) => run.script === 'normal' ? (
              <span key={ri}>{run.text}</span>
            ) : (
              <span
                key={ri}
                style={{
                  fontSize: size * SCRIPT_SCALE,
                  verticalAlign: 'baseline',
                  position: 'relative',
                  top: run.script === 'sup' ? -size * SCRIPT_RISE : size * SCRIPT_RISE * 0.6,
                }}
              >
                {run.text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </>
  );
};

export default NoteNode;
