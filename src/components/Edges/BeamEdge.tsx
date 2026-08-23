// Beam edge: colored by wavelength, straight or elbow path.
// Labels shown only when showBeamLabels is on, positioned above midpoint.
import React, { memo } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  type EdgeProps,
  type Edge,
} from '@xyflow/react';
import type { BeamEdgeData } from '../../types/components';
import { wavelengthToRGB } from '../../utils/colormap';
import { formatSpot } from '../../physics/scale';
import { formatDetuning } from '../../physics/wavelength';
import { useLayoutStore } from '../../store/layoutStore';


const BeamEdge: React.FC<EdgeProps<Edge<BeamEdgeData>>> = ({
  id,
  sourceX, sourceY, targetX, targetY,
  data,
}) => {
  const isAuto     = id.startsWith('auto_');
  const showLabels = useLayoutStore(s => s.showBeamLabels);

  // Subscribe to this edge's beam values as primitives. zustand v5 has no
  // equality-function argument, so selecting scalars (rather than the BeamState
  // object, which is rebuilt on every trace) is what actually keeps unrelated
  // beam changes from re-rendering every edge.
  const beamWl    = useLayoutStore(s => s.beamMap.get(id)?.wavelength);
  const beamPower = useLayoutStore(s => s.beamMap.get(id)?.power);
  const beamPol   = useLayoutStore(s => s.beamMap.get(id)?.polarization.type);
  const beamHand  = useLayoutStore(s => {
    const p = s.beamMap.get(id)?.polarization;
    return p?.type === 'circular' ? p.handedness : undefined;
  });
  const beamSpot  = useLayoutStore(s => s.beamMap.get(id)?.w);
  const beamDet   = useLayoutStore(s => s.beamMap.get(id)?.detuningHz);

  // beamMap comes from the beam tracer and is per-ray, so it is authoritative for
  // every edge it covers — including co-propagating beams sharing a source handle.
  // `data` is the same trace output baked into the edge, used as a fallback for
  // edges the tracer couldn't resolve (e.g. a wire from an unpowered component).
  const wavelength = beamWl    ?? data?.wavelength ?? 780;
  const power      = beamPower ?? data?.power      ?? 0;
  const color      = wavelengthToRGB(wavelength);

  // For auto-routed edges, use the explicit coordinates baked in by the router.
  // These are guaranteed axis-aligned (same x for vertical beams, same y for horizontal).
  // Fall back to xyflow's handle-measurement coordinates for manually-drawn edges.
  const sx = (isAuto && data?.sx != null) ? data.sx : sourceX;
  const sy = (isAuto && data?.sy != null) ? data.sy : sourceY;
  const tx = (isAuto && data?.tx != null) ? data.tx : targetX;
  const ty = (isAuto && data?.ty != null) ? data.ty : targetY;

  const adx = Math.abs(tx - sx);
  const ady = Math.abs(ty - sy);
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty });

  const labelParts: string[] = [];
  if (showLabels) {
    // Carrier and RF detuning read as one quantity: "780 nm +160 MHz".
    if (wavelength) {
      const det = formatDetuning(beamDet);
      labelParts.push(`${Math.round(wavelength)} nm${det ? ` ${det}` : ''}`);
    }
    if (power > 0) {
      if (power >= 1000)       labelParts.push(`${(power / 1000).toFixed(2)} W`);
      else if (power >= 0.5)   labelParts.push(`${power.toFixed(1)} mW`);
      else                     labelParts.push(`${(power * 1000).toFixed(1)} µW`);
    }
    if (beamPol === 'H' || beamPol === 'V') labelParts.push(beamPol);
    else if (beamPol === 'circular' && beamHand) labelParts.push(`${beamHand}CP`);
    if (beamSpot != null) labelParts.push(`w=${formatSpot(beamSpot)}`);
  }

  // Offset label beside the beam midpoint
  const isHorizontal = adx > ady;
  const lblOffX = isHorizontal ? 0 : 14;
  const lblOffY = isHorizontal ? -14 : 0;

  return (
    <>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: color,
          strokeWidth: isAuto ? 1.5 : 2,
          opacity: isAuto ? 0.9 : 1,
          // Auto-beam edges are elevated above nodes (z-index on .react-flow__edges).
          // Disable pointer events so elevated beams don't block node interactions.
          pointerEvents: isAuto ? 'none' : 'stroke',
        }}
      />
      {labelParts.length > 0 && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX + lblOffX}px,${labelY + lblOffY}px)`,
              pointerEvents: 'none',
              background: 'rgba(15,15,25,0.85)',
              border: `1px solid ${color}`,
              borderRadius: 4,
              padding: '1px 5px',
              fontSize: 9,
              color: color,
              whiteSpace: 'nowrap',
            }}
          >
            {labelParts.join(' · ')}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default memo(BeamEdge);
