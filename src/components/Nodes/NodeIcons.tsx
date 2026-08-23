// SVG icons for each optical component type — physics-accurate, clean symbols
import React from 'react';
import type { OpticalNodeData } from '../../types/components';
import { mirrorHatchSide } from '../../utils/nodeGeometry';
import { VAPOR_CELL_ASPECT, AMPLIFIER_ASPECT } from '../../utils/iconMetrics';

interface IconProps { size?: number; w?: number; h?: number; color?: string }

export const LaserIcon: React.FC<IconProps> = ({ size = 24 }) => {
  const w = size * (90 / 66);
  const h = size;
  return <LaserBoxSVG width={w} height={h} />;
};

/** Shared SVG — viewBox 0 0 90 66 */
export const LaserBoxSVG: React.FC<{ width: number; height: number }> = ({ width, height }) => (
  <svg width={width} height={height} viewBox="0 0 90 66" fill="none">
    {/* Top mounting flange */}
    <rect x="14" y="0"  width="62" height="10" rx="3" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1"/>
    {/* Bottom mounting flange */}
    <rect x="14" y="56" width="62" height="10" rx="3" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1"/>
    {/* Main body */}
    <rect x="2"  y="8"  width="86" height="50" rx="9" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1.25"/>
    {/* Mounting holes — smaller white circles */}
    <circle cx="24" cy="5"  r="3" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="66" cy="5"  r="3" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="24" cy="61" r="3" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="66" cy="61" r="3" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    {/* Ventilation slots — 7 pill-shapes, shifted left, smaller */}
    <rect x="44" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
    <rect x="49" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
    <rect x="54" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
    <rect x="59" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
    <rect x="64" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
    <rect x="69" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
    <rect x="74" y="12" width="3.5" height="18" rx="1.75" fill="#1a1a1a"/>
  </svg>
);

/**
 * Optical amplifier: a chip with a tapered gain stripe running through it, narrow on the
 * seed side and wide on the output side. Literal for a tapered amplifier, and reads as
 * "gain, one way" for a fibre amplifier too.
 */
/**
 * Optical amplifier — the same instrument box a laser gets, with a gain medium inside it.
 *
 * A TA or a fibre amplifier is a boxed instrument on the table, not a bare optic, so it
 * takes `LaserBoxSVG`'s casing: mounting flanges top and bottom, a rounded body, four
 * mounting holes. What differs is what sits inside — the laser's ventilation slots give way
 * to the tapered gain stripe, widening towards an emphasised output facet, which is the one
 * thing that says *amplifier* rather than *source*.
 *
 * Geometry mirrors the laser's proportions, scaled from its 90×66 frame into this 64×44
 * one, so the two read as the same family of object at any size.
 */
export const AmplifierIcon: React.FC<IconProps> = ({ size = 24, w, h, color = 'currentColor' }) => (
  <svg
    width={w ?? size * AMPLIFIER_ASPECT} height={h ?? size}
    viewBox="0 0 64 44" fill="none"
  >
    {/* Mounting flanges, top and bottom */}
    <rect x="10" y="0"  width="44" height="7" rx="2" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1"/>
    <rect x="10" y="37" width="44" height="7" rx="2" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1"/>
    {/* Main body */}
    <rect x="1.5" y="5.5" width="61" height="33" rx="6" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1.25"/>
    {/* Mounting holes */}
    <circle cx="17" cy="3.5"  r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="47" cy="3.5"  r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="17" cy="40.5" r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="47" cy="40.5" r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    {/* Tapered gain stripe — the amplifying region widening toward the output facet.
        Brighter than it was on a pale background, so it still reads against the dark case. */}
    <path d="M11 20 L53 13 L53 31 L11 24 Z" fill={color} fillOpacity="0.75" stroke="none"/>
    {/* Facets: the output one is emphasised, being where the power comes out */}
    <line x1="11" y1="13" x2="11" y2="31" stroke={color} strokeWidth="1" strokeOpacity="0.65"/>
    <line x1="53" y1="11" x2="53" y2="33" stroke={color} strokeWidth="2.2" strokeOpacity="1"/>
  </svg>
);

/**
 * Fibre-coupled optical amplifier: the amplifier's instrument box, seeded down a fibre.
 *
 * Same casing as `AmplifierIcon` so the two read as siblings, with two differences that
 * carry the whole distinction. The entry facet is replaced by a fibre entering the case
 * through a strain-relief boot, because that is where the seed comes from; and there is no
 * free-space input, which is why this type emits rather than passing a beam through.
 */
