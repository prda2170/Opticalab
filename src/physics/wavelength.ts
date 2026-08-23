// Wavelength and optical-frequency transformations.
//
// Two separate quantities, deliberately:
//   • the **carrier** wavelength (nm), changed only by nonlinear conversion, and
//   • the **detuning** (Hz), which carries every RF-scale shift.
// See BeamState in types/beam.ts for why.
import type { OpticalNodeData } from '../types/components';

/** Speed of light, m/s. */
export const C_LIGHT = 299792458;

// Returns output carrier wavelength in nm given input wavelength.
export function outputWavelength(inputNm: number, node: OpticalNodeData): number {
  switch (node.type) {
    case 'shg_crystal':
      return inputNm / 2;  // frequency doubled
    case 'sfg_crystal':
      return inputNm; // simplified — real SFG depends on both input wavelengths
    case 'nonlinear_crystal':
      return node.crystalType === 'SHG' ? inputNm / 2 : inputNm;

    // NOTE: AOMs and AODs do *not* appear here. Their ±f_RF shift is recorded in
    // BeamState.detuningHz by componentOutputs — expressing it as a change in nm
    // would be a 1e-7 relative perturbation that no display could show.
    default:
      return inputNm;
  }
}

/** Optical frequency of a carrier wavelength, Hz. */
export function opticalFrequencyHz(wavelengthNm: number): number {
  return C_LIGHT / (wavelengthNm * 1e-9);
}

/** Trim trailing zeros from a fixed-decimal string ("80.00" → "80"). */
const trim = (n: number, dp: number) => String(Number(n.toFixed(dp)));

/**
 * Format a frequency offset with an explicit sign, e.g. "+80 MHz", "-1.5 GHz".
 * Returns an empty string for a zero/absent detuning.
 */
export function formatDetuning(hz: number | undefined): string {
  if (!hz) return '';
  const sign = hz > 0 ? '+' : '-';
  const a = Math.abs(hz);
  if (a >= 1e12) return `${sign}${trim(a / 1e12, 3)} THz`;
  if (a >= 1e9)  return `${sign}${trim(a / 1e9,  3)} GHz`;
  if (a >= 1e6)  return `${sign}${trim(a / 1e6,  2)} MHz`;
  if (a >= 1e3)  return `${sign}${trim(a / 1e3,  2)} kHz`;
  return `${sign}${trim(a, 0)} Hz`;
}
