// Diagram panel: clean read-only SVG render of the optical layout.
//
// This is a *pure renderer*. Beam geometry comes entirely from `store.segments`
// (produced by the beam tracer) — the panel never derives beam paths itself, so
// it always matches the editor canvas exactly. Component geometry comes from
// getNodeGeometry, the same source the router snaps against.
import React, { useState, useMemo, useRef } from 'react';
import { useLayout } from '../../store/layoutContext';
import { useWorkspace } from '../../store/workspaceStore';
import { wavelengthToRGB, wavelengthDashArray } from '../../utils/colormap';
import { getNodeIcon } from '../Nodes/NodeIcons';
import { iconDimensions } from '../../utils/iconMetrics';
import { getNodeGeometry, artworkOf } from '../../utils/nodeGeometry';
import { CATEGORY_COLORS } from '../../types/components';
import type { OpticalNodeData, PowerProbeData } from '../../types/components';
import type { BeamSegment } from '../../types/beam';
import { downloadSVG, downloadPNG } from '../../utils/export';
import { PX_PER_INCH, formatSpot } from '../../physics/scale';
import { formatDetuning } from '../../physics/wavelength';
import { drawnEndpoints } from '../../physics/beamLayout';
import { componentLanes } from '../../physics/lanes';
import { probeBeam, probeLines } from '../../physics/probe';
import { detectorSignalLabel, incidentPower } from '../../physics/detector';
import { formatCurrent, formatSourcePower } from '../../utils/units';

import { labelLayout } from '../../utils/labelLayout';
import { labelDistance, labelHalfExtents, DEFAULT_LABEL_SIDE } from '../../physics/labelPlacement';
import type { Node } from '@xyflow/react';

// Per-component annotation toggle state
type AnnotationToggles = Record<string, Record<string, boolean>>;

function getAnnotations(data: OpticalNodeData): Record<string, string> {
  const ann: Record<string, string> = {};
  switch (data.type) {
    case 'laser_source':
      ann['λ'] = `${data.wavelength} nm`;
      ann['P'] = formatSourcePower(data.outputPower);
      ann['pol'] = data.polarization;
      // Bookkeeping, so only shown when someone has bothered to record it.
      if (data.current) ann['I'] = formatCurrent(data.current);
      break;
    case 'optical_amplifier':
      ann['P'] = formatSourcePower(data.outputPower);
      if (data.current) ann['I'] = formatCurrent(data.current);
      break;
    case 'fiber_amplifier':
      // A source, so it gets source-style annotations: what colour, how much, how polarised.
      ann['λ'] = `${data.wavelength} nm`;
      ann['P'] = formatSourcePower(data.outputPower);
      ann['pol'] = data.polarization;
      if (data.current) ann['I'] = formatCurrent(data.current);
      break;
    case 'hwp': ann['θ'] = `${data.fastAxisAngle}°`; break;
    case 'qwp': ann['θ'] = `${data.fastAxisAngle}°`; break;
    case 'linear_polarizer': ann['θ'] = `${data.angle}°`; break;
    case 'nd_filter': ann['OD'] = `${data.od}`; break;
    case 'isolator': ann['T'] = `${data.transmission}%`; ann['iso'] = `${data.isolation} dB`; break;
    case 'dielectric_mirror': ann['R'] = `${data.reflectivity}%`; break;
    case 'retroreflector':
      ann['R'] = `${data.reflectivity}%`;
      if (data.focalLength) ann['f'] = `${data.focalLength} mm`;
      break;
    case 'npbs': ann['R:T'] = data.splitRatio; break;
    case 'plano_convex':
    case 'plano_concave': ann['f'] = `${data.focalLength} mm`; break;
    case 'aom': ann['f'] = `${data.rfFrequency} MHz`; ann['η'] = `${data.diffractionEfficiency}%`; break;
    case 'eom': ann['f'] = `${data.rfFrequency} MHz`; break;
    case 'vapor_cell':
      ann['X'] = data.species;
      ann['L'] = `${data.length} mm`;
      ann['T'] = `${data.temperature}°C`;
      break;
    case 'fiber_coupler': ann['η'] = `${data.couplingEfficiency}%`; ann['NA'] = `${data.inputNA}`; break;
    case 'fiber_launcher':
      // A launcher is a source, so it gets source-style annotations.
      ann['λ'] = `${data.wavelength ?? 780} nm`;
      ann['P'] = `${data.outputPower ?? 1} mW`;
      if (data.focalLength) ann['f'] = `${data.focalLength} mm`;
      break;
    case 'fiber_cable': ann['L'] = `${data.length} m`; break;
    case 'fabry_perot': ann['F'] = `${data.finesse}`; ann['FSR'] = `${data.fsr} MHz`; break;
    case 'reference_cavity': ann['F'] = `${data.finesse}`; ann['δν'] = `${data.linewidth} kHz`; break;
    case 'nonlinear_crystal':
    case 'shg_crystal':
    case 'sfg_crystal':
      ann['η'] = `${data.conversionEfficiency}%`; ann['T'] = `${data.temperature}°C`; break;
    default: break;
  }
  return ann;
}

