// The single source of truth for optical physics.
//
// `componentOutputs` answers one question: given the beam arriving at a
// component, what beams leave it and through which port?  The router calls it to
// decide where rays go; the store calls it to resolve user-drawn wiring.  Nothing
// else in the app is allowed to compute beam power, wavelength or polarization,
// so the editor canvas, the diagram and the properties panel can never disagree.
import type { OpticalNodeData } from '../types/components';
import type { BeamState, Polarization } from '../types/beam';
import { applyPowerTransform, insertionLossFactor } from './power';
import { outputWavelength } from './wavelength';
import { hwpMatrix, qwpMatrix, linearPolarizer, propagatePolarization, polarizationToJones, cabs2 } from './jones';
import { dot, type Vec2 } from './geometry';
import { bodyAxis } from './lanes';
import {
  advanceQ, beamRadiusAt, distanceToWaist, divergenceOf, effectiveWavelengthMm,
  identityABCD, rayleighRangeOf, thinLens, transformQ, waistQ, waistRadiusOf,
  type ABCDMatrix,
} from './gaussian';

/**
 * How a beam leaves a component, geometrically.
 * `transmit` carries on; `reflect` bounces off a 45° surface; `retro` goes back the
 * way it came, whichever way that was.
 */
export type PortKind = 'transmit' | 'reflect' | 'retro';

export interface OutputPort {
  /** Source handle id on the node — must match the handles declared in OpticalNode. */
  handle: string;
  /** `transmit` continues in the incoming direction; `reflect` bounces off the surface. */
  kind: PortKind;
  /** The fully resolved beam leaving this port. */
  beam: BeamState;
  /**
   * This port's power leaves the traced free-space path — absorbed in a beam dump, or
   * coupled into a fibre — so it is accounted for and reported, but no ray follows it.
   */
  dumped?: boolean;
  /** How the power left, shown in place of a generic "dumped" (e.g. 'coupled in'). */
  dumpedAs?: string;
  /**
   * Index into `componentLanes(node)` — which of the component's parallel beam axes
   * this port leaves on. Defaults to the lane the beam arrived on.
   */
  lane?: number;
}

/** What the tracer knows about how the beam arrived, beyond the beam itself. */
export interface PortContext {
  /** Index into `componentLanes(node)` of the axis the beam arrived on. */
  entryLane: number;
  /**
   * Direction the beam is travelling as it enters. Needed by non-reciprocal
   * components — an isolator only isolates one way. Absent means "assume forward",
   * which is what the properties panel wants when it previews a component's outputs.
   */
  entryDir?: Vec2;
}

/** Power below which a beam is treated as extinguished (1 µW). */
export const MIN_POWER_MW = 0.001;

/** Waist radius (µm) assumed for a laser that has none configured. */
export const DEFAULT_WAIST_UM = 800;

// ── Gaussian beam bookkeeping ─────────────────────────────────────────────────

/**
 * Recompute the display fields (w, w0, zR, waistDistance, divergence) from `q`.
 * Call this after anything that changes `q` *or* the wavelength — the spot size
 * that a given q describes depends on λ.
 *
 * A wavelength-halving component (SHG) therefore reports w → w/√2 at the same q,
 * which is the right answer for a second-harmonic mode driven by a Gaussian pump
 * (the SH intensity goes as the pump intensity squared).
 */
export function refreshGaussian(beam: BeamState): BeamState {
  if (!beam.q) return beam;
  const lambdaEff = effectiveWavelengthMm(beam.wavelength, beam.mSquared);
  const wMm  = beamRadiusAt(beam.q, lambdaEff);
  const w0Mm = waistRadiusOf(beam.q, lambdaEff);
  const div  = divergenceOf(beam.q, lambdaEff);
  return {
    ...beam,
    w:  Number.isFinite(wMm)  ? wMm  * 1e3 : undefined,   // mm → µm
    w0: Number.isFinite(w0Mm) ? w0Mm * 1e3 : undefined,
    zR: rayleighRangeOf(beam.q),
    waistDistance: distanceToWaist(beam.q),
    divergence: Number.isFinite(div) ? div * 1e3 : undefined, // rad → mrad
  };
}

/** Propagate a beam through `dMm` of free space. */
export function advanceBeam(beam: BeamState, dMm: number): BeamState {
  if (!beam.q || !(dMm > 0)) return beam;
  return refreshGaussian({ ...beam, q: advanceQ(beam.q, dMm) });
}