export const FiberAmplifierIcon: React.FC<IconProps> = ({ size = 24, w, h, color = 'currentColor' }) => (
  <svg
    width={w ?? size * AMPLIFIER_ASPECT} height={h ?? size}
    viewBox="0 0 64 44" fill="none"
  >
    {/* Mounting flanges, top and bottom */}
    <rect x="10" y="0"  width="44" height="7" rx="2" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1"/>
    <rect x="10" y="37" width="44" height="7" rx="2" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1"/>
    {/* Main body */}
    <rect x="1.5" y="5.5" width="61" height="33" rx="6" fill="#3a3a3a" stroke="#0d0d0d" strokeWidth="1.25"/>
    {/* Mounting holes */}
    <circle cx="17" cy="3.5"  r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="47" cy="3.5"  r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="17" cy="40.5" r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    <circle cx="47" cy="40.5" r="2" fill="#ffffff" stroke="#0d0d0d" strokeWidth="0.75"/>
    {/* Seed fibre, entering the case from below-left through a boot. Drawn outside the
        body on purpose: a fibre is a thing hanging off the instrument, not a beam. */}
    <path d="M2 43 C 8 43, 10 34, 16 30" stroke="#d1d5db" strokeWidth="1.6" fill="none" strokeLinecap="round"/>
    <rect x="13" y="26" width="7" height="6" rx="2" transform="rotate(-38 16.5 29)" fill="#6b7280" stroke="#0d0d0d" strokeWidth="0.6"/>
    {/* Tapered gain stripe, from the seeded end to the output facet */}
    <path d="M17 21 L53 13 L53 31 L17 23 Z" fill={color} fillOpacity="0.75" stroke="none"/>
    {/* Output facet, emphasised: the only place light leaves */}
    <line x1="53" y1="11" x2="53" y2="33" stroke={color} strokeWidth="2.2" strokeOpacity="1"/>
  </svg>
);

export const IsolatorIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none">
    {/* Left connector tab */}
    <rect x="2"  y="17" width="8"  height="10" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
    {/* Right connector tab */}
    <rect x="34" y="17" width="8"  height="10" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="1.5"/>
    {/* Main body — drawn on top so its fill covers tab junctions cleanly */}
    <rect x="7"  y="9"  width="30" height="26" fill={color} fillOpacity="0.12" stroke={color} strokeWidth="2.5"/>
    {/* Rightward arrow: shaft + filled triangle head */}
    <line x1="13" y1="22" x2="26" y2="22" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    <path d="M24 18 L32 22 L24 26 Z" fill={color} stroke="none"/>
  </svg>
);

export const PolarizerIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="9" y="3" width="6" height="18" rx="0.5" fill={color} fillOpacity="0.1"/>
    <line x1="10" y1="5.5" x2="14" y2="5.5"/>
    <line x1="10" y1="8.5" x2="14" y2="8.5"/>
    <line x1="10" y1="11.5" x2="14" y2="11.5"/>
    <line x1="10" y1="14.5" x2="14" y2="14.5"/>
    <line x1="10" y1="17.5" x2="14" y2="17.5"/>
  </svg>
);

export const WaveplateIcon: React.FC<IconProps & { label?: string }> = ({ size = 24, color = 'currentColor', label = 'λ/2' }) => {
  const [numer, denom] = label.includes('/') ? label.split('/') : ['λ', label];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      <rect x="8" y="1.5" width="8" height="21" rx="0.5" fill={color} fillOpacity="0.18"/>
      {/* Vertical fraction: λ on top, dividing line, denominator below */}
      <text x="12" y="10"   textAnchor="middle" fontSize="5.5" fill={color} stroke="none" fontFamily="serif" fontStyle="italic">{numer}</text>
      <line x1="10" y1="11.5" x2="14" y2="11.5" stroke={color} strokeWidth="0.8" strokeLinecap="round"/>
      <text x="12" y="16.5" textAnchor="middle" fontSize="5.5" fill={color} stroke="none" fontFamily="sans-serif">{denom}</text>
    </svg>
  );
};

export const NDFilterIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="9" y="3" width="6" height="18" rx="0.5"/>
    <rect x="9" y="3" width="6" height="4" fill={color} fillOpacity="0.7"/>
    <rect x="9" y="7" width="6" height="4" fill={color} fillOpacity="0.45"/>
    <rect x="9" y="11" width="6" height="4" fill={color} fillOpacity="0.25"/>
    <rect x="9" y="15" width="6" height="6" fill={color} fillOpacity="0.08"/>
  </svg>
);

export const IrisIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <circle cx="12" cy="12" r="9"/>
    <circle cx="12" cy="12" r="4" fill={color} fillOpacity="0.08"/>
    <path d="M12,3 L12,8 M12,16 L12,21 M3,12 L8,12 M16,12 L21,12" strokeLinecap="round"/>
    <path d="M5.6,5.6 L9,9 M15,15 L18.4,18.4 M18.4,5.6 L15,9 M9,15 L5.6,18.4" strokeLinecap="round" strokeWidth="1"/>
  </svg>
);

