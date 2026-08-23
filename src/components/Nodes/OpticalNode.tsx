// Optical component node — symbol style for optical elements, box style for instruments
import React, { memo } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { OpticalNodeData } from '../../types/components';
import { CATEGORY_COLORS } from '../../types/components';
import { getNodeIcon, LaserBoxSVG } from './NodeIcons';
import { getNodeGeometry, artworkOf } from '../../utils/nodeGeometry';
import { labelLayout, type LabelLayout } from '../../utils/labelLayout';
import { detectorSignalLabel, incidentPower as incidentPowerOf } from '../../physics/detector';
import { mirrorReflect } from '../../physics/geometry';
import { componentLanes } from '../../physics/lanes';
import { useLayoutStore } from '../../store/layoutStore';

// ── Direction helpers ─────────────────────────────────────────────────────────

/** Which face a beam travelling in direction d enters (the opposite face). */
function beamToInputPos(d: { dx: number; dy: number }): Position {
  if (d.dx > 0.5)  return Position.Left;   // beam → : enters left face
  if (d.dy > 0.5)  return Position.Top;    // beam ↓ : enters top face
  if (d.dx < -0.5) return Position.Right;  // beam ← : enters right face
  return Position.Bottom;                   // beam ↑ : enters bottom face
}

/** Which face a beam travelling in direction d exits from. */
function beamToOutputPos(d: { dx: number; dy: number }): Position {
  if (d.dx > 0.5)  return Position.Right;  // beam → : exits right face
  if (d.dy > 0.5)  return Position.Bottom; // beam ↓ : exits bottom face
  if (d.dx < -0.5) return Position.Left;   // beam ← : exits left face
  return Position.Top;                      // beam ↑ : exits top face
}

// Mirror reflection comes from physics/geometry so handle placement can never
// disagree with the direction the router actually sends the beam.

/**
 * Place a handle at the centre of the node — overrides ReactFlow's default
 * edge-based positioning so the beam terminates at the optical surface rather
 * than the bounding-box edge.  Works for any Position and any node size.
 */
function atNodeCentre(): React.CSSProperties {
  return {
    left:      'calc(50% - 4px)',
    top:       'calc(50% - 4px)',
    right:     'auto',
    bottom:    'auto',
    transform: 'none',
  };
}