/**
 * The ray-transfer matrix a component applies to the beam parameter.
 * Everything that isn't a lens is treated as flat (identity) for now — mirrors
 * are plane, waveplates and splitters are thin, and aperture clipping is not
 * modelled. Extend here to add curved optics or fibre mode-matching.
 */
export function componentABCD(node: OpticalNodeData): ABCDMatrix {
  switch (node.type) {
    case 'plano_convex':
    case 'plano_concave':
      // focalLength is mm and already carries its sign (concave is negative).
      return node.focalLength !== 0 ? thinLens(node.focalLength) : identityABCD;

    // Cat's eye: lens f, free space f, mirror, free space f, lens f. Cascading those
    // gives [[-1, 2f], [0, -1]], i.e. q → q − 2f. Together with the 2f the tracer adds
    // for the flight there and back, the input plane is imaged onto itself — so a beam
    // double-passed through a component one focal length away comes back the same size.
    // A corner cube (f = 0) simply hands q back unchanged.
    case 'retroreflector':
      return node.focalLength
        ? { A: -1, B: 2 * node.focalLength, C: 0, D: -1 }
        : identityABCD;

    default:
      return identityABCD;
  }
}

// ── Single-output transform ───────────────────────────────────────────────────

/**
 * Output beam of a component with one optical path: wavelength shift, power
 * loss, polarization (Jones), and Gaussian re-imaging through lenses.
 * Splitting components do not use this — see `componentOutputs`.
 */
export function transformBeam(beam: BeamState, node: OpticalNodeData): BeamState {
  // 1. Wavelength transform
  let out: BeamState = { ...beam, wavelength: outputWavelength(beam.wavelength, node) };

  // 2. Power / loss
  out = applyPowerTransform(out, node);

  // 3. Polarization (Jones calculus)
  switch (node.type) {
    case 'hwp': {
      const M = hwpMatrix((node.fastAxisAngle * Math.PI) / 180);
      out = { ...out, polarization: propagatePolarization(beam.polarization, M) };
      break;
    }
    case 'qwp': {
      const M = qwpMatrix((node.fastAxisAngle * Math.PI) / 180);
      out = { ...out, polarization: propagatePolarization(beam.polarization, M) };
      break;
    }
    case 'linear_polarizer': {
      const M = linearPolarizer((node.angle * Math.PI) / 180);
      out = { ...out, polarization: propagatePolarization(beam.polarization, M) };
      break;
    }
    // PBS polarization splitting is handled in `componentOutputs`, not here.
    default:
      break;
  }

  // 4. Gaussian beam: apply this component's ray-transfer matrix to q.
  //    `beam.q` is the beam parameter *at this component's plane* — the tracer has
  //    already propagated it through the free space upstream, so unlike the old
  //    at-waist approximation this handles a lens anywhere along the beam.
  if (out.q) {
    const M = componentABCD(node);
    out = refreshGaussian({ ...out, q: transformQ(out.q, M) });
  }

  return out;
}

// ── Port table ────────────────────────────────────────────────────────────────

/** Split an R:T ratio string ("70:30") into normalised [reflected, transmitted]. */
function splitRatio(ratio: string | undefined): [number, number] {
  const [r, t] = (ratio ?? '50:50').split(':').map(Number);
  const total = (r + t) || 100;
  return [r / total, t / total];
}

/** Fraction of power in the H and V components of a polarization state. */
function polarizationSplit(pol: Polarization): [number, number] {
  const jones = polarizationToJones(pol);
  const exSq = cabs2(jones[0]);
  const eySq = cabs2(jones[1]);
  const norm = exSq + eySq || 1;
  return [exSq / norm, eySq / norm];
}

/** Does a dichroic mirror transmit this wavelength? LP passes long, SP passes short. */
export function dichroicTransmits(wavelengthNm: number, edgeNm: number, kind: 'LP' | 'SP'): boolean {
  return kind === 'LP' ? wavelengthNm > edgeNm : wavelengthNm < edgeNm;
}

/**
 * Every beam leaving `node` when `inBeam` arrives at it.
 *
 * Insertion loss (`node.loss`, %) applies to every port, including splitters —
 * which is why the splitting branches compute power from `inBeam.power` times an
 * explicit `lossF` rather than going through `transmissionFraction` (whose base
 * fraction already encodes one particular port's share).
 *
 * Returns `[]` for detectors, beam blocks, and any component the beam cannot
 * leave.
 */