// Clean optical mirror: reflective surface + hatch marks on the back.
//
// **One artwork, turned by the node's rotation.** The surface is drawn along −45° ("/"),
// which is exactly what `mirrorSurfaceDeg` says a mirror at rotation 0 presents, so
// rotating this artwork by `rotation` always draws the surface the physics is reflecting
// off. It replaces four hand-drawn variants (slash/backslash × which-face-is-coated)
// that between them could only express two surface angles — and that the diagram then
// rotated *again*, so a rotation-90 mirror drew "\" on the canvas and "/" in the figure.
//
// `hatchSide` picks which side of the surface the substrate hatching goes on: +1 is the
// lower-right of "/", −1 the upper-left. Callers derive it from where the beam is coming
// from, so the polished face always looks at the beam.

/** Points along the "/" surface where hatch marks start, in the 24×24 artwork frame. */
const HATCH_AT = [7, 10, 13, 16];

export const MirrorIcon: React.FC<IconProps & { hatchSide?: 1 | -1 }> = ({
  size = 24, color = 'currentColor', hatchSide = 1,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    {/* Reflective surface, centred through (12,12) so its midpoint is the node centre */}
    <line x1="5" y1="19" x2="19" y2="5" strokeWidth="2.5" strokeLinecap="round"/>
    {/* Substrate hatching on the back face */}
    {HATCH_AT.map(t => (
      <line
        key={t}
        x1={t} y1={24 - t}
        x2={t + 3 * hatchSide} y2={24 - t + 3 * hatchSide}
        strokeWidth="1" strokeLinecap="round"
      />
    ))}
  </svg>
);

/**
 * Dichroic mirror — a two-layer surface: the coating on the beam side, the substrate
 * behind it. Same single-artwork treatment as `MirrorIcon`; `coatedSide` says which band
 * is filled, +1 being the lower-right of "/".
 */
export const DichroicMirrorIcon: React.FC<IconProps & { coatedSide?: 1 | -1 }> = ({
  size = 24, color = 'currentColor', coatedSide = -1,
}) => {
  // Two 1 px bands either side of the surface line (5,19)→(19,5).
  const upper = '4,18 18,4 19,5 5,19';
  const lower = '5,19 19,5 20,6 6,20';
  const filled = coatedSide === 1 ? lower : upper;
  const empty  = coatedSide === 1 ? upper : lower;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1" strokeLinejoin="round">
      <polygon points={filled} fill={color} stroke={color} strokeWidth="0.5"/>
      <polygon points={empty} fill="none" stroke={color} strokeWidth="1"/>
    </svg>
  );
};

export const BeamSplitterIcon: React.FC<IconProps & { label?: string }> = ({ size = 24, color = 'currentColor', label }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="6" y="6" width="12" height="12" rx="1" fill={color} fillOpacity="0.1"/>
    {/* Internal surface along −45°, like MirrorIcon: the caller turns the whole cube,
        so rotation 90 draws "\" exactly as the two-variant version used to. */}
    <line x1="6" y1="18" x2="18" y2="6" strokeWidth="2" strokeLinecap="round"/>
    {label && <text x="12" y="22.5" textAnchor="middle" fontSize="4.5" fill={color} stroke="none" fontFamily="sans-serif">{label}</text>}
  </svg>
);

export const CrystalIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M12,2 L19,7 L19,17 L12,22 L5,17 L5,7 Z" fill={color} fillOpacity="0.12" strokeLinejoin="round"/>
    <line x1="5" y1="7" x2="19" y2="7" strokeOpacity="0.4"/>
    <line x1="5" y1="17" x2="19" y2="17" strokeOpacity="0.4"/>
    <text x="12" y="13.5" textAnchor="middle" fontSize="4" fill={color} stroke="none" fontFamily="serif" fontStyle="italic">2ω</text>
  </svg>
);

// True plano-convex lens: flat on one side, convex curve on the other
// viewBox is portrait (fits tall narrow node)
export const LensConvexIcon: React.FC<IconProps & { flipped?: boolean }> = ({ size = 24, color = 'currentColor', flipped = false }) => {
  // flat side at x=9 (left), convex bulges right from x=13 to ~x=21 at center
  const fl = flipped;
  // flat side x, convex start x, convex bulge x
  const [fx, cx, bx] = fl ? [15, 9, 3] : [9, 15, 21];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      {/* Fill */}
      <path d={`M${fx},2 L${cx},2 Q${bx},12 ${cx},22 L${fx},22 Z`} fill={color} fillOpacity="0.18" stroke="none"/>
      {/* Flat side */}
      <line x1={fx} y1="2" x2={fx} y2="22" strokeLinecap="round"/>
      {/* Convex curved side */}
      <path d={`M${cx},2 Q${bx},12 ${cx},22`} strokeLinecap="round"/>
      {/* Top and bottom caps */}
      <line x1={Math.min(fx,cx)} y1="2"  x2={Math.max(fx,cx)} y2="2"  strokeWidth="1"/>
      <line x1={Math.min(fx,cx)} y1="22" x2={Math.max(fx,cx)} y2="22" strokeWidth="1"/>
    </svg>
  );
};

