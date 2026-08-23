// What a detector reads out.
//
// On the bench you watch volts on a scope, not photocurrent, so a monitor photodiode is
// characterised by a single V/mW factor that folds its responsivity in with whatever
// transimpedance or amplifier gain follows it.
import type { OpticalNodeData } from '../types/components';
import type { BeamState } from '../types/beam';
import { opticalFrequencyHz } from './wavelength';

/**
 * Total optical power landing on a detector, mW, or null if nothing is.
 *
 * A photodiode integrates: every beam that reaches the active area contributes, whatever
 * direction it came from and whatever colour it is, so the powers simply add. That is why
 * a detector is fed the whole arrival list rather than `nodeBeams`' single strongest beam —
 * two beams on one photodiode is a real setup (balanced or heterodyne detection), two
 * beams on one mirror is still two beams.
 *
 * Powers add; fields do not. Relative optical phase isn't tracked anywhere in this model,
 * so this is the DC term only — see `detectorBeat` for what is being left out.
 */
export function incidentPower(beams: BeamState[] | null | undefined): number | null {
  if (!beams || beams.length === 0) return null;
  return beams.reduce((sum, b) => sum + b.power, 0);
}

/**
 * The beat note two or more beams would produce on a detector: the smallest non-zero
 * difference in optical frequency among them, and whether the detector could follow it.
 * Null when there is nothing to beat — one beam, or several at identical frequency.
 *
 * Not added to the reading, deliberately: the interference term needs relative phase and
 * spatial overlap, neither of which this model carries. Reported so a heterodyne setup
 * isn't silently shown as a flat DC level.
 */
export function detectorBeat(
  node: OpticalNodeData,
  beams: BeamState[] | null | undefined,
): { hz: number; withinBandwidth: boolean } | null {
  if (!beams || beams.length < 2) return null;

  // Carrier plus RF shift — the two are stored separately (see physics/wavelength.ts).
  const freqs = beams.map(b => opticalFrequencyHz(b.wavelength) + (b.detuningHz ?? 0));
  let hz = Infinity;
  for (let i = 0; i < freqs.length; i++) {
    for (let j = i + 1; j < freqs.length; j++) {
      const d = Math.abs(freqs[i] - freqs[j]);
      if (d > 0 && d < hz) hz = d;
    }
  }
  if (!Number.isFinite(hz)) return null;

  // `bandwidth` is in MHz on every detector that has one.
  const bwHz = 'bandwidth' in node && typeof node.bandwidth === 'number'
    ? node.bandwidth * 1e6
    : 0;
  return { hz, withinBandwidth: bwHz > 0 && hz <= bwHz };
}

/**
 * Scope voltage for the power landing on a detector, or null when the component has no
 * signal factor or nothing is hitting it. Takes the power in mW rather than a whole
 * BeamState so callers can subscribe to just that scalar.
 */
export function detectorVolts(node: OpticalNodeData, powerMw: number | null | undefined): number | null {
  if (powerMw == null) return null;
  if (node.type !== 'photodiode') return null;
  const factor = node.signalFactor;
  if (!Number.isFinite(factor)) return null;
  return powerMw * factor;
}

/** Format a scope voltage, stepping down through mV and µV. */
export function formatVoltage(volts: number): string {
  const a = Math.abs(volts);
  if (a >= 1000)  return `${(volts / 1000).toFixed(2)} kV`;
  if (a >= 1)     return `${volts.toFixed(2)} V`;
  if (a >= 1e-3)  return `${(volts * 1e3).toFixed(a >= 1e-2 ? 1 : 2)} mV`;
  if (a >= 1e-6)  return `${(volts * 1e6).toFixed(0)} µV`;
  return '0 V';
}

/**
 * The signal string a detector shows beside itself, or null if it shows none. Both views
 * call this, so a probe-less bench reads the same in the editor and in a figure.
 */
export function detectorSignalLabel(
  node: OpticalNodeData,
  powerMw: number | null | undefined,
): string | null {
  if (node.type !== 'photodiode' || node.showSignal !== true) return null;
  const volts = detectorVolts(node, powerMw);
  return volts === null ? '— V' : formatVoltage(volts);
}