// ── Handle definitions per component type ─────────────────────────────────────
function getHandles(data: OpticalNodeData): {
  inputs:  { id: string; label: string; position: Position; style?: React.CSSProperties }[];
  outputs: { id: string; label: string; position: Position; style?: React.CSSProperties }[];
} {
  const type     = data.type;
  const rotation = (data as { rotation?: number }).rotation ?? 0;

  // For mirror/splitter nodes: use the stored beam direction to dynamically
  // place input and output handles on the correct faces.
  const beamIn   = (data as { beamIncomingDir?: { dx: number; dy: number } }).beamIncomingDir
                   ?? { dx: 1, dy: 0 }; // default: beam from left
  const inputPos = beamToInputPos(beamIn);

  // Reflected beam direction depends on mirror orientation ("/": rotation=0, "\": rotation=90)
  const reflPos  = beamToOutputPos(mirrorReflect(beamIn, rotation));
  // Transmitted beam exits the same face the beam entered from the far side
  const transPos = beamToOutputPos(beamIn);

  switch (type) {
    case 'pbs':
      return {
        inputs:  [{ id: 'in',   label: 'in', position: inputPos,  style: atNodeCentre() }],
        outputs: [
          { id: 'trans', label: 'H', position: transPos, style: atNodeCentre() },
          { id: 'refl',  label: 'V', position: reflPos,  style: atNodeCentre() },
        ],
      };
    case 'galvo':
      return {
        inputs:  [{ id: 'in',  label: 'in',  position: inputPos, style: atNodeCentre() }],
        outputs: [
          { id: 'refl', label: 'out', position: reflPos, style: atNodeCentre() },
        ],
      };
    case 'dielectric_mirror':
      return {
        inputs:  [{ id: 'in',  label: 'in', position: inputPos, style: atNodeCentre() }],
        outputs: [
          { id: 'refl', label: 'R', position: reflPos, style: atNodeCentre() },
        ],
      };
    case 'retroreflector':
      // In and out share a face — the beam leaves the way it came.
      return {
        inputs:  [{ id: 'in',    label: 'in',  position: inputPos, style: atNodeCentre() }],
        outputs: [{ id: 'retro', label: 'ret', position: inputPos, style: atNodeCentre() }],
      };
    case 'dichroic_mirror':
      return {
        inputs:  [{ id: 'in',    label: 'in', position: inputPos, style: atNodeCentre() }],
        outputs: [
          { id: 'trans', label: 'T', position: transPos, style: atNodeCentre() },
          { id: 'refl',  label: 'R', position: reflPos,  style: atNodeCentre() },
        ],
      };
    case 'npbs':
      return {
        inputs:  [{ id: 'in',   label: 'in', position: inputPos,  style: atNodeCentre() }],
        outputs: [
          { id: 'trans', label: 'T', position: transPos, style: atNodeCentre() },
          { id: 'refl',  label: 'R', position: reflPos,  style: atNodeCentre() },
        ],
      };
    case 'aom':
    case 'aod': {
      // The diffracted order leaves along the entry lane (the centre); the 0th order
      // leaves along the dump lane, one order-separation off. That lane is outside the
      // body, so the handle is pulled to the body edge on the correct side — its exact
      // position is cosmetic, since auto-edges carry explicit coordinates and only the
      // handle's existence matters to xyflow.
      const geo = getNodeGeometry(type);
      const lane = componentLanes(data)[1] ?? 0;
      const lanePct = Math.min(92, Math.max(8, 50 + (lane / geo.height) * 100));
      return {
        inputs:  [{ id: 'in',     label: 'in', position: Position.Left,  style: { top: '50%' } }],
        outputs: [
          { id: 'order1', label: '±1', position: Position.Right, style: { top: '50%' } },
          { id: 'order0', label: '0',  position: Position.Right, style: { top: `${lanePct}%` } },
        ],
      };
    }
    case 'nonlinear_crystal':
    case 'shg_crystal':
      return {
        inputs:  [{ id: 'in',   label: 'in',  position: Position.Left,  style: { top: '50%' } }],
        outputs: [
          { id: 'shg',  label: '2ω', position: Position.Right, style: { top: '33%' } },
          { id: 'fund', label: 'ω',  position: Position.Right, style: { top: '67%' } },
        ],
      };
    case 'sfg_crystal':
      return {
        inputs:  [
          { id: 'in1', label: 'ω₁', position: Position.Left,   style: { top: '35%' } },
          { id: 'in2', label: 'ω₂', position: Position.Bottom, style: { left: '50%' } },
        ],
        outputs: [
          { id: 'sfg', label: 'ω₃', position: Position.Right, style: { top: '50%' } },
        ],
      };
    case 'beam_block':
      return {
        inputs:  [{ id: 'in', label: 'in', position: Position.Left, style: atNodeCentre() }],
        outputs: [],
      };
    case 'photodiode':
    case 'apd':
      // Symbol-type detectors: beam meets the active surface at the node centre
      return {
        inputs:  [{ id: 'in', label: 'in', position: Position.Left, style: atNodeCentre() }],
        outputs: [],
      };
    case 'camera':
    case 'beam_profiler':
      // Box-type detectors: beam meets the front face
      return {
        inputs:  [{ id: 'in', label: 'in', position: Position.Left, style: { top: '50%' } }],
        outputs: [],
      };
    case 'fiber_cable':
      return {
        inputs:  [{ id: 'in',  label: 'in',  position: Position.Left,  style: { top: '50%' } }],
        outputs: [{ id: 'out', label: 'out', position: Position.Right, style: { top: '50%' } }],
      };
    default: {
      // Symbol nodes → beam meets optical surface at node centre.
      // Box nodes   → beam meets bounding-box face (edge handles).
      const geo = getNodeGeometry(type);
      const s   = geo.symbolType === 'symbol' ? atNodeCentre() : { top: '50%' };
      return {
        inputs:  [{ id: 'in',  label: 'in',  position: Position.Left,  style: s }],
        outputs: [{ id: 'out', label: 'out', position: Position.Right, style: s }],
      };
    }
  }
}