// True plano-concave lens: flat on one side, concave (inward) curve on the other
export const LensConcaveIcon: React.FC<IconProps & { flipped?: boolean }> = ({ size = 24, color = 'currentColor', flipped = false }) => {
  const fl = flipped;
  // Flat side x, concave edge x, and the quadratic's control x. The curve's deepest
  // point sits at (edge + 2·control + edge)/4, so pulling the control back toward the
  // edge makes a shallower dish: 11/13 leaves the centre half as hollowed out as the
  // original 7/17 did, which reads better at icon size.
  const [fx, cx, bx] = fl ? [15, 9, 13] : [9, 15, 11];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
      {/* Fill */}
      <path d={`M${fx},2 L${cx},2 Q${bx},12 ${cx},22 L${fx},22 Z`} fill={color} fillOpacity="0.12" stroke="none"/>
      {/* Flat side */}
      <line x1={fx} y1="2" x2={fx} y2="22" strokeLinecap="round"/>
      {/* Concave curved side */}
      <path d={`M${cx},2 Q${bx},12 ${cx},22`} strokeLinecap="round"/>
      {/* Top and bottom caps */}
      <line x1={Math.min(fx,cx)} y1="2"  x2={Math.max(fx,cx)} y2="2"  strokeWidth="1"/>
      <line x1={Math.min(fx,cx)} y1="22" x2={Math.max(fx,cx)} y2="22" strokeWidth="1"/>
    </svg>
  );
};

/**
 * Fibre patch cord: a connector at each end with slack cable looped between them.
 * Drawn stretched (preserveAspectRatio="none") to fill its box like the other
 * instrument-style icons.
 */
export const FiberIcon: React.FC<IconProps> = ({ size = 24, w, h, color = 'currentColor' }) => (
  <svg width={w ?? size} height={h ?? size} viewBox="0 0 76 36" preserveAspectRatio="none"
    fill="none" stroke={color} strokeWidth="1.6">
    {/* Cable, with a little slack so it reads as a patch cord rather than a rod */}
    <path d="M13,18 C26,18 24,7 38,7 C52,7 50,29 63,29" strokeLinecap="round" strokeWidth="1.8"/>
    {/* Connector bodies with their ferrules */}
    <rect x="3" y="13" width="10" height="10" rx="1.5" fill={color} fillOpacity="0.22"/>
    <line x1="13" y1="18" x2="16" y2="18" strokeWidth="2.4" strokeLinecap="round"/>
    <rect x="63" y="24" width="10" height="10" rx="1.5" fill={color} fillOpacity="0.22"/>
    <line x1="60" y1="29" x2="63" y2="29" strokeWidth="2.4" strokeLinecap="round"/>
  </svg>
);

/**
 * Fibre coupler — free space *into* fibre. A lens brings the beam to a focus on the
 * fibre tip held in a ferrule, and the cable leaves behind it. The converging rays are
 * what distinguish it from the launcher, which collimates.
 */
export const FiberCouplerIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" stroke={color} strokeWidth="1.6">
    {/* Incoming collimated beam, converging through the lens onto the fibre tip */}
    <line x1="2" y1="14" x2="12" y2="14" strokeWidth="1" strokeOpacity="0.5"/>
    <line x1="2" y1="30" x2="12" y2="30" strokeWidth="1" strokeOpacity="0.5"/>
    <line x1="14" y1="14" x2="28" y2="22" strokeWidth="1" strokeOpacity="0.5"/>
    <line x1="14" y1="30" x2="28" y2="22" strokeWidth="1" strokeOpacity="0.5"/>
    {/* Coupling lens */}
    <path d="M12 9 Q18 22 12 35 Q6 22 12 9 Z" fill={color} fillOpacity="0.16" strokeLinejoin="round"/>
    {/* Ferrule holding the fibre tip at the focus */}
    <rect x="28" y="17" width="9" height="10" rx="1.5" fill={color} fillOpacity="0.25"/>
    {/* Fibre curling away behind it */}
    <path d="M37,22 C40,22 41,28 43,30" strokeLinecap="round" strokeWidth="1.4"/>
  </svg>
);

/**
 * Fibre launcher / collimator — fibre *out* into free space. The fibre comes in from
 * behind, and the lens sends a collimated beam onward; it is a source, so the beam
 * leaves along the way the component faces.
 */