export function componentOutputs(
  inBeam: BeamState,
  node: OpticalNodeData,
  ctx: PortContext = { entryLane: 0 },
): OutputPort[] {
  // Derived Gaussian fields are refreshed on the way out, so the branches below
  // only have to carry `q` forward (they are all flat/thin elements; lenses go
  // through transformBeam, which applies componentABCD).
  return rawOutputs(inBeam, node, ctx).map(port => ({ ...port, beam: refreshGaussian(port.beam) }));
}

function rawOutputs(inBeam: BeamState, node: OpticalNodeData, ctx: PortContext): OutputPort[] {
  const lossF = insertionLossFactor(node);

  switch (node.type) {
    // ── Terminators ──────────────────────────────────────────────────────────
    case 'beam_block':
    case 'photodiode':
    case 'apd':
    case 'camera':
    case 'beam_profiler':
      return [];

    // A beam that reaches an emitter goes back into it, not out the other side — into
    // the diode, or back down the fibre. The router raises a feedback warning.
    // Emitters absorb: a beam reaching one is feedback into a diode or back down a fibre,
    // not something that carries on. `autoRoute` warns about it.
    case 'laser_source':
    case 'fiber_launcher':
    case 'fiber_amplifier':
      return [];

    // ── Fibre ────────────────────────────────────────────────────────────────
    // Coupling free space into fibre ends the free-space path. The coupled power is
    // reported so you can see what made it in; the rest is lost at the ferrule.
    case 'fiber_coupler':
      return [{
        handle: 'fiber',
        kind: 'transmit',
        lane: ctx.entryLane,
        dumped: true,
        dumpedAs: 'coupled in',
        beam: { ...inBeam, power: inBeam.power * (node.couplingEfficiency / 100) * lossF },
      }];

    // A patch cord isn't a free-space optic. If a beam lands on one it stops there
    // rather than passing through as if the glass were a window.
    case 'fiber_cable':
      return [];

    // ── Isolator: forward only ───────────────────────────────────────────────
    // Reverse power is set by the isolation figure (dB), which is quoted as the
    // total reverse attenuation, so the forward transmission is not applied again.
    case 'isolator': {
      const forward = ctx.entryDir ? dot(ctx.entryDir, bodyAxis(node.rotation ?? 0)) : 1;
      if (forward < -0.5) {
        const reverse = Math.pow(10, -(node.isolation ?? 30) / 10);
        return [{
          handle: 'out',
          kind: 'transmit',
          lane: ctx.entryLane,
          beam: { ...inBeam, power: inBeam.power * reverse * lossF },
        }];
      }
      return [{ handle: 'out', kind: 'transmit', lane: ctx.entryLane, beam: transformBeam(inBeam, node) }];
    }

    // ── Gain ─────────────────────────────────────────────────────────────────
    // The seed sets everything except the power; the power is whatever the user says the
    // amplifier delivers. Resolved here rather than through transmissionFraction because
    // it is not a fraction of the input at all. Needs a seed, though: no beam in, no beam
    // out (`MIN_POWER_MW` stops a numerically-dead beam from being resurrected at full
    // power). Insertion loss is not applied — the stated figure is what leaves the device.
    case 'optical_amplifier': {
      const seeded = inBeam.power >= MIN_POWER_MW;
      return [{
        handle: 'out',
        kind: 'transmit',
        lane: ctx.entryLane,
        // Spread carries wavelength, detuning, polarisation and the mode through
        // untouched — an amplifier changes the power, not the colour.
        beam: { ...inBeam, power: seeded ? Math.max(0, node.outputPower) : 0 },
      }];
    }

    // ── Pure reflectors ──────────────────────────────────────────────────────
    case 'dielectric_mirror':
    case 'galvo':
      return [{ handle: 'refl', kind: 'reflect', beam: transformBeam(inBeam, node) }];

    // Sends the beam straight back where it came from. The Gaussian round trip is in
    // componentABCD — a cat's eye images its own plane, a corner cube leaves q alone.
    case 'retroreflector':
      return [{ handle: 'retro', kind: 'retro', lane: ctx.entryLane, beam: transformBeam(inBeam, node) }];

    // ── Wavelength-selective mirror ──────────────────────────────────────────
    case 'dichroic_mirror': {
      const beam = { ...inBeam, power: inBeam.power * lossF };
      return dichroicTransmits(inBeam.wavelength, node.edgeWavelength, node.mirrorType)
        ? [{ handle: 'trans', kind: 'transmit', beam }]
        : [{ handle: 'refl',  kind: 'reflect',  beam }];
    }

    // ── Polarizing beamsplitter ──────────────────────────────────────────────
    case 'pbs': {
      const [fracH, fracV] = polarizationSplit(inBeam.polarization);
      return [
        { handle: 'trans', kind: 'transmit', beam: { ...inBeam, power: inBeam.power * fracH * lossF, polarization: { type: 'H' } } },
        { handle: 'refl',  kind: 'reflect',  beam: { ...inBeam, power: inBeam.power * fracV * lossF, polarization: { type: 'V' } } },
      ];
    }

    // ── Non-polarizing beamsplitter ──────────────────────────────────────────
    case 'npbs': {
      const [fracR, fracT] = splitRatio(node.splitRatio);
      return [
        { handle: 'trans', kind: 'transmit', beam: { ...inBeam, power: inBeam.power * fracT * lossF } },
        { handle: 'refl',  kind: 'reflect',  beam: { ...inBeam, power: inBeam.power * fracR * lossF } },
      ];
    }

    // ── Acousto-optics ───────────────────────────────────────────────────────
    // Two real ports: the diffracted order carrying the RF frequency shift, and
    // the undiffracted 0th order.
    //
    // Power bookkeeping. `diffractionEfficiency` (η) is read as the fraction of
    // *incident* power in the diffracted order — how AO datasheet numbers are
    // normally used — and `transmission` (T) as the RF-off throughput of the cell:
    //
    //     P₁   = P·η               diffracted, frequency shifted
    //     P₀   = P·max(0, T − η)   undiffracted — dumped at the cell
    //     lost = P·(1 − T)         absorption / scatter / higher orders
    //
    // So η alone sets the power continuing downstream and T only affects how much
    // lands in the 0th order; layouts saved before T was read keep their exact
    // first-order power.
    // Lanes. The diffracted order stays on the lane the beam arrived on, and the
    // undiffracted order peels off onto the other one. That is inverted from
    // reality — the 0th order is the undeviated beam — but it is the convention
    // bench drawings use, it keeps the used beam as the through-line so existing
    // layouts and chains of cells don't walk sideways, and a double-passed cell
    // still retraces its own path. See PROJECT_NOTES §4.
    case 'aom':
    case 'aod': {
      const eta = (node.diffractionEfficiency ?? 80) / 100;
      const T   = (node.transmission ?? 100) / 100;
      const order = node.type === 'aom' ? node.activeOrder : '+1';
      const dumpLane = ctx.entryLane === 0 ? 1 : 0;
      const zeroth: OutputPort = {
        handle: 'order0',
        kind: 'transmit',
        lane: dumpLane,
        // Blocked inside the cell unless the user asks to route it out and block it
        // themselves, which is what the dump lane is there for.
        dumped: node.dumpZeroOrder !== false,
        beam: { ...inBeam, power: inBeam.power * Math.max(0, T - eta) * lossF },
      };

      // activeOrder '0' means the undiffracted beam is the one being used, so it
      // propagates unshifted, straight through, and there is no diffracted output.
      if (order === '0') {
        return [{
          ...zeroth,
          lane: ctx.entryLane,
          dumped: false,
          beam: { ...inBeam, power: inBeam.power * T * lossF },
        }];
      }

      const m = order === '-1' ? -1 : 1;
      return [
        {
          handle: 'order1',
          kind: 'transmit',
          lane: ctx.entryLane,
          beam: {
            ...inBeam,
            power: inBeam.power * eta * lossF,
            detuningHz: (inBeam.detuningHz ?? 0) + m * node.rfFrequency * 1e6,
          },
        },
        zeroth,
      ];
    }

    // ── Frequency doubling: converted + residual fundamental ─────────────────
    case 'shg_crystal':
    case 'nonlinear_crystal': {
      const eff = (node.conversionEfficiency ?? 30) / 100;
      const doubles = node.type === 'shg_crystal' || node.crystalType === 'SHG';
      if (!doubles) {
        return [{ handle: 'out', kind: 'transmit', beam: transformBeam(inBeam, node) }];
      }
      return [
        // Doubling the carrier doubles any accumulated detuning with it.
        { handle: 'shg',  kind: 'transmit', beam: { ...inBeam, wavelength: inBeam.wavelength / 2, power: inBeam.power * eff * lossF, detuningHz: (inBeam.detuningHz ?? 0) * 2 } },
        { handle: 'fund', kind: 'transmit', beam: { ...inBeam, power: inBeam.power * (1 - eff) * lossF } },
      ];
    }

    // ── Everything else: single transmitted path ─────────────────────────────
    default:
      return [{ handle: 'out', kind: 'transmit', beam: transformBeam(inBeam, node) }];
  }
}

