// The layout as one flat SVG — the export path, and only that.
//
// The Diagram tab shows the *canvas* (see FigurePanel): identical to the editor by
// construction, because it is the same component. This file exists because a figure has to
// leave the app as vector art that opens in Illustrator or Inkscape, and the canvas is
// HTML/CSS — serialising it would mean `<foreignObject>`, which is neither editable nor
// reliably rasterisable.
//
// So this is a second renderer, and its one job is to be indistinguishable from the first.
// Everything visual it needs comes from `utils/canvasStyle`, which the canvas reads too;
// geometry comes from the tracer, exactly as the canvas gets it. What it deliberately leaves
// out is interaction chrome — handles, selection rings, lock badges — which is not part of
// the layout.
import React from 'react';
import type { Node } from '@xyflow/react';
import { useLayout } from '../../store/layoutContext';
import { useWorkspace } from '../../store/workspaceStore';
import { wavelengthToRGB, wavelengthDashArray } from '../../utils/colormap';
import { getNodeIcon } from '../Nodes/NodeIcons';
import { iconDimensions } from '../../utils/iconMetrics';
import { getNodeGeometry, artworkOf, sizeOf } from '../../utils/nodeGeometry';
import { CATEGORY_COLORS } from '../../types/components';
import type { OpticalNodeData, PowerProbeData, RegionData, NoteData } from '../../types/components';
import type { BeamSegment } from '../../types/beam';
import { formatSpot } from '../../physics/scale';
import { formatDetuning } from '../../physics/wavelength';
import { drawnEndpoints } from '../../physics/beamLayout';
import { componentLanes, laneExitSign } from '../../physics/lanes';
import { probeBeam, probeLines } from '../../physics/probe';
import { detectorSignalLabel, incidentPower } from '../../physics/detector';
import { labelLayout } from '../../utils/labelLayout';
import { labelDistance, labelHalfExtents, DEFAULT_LABEL_SIDE } from '../../physics/labelPlacement';
import {
  CANVAS_BEAM, CANVAS_BOX, CANVAS_GRID, CANVAS_LABEL,
  canvasBg, gridColour, boxFill, labelColour,
} from '../../utils/canvasStyle';
import {
  REGION_STYLE, NOTE_STYLE, withAlpha, regionCaptionCorner,
} from '../../utils/annotationStyle';
import { parseRich, SCRIPT_SCALE, SCRIPT_RISE } from '../../utils/richText';
import { annotationsInLayer } from '../../utils/stacking';
import { ChamberArt } from '../Nodes/ChamberArt';

/** Padding around the layout, px. */
const FIGURE_PAD = 60;

/**
 * One beam, drawn as the canvas draws it: the traced line, at the traced width, with the
 * wavelength's colour and dash. Labels are the same opt-in chip, on the same toggle.
 */
const Beam: React.FC<{ seg: BeamSegment; dark: boolean }> = ({ seg, dark }) => {
  const color = wavelengthToRGB(seg.beam.wavelength);
  const dash = wavelengthDashArray(seg.beam.wavelength);
  const { x1, y1, x2, y2 } = drawnEndpoints(seg);
  return (
    <line
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={color}
      strokeWidth={seg.wired ? CANVAS_BEAM.userWidth : CANVAS_BEAM.autoWidth}
      strokeDasharray={dash === '0' ? undefined : dash}
      // A free beam fades, as it does on the canvas: it leaves the layout rather than
      // arriving anywhere, and the figure should not imply a component that isn't there.
      opacity={seg.free ? 0.55 : (seg.wired ? CANVAS_BEAM.userOpacity : CANVAS_BEAM.autoOpacity)}
      // `dark` only reaches here for symmetry with the chip; the line itself is theme-free.
      data-theme={dark ? 'dark' : 'light'}
    />
  );
};