export const FiberLauncherIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" stroke={color} strokeWidth="1.6">
    {/* Fibre arriving from behind */}
    <path d="M1,30 C3,28 4,22 7,22" strokeLinecap="round" strokeWidth="1.4"/>
    {/* Ferrule holding the fibre tip at the focus */}
    <rect x="7" y="17" width="9" height="10" rx="1.5" fill={color} fillOpacity="0.25"/>
    {/* Diverging from the tip, then collimated by the lens */}
    <line x1="16" y1="22" x2="30" y2="14" strokeWidth="1" strokeOpacity="0.5"/>
    <line x1="16" y1="22" x2="30" y2="30" strokeWidth="1" strokeOpacity="0.5"/>
    <line x1="32" y1="14" x2="42" y2="14" strokeWidth="1" strokeOpacity="0.5"/>
    <line x1="32" y1="30" x2="42" y2="30" strokeWidth="1" strokeOpacity="0.5"/>
    {/* Collimating lens */}
    <path d="M32 9 Q38 22 32 35 Q26 22 32 9 Z" fill={color} fillOpacity="0.16" strokeLinejoin="round"/>
  </svg>
);

export const AOMIcon: React.FC<IconProps> = ({ size = 24, w, h, color = 'currentColor' }) => (
  <svg width={w ?? size} height={h ?? size} viewBox="0 0 24 24" preserveAspectRatio="none" fill="none" stroke={color} strokeWidth="1.5">
    {/* Fine bulk grating: uniform horizontal lines, edge-to-edge */}
    <line x1="0" y1="1"  x2="24" y2="1"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="3"  x2="24" y2="3"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="5"  x2="24" y2="5"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="7"  x2="24" y2="7"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="9"  x2="24" y2="9"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="11" x2="24" y2="11" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="13" x2="24" y2="13" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="15" x2="24" y2="15" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="17" x2="24" y2="17" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="19" x2="24" y2="19" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="21" x2="24" y2="21" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="0" y1="23" x2="24" y2="23" strokeWidth="0.6" strokeOpacity="0.8"/>
  </svg>
);

export const AODIcon: React.FC<IconProps> = ({ size = 24, w, h, color = 'currentColor' }) => (
  <svg width={w ?? size} height={h ?? size} viewBox="0 0 24 24" preserveAspectRatio="none" fill="none" stroke={color} strokeWidth="1.5">
    {/* Fine bulk grating: slightly tilted lines to suggest angular deflection */}
    <line x1="-2" y1="0"  x2="26" y2="2"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="2"  x2="26" y2="4"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="4"  x2="26" y2="6"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="6"  x2="26" y2="8"  strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="8"  x2="26" y2="10" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="10" x2="26" y2="12" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="12" x2="26" y2="14" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="14" x2="26" y2="16" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="16" x2="26" y2="18" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="18" x2="26" y2="20" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="20" x2="26" y2="22" strokeWidth="0.6" strokeOpacity="0.8"/>
    <line x1="-2" y1="22" x2="26" y2="24" strokeWidth="0.6" strokeOpacity="0.8"/>
  </svg>
);

/**
 * Atomic vapour cell, side-on: a glass tube whose end windows are wedged off normal,
 * with the reservoir bell standing up in the middle. Drawn in an 88×44 viewBox so the
 * tube runs along the beam; `wedge` is the window tilt in degrees.
 */
export const VaporCellIcon: React.FC<IconProps & { wedge?: number }> = ({ size = 24, w, h, color = 'currentColor', wedge = 8 }) => {
  // Tube body spans x 10→78 about the axis at y = 26, with the windows leaning by
  // `wedge`. Half-height 11, so the lean shifts each end by 11·tan(wedge).
  const lean = 11 * Math.tan((Math.min(Math.abs(wedge), 30) * Math.PI) / 180) * Math.sign(wedge || 1);
  const top = 15, bot = 37, left = 12, right = 76;
  return (
    <svg
      width={w ?? size * VAPOR_CELL_ASPECT} height={h ?? size}
      viewBox="0 0 88 44" fill="none" stroke={color} strokeWidth="1.6"
    >
      {/* Glass body — both ends wedged the same way, as on a real cell */}
      <path
        d={`M${left - lean},${top} L${right - lean},${top} L${right + lean},${bot} L${left + lean},${bot} Z`}
        fill={color} fillOpacity="0.1" strokeLinejoin="round"
      />
      {/* End windows picked out more strongly than the walls */}
      <line x1={left - lean} y1={top} x2={left + lean} y2={bot} strokeWidth="2.4" strokeLinecap="round"/>
      <line x1={right - lean} y1={top} x2={right + lean} y2={bot} strokeWidth="2.4" strokeLinecap="round"/>
      {/* Far rim of the tube, hinting at the cylinder */}
      <path d={`M${left + lean},${bot} Q44,${bot + 3.5} ${right + lean},${bot}`}
        strokeWidth="0.9" strokeOpacity="0.5"/>
      {/* Reservoir bell on top: short neck into a rounded body with a pulled tip */}
      <line x1="44" y1={top} x2="44" y2="11" strokeWidth="1.3"/>
      <path d="M38.5 11 Q38.5 4.5 44 1.5 Q49.5 4.5 49.5 11 Z"
        fill={color} fillOpacity="0.16" strokeLinejoin="round"/>
      <line x1="38.5" y1="11" x2="49.5" y2="11" strokeWidth="1.1" strokeOpacity="0.75"/>
    </svg>
  );
};