/**
 * Every handle sits at the node centre.
 *
 * Handles are 1×1 and fully transparent — they exist only so xyflow will keep an edge,
 * and auto-edges carry their own drawn coordinates — so their position is cosmetic. The
 * old code rotated edge-mounted handles in 90° steps, which has no meaning once a node
 * can sit at 15°, and it never affected anything that was drawn.
 */
function centreHandles(handles: ReturnType<typeof getHandles>): ReturnType<typeof getHandles> {
  const centre = atNodeCentre();
  return {
    inputs:  handles.inputs.map(h  => ({ ...h, style: centre })),
    outputs: handles.outputs.map(h => ({ ...h, style: centre })),
  };
}

const HANDLE_BASE: React.CSSProperties = {
  width: 1,
  height: 1,
  border: 'none',
  borderRadius: 0,
  background: 'transparent',
  opacity: 0,
  display: 'block',
  // Keeps handle in DOM for xyflow edge wiring but invisible
  // (inline style wins over xyflow's bundled CSS)
};

/**
 * Component name below the artwork. `slack` is applied as a negative margin so a tall
 * narrow icon — a waveplate is 36 px of artwork in a 72 px box — doesn't leave its label
 * floating below empty space. See utils/labelLayout.
 */
const NameLabel: React.FC<{
  name: string; width: number; color: string; layout: LabelLayout; signal?: string | null;
}> = ({ name, width, color, layout, signal }) => (
  <div
    style={{
      fontSize: layout.fontSize,
      marginTop: -layout.slack,
      fontWeight: 500,
      color,
      textAlign: 'center',
      maxWidth: Math.max(width, 60),
      lineHeight: 1.2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      letterSpacing: 0.1,
    }}
    title={name}
  >
    {name}
    {signal && (
      <div style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, opacity: 0.95 }}>
        {signal}
      </div>
    )}
  </div>
);

// Small lock SVG inline
const LockSVG = ({ color }: { color: string }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={color} strokeWidth="1.2">
    <rect x="1.5" y="4.5" width="7" height="5" rx="1" fill={color} fillOpacity="0.3"/>
    <path d="M3 4.5V3a2 2 0 0 1 4 0v1.5" strokeLinecap="round"/>
  </svg>
);