/** Format a beam power for a diagram label. */
function formatPower(mW: number): string {
  if (mW >= 1000) return `${(mW / 1000).toFixed(1)} W`;
  if (mW >= 0.5)  return `${mW.toFixed(mW >= 10 ? 0 : 1)} mW`;
  return `${(mW * 1000).toFixed(0)} µW`;
}

/**
 * One beam segment, straight from the traced coordinates. Free beams (those that
 * leave the layout) get no arrowhead and fade out, so the figure doesn't imply a
 * component where there isn't one.
 */
const BeamPath: React.FC<{ seg: BeamSegment; theme: 'light' | 'dark'; showLabels: boolean }> = ({ seg, theme, showLabels }) => {
  const color = wavelengthToRGB(seg.beam.wavelength);
  const dash  = wavelengthDashArray(seg.beam.wavelength);
  const det = formatDetuning(seg.beam.detuningHz);
  const label = [
    `${Math.round(seg.beam.wavelength)}nm${det ? ` ${det}` : ''}`,
    seg.beam.power > 0 ? formatPower(seg.beam.power) : null,
    seg.beam.w != null ? `w=${formatSpot(seg.beam.w)}` : null,
  ].filter(Boolean).join(' · ');

  // Drawn coordinates: physically true, plus any cosmetic separation from beams
  // sharing this line. Identical to what the editor canvas draws.
  const { x1, y1, x2, y2 } = drawnEndpoints(seg);
  const shift = seg.renderShift;

  // Label at the midpoint, nudged clear of the beam.
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const horizontal = Math.abs(x2 - x1) > Math.abs(y2 - y1);
  const lx = mx + (horizontal ? 0 : 30);
  const ly = my + (horizontal ? -7 : 0);
  const width = Math.max(46, label.length * 4.4);

  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color} strokeWidth={1.5}
        strokeDasharray={dash === '0' ? undefined : dash}
        opacity={seg.free ? 0.55 : 0.9}
        markerEnd={seg.free ? undefined : `url(#diag-arrow-${seg.beam.wavelength.toFixed(0)})`}
      />
      {showLabels && !seg.free && (
        <>
          <rect x={lx - width / 2} y={ly - 6} width={width} height={12} rx={3}
            fill={theme === 'dark' ? 'rgba(15,17,23,0.85)' : 'rgba(248,250,252,0.92)'}
            stroke={color} strokeWidth={0.5}
          />
          <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            fontSize={6.5} fill={color} fontFamily="monospace">
            {label}
          </text>
        </>
      )}

      {/* Focus marker: the beam comes to a waist part-way along this segment.
          Shifted with the drawn line so it stays on the beam. */}
      {seg.waist && (() => {
        const wx = seg.waist.x + (shift?.dx ?? 0);
        const wy = seg.waist.y + (shift?.dy ?? 0);
        return (
        <g>
          <line
            x1={wx + (horizontal ? 0 : -4)} y1={wy + (horizontal ? -4 : 0)}
            x2={wx + (horizontal ? 0 : 4)}  y2={wy + (horizontal ? 4 : 0)}
            stroke={color} strokeWidth={1} opacity={0.9}
          />
          <circle cx={wx} cy={wy} r={1.6} fill={color} opacity={0.9} />
          {showLabels && (
            <text
              x={wx + (horizontal ? 0 : 8)}
              y={wy + (horizontal ? 12 : 0)}
              textAnchor={horizontal ? 'middle' : 'start'}
              dominantBaseline="middle"
              fontSize={6} fill={color} fontFamily="monospace" opacity={0.95}
            >
              {`w₀=${formatSpot(seg.waist.radius)}`}
            </text>
          )}
        </g>
        );
      })()}
    </g>
  );
};