/** Cat's eye retroreflector: lens focusing onto a mirror at its focal plane. */
export const RetroreflectorIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 44 44" fill="none" stroke={color} strokeWidth="1.5">
    {/* Converging rays, lens → focus on the mirror */}
    <line x1="15" y1="12" x2="32" y2="22" strokeWidth="0.8" strokeOpacity="0.45"/>
    <line x1="15" y1="32" x2="32" y2="22" strokeWidth="0.8" strokeOpacity="0.45"/>
    {/* Biconvex lens */}
    <path d="M15 8 Q21 22 15 36 Q9 22 15 8 Z" fill={color} fillOpacity="0.14"/>
    {/* Mirror at the focal plane */}
    <line x1="33" y1="10" x2="33" y2="34" strokeWidth="2.5" strokeLinecap="round"/>
    {/* Hatching on the back of the mirror */}
    <line x1="34" y1="13" x2="38" y2="9"  strokeWidth="1" strokeOpacity="0.55"/>
    <line x1="34" y1="20" x2="38" y2="16" strokeWidth="1" strokeOpacity="0.55"/>
    <line x1="34" y1="27" x2="38" y2="23" strokeWidth="1" strokeOpacity="0.55"/>
    <line x1="34" y1="34" x2="38" y2="30" strokeWidth="1" strokeOpacity="0.55"/>
  </svg>
);

export const EOMIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="7" y="6" width="10" height="12" rx="1" fill={color} fillOpacity="0.12"/>
    <line x1="12" y1="1.5" x2="12" y2="5.5" strokeLinecap="round"/>
    <line x1="12" y1="18.5" x2="12" y2="22.5" strokeLinecap="round"/>
    <line x1="9" y1="1.5" x2="15" y2="1.5" strokeLinecap="round"/>
    <line x1="9" y1="22.5" x2="15" y2="22.5" strokeLinecap="round"/>
    <path d="M9,12 Q10.5,9.5 12,12 Q13.5,14.5 15,12" strokeLinecap="round"/>
  </svg>
);

export const SLMIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="3" y="4" width="18" height="14" rx="1" fill={color} fillOpacity="0.1"/>
    <line x1="9" y1="4" x2="9" y2="18" strokeWidth="0.8"/>
    <line x1="15" y1="4" x2="15" y2="18" strokeWidth="0.8"/>
    <line x1="3" y1="9" x2="21" y2="9" strokeWidth="0.8"/>
    <line x1="3" y1="14" x2="21" y2="14" strokeWidth="0.8"/>
    <rect x="9" y="9" width="6" height="5" fill={color} fillOpacity="0.35"/>
  </svg>
);

/** Galvo "/" — beam from left reflects down */
export const GalvoSlashIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <circle cx="12" cy="12" r="5" fill={color} fillOpacity="0.08"/>
    {/* "/" mirror surface centred through (12,12) */}
    <line x1="5" y1="19" x2="19" y2="5" strokeWidth="2.5" strokeLinecap="round"/>
    {/* Scan arc indicator */}
    <path d="M12,10 A3,3 0 0,1 9.5,12.5" strokeDasharray="2,2"/>
    <polyline points="8.5,10.5 9.5,12.5 11.5,12" strokeLinejoin="round" strokeWidth="1"/>
  </svg>
);

/** The galvo's surface is drawn along −45° like a mirror's; the caller turns it. */
export const GalvoIcon = GalvoSlashIcon;

export const PhotodiodeIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <polygon points="7,6 19,12 7,18" fill={color} fillOpacity="0.18" strokeLinejoin="round"/>
    <line x1="19" y1="6" x2="19" y2="18" strokeLinecap="round"/>
    <line x1="2" y1="12" x2="7" y2="12" strokeLinecap="round"/>
    <line x1="19" y1="12" x2="22" y2="12" strokeLinecap="round"/>
    <line x1="9" y1="5" x2="11" y2="3" strokeWidth="1" strokeLinecap="round"/>
    <line x1="12" y1="4" x2="14" y2="2" strokeWidth="1" strokeLinecap="round"/>
  </svg>
);

export const APDIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <polygon points="6,7 17,12 6,17" fill={color} fillOpacity="0.18" strokeLinejoin="round"/>
    <line x1="17" y1="7" x2="17" y2="17"/>
    <line x1="2" y1="12" x2="6" y2="12"/>
    <line x1="17" y1="12" x2="22" y2="12"/>
    <text x="19.5" y="10" fontSize="5" fill={color} stroke="none" fontFamily="sans-serif">×G</text>
  </svg>
);