/** The port a given source handle corresponds to, or undefined if there is none. */
export function outputPortFor(
  inBeam: BeamState,
  node: OpticalNodeData,
  handle: string | null | undefined,
): OutputPort | undefined {
  const ports = componentOutputs(inBeam, node);
  if (ports.length === 0) return undefined;
  // With no handle to go on, prefer a port the beam actually leaves by, so a
  // handle-less wire off an AOM doesn't pick up the dumped 0th order.
  const fallback = ports.find(p => !p.dumped) ?? ports[0];
  if (!handle) return fallback;
  return ports.find(p => p.handle === handle) ?? fallback;
}

/** Component types that launch a beam into free space rather than receiving one. */
const EMITTER_TYPES = new Set<OpticalNodeData['type']>([
  'laser_source',
  'fiber_launcher',
  // Its seed arrives by fibre, which the free-space layout never sees, so as far as the
  // tracer is concerned it starts a beam rather than continuing one.
  'fiber_amplifier',
]);

export function isEmitter(type: OpticalNodeData['type']): boolean {
  return EMITTER_TYPES.has(type);
}

/**
 * The beam a laser source emits, seeded with a waist at its output face.
 * Layouts saved before lasers had beam parameters fall back to DEFAULT_WAIST_UM,
 * so the Gaussian chain is always live.
 */