/** The beam's λ/power/spot chip, when the shared toggle is on. */
const BeamLabel: React.FC<{ seg: BeamSegment }> = ({ seg }) => {
  const { beam } = seg;
  const parts: string[] = [];
  const det = formatDetuning(beam.detuningHz);
  parts.push(`${Math.round(beam.wavelength)} nm${det ? ` ${det}` : ''}`);
  if (beam.power >= 1000)     parts.push(`${(beam.power / 1000).toFixed(2)} W`);
  else if (beam.power >= 0.5) parts.push(`${beam.power.toFixed(1)} mW`);
  else if (beam.power > 0)    parts.push(`${(beam.power * 1000).toFixed(1)} µW`);
  if (beam.polarization.type === 'H' || beam.polarization.type === 'V') parts.push(beam.polarization.type);
  else if (beam.polarization.type === 'circular') parts.push(`${beam.polarization.handedness}CP`);
  if (beam.w != null) parts.push(`w=${formatSpot(beam.w)}`);

  const text = parts.join(' · ');
  const color = wavelengthToRGB(beam.wavelength);
  const { x1, y1, x2, y2 } = drawnEndpoints(seg);
  const horizontal = Math.abs(x2 - x1) > Math.abs(y2 - y1);
  const { fontSize, padX, padY, radius, offset, background } = CANVAS_BEAM.label;
  const cx = (x1 + x2) / 2 + (horizontal ? 0 : offset);
  const cy = (y1 + y2) / 2 + (horizontal ? -offset : 0);
  // Estimated, as on the canvas the browser measures it. Half a character either way does
  // not move a chip that is centred on the midpoint.
  const w = text.length * fontSize * 0.55 + padX * 2;
  const h = fontSize * 1.35 + padY * 2;

  return (
    <g>
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={radius}
        fill={background} stroke={color} strokeWidth={1} />
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
        fontSize={fontSize} fill={color} fontFamily="system-ui, sans-serif">
        {text}
      </text>
    </g>
  );
};

/**
 * A power probe: the ring on the beam, its leader and the readout, as `PowerProbeNode`
 * draws them on the canvas.
 */
const Probe: React.FC<{
  node: Node<OpticalNodeData>;
  segments: BeamSegment[];
  dark: boolean;
  labelScale: number;
}> = ({ node, segments, dark, labelScale }) => {
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
        fill={dark ? 'rgba(15,17,23,0.65)' : 'rgba(255,255,255,0.75)'}
        stroke={colour} strokeWidth={1.3} />
      {reading && <circle cx={cx} cy={cy} r={1.2} fill={colour} />}
      <rect x={lx - boxW / 2} y={ly - boxH / 2} width={boxW} height={boxH} rx={3}
        fill={dark ? 'rgba(15,17,23,0.92)' : 'rgba(255,255,255,0.95)'}
        stroke={colour} strokeWidth={0.7} />
      {lines.map((line, i) => (
        <text key={i}
          x={lx} y={ly - boxH / 2 + fontSize * (1.15 + i * 1.35)}
          textAnchor="middle" fontSize={fontSize} fontFamily="ui-monospace, monospace"
          fill={reading ? labelColour(dark) : '#6b7280'}
        >
          {line}
        </text>
      ))}
    </g>
  );
};

/**
 * A highlight region: the wash and its caption, drawn under everything else.
 *
 * `RegionNode` draws the same thing in CSS. Both take their border width, dash and radius
 * from `annotationStyle`, so a figure exports as the region looked.
 */
const Region: React.FC<{ node: Node<OpticalNodeData> }> = ({ node }) => {
  const data = node.data as RegionData;
  const { width: w, height: h } = sizeOf(node);
  const x = node.position.x;
  const y = node.position.y;
  const caption = regionCaptionCorner(data.captionCorner);
  const common = {
    fill: withAlpha(data.colour, data.fillOpacity),
    stroke: data.colour,
    strokeWidth: REGION_STYLE.borderWidth,
    strokeDasharray: REGION_STYLE.dashArray,
  };
  return (
    <g>
      {data.shape === 'ellipse'
        ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
        : <rect x={x} y={y} width={w} height={h} rx={REGION_STYLE.radius} {...common} />}
      {data.caption && !caption.hidden && (
        <text
          // `textAnchor` does the work at the right-hand corners: the text's near edge is
          // `captionInset` from the same edge the canvas measures from, whatever it says.
          x={caption.right ? x + w - REGION_STYLE.captionInset : x + REGION_STYLE.captionInset}
          y={caption.bottom
            ? y + h - REGION_STYLE.captionInset - REGION_STYLE.captionSize * 0.2
            : y + REGION_STYLE.captionInset + REGION_STYLE.captionSize * 0.8}
          textAnchor={caption.right ? 'end' : 'start'}
          fontSize={REGION_STYLE.captionSize} fill={data.colour}
          fontFamily="system-ui, sans-serif" fontWeight={600} letterSpacing={0.2}
        >
          {data.caption}
        </text>
      )}
    </g>
  );
};