export const CameraIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="2" y="7" width="20" height="13" rx="2" fill={color} fillOpacity="0.12"/>
    <circle cx="12" cy="13.5" r="4"/>
    <circle cx="12" cy="13.5" r="2" fill={color} fillOpacity="0.2"/>
    <path d="M7,7 L9,3.5 L15,3.5 L17,7"/>
    <circle cx="18.5" cy="9.5" r="1" fill={color}/>
  </svg>
);

export const BeamProfilerIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="2" y="4" width="20" height="16" rx="2" fill={color} fillOpacity="0.1"/>
    <ellipse cx="12" cy="12" rx="5" ry="5" fill={color} fillOpacity="0.25"/>
    <ellipse cx="12" cy="12" rx="3" ry="3" fill={color} fillOpacity="0.35"/>
    <line x1="12" y1="4" x2="12" y2="20" strokeWidth="0.7" strokeDasharray="2,2"/>
    <line x1="2" y1="12" x2="22" y2="12" strokeWidth="0.7" strokeDasharray="2,2"/>
  </svg>
);

export const CavityIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <line x1="3" y1="5" x2="3" y2="19" strokeWidth="3" strokeLinecap="round"/>
    <line x1="21" y1="5" x2="21" y2="19" strokeWidth="3" strokeLinecap="round"/>
    <path d="M3,10 Q12,6 21,10" strokeLinecap="round"/>
    <path d="M3,14 Q12,18 21,14" strokeLinecap="round"/>
  </svg>
);

export const DelayLineIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M2,12 L5,12 L5,6 L11,6 L11,18 L17,18 L17,6 L19,6" strokeLinecap="round" strokeLinejoin="round"/>
    <line x1="19" y1="6" x2="22" y2="6" strokeLinecap="round"/>
    <line x1="2" y1="12" x2="2" y2="12" strokeLinecap="round"/>
  </svg>
);

export const BeamBlockIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="8" y="3" width="8" height="18" rx="1" fill={color} fillOpacity="0.6"/>
    <line x1="10" y1="7" x2="14" y2="17" strokeWidth="1" stroke="rgba(0,0,0,0.4)"/>
    <line x1="14" y1="7" x2="10" y2="17" strokeWidth="1" stroke="rgba(0,0,0,0.4)"/>
  </svg>
);

export const SHGCrystalIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M12,2 L19,7 L19,17 L12,22 L5,17 L5,7 Z" fill={color} fillOpacity="0.12" strokeLinejoin="round"/>
    <line x1="5" y1="7" x2="19" y2="7" strokeOpacity="0.4"/>
    <line x1="5" y1="17" x2="19" y2="17" strokeOpacity="0.4"/>
    <text x="12" y="13.5" textAnchor="middle" fontSize="5" fill={color} stroke="none" fontFamily="serif" fontStyle="italic">2ω</text>
  </svg>
);

export const SFGCrystalIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <path d="M12,2 L19,7 L19,17 L12,22 L5,17 L5,7 Z" fill={color} fillOpacity="0.12" strokeLinejoin="round"/>
    <line x1="5" y1="7" x2="19" y2="7" strokeOpacity="0.4"/>
    <line x1="5" y1="17" x2="19" y2="17" strokeOpacity="0.4"/>
    <text x="12" y="11" textAnchor="middle" fontSize="3.8" fill={color} stroke="none" fontFamily="serif" fontStyle="italic">ω₁+ω₂</text>
    <text x="12" y="16" textAnchor="middle" fontSize="3.4" fill={color} stroke="none" fontFamily="serif">→ ω₃</text>
  </svg>
);

/** Power probe, for the palette: a ring on a beam with a leader to its readout. */
export const PowerProbeIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    {/* The beam it reads */}
    <line x1="1" y1="16" x2="23" y2="16" strokeWidth="1" strokeOpacity="0.45"/>
    {/* Probe ring on the beam */}
    <circle cx="9" cy="16" r="3.2" fill="none"/>
    <circle cx="9" cy="16" r="0.9" fill={color} stroke="none"/>
    {/* Leader out to the readout */}
    <line x1="9" y1="16" x2="15" y2="8" strokeWidth="1" strokeDasharray="2,1.5"/>
    <rect x="13" y="3" width="10" height="6" rx="1.5" fill={color} fillOpacity="0.16"/>
  </svg>
);

/**
 * Fallback for a type with no icon of its own — most likely a component removed from the
 * palette that a previously saved layout still refers to. Deliberately plain, so it
 * reads as "unknown" rather than as a real optic.
 */