export function laserBeam(node: OpticalNodeData & { type: 'laser_source' }): BeamState {
  return sourceBeam(node.wavelength, node.outputPower, node.polarization, node.waist, node.mSquared);
}

/**
 * The beam an emitting component launches. A fibre launcher states its own output, so
 * it seeds a trace exactly as a laser does; fields missing from an older saved layout
 * fall back to sensible values. Returns null for anything that isn't an emitter.
 */
export function emitterBeam(node: OpticalNodeData): BeamState | null {
  switch (node.type) {
    case 'laser_source':
      return laserBeam(node);
    case 'fiber_launcher':
      return sourceBeam(
        node.wavelength ?? 780,
        node.outputPower ?? 1,
        node.polarization ?? 'H',
        node.waist,
        node.mSquared,
      );
    case 'fiber_amplifier':
      return sourceBeam(
        node.wavelength,
        node.outputPower,
        node.polarization,
        node.waist,
        node.mSquared,
      );
    default:
      return null;
  }
}

function sourceBeam(
  wavelengthNm: number,
  powerMw: number,
  pol: 'H' | 'V' | 'circular' | 'custom',
  waistUm: number | undefined,
  mSquared: number | undefined,
): BeamState {
  const w0Um = waistUm && waistUm > 0 ? waistUm : DEFAULT_WAIST_UM;
  const mSq  = mSquared && mSquared >= 1 ? mSquared : 1;
  const lambdaEff = effectiveWavelengthMm(wavelengthNm, mSq);
  return refreshGaussian({
    wavelength: wavelengthNm,
    power: powerMw,
    polarization: laserPolarization(pol),
    q: waistQ(w0Um * 1e-3, lambdaEff),   // µm → mm
    mSquared: mSq,
  });
}

/** Laser source polarization string → Polarization union. */
export function laserPolarization(p: 'H' | 'V' | 'circular' | 'custom'): Polarization {
  if (p === 'H') return { type: 'H' };
  if (p === 'V') return { type: 'V' };
  if (p === 'circular') return { type: 'circular', handedness: 'L' };
  return { type: 'H' }; // 'custom' has no stored Jones vector yet
}

/** Map from edge id to the beam travelling along it. */
export type BeamMap = Map<string, BeamState>;