/**
 * Power probe in the figure: the ring on the beam, its leader, and the readout. Drawn
 * from the same `probeBeam` lookup the canvas uses, so both views agree.
 */
const ProbeSymbol: React.FC<{
  node: Node<OpticalNodeData>;
  segments: BeamSegment[];
  theme: 'light' | 'dark';
  labelScale: number;
}> = ({ node, segments, theme, labelScale }) => {
  const data = node.data as PowerProbeData;
  const g = getNodeGeometry('power_probe');
  const cx = node.position.x + g.width / 2;
  const cy = node.position.y + g.height / 2;
  const reading = probeBeam(segments, { x: cx, y: cy });
  const colour = CATEGORY_COLORS.utility;
  const lines = probeLines(data, reading?.beam ?? null);

  const lx = cx + data.labelDx;
  const ly = cy + data.labelDy;
  const fontSize = 7.5 * labelScale;
  const boxW = Math.max(30, Math.max(...lines.map(l => l.length)) * fontSize * 0.62) + 6;
  const boxH = lines.length * fontSize * 1.35 + 4;

  return (
    <g>
      <line x1={cx} y1={cy} x2={lx} y2={ly}
        stroke={colour} strokeWidth={0.8} strokeDasharray="3,2" strokeOpacity={0.75} />
      <circle cx={cx} cy={cy} r={4.5}
        fill={theme === 'dark' ? 'rgba(15,17,23,0.65)' : 'rgba(255,255,255,0.75)'}
        stroke={colour} strokeWidth={1.3} />
      {reading && <circle cx={cx} cy={cy} r={1.2} fill={colour} />}
      <rect x={lx - boxW / 2} y={ly - boxH / 2} width={boxW} height={boxH} rx={3}
        fill={theme === 'dark' ? 'rgba(15,17,23,0.92)' : 'rgba(255,255,255,0.95)'}
        stroke={colour} strokeWidth={0.7} />
      {lines.map((line, i) => (
        <text key={i}
          x={lx} y={ly - boxH / 2 + fontSize * (1.15 + i * 1.35)}
          textAnchor="middle" fontSize={fontSize} fontFamily="ui-monospace, monospace"
          fill={reading ? (theme === 'dark' ? '#e2e8f0' : '#1e293b') : '#6b7280'}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

// Render a single component as SVG group using actual geometry
const NodeSymbol: React.FC<{
  node: Node<OpticalNodeData>;
  toggles: Record<string, boolean>;
  onToggle: (key: string) => void;
  theme: 'light' | 'dark';
  showAnnotations: boolean;
  hiddenTypes: Set<string>;
  labelScale: number;
  /** Detector readout, when the component is showing one. */
  signal: string | null;
  /** Which way this component's label sits, from the trace. */
  labelSide: { dx: number; dy: number };
}> = ({ node, toggles, onToggle, theme, showAnnotations, hiddenTypes, labelScale, signal, labelSide }) => {
  const data = node.data;
  const rotation = data.rotation ?? 0;
  const g = getNodeGeometry(data.type, rotation);
  const hw = g.width / 2;
  const hh = g.height / 2;
  // Center point in canvas coords
  const cx = node.position.x + hw;
  const cy = node.position.y + hh;

  const catColor = CATEGORY_COLORS[data.category];
  const textColor = theme === 'dark' ? '#e2e8f0' : '#1e293b';
  const annColor  = theme === 'dark' ? '#94a3b8' : '#475569';
  const isSymbol  = g.symbolType === 'symbol';
  // From the artwork, not the occupied box: a turned symbol's box grows, and the icon
  // must not grow with it. Identical at 0/90/180/270, where min(w, h) is the same either
  // way. Box nodes fill their border, which is the occupied box by definition.
  const art       = artworkOf(data.type);
  const iconSize  = isSymbol
    ? Math.min(art.width, art.height) + 4
    : Math.min(g.width, g.height) - 6;
  // The diagram's own base label size is a shade smaller than the canvas's.
  const label     = labelLayout(labelScale, 8);
  // A few icons are wider than they are tall, so centre by their real drawn size.
  const drawn     = iconDimensions(data.type, iconSize);
  const showAnn   = showAnnotations && !hiddenTypes.has(data.type);
  const annotations = getAnnotations(data);
  const annKeys = Object.keys(annotations);

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Background — subtle for symbols, solid for boxes. Sized to the *artwork* and
          turned with it, so it hugs the component at any angle instead of being an
          axis-aligned box around it. */}
      <rect
        transform={rotation ? `rotate(${rotation})` : undefined}
        x={-art.width / 2} y={-art.height / 2}
        width={art.width} height={art.height}
        rx={isSymbol ? 4 : 6}
        fill={theme === 'dark' ? '#1e2030' : '#ffffff'}
        stroke={catColor}
        strokeWidth={isSymbol ? 1 : 1.5}
        opacity={isSymbol ? 0.55 : 0.92}
      />
      {/* Category dot (top-right corner) */}
      <circle cx={hw - 5} cy={-hh + 5} r={isSymbol ? 2.5 : 3.5} fill={catColor} />

      {/* Icon — nested <svg>, NOT <foreignObject>, so the diagram rasterises to
          PNG and opens in Illustrator/Inkscape. Rotation is about the node centre,
          which is the current transform origin. */}
      <g transform={`rotate(${rotation}) translate(${-drawn.w / 2}, ${-drawn.h / 2})`}>
        {getNodeIcon(data.type, iconSize, catColor, data)}
      </g>

      {/* Acousto-optics: the 0th order peeling off to its own lane, which sits outside
          the body. Mirrors the marker OpticalNode draws, so both views agree. */}
      {(data.type === 'aom' || data.type === 'aod') && (() => {
        const lane = componentLanes(data)[1] ?? 0;
        const dumped = (data as { dumpZeroOrder?: boolean }).dumpZeroOrder !== false;
        return (
          <g transform={rotation ? `rotate(${rotation})` : undefined}>
            <line
              x1={art.width / 2 - 16} y1={0} x2={art.width / 2} y2={lane}
              stroke={catColor} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2,2"
            />
            <line
              x1={art.width / 2} y1={lane} x2={art.width / 2 + 12} y2={lane}
              stroke={catColor} strokeWidth={1}
              strokeOpacity={dumped ? 0.65 : 0.3}
              strokeDasharray={dumped ? undefined : '2,2'}
            />
            {dumped && (
              <rect x={art.width / 2 + 12} y={lane - 5} width={4} height={10} rx={0.5}
                fill={catColor} fillOpacity={0.7} />
            )}
          </g>
        );
      })()}

      {/* Name and reading, on the side the tracer chose so they keep clear of the beams.
          Same `labelDistance` the canvas uses, so the figure matches what was on screen.
          Anchored by the side: a label to the left of a component ends at it, one to the
          right starts at it, and one above or below is centred. */}
      {(data.showLabel === true || signal) && (() => {
        const lines = [
          data.showLabel === true ? { text: data.name, mono: false } : null,
          signal ? { text: signal, mono: true } : null,
        ].filter(Boolean) as { text: string; mono: boolean }[];
        const widest = lines.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;
        const dist = labelDistance(
          data.type, rotation, labelSide,
          labelHalfExtents(widest, label.fontSize), labelScale,
        );
        const anchor = labelSide.dx > 0.3 ? 'start' : labelSide.dx < -0.3 ? 'end' : 'middle';
        // Vertically centre the block on the chosen point.
        const blockTop = labelSide.dy * dist - ((lines.length - 1) * label.fontSize * 1.25) / 2;
        return (
          <g>
            {lines.map((line, i) => (
              <text
                key={line.mono ? 'signal' : 'name'}
                x={labelSide.dx * dist}
                y={blockTop + i * label.fontSize * 1.25 + label.fontSize * 0.35}
                textAnchor={anchor} fontSize={label.fontSize} fill={textColor}
                fontFamily={line.mono ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}
                fontWeight="600"
              >
                {line.text}
              </text>
            ))}
          </g>
        );
      })()}

      {/* Annotations above node */}
      {showAnn && annKeys.length > 0 && (
        <g>
          {annKeys.map((key, idx) => {
            const active = toggles[key] !== false;
            const gy = -hh - 8 - idx * 10;
            return (
              <text
                key={key}
                x={0} y={gy}
                textAnchor="middle"
                fontSize={7.5}
                fill={annColor}
                fontFamily="monospace"
                opacity={active ? 1 : 0.3}
                style={{ cursor: 'pointer' }}
                onClick={() => onToggle(key)}
              >
                {active ? `${key}=${annotations[key]}` : `${key}=…`}
              </text>
            );
          })}
          {/* Dashed connector line from top of node to lowest annotation */}
          <line
            x1={0} y1={-hh}
            x2={0} y2={-hh - 5}
            stroke={annColor} strokeWidth={0.5} strokeDasharray="2,2" opacity={0.35}
          />
        </g>
      )}
    </g>
  );
};

export const DiagramPanel: React.FC = () => {
  const nodes    = useLayout(s => s.nodes);
  const segments = useLayout(s => s.segments);
  const theme    = useWorkspace(s => s.theme);
  const labelScale = useWorkspace(s => s.labelScale);
  const nodeArrivals = useLayout(s => s.nodeArrivals);
  const labelSides = useLayout(s => s.labelSides);

  const [toggles, setToggles] = useState<AnnotationToggles>({});
  const [zoom, setZoom] = useState(1);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showBeamLabels, setShowBeamLabels] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const svgRef = useRef<SVGSVGElement>(null);

  const presentCategories = useMemo(() => {
    const cats = new Set<string>();
    nodes.forEach(n => cats.add((n.data as OpticalNodeData).category));
    return Array.from(cats);
  }, [nodes]);

  const toggleAnnotation = (nodeId: string, key: string) => {
    setToggles(prev => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], [key]: !(prev[nodeId]?.[key] ?? true) },
    }));
  };

  const toggleHiddenType = (category: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      const allOfType = nodes
        .filter(n => (n.data as OpticalNodeData).category === category)
        .map(n => (n.data as OpticalNodeData).type);
      const allHidden = allOfType.every(t => next.has(t));
      if (allHidden) {
        allOfType.forEach(t => next.delete(t));
      } else {
        allOfType.forEach(t => next.add(t));
      }
      return next;
    });
  };

  // Bounding box over component geometry plus every beam that terminates on a
  // component. Free beams run 4000 px off-canvas, so they are excluded here and
  // clipped to this box at render time instead.
  const bbox = useMemo(() => {
    if (nodes.length === 0) return { x: 0, y: 0, w: 800, h: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x: number, y: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };
    for (const n of nodes) {
      const d = n.data as OpticalNodeData;
      const g = getNodeGeometry(d.type, d.rotation ?? 0);
      grow(n.position.x, n.position.y);
      grow(n.position.x + g.width, n.position.y + g.height);
    }
    for (const s of segments) {
      if (s.free) continue;
      grow(s.x1, s.y1);
      grow(s.x2, s.y2);
    }
    const pad = 100;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }, [nodes, segments]);

  // One arrow marker per distinct wavelength, rather than one per beam.
  const markerWavelengths = useMemo(
    () => Array.from(new Set(segments.filter(s => !s.free).map(s => s.beam.wavelength.toFixed(0)))),
    [segments],
  );

  const bg = theme === 'dark' ? '#0f1117' : '#f8fafc';
  const lineColor = theme === 'dark' ? '#2a2d3a' : '#dde3ee';
  const borderColor = theme === 'dark' ? '#374151' : '#e2e8f0';
  const textMuted = theme === 'dark' ? '#64748b' : '#94a3b8';
  const textSecondary = theme === 'dark' ? '#94a3b8' : '#475569';

  return (
    <div className="flex flex-col h-full" style={{ background: bg }}>
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b flex-wrap"
        style={{ borderColor, flexShrink: 0 }}>
        <span className="text-xs font-semibold" style={{ color: textSecondary }}>DIAGRAM</span>
        <div className="flex-1" />

        <button
          onClick={() => setShowAnnotations(v => !v)}
          className="px-2 py-0.5 text-xs rounded border"
          style={{
            background: showAnnotations ? (theme === 'dark' ? '#1e3a5f' : '#dbeafe') : (theme === 'dark' ? '#1e2030' : '#e2e8f0'),
            borderColor: showAnnotations ? '#3b82f6' : (theme === 'dark' ? '#374151' : '#d1d5db'),
            color: showAnnotations ? '#60a5fa' : textMuted,
          }}
        >
          {showAnnotations ? '🏷 Annotations' : '🏷 Hidden'}
        </button>

        {showAnnotations && presentCategories.map(cat => {
          const catNodes = nodes.filter(n => (n.data as OpticalNodeData).category === cat);
          const allHidden = catNodes.every(n => hiddenTypes.has((n.data as OpticalNodeData).type));
          return (
            <button
              key={cat}
              onClick={() => toggleHiddenType(cat)}
              className="px-1.5 py-0.5 text-xs rounded border"
              style={{
                background: allHidden ? (theme === 'dark' ? '#1e2030' : '#e2e8f0') : (theme === 'dark' ? '#1e2a3a' : '#f0f4ff'),
                borderColor: allHidden ? (theme === 'dark' ? '#374151' : '#d1d5db') : '#3b82f6',
                color: allHidden ? textMuted : '#60a5fa',
                opacity: allHidden ? 0.6 : 1,
              }}
            >
              {cat}
            </button>
          );
        })}

        <div style={{ width: 1, height: 16, background: borderColor }} />
        <button
          onClick={() => setShowBeamLabels(v => !v)}
          className="px-2 py-0.5 text-xs rounded border"
          title="Show λ and power on each beam"
          style={{
            background: showBeamLabels ? (theme === 'dark' ? '#1e3a5f' : '#dbeafe') : (theme === 'dark' ? '#1e2030' : '#e2e8f0'),
            borderColor: showBeamLabels ? '#3b82f6' : (theme === 'dark' ? '#374151' : '#d1d5db'),
            color: showBeamLabels ? '#60a5fa' : textMuted,
          }}
        >
          ⌇ Beams
        </button>

        <div style={{ width: 1, height: 16, background: borderColor }} />
        <button onClick={() => svgRef.current && downloadSVG(svgRef.current, 'opticalab_diagram.svg')}
          className="px-2 py-0.5 text-xs rounded" title="Export diagram as SVG"
          style={{ background: theme === 'dark' ? '#1e2030' : '#e2e8f0', color: theme === 'dark' ? '#e2e8f0' : '#374151' }}>
          ⤓ SVG
        </button>
        <button onClick={() => svgRef.current && downloadPNG(svgRef.current, 'opticalab_diagram.png', bg, 2)}
          className="px-2 py-0.5 text-xs rounded" title="Export diagram as PNG (2× scale)"
          style={{ background: theme === 'dark' ? '#1e2030' : '#e2e8f0', color: theme === 'dark' ? '#e2e8f0' : '#374151' }}>
          ⤓ PNG
        </button>

        <div style={{ width: 1, height: 16, background: borderColor }} />
        <button onClick={() => setZoom(z => Math.min(z + 0.1, 3))}
          className="px-2 py-0.5 text-xs rounded"
          style={{ background: theme === 'dark' ? '#1e2030' : '#e2e8f0', color: theme === 'dark' ? '#e2e8f0' : '#374151' }}>
          +
        </button>
        <span className="text-xs" style={{ color: textMuted }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.2))}
          className="px-2 py-0.5 text-xs rounded"
          style={{ background: theme === 'dark' ? '#1e2030' : '#e2e8f0', color: theme === 'dark' ? '#e2e8f0' : '#374151' }}>
          −
        </button>
        <button onClick={() => setZoom(1)}
          className="px-2 py-0.5 text-xs rounded"
          style={{ background: theme === 'dark' ? '#1e2030' : '#e2e8f0', color: theme === 'dark' ? '#e2e8f0' : '#374151' }}>
          Reset
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm" style={{ color: textMuted }}>
          No components in layout. Build a layout in the Editor tab.
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <svg
            ref={svgRef}
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`}
            style={{ width: bbox.w * zoom, height: bbox.h * zoom, display: 'block', margin: '0 auto' }}
          >
            <defs>
              {/* Optical-table grid — one dot per breadboard hole (1 inch pitch) */}
              <pattern id="diag-grid" width={PX_PER_INCH} height={PX_PER_INCH} patternUnits="userSpaceOnUse">
                <circle cx={PX_PER_INCH / 2} cy={PX_PER_INCH / 2} r="1" fill={lineColor} />
              </pattern>
              {/* Beams that leave the layout are clipped to the figure bounds. */}
              <clipPath id="diag-clip">
                <rect x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} />
              </clipPath>
              {markerWavelengths.map(wl => (
                <marker key={wl} id={`diag-arrow-${wl}`} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
                  <path d="M0,0 L5,2.5 L0,5 Z" fill={wavelengthToRGB(Number(wl))} opacity={0.85} />
                </marker>
              ))}
            </defs>

            {/* Background: opaque so exported PNG/SVG doesn't come out transparent */}
            <rect x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} fill={bg} />
            <rect x={bbox.x} y={bbox.y} width={bbox.w} height={bbox.h} fill="url(#diag-grid)" />

            {/* Beams — geometry straight from the tracer, identical to the editor */}
            <g clipPath="url(#diag-clip)">
              {segments.map(seg => (
                <BeamPath key={seg.id} seg={seg} theme={theme} showLabels={showBeamLabels} />
              ))}
            </g>

            {/* Nodes. Probes are annotations rather than optics, so they draw their
                own ring-and-readout instead of a component symbol. */}
            {nodes.map(node => node.type === 'power_probe' ? (
              <ProbeSymbol
                key={node.id}
                node={node as Node<OpticalNodeData>}
                segments={segments}
                theme={theme}
                labelScale={labelScale}
              />
            ) : (
              <NodeSymbol
                key={node.id}
                node={node as Node<OpticalNodeData>}
                toggles={toggles[node.id] ?? {}}
                onToggle={(key) => toggleAnnotation(node.id, key)}
                theme={theme}
                showAnnotations={showAnnotations}
                hiddenTypes={hiddenTypes}
                labelScale={labelScale}
                signal={detectorSignalLabel(node.data as OpticalNodeData, incidentPower(nodeArrivals.get(node.id)))}
                labelSide={labelSides.get(node.id) ?? DEFAULT_LABEL_SIDE}
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
};