export const UnknownComponentIcon: React.FC<IconProps> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
    <rect x="4" y="4" width="16" height="16" rx="2" fill={color} fillOpacity="0.07" strokeDasharray="3,2"/>
    <text x="12" y="16" textAnchor="middle" fontSize="10" fill={color} stroke="none" fontFamily="sans-serif">?</text>
  </svg>
);

// Map component type to icon — accepts optional data for flip/rotation-aware icons
export function getNodeIcon(
  type: OpticalNodeData['type'],
  size = 22,
  color = 'currentColor',
  data?: OpticalNodeData,
  boxDims?: { w: number; h: number },
): React.ReactNode {
  const flipped   = (data as { flipped?: boolean }   | undefined)?.flipped   ?? false;
  const rotation  = (data as { rotation?: number }   | undefined)?.rotation  ?? 0;
  const beamIn = (data as { beamIncomingDir?: { dx: number; dy: number } } | undefined)?.beamIncomingDir ?? { dx: 1, dy: 0 };
  // Which face of a mirror is polished: the one the beam arrives at. Worked out in the
  // *artwork* frame, since the caller turns the artwork by `rotation` — take the beam
  // back through that rotation and compare it with the artwork's own surface normal.
  // The hatching (substrate) then goes on the other side. This replaces two booleans
  // that only had answers for the two 45° surfaces the old artwork could draw.
  const hatchSide = mirrorHatchSide(beamIn, rotation);

  switch (type) {
    case 'laser_source':      return <LaserIcon size={size} color={color} />;
    case 'optical_amplifier': return <AmplifierIcon size={size} color={color} />;
    case 'fiber_amplifier':   return <FiberAmplifierIcon size={size} color={color} />;
    case 'isolator':          return <IsolatorIcon size={size} color={color} />;
    case 'linear_polarizer':  return <PolarizerIcon size={size} color={color} />;
    case 'hwp':               return <WaveplateIcon size={size} color={color} label="λ/2" />;
    case 'qwp':               return <WaveplateIcon size={size} color={color} label="λ/4" />;
    case 'nd_filter':         return <NDFilterIcon size={size} color={color} />;
    case 'iris':              return <IrisIcon size={size} color={color} />;
    case 'beam_block':        return <BeamBlockIcon size={size} color={color} />;
    case 'dielectric_mirror': return <MirrorIcon size={size} color={color} hatchSide={hatchSide} />;
    case 'dichroic_mirror':   return <DichroicMirrorIcon size={size} color={color} coatedSide={hatchSide === 1 ? -1 : 1} />;
    case 'retroreflector':    return <RetroreflectorIcon size={size} color={color} />;
    case 'npbs':              return <BeamSplitterIcon size={size} color={color} />;
    case 'pbs':               return <BeamSplitterIcon size={size} color={color} label="PBS" />;
    case 'nonlinear_crystal': return <CrystalIcon size={size} color={color} />;
    case 'shg_crystal':       return <SHGCrystalIcon size={size} color={color} />;
    case 'sfg_crystal':       return <SFGCrystalIcon size={size} color={color} />;
    case 'plano_convex':      return <LensConvexIcon size={size} color={color} flipped={flipped} />;
    case 'plano_concave':     return <LensConcaveIcon size={size} color={color} flipped={flipped} />;
    case 'fiber_coupler':     return <FiberCouplerIcon size={size} color={color} />;
    case 'fiber_launcher':    return <FiberLauncherIcon size={size} color={color} />;
    case 'fiber_cable':       return <FiberIcon size={size} w={boxDims?.w} h={boxDims?.h} color={color} />;
    case 'aom':               return <AOMIcon size={size} w={boxDims?.w} h={boxDims?.h} color={color} />;
    case 'aod':               return <AODIcon size={size} w={boxDims?.w} h={boxDims?.h} color={color} />;
    case 'eom':               return <EOMIcon size={size} color={color} />;
    case 'slm':               return <SLMIcon size={size} color={color} />;
    case 'galvo':             return <GalvoIcon size={size} color={color} />;
    case 'photodiode':        return <PhotodiodeIcon size={size} color={color} />;
    case 'apd':               return <APDIcon size={size} color={color} />;
    case 'camera':            return <CameraIcon size={size} color={color} />;
    case 'beam_profiler':     return <BeamProfilerIcon size={size} color={color} />;
    case 'fabry_perot':       return <CavityIcon size={size} color={color} />;
    case 'reference_cavity':  return <CavityIcon size={size} color={color} />;
    case 'delay_line':        return <DelayLineIcon size={size} color={color} />;
    case 'power_probe':       return <PowerProbeIcon size={size} color={color} />;
    case 'vapor_cell':        return <VaporCellIcon size={size} color={color}
                                       wedge={(data as { windowAngle?: number } | undefined)?.windowAngle} />;
    default:                  return <UnknownComponentIcon size={size} color={color} />;
  }
}
