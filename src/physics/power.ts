// Power/loss propagation through optical components
import type { OpticalNodeData } from '../types/components';
import type { BeamState } from '../types/beam';

/**
 * Multiplier for the optional `loss` property (% insertion loss), which every
 * component may carry on top of its physics-defined losses.  Splitting
 * components apply this directly, since their per-port share is computed
 * separately (see `componentOutputs`).
 */
export function insertionLossFactor(node: OpticalNodeData): number {
  return 1 - (node.loss ?? 0) / 100;
}

// Returns transmitted power fraction [0,1] for a given component.
// The base fraction captures physics-defined losses (reflectivity, efficiency, etc.).
// The optional `loss` property (% insertion loss) is applied on top as a multiplier.
//
// NOTE: for splitting components (pbs/npbs/dichroic) the base fraction below is
// only one of several ports.  Those components are resolved by
// `componentOutputs` in propagate.ts and do not go through this function.
// An optical amplifier is absent entirely: its output power is stated outright, so it
// bears no fixed relation to the input at all.
export function transmissionFraction(node: OpticalNodeData): number {
  const insertionLoss = insertionLossFactor(node);

  let base: number;
  switch (node.type) {
    case 'isolator':
      base = node.transmission / 100; break;
    case 'linear_polarizer':
      base = 0.5; break; // 50% for unpolarized; Jones calculus handles polarization
    case 'hwp':
    case 'qwp':
      base = 1.0; break; // ideal waveplates
    case 'nd_filter':
      base = Math.pow(10, -node.od); break;
    case 'iris':
      base = 1.0; break; // aperture clipping not modeled
    case 'dielectric_mirror':
    case 'retroreflector':
      base = node.reflectivity / 100; break;
    case 'dichroic_mirror':
      base = 1.0; break; // perfect step function — per-edge logic handles T/R split
    case 'npbs': {
      const parts = node.splitRatio.split(':').map(Number);
      const total = parts[0] + parts[1];
      base = parts[0] / total; break; // reflected fraction
    }
    case 'pbs':
      base = 1.0; break; // PBS routes beam; per-edge Jones logic handles power
    case 'plano_convex':
    case 'plano_concave':
      base = 1.0; break; // ideal lens; set loss % for AR-coating etc.
    // Fibre components all leave the free-space path, so componentOutputs resolves
    // them rather than this function; the fractions below are what makes it into the
    // fibre (coupler) or nowhere at all (cable, and a launcher, which is a source).
    case 'fiber_coupler':
      base = node.couplingEfficiency / 100; break;
    case 'fiber_launcher':
    case 'fiber_cable':
      return 0.0;
    case 'aom':
      base = node.diffractionEfficiency / 100; break;
    case 'aod':
      base = node.diffractionEfficiency / 100; break;
    case 'eom':
      base = node.transmission / 100; break;
    case 'slm':
      base = 1.0; break; // set loss % for diffraction efficiency etc.
    case 'galvo':
      base = 1.0; break; // set loss % for mirror coating reflectivity
    case 'photodiode':
    case 'apd':
    case 'camera':
    case 'beam_profiler':
      return 0.0; // beam terminates at detectors — loss irrelevant
    case 'beam_block':
      return 0.0; // absorbs beam entirely
    case 'shg_crystal':
    case 'sfg_crystal':
      base = 1 - node.conversionEfficiency / 100; break; // residual unconverted
    case 'nonlinear_crystal':
      base = 1 - node.conversionEfficiency / 100; break;
    case 'fabry_perot':
    case 'reference_cavity':
      base = 0.5; break; // partially transmitted
    case 'delay_line':
      base = 1.0; break; // set loss % for delay-line mirrors/fibers
    case 'vapor_cell':
      // Resonant absorption is not modelled — see VaporCellData. Set loss % to stand
      // in for off-resonant attenuation and window reflections.
      base = 1.0; break;
    default:
      base = 1.0; break;
  }

  return base * insertionLoss;
}

// Apply power transformation to beam state
export function applyPowerTransform(beam: BeamState, node: OpticalNodeData): BeamState {
  const frac = transmissionFraction(node);
  return { ...beam, power: beam.power * frac };
}
