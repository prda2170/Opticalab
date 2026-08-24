// A highlighted area of the bench, on the canvas.
//
// Deliberately an xyflow node rather than an overlay of its own: that is what buys drag,
// resize, selection, delete, undo, copy/paste, the layout file and session restore, all
// without a line of new plumbing. What makes it not an optic is `NON_OPTICAL_NODE_TYPES`,
// which keeps it out of the beam trace entirely.
import React from 'react';
import { NodeResizer, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { useLayout } from '../../store/layoutContext';
import type { RegionData } from '../../types/components';
import { REGION_STYLE, withAlpha, regionCaptionCorner } from '../../utils/annotationStyle';

const RegionNode: React.FC<NodeProps<Node<RegionData>>> = ({ id, data, selected }) => {
  const { updateNodeData } = useReactFlow();
  const setSelectedNode = useLayout(s => s.setSelectedNode);
  const w = data.w;
  const h = data.h;
  const colour = data.colour;
  const caption = regionCaptionCorner(data.captionCorner);

  return (
    <>
      {/* Resize handles only while selected, so a region is invisible furniture the rest of
          the time. Minimums keep it grabbable. */}
      <NodeResizer
        isVisible={selected}
        color={colour}
        minWidth={REGION_STYLE.minSize}
        minHeight={REGION_STYLE.minSize}
        onResize={(_, params) => updateNodeData(id, { w: params.width, h: params.height })}
      />
      <div
        style={{
          width: w,
          height: h,
          boxSizing: 'border-box',
          border: `${REGION_STYLE.borderWidth}px ${REGION_STYLE.borderStyle} ${colour}`,
          borderRadius: data.shape === 'ellipse' ? '50%' : REGION_STYLE.radius,
          background: withAlpha(colour, data.fillOpacity),
          // The wash must not eat clicks meant for the optics inside it: only the border and
          // the caption are grabbable. `NodeResizer`'s handles sit outside this element.
          pointerEvents: 'none',
        }}
      />
      {/* Border as a separate hit area, so the region can still be picked up. */}
      <div
        title={data.name}
        onMouseDown={() => setSelectedNode(id)}
        style={{
          position: 'absolute', inset: 0,
          border: `${REGION_STYLE.grabWidth}px solid transparent`,
          borderRadius: data.shape === 'ellipse' ? '50%' : REGION_STYLE.radius,
          cursor: 'move',
        }}
      />
      {data.caption && !caption.hidden && (
        <div
          style={{
            position: 'absolute',
            // Anchored to the chosen corner's own edges, so the text's near edge is always
            // `captionInset` from them however long it is. `lineHeight: 1` makes the box the
            // height of the text, which is what keeps the SVG baseline in the same place.
            ...(caption.right
              ? { right: REGION_STYLE.captionInset }
              : { left: REGION_STYLE.captionInset }),
            ...(caption.bottom
              ? { bottom: REGION_STYLE.captionInset }
              : { top: REGION_STYLE.captionInset }),
            fontSize: REGION_STYLE.captionSize,
            lineHeight: 1,
            fontWeight: 600,
            color: colour,
            letterSpacing: 0.2,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {data.caption}
        </div>
      )}
    </>
  );
};

export default RegionNode;
