// What the figure prints above each component, and how much room that takes.
//
// Two callers, on purpose. The diagram draws these lines; `physics/labelPlacement` needs the
// *box* they occupy, because a name dropped on top of a neighbour's "R=99.5%" is as
// unreadable as one dropped on a beam. Deriving the box anywhere but from the same rows the
// renderer draws would let the two drift, so the geometry constants live here too.
import type { OpticalNodeData } from '../types/components';
import { getNodeGeometry } from './nodeGeometry';
import { formatCurrent, formatSourcePower } from './units';

/** Annotation text size, px. */
export const ANNOTATION_FONT_PX = 7.5;
/** Vertical pitch between annotation rows, px. */
export const ANNOTATION_ROW_PX = 10;
/** Gap between the top of the component's box and the lowest annotation row, px. */
export const ANNOTATION_GAP_PX = 8;
/** Width of one monospace character, as a fraction of the font size. */
const ANNOTATION_CHAR_RATIO = 0.6;

export function getAnnotations(data: OpticalNodeData): Record<string, string> {
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

/** The rows the figure draws, in order, lowest first. */
export function annotationRows(data: OpticalNodeData): string[] {
  const ann = getAnnotations(data);
  return Object.keys(ann).map(key => `${key}=${ann[key]}`);
}

/**
 * The box the annotation stack occupies, relative to the component's centre.
 *
 * Null when the component annotates nothing. Reserved whether or not the annotations are
 * currently toggled on: a label that moved every time you hid a category would be worse
 * than one that keeps a little space free.
 */
export function annotationBox(data: OpticalNodeData): { dy: number; halfWidth: number; halfHeight: number } | null {
  const rows = annotationRows(data);
  if (rows.length === 0) return null;

  const hh = getNodeGeometry(data.type, data.rotation ?? 0).height / 2;
  const widest = rows.reduce((a, b) => (b.length > a.length ? b : a));
  // Rows are drawn upwards from `-hh - GAP`, so the stack's own extent is the ascent of the
  // top row down to the descent of the bottom one.
  const top = -hh - ANNOTATION_GAP_PX - (rows.length - 1) * ANNOTATION_ROW_PX - ANNOTATION_FONT_PX * 0.8;
  const bottom = -hh - ANNOTATION_GAP_PX + ANNOTATION_FONT_PX * 0.2;
  return {
    dy: (top + bottom) / 2,
    halfWidth: (widest.length * ANNOTATION_FONT_PX * ANNOTATION_CHAR_RATIO) / 2,
    halfHeight: (bottom - top) / 2,
  };
}
