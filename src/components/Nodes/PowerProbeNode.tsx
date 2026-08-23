// Power probe: a circle sitting on a beam, with a leader line to a readout.
//
// One node, not two. The readout is offset from the probe point and dragged separately
// by pointer events, rather than being its own node joined by an edge — an edge would be
// treated as user wiring by the router, which would try to resolve a beam along it and
// would block auto-routing at the node it pointed to.
import React, { memo, useCallback, useRef, useState } from 'react';
import { useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import type { PowerProbeData } from '../../types/components';
import { CATEGORY_COLORS } from '../../types/components';
import { useLayout } from '../../store/layoutContext';
import { useWorkspace } from '../../store/workspaceStore';
import { probeBeam, probeLines } from '../../physics/probe';
import { getNodeGeometry } from '../../utils/nodeGeometry';

const RADIUS = 5;

const PowerProbeNode: React.FC<NodeProps<Node<PowerProbeData>>> = ({ id, data, selected, positionAbsoluteX, positionAbsoluteY }) => {
  const segments      = useLayout(s => s.segments);
  const theme         = useWorkspace(s => s.theme);
  const labelScale    = useWorkspace(s => s.labelScale);
  const updateNodeData = useLayout(s => s.updateNodeData);
  const setSelectedNode = useLayout(s => s.setSelectedNode);
  const { getZoom }   = useReactFlow();

  const g = getNodeGeometry('power_probe');
  const centre = { x: positionAbsoluteX + g.width / 2, y: positionAbsoluteY + g.height / 2 };
  const reading = probeBeam(segments, centre);

  const colour = CATEGORY_COLORS.utility;
  const isDark = theme === 'dark';

  // Live offset while dragging the readout; committed to node data on release so the
  // canvas isn't reloaded on every pointer move.
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const offset = drag ?? { dx: data.labelDx, dy: data.labelDy };

  const onLabelPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const from = { dx: data.labelDx, dy: data.labelDy };
    const zoom = getZoom() || 1;

    const move = (ev: PointerEvent) => {
      const next = {
        dx: from.dx + (ev.clientX - startX) / zoom,
        dy: from.dy + (ev.clientY - startY) / zoom,
      };
      dragRef.current = next;
      setDrag(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const final = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (final) updateNodeData(id, { labelDx: Math.round(final.dx), labelDy: Math.round(final.dy) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [data.labelDx, data.labelDy, getZoom, id, updateNodeData]);

  const lines = probeLines(data, reading?.beam ?? null);
  const fontSize = 9.5 * labelScale;

  return (
    <div
      style={{ width: g.width, height: g.height, position: 'relative' }}
      title={`${data.name} — power probe`}
      // Selecting opens the readout toggles in the properties panel. A click on the
      // label still bubbles here (only its pointerdown is stopped, to start a drag).
      onClick={() => setSelectedNode(id)}
    >
      {/* Leader line, drawn from the probe circle out to the readout. */}
      <svg
        style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
        width={g.width} height={g.height}
      >
        <line
          x1={g.width / 2} y1={g.height / 2}
          x2={g.width / 2 + offset.dx} y2={g.height / 2 + offset.dy}
          stroke={colour} strokeWidth={1} strokeDasharray="3,2" strokeOpacity={0.75}
        />
        {/* Probe point: a ring, so the beam stays visible through it. */}
        <circle
          cx={g.width / 2} cy={g.height / 2} r={RADIUS}
          fill={isDark ? 'rgba(15,17,23,0.65)' : 'rgba(255,255,255,0.75)'}
          stroke={colour} strokeWidth={selected ? 2 : 1.5}
        />
        {reading && <circle cx={g.width / 2} cy={g.height / 2} r={1.4} fill={colour} />}
      </svg>

      {/* Readout — `nodrag` so grabbing it moves the label, not the whole probe. */}
      <div
        className="nodrag"
        onPointerDown={onLabelPointerDown}
        style={{
          position: 'absolute',
          left: g.width / 2 + offset.dx,
          top: g.height / 2 + offset.dy,
          transform: 'translate(-50%, -50%)',
          padding: `${2 * labelScale}px ${4 * labelScale}px`,
          borderRadius: 4,
          background: isDark ? 'rgba(15,17,23,0.92)' : 'rgba(255,255,255,0.95)',
          border: `1px solid ${colour}`,
          color: reading ? (isDark ? '#e2e8f0' : '#1e293b') : '#6b7280',
          fontSize,
          fontFamily: 'ui-monospace, monospace',
          lineHeight: 1.35,
          whiteSpace: 'nowrap',
          textAlign: 'center',
          cursor: 'move',
          userSelect: 'none',
          boxShadow: selected ? `0 0 0 1.5px ${colour}` : '0 1px 4px rgba(0,0,0,0.3)',
        }}
      >
        {lines.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
};

export default memo(PowerProbeNode);