const OpticalNode: React.FC<NodeProps<Node<OpticalNodeData>>> = ({ id, data, selected }) => {
  const setSelectedNode = useLayoutStore(s => s.setSelectedNode);
  const theme           = useLayoutStore(s => s.theme);
  const labelScale      = useLayoutStore(s => s.labelScale);
  // Total of every beam landing here, not just the strongest: a photodiode with two
  // beams on it reads their sum. Summed inside the selector so this stays a scalar and
  // the node doesn't re-render on every trace (zustand v5 has no equality argument).
  const incidentPower   = useLayoutStore(s => incidentPowerOf(s.nodeArrivals.get(id)));
  const rotation        = (data as { rotation?: number }).rotation ?? 0;
  const geometry        = getNodeGeometry(data.type, rotation);
  // Unrotated size, i.e. the shape of the artwork before it is turned. Icon sizing must
  // come from this rather than the occupied box: a turned symbol's box grows (at 45° a
  // 90x66 laser occupies 110x110), and sizing the artwork from that would inflate it.
  const artwork         = artworkOf(data.type);
  // How big the square symbol artwork is drawn. Rotation-invariant by construction.
  const symbolIconSize  = Math.min(artwork.width, artwork.height) + 4;

  const catColor  = CATEGORY_COLORS[data.category];
  const isDark    = theme === 'dark';
  const isSymbol  = geometry.symbolType === 'symbol';
  const { inputs, outputs } = centreHandles(getHandles(data));
  const { width, height } = geometry;

  const labelColor = isDark ? '#e2e8f0' : '#1e293b';

  // Names are off unless asked for — see BaseNodeData.showLabel.
  const showLabel  = data.showLabel === true;
  const label      = labelLayout(data.type, rotation, labelScale);
  // Detector readout, shown independently of the name label.
  const signal     = detectorSignalLabel(data, incidentPower);

  // Common handle renderer
  const renderHandles = () => (
    <>
      {inputs.map(h => (
        <Handle
          key={`in-${h.id}`}
          type="target"
          position={h.position}
          id={h.id}
          style={{ ...HANDLE_BASE, ...h.style }}
          title={h.label}
        />
      ))}
      {outputs.map(h => (
        <Handle
          key={`out-${h.id}`}
          type="source"
          position={h.position}
          id={h.id}
          style={{ ...HANDLE_BASE, ...h.style }}
          title={h.label}
        />
      ))}
    </>
  );

  // ── Laser source: custom realistic instrument box ─────────────────────────
  if (data.type === 'laser_source') {
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: label.gap, cursor: 'pointer', userSelect: 'none' }}
        title={data.name}
        onClick={() => setSelectedNode(id)}
      >
        <div style={{ width, height, position: 'relative' }}>
          {selected && (
            <div style={{
              position: 'absolute',
              inset: -3,
              border: '2px solid #60a5fa',
              borderRadius: 8,
              pointerEvents: 'none',
              boxShadow: '0 0 0 1px rgba(96,165,250,0.3)',
            }} />
          )}
          {/* The artwork is always drawn at its unrotated size and then turned, centred on
              the node box. Drawing it at the *rotated* size and then rotating turned it
              twice: a vertical laser came out landscape inside a portrait box, its output
              face 12 px off the axis the router emits along. */}
          <div style={{
            position: 'absolute', left: '50%', top: '50%', lineHeight: 0,
            transform: `translate(-50%, -50%)${rotation ? ` rotate(${rotation}deg)` : ''}`,
          }}>
            <LaserBoxSVG width={artwork.width} height={artwork.height} />
          </div>
          {data.locked && (
            <div style={{ position: 'absolute', top: 2, left: 4 }}>
              <LockSVG color={isDark ? '#fbbf24' : '#d97706'} />
            </div>
          )}
          {/* Output handle — right edge, vertically centred */}
          <Handle
            type="source"
            position={Position.Right}
            id="out"
            style={{ ...HANDLE_BASE, top: '50%' }}
            title="out"
          />
          {/* Input handle. A laser absorbs any beam that reaches it (optical
              feedback), so it has to be a valid edge target — without this handle
              xyflow silently drops the edge and the beam is drawn nowhere. */}
          <Handle
            type="target"
            position={Position.Left}
            id="in"
            style={{ ...HANDLE_BASE, top: '50%' }}
            title="in"
          />
        </div>
        {(showLabel || signal) && <NameLabel name={showLabel ? data.name : ''} width={width} color={labelColor} layout={label} signal={signal} />}
      </div>
    );
  }

  if (isSymbol) {
    // ── Symbol node: transparent, pure icon ────────────────────────────────
    return (
      <div
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: label.gap, cursor: 'pointer', userSelect: 'none' }}
        title={data.name}
        onClick={() => setSelectedNode(id)}
      >
        <div style={{
          width,
          height,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* Selection ring */}
          {selected && (
            <div style={{
              position: 'absolute',
              inset: -3,
              border: '2px solid #60a5fa',
              borderRadius: 6,
              pointerEvents: 'none',
              boxShadow: '0 0 0 1px rgba(96,165,250,0.3)',
            }} />
          )}
          {/* Icon. Every symbol turns the same way, mirrors included: their artwork draws
              the surface along −45°, so rotating it lands exactly where the physics
              reflects (mirrorSurfaceDeg = rotation − 45). */}
          <div style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {getNodeIcon(data.type, symbolIconSize, catColor, data)}
          </div>
          {/* Lock badge */}
          {data.locked && (
            <div style={{ position: 'absolute', top: -2, right: -2 }}>
              <LockSVG color={isDark ? '#fbbf24' : '#d97706'} />
            </div>
          )}
          {renderHandles()}
        </div>
        {/* Label below */}
        {(showLabel || signal) && <NameLabel name={showLabel ? data.name : ''} width={width} color={labelColor} layout={label} signal={signal} />}
      </div>
    );
  }

  // ── Box node: badge with border, icon, label ───────────────────────────────
  const ringColor = selected ? '#60a5fa' : catColor;
  const bgColor   = isDark
    ? selected ? 'rgba(30,34,50,0.98)' : 'rgba(22,25,40,0.97)'
    : selected ? 'rgba(255,255,255,1)'  : 'rgba(248,250,252,0.98)';
  const shadowColor = selected
    ? '0 0 0 1.5px #60a5fa, 0 4px 14px rgba(0,0,0,0.45)'
    : '0 2px 8px rgba(0,0,0,0.25)';

  const isAOM = data.type === 'aom' || data.type === 'aod';

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: label.gap, cursor: 'pointer', userSelect: 'none' }}
        title={data.name}
      onClick={() => setSelectedNode(id)}
    >
      {/* Outer wrapper is the box the node *occupies* (the bounding box at this angle);
          the inner group is the artwork, turned inside it. Instruments used to be drawn
          identically at every rotation while the physics treated them as turned — so a
          vertical AOM was trimmed as though it were horizontal and its dump lane came out
          of the side of an unturned box. */}
      <div style={{ position: 'relative', width, height }}>
        <div style={{
          position: 'absolute', left: '50%', top: '50%',
          width: artwork.width, height: artwork.height,
          transform: `translate(-50%, -50%)${rotation ? ` rotate(${rotation}deg)` : ''}`,
        }}>
        {/* Box body */}
        <div style={{
          width: artwork.width,
          height: artwork.height,
          borderRadius: 3,
          background: bgColor,
          border: `1.5px solid ${ringColor}`,
          boxShadow: shadowColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}>
          {/* Lock badge */}
          {data.locked && (
            <div style={{ position: 'absolute', top: 2, left: 4, zIndex: 1 }}>
              <LockSVG color={isDark ? '#fbbf24' : '#d97706'} />
            </div>
          )}
          {/* Icon fills the box */}
          {getNodeIcon(data.type, Math.min(artwork.width, artwork.height) - 4, catColor, data, { w: artwork.width - 3, h: artwork.height - 3 })}
          {renderHandles()}
        </div>

        {/* AOM/AOD: the 0th-order dump lane.
            The undiffracted order has its own beam axis one order-separation off the
            centre — further out than the body, so a peel-off line runs from inside the
            cell to the point where that beam actually begins (node-local `width`,
            which is the exit face the router trims to). When the order is blocked
            inside the cell, the default, the block glyph sits there; when the user
            routes it out, a real beam continues from exactly that point. */}
        {isAOM && (() => {
          const laneY = artwork.height / 2 + (componentLanes(data)[1] ?? 0);
          const dumped = (data as { dumpZeroOrder?: boolean }).dumpZeroOrder !== false;
          return (
            <svg
              style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}
              width={artwork.width} height={artwork.height}
              overflow="visible"
            >
              <title>{dumped ? '0th order — blocked at the cell' : '0th order — routed out on the dump lane'}</title>
              {/* Peel-off: the unused order deviating inside the cell out to its lane. */}
              <line
                x1={artwork.width - 16} y1={artwork.height / 2} x2={artwork.width} y2={laneY}
                stroke={catColor} strokeWidth="1" strokeOpacity="0.4"
                strokeDasharray="2,2" strokeLinecap="round"
              />
              {/* Short stub along the lane, then the block if it is absorbed here. */}
              <line
                x1={artwork.width} y1={laneY} x2={artwork.width + 12} y2={laneY}
                stroke={catColor} strokeWidth="1"
                strokeOpacity={dumped ? 0.65 : 0.3}
                strokeDasharray={dumped ? undefined : '2,2'}
                strokeLinecap="round"
              />
              {dumped && (
                <rect
                  x={artwork.width + 12} y={laneY - 5}
                  width="4" height="10"
                  fill={catColor} fillOpacity="0.7" rx="0.5"
                />
              )}
            </svg>
          );
        })()}
        </div>
      </div>

      {/* Label below — same style as symbol nodes */}
      {(showLabel || signal) && <NameLabel name={showLabel ? data.name : ''} width={width} color={labelColor} layout={label} signal={signal} />}
    </div>
  );
};

export default memo(OpticalNode);