/**
 * A text note. The markup is parsed by `utils/richText`, the same call `NoteNode` makes, so
 * `\Delta = 2\pi	imes80` MHz lands identically in both.
 *
 * Scripts are `<tspan>` with a baseline shift rather than `baseline-shift`, which Illustrator
 * and rasterisers disagree about.
 */
const Note: React.FC<{ node: Node<OpticalNodeData> }> = ({ node }) => {
  const data = node.data as NoteData;
  const lines = parseRich(data.text);
  const size = data.fontSize;
  const step = size * NOTE_STYLE.lineHeight;
  const w = sizeOf(node).width;
  const anchor = data.align === 'center' ? 'middle' : 'start';
  const x = node.position.x + NOTE_STYLE.pad + (data.align === 'center' ? w / 2 - NOTE_STYLE.pad : 0);

  // Each line gets an **absolute** baseline. A relative `dy` per line looks equivalent and
  // is not: SVG accumulates `dy` down the whole `<text>`, so a superscript on line 1 shifts
  // every line after it, and a three-line note draws itself in a heap.
  const top = node.position.y + NOTE_STYLE.pad + size * 0.85;

  return (
    <text
      x={x} y={top}
      textAnchor={anchor} fill={data.colour}
      fontFamily="system-ui, sans-serif" fontSize={size} fontWeight={500}
    >
      {lines.map((runs, li) => {
        const base = top + li * step;
        return runs.map((run, ri) => (
          <tspan
            key={`${li}-${ri}`}
            // Absolute on both axes for the first run of each line, so nothing accumulates;
            // later runs take only a baseline and flow on horizontally. A `dy` *inside* a
            // tspan that carries its own `y` is ignored, which is how the scripts came out
            // flat — hence the arithmetic here rather than a relative shift.
            x={ri === 0 ? x : undefined}
            y={base + (run.script === 'sup' ? -size * SCRIPT_RISE
              : run.script === 'sub' ? size * SCRIPT_RISE * 0.6 : 0)}
            fontSize={run.script === 'normal' ? undefined : size * SCRIPT_SCALE}
          >
            {run.text}
          </tspan>
        ));
      })}
    </text>
  );
};

/** Either kind of annotation, so both layers can render whatever is in them. */
const Annotation: React.FC<{ node: Node<OpticalNodeData> }> = ({ node }) => (
  node.type === 'note' ? <Note node={node} /> : <Region node={node} />
);

/** One component: its glyph, an instrument's housing, and its name. */
const Component: React.FC<{
  node: Node<OpticalNodeData>;
  dark: boolean;
  labelScale: number;
  signal: string | null;
  labelSide: { dx: number; dy: number };
}> = ({ node, dark, labelScale, signal, labelSide }) => {
  const data = node.data;
  const rotation = data.rotation ?? 0;
  const g = getNodeGeometry(data.type, rotation);
  const cx = node.position.x + g.width / 2;
  const cy = node.position.y + g.height / 2;

  const catColor = CATEGORY_COLORS[data.category];
  const isSymbol = g.symbolType === 'symbol';
  // From the artwork, not the occupied box: a turned symbol's box grows, and the icon must
  // not grow with it. The canvas sizes its icons the same way.
  const art = artworkOf(data.type);
  const iconSize = isSymbol
    ? Math.min(art.width, art.height) + 4
    : Math.min(g.width, g.height) - 6;
  const drawn = iconDimensions(data.type, iconSize);
  const label = labelLayout(labelScale, CANVAS_LABEL.basePx);
  const showName = data.showLabel === true;

  if (data.type === 'vacuum_chamber') {
    // Same art the canvas draws, from the same module, so the figure cannot disagree.
    return (
      <g transform={`translate(${cx}, ${cy})`}>
        <g transform={rotation ? `rotate(${rotation})` : undefined}>
          <ChamberArt data={data} colour={catColor} fill={boxFill(dark)} />
        </g>
        {showName && (
          <text
            x={0} y={sizeOf(node).height / 2 + CANVAS_LABEL.basePx * labelScale + 4}
            textAnchor="middle" fontSize={label.fontSize} fill={labelColour(dark)}
            fontFamily="system-ui, sans-serif" fontWeight={500}
          >
            {data.name}
          </text>
        )}
      </g>
    );
  }

  return (
    <g transform={`translate(${cx}, ${cy})`}>
      {/* Instrument housing. Symbol nodes draw bare on the canvas, so they do here. */}
      {!isSymbol && (
        <rect
          transform={rotation ? `rotate(${rotation})` : undefined}
          x={-art.width / 2} y={-art.height / 2}
          width={art.width} height={art.height}
          rx={CANVAS_BOX.radius}
          fill={boxFill(dark)}
          stroke={catColor}
          strokeWidth={CANVAS_BOX.borderWidth}
          filter="url(#fig-box-shadow)"
        />
      )}

      {/* Icon — nested <svg>, NOT <foreignObject>, so the figure rasterises to PNG and
          opens in Illustrator/Inkscape. */}
      <g transform={`rotate(${rotation}) translate(${-drawn.w / 2}, ${-drawn.h / 2})`}>
        {getNodeIcon(data.type, iconSize, catColor, data)}
      </g>

      {/* Acousto-optics: the 0th order peeling off to its own lane, outside the body. The
          same marker `OpticalNode` draws, so both views agree. */}
      {(data.type === 'aom' || data.type === 'aod') && (() => {
        const lane = componentLanes(data)[1] ?? 0;
        const dumped = (data as { dumpZeroOrder?: boolean }).dumpZeroOrder !== false;
        // The dumped order leaves *with* the beam. A cell fed right-to-left keeps its
        // rotation (lanes align to the beam axis, not its direction), so drawing this along
        // +x would point it back up the beam it came from. See `laneExitSign`.
        const s = laneExitSign(data);
        return (
          <g transform={rotation ? `rotate(${rotation})` : undefined}>
            <line
              x1={s * (art.width / 2 - 16)} y1={0} x2={s * (art.width / 2)} y2={lane}
              stroke={catColor} strokeWidth={1} strokeOpacity={0.4} strokeDasharray="2,2"
            />
            <line
              x1={s * (art.width / 2)} y1={lane} x2={s * (art.width / 2 + 12)} y2={lane}
              stroke={catColor} strokeWidth={1}
              strokeOpacity={dumped ? 0.65 : 0.3}
              strokeDasharray={dumped ? undefined : '2,2'}
            />
            {dumped && (
              <rect
                x={s > 0 ? art.width / 2 + 12 : -(art.width / 2 + 12) - 4}
                y={lane - 5} width={4} height={10} rx={0.5}
                fill={catColor} fillOpacity={0.7} />
            )}
          </g>
        );
      })()}

      {/* Name and reading, on the side the tracer chose so they keep clear of the beams —
          the same side, and the same distance, the canvas uses. */}
      {(showName || signal) && (() => {
        const lines = [
          showName ? { text: data.name, mono: false } : null,
          signal ? { text: signal, mono: true } : null,
        ].filter(Boolean) as { text: string; mono: boolean }[];
        const widest = lines.reduce((a, b) => (b.text.length > a.text.length ? b : a)).text;
        const dist = labelDistance(
          data.type, rotation, labelSide,
          labelHalfExtents(widest, label.fontSize), labelScale,
        );
        const anchor = labelSide.dx > 0.3 ? 'start' : labelSide.dx < -0.3 ? 'end' : 'middle';
        const blockTop = labelSide.dy * dist - ((lines.length - 1) * label.fontSize * 1.25) / 2;
        return (
          <g>
            {lines.map((line, i) => (
              <text
                key={line.mono ? 'signal' : 'name'}
                x={labelSide.dx * dist}
                y={blockTop + i * label.fontSize * 1.25 + label.fontSize * 0.35}
                textAnchor={anchor} fontSize={label.fontSize} fill={labelColour(dark)}
                fontFamily={line.mono ? 'ui-monospace, monospace' : 'system-ui, sans-serif'}
                fontWeight={500}
              >
                {line.text}
              </text>
            ))}
          </g>
        );
      })()}
    </g>
  );
};

/**
 * The whole layout, in one `<svg>` the export functions can serialise.
 *
 * Rendered off-screen by `FigurePanel` while the Diagram tab is open, so Export is instant
 * and always reflects what is on the canvas.
 */
export const FigureSVG = React.forwardRef<SVGSVGElement>((_props, ref) => {
  const nodes = useLayout(s => s.nodes);
  const segments = useLayout(s => s.segments);
  const nodeArrivals = useLayout(s => s.nodeArrivals);
  const labelSides = useLayout(s => s.labelSides);
  const theme = useWorkspace(s => s.theme);
  const labelScale = useWorkspace(s => s.labelScale);
  const showBeamLabels = useWorkspace(s => s.showBeamLabels);
  const dark = theme === 'dark';

  // Bounding box over the components and every beam that lands on one. Free beams run
  // 4000 px off-canvas, so they are clipped to this box rather than growing it.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  };
  for (const n of nodes) {
    // `sizeOf`, not the geometry table: a region is whatever size it was dragged to.
    const g = sizeOf(n as Node<OpticalNodeData>);
    grow(n.position.x, n.position.y);
    grow(n.position.x + g.width, n.position.y + g.height);
  }
  for (const s of segments) {
    if (s.free) continue;
    const e = drawnEndpoints(s);
    grow(e.x1, e.y1); grow(e.x2, e.y2);
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 800; maxY = 600; }
  const box = {
    x: minX - FIGURE_PAD, y: minY - FIGURE_PAD,
    w: maxX - minX + FIGURE_PAD * 2, h: maxY - minY + FIGURE_PAD * 2,
  };

  const bg = canvasBg(dark);
  const dot = CANVAS_GRID.size / 2;

  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      width={box.w} height={box.h}
    >
      <defs>
        {/* Hole grid — one dot per inch, the canvas's own colour and size. */}
        <pattern id="fig-grid" width={CANVAS_GRID.gap} height={CANVAS_GRID.gap}
          patternUnits="userSpaceOnUse">
          <circle cx={CANVAS_GRID.gap / 2} cy={CANVAS_GRID.gap / 2} r={dot} fill={gridColour(dark)} />
        </pattern>
        {/* The canvas's CSS drop shadow on instrument boxes. */}
        <filter id="fig-box-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dy={CANVAS_BOX.shadow.dy} stdDeviation={CANVAS_BOX.shadow.blur}
            floodOpacity={CANVAS_BOX.shadow.opacity} />
        </filter>
        <clipPath id="fig-clip">
          <rect x={box.x} y={box.y} width={box.w} height={box.h} />
        </clipPath>
      </defs>

      {/* Opaque, so an exported PNG isn't transparent. */}
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={bg} />
      <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#fig-grid)" />

      {/* Annotations behind the bench, in the order the canvas stacks them. */}
      {annotationsInLayer(nodes as Node<OpticalNodeData>[], 'behind').map(node => (
        <Annotation key={node.id} node={node} />
      ))}

      {/* Components under the beams, as on the canvas, where auto-edges are raised. */}
      {nodes.filter(n => n.type !== 'region' && n.type !== 'note').map(node => node.type === 'power_probe' ? (
        <Probe key={node.id} node={node as Node<OpticalNodeData>}
          segments={segments} dark={dark} labelScale={labelScale} />
      ) : (
        <Component key={node.id} node={node as Node<OpticalNodeData>} dark={dark}
          labelScale={labelScale}
          signal={detectorSignalLabel(node.data as OpticalNodeData, incidentPower(nodeArrivals.get(node.id)))}
          labelSide={labelSides.get(node.id) ?? DEFAULT_LABEL_SIDE}
        />
      ))}

      <g clipPath="url(#fig-clip)">
        {segments.map(seg => <Beam key={seg.id} seg={seg} dark={dark} />)}
      </g>
      {showBeamLabels && segments.filter(s => !s.free).map(seg => (
        <BeamLabel key={`lbl-${seg.id}`} seg={seg} />
      ))}

      {/* Annotations in front, last of all: over the beams, where a caption is readable. */}
      {annotationsInLayer(nodes as Node<OpticalNodeData>[], 'front').map(node => (
        <Annotation key={node.id} node={node} />
      ))}
    </svg>
  );
});

FigureSVG.displayName = 'FigureSVG';
