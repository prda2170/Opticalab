// TypeScript types for all optical component node data

export type ComponentCategory =
  | 'source'
  | 'conditioning'
  | 'steering'
  | 'lens'
  | 'fiber'
  | 'modulation'
  | 'detection'
  | 'cavity'
  | 'coldatom'
  | 'utility';

export const CATEGORY_COLORS: Record<ComponentCategory, string> = {
  source: '#ef4444',
  conditioning: '#f97316',
  steering: '#eab308',
  lens: '#22c55e',
  fiber: '#3b82f6',
  modulation: '#a855f7',
  detection: '#6b7280',
  cavity: '#d1d5db',
  coldatom: '#92400e',
  utility: '#38bdf8',
};

// ─── Base ────────────────────────────────────────────────────────────────────
export interface BaseNodeData {
  [key: string]: unknown;
  name: string;
  aperture?: number;       // mm
  loss?: number;           // additional insertion loss, % (0 = ideal)
  category: ComponentCategory;
  locked?: boolean;        // prevents drag when true
  /**
   * Components that move as one. A shared id, not an xyflow parent/child relationship —
   * see `utils/grouping.ts` for why. Unset means ungrouped, which is every node until
   * someone groups it.
   */
  groupId?: string;
  /**
   * Draw the component's name beside it. Off unless explicitly true — a bench with
   * every part named is hard to read, and the name is on hover and in the properties
   * panel regardless.
   */
  showLabel?: boolean;
  rotation?: number;
  /** Direction the beam is travelling when it enters this node (set by autoRoute). */
  beamIncomingDir?: { dx: number; dy: number };
  computedInput?: import('./beam').BeamState;
  computedOutput?: import('./beam').BeamState;
}

// ─── Sources ─────────────────────────────────────────────────────────────────
export interface LaserSourceData extends BaseNodeData {
  type: 'laser_source';
  wavelength: number;   // nm
  outputPower: number;  // mW
  polarization: 'H' | 'V' | 'circular' | 'custom';
  /** 1/e² beam waist radius at the output face, μm. Seeds Gaussian propagation. */
  waist?: number;
  /** Beam quality factor M² (1 = ideal Gaussian). */
  mSquared?: number;
  /**
   * Drive current, mA. Bookkeeping only — nothing in the physics reads it. It is here so
   * a layout can record the setting that produced the quoted output power, which is the
   * number you actually need when returning to a setup.
   */
  current?: number;
}

/**
 * Optical amplifier — a tapered amplifier, fibre amplifier, or similar. It needs a seed:
 * the beam that arrives sets the wavelength, detuning and polarisation, and the amplifier
 * only raises the power.
 *
 * The output power is stated outright rather than derived from a gain: on a real amplifier
 * that is the number you read off a power meter and the number you care about, and a gain
 * figure is only ever a way of guessing it. Amplified spontaneous emission is not modelled,
 * so an unseeded amplifier outputs nothing rather than broadband ASE, and the output mode
 * is the seed's (a real TA redefines it, and is astigmatic).
 */
export interface OpticalAmplifierData extends BaseNodeData {
  type: 'optical_amplifier';
  /** Power delivered when seeded, mW. */
  outputPower: number;
  /** Drive current, mA. Bookkeeping only, as on a laser. */
  current?: number;
}

/**
 * Fibre-coupled optical amplifier — a fibre amplifier, or a TA with a fibre-fed seed.
 *
 * Unlike the free-space `optical_amplifier`, this one **needs no beam drawn to it**: its
 * seed arrives down a fibre, which is not part of the free-space layout, so it behaves as a
 * source. That is the whole difference, and it is why this is a separate type rather than a
 * flag — an emitter and a pass-through are different things to the tracer, not different
 * settings of one thing.
 *
 * It states its own output beam exactly as a laser does. ASE is not modelled, and neither
 * is the seed: if the fibre is dark the real device puts out only broadband light, and here
 * it puts out whatever `outputPower` says. Set it to what your power meter reads.
 */
export interface FiberAmplifierData extends BaseNodeData {
  type: 'fiber_amplifier';
  wavelength: number;   // nm
  /** Power delivered at the output collimator, mW. */
  outputPower: number;
  polarization: 'H' | 'V' | 'circular' | 'custom';
  /** 1/e² waist radius of the collimated output, µm. */
  waist?: number;
  mSquared?: number;
  /** Drive current, mA. Bookkeeping only, as on a laser. */
  current?: number;
  /**
   * Fibre this output is fed from: the id of a `fiber_coupler` elsewhere in the layout.
   *
   * Unset means free-running — it states its own wavelength and power, as it always has.
   * Tagged, it carries what actually went into that coupler: wavelength and RF detuning,
   * and (for a launcher) the coupled power. **Polarisation does not carry.** These are PM
   * fibres, but the key angle relative to the bench is arbitrary, so the state at the far
   * end is whatever this component says it is, not what went in. The spatial mode does not
   * carry either — a fibre is a mode filter, which is most of the reason to use one.
   */
  fiberInputId?: string;
}

// ─── Conditioning ─────────────────────────────────────────────────────────────
export interface IsolatorData extends BaseNodeData {
  type: 'isolator';
  transmission: number; // %
  isolation: number;    // dB
}

export interface LinearPolarizerData extends BaseNodeData {
  type: 'linear_polarizer';
  angle: number; // °
  polType: 'generic' | 'glan_taylor';
}

export interface HWPData extends BaseNodeData {
  type: 'hwp';
  fastAxisAngle: number; // °
}

export interface QWPData extends BaseNodeData {
  type: 'qwp';
  fastAxisAngle: number; // °
}

export interface NDFilterData extends BaseNodeData {
  type: 'nd_filter';
  od: number; // optical density
}

export interface IrisData extends BaseNodeData {
  type: 'iris';
  apertureDiameter: number; // mm
}

export interface BeamBlockData extends BaseNodeData {
  type: 'beam_block';
}

// ─── Steering & Splitting ────────────────────────────────────────────────────
export interface DielectricMirrorData extends BaseNodeData {
  type: 'dielectric_mirror';
  reflectivity: number; // %
}

export interface DichroicMirrorData extends BaseNodeData {
  type: 'dichroic_mirror';
  edgeWavelength: number; // nm
  mirrorType: 'LP' | 'SP';
}

/**
 * Returns the beam back along its own path, whichever way it arrives.
 * With a focal length it is a cat's eye (lens + mirror at the focal plane), which
 * images its input plane onto itself when placed one focal length from the component
 * being double-passed — that is what stops the return beam walking when an AOM is
 * retuned. With `focalLength: 0` it is a plain flat retro / corner cube.
 */
export interface RetroreflectorData extends BaseNodeData {
  type: 'retroreflector';
  reflectivity: number;  // %
  focalLength: number;   // mm; 0 = corner cube
}

export interface NPBSData extends BaseNodeData {
  type: 'npbs';
  splitRatio: string; // R:T ratio e.g. "50:50", "90:10"
}

export interface PBSData extends BaseNodeData {
  type: 'pbs';
}

/** Legacy — kept for file compatibility. Use shg_crystal or sfg_crystal for new designs. */
export interface NonlinearCrystalData extends BaseNodeData {
  type: 'nonlinear_crystal';
  crystalType: 'SHG' | 'SFG';
  geometry: 'bulk' | 'waveguide';
  temperature: number;
  conversionEfficiency: number; // %
}

export interface SHGCrystalData extends BaseNodeData {
  type: 'shg_crystal';
  geometry: 'bulk' | 'waveguide';
  temperature: number;
  conversionEfficiency: number; // %
}

export interface SFGCrystalData extends BaseNodeData {
  type: 'sfg_crystal';
  geometry: 'bulk' | 'waveguide';
  temperature: number;
  conversionEfficiency: number; // %
}

// ─── Lenses ──────────────────────────────────────────────────────────────────
export interface PlanoConvexLensData extends BaseNodeData {
  type: 'plano_convex';
  focalLength: number; // mm
  flipped?: boolean;   // flip: convex side faces left instead of right
}

export interface PlanoConcaveLensData extends BaseNodeData {
  type: 'plano_concave';
  focalLength: number; // mm (negative)
  flipped?: boolean;   // flip: concave side faces left instead of right
}

// ─── Fiber Optics ────────────────────────────────────────────────────────────
export interface FiberCouplerData extends BaseNodeData {
  type: 'fiber_coupler';
  couplingEfficiency: number; // %
  inputNA: number;
}

/**
 * Fibre launcher / collimator: light arrives down a fibre and is launched into free
 * space, so it is a **beam source**, like a laser. Its output is stated directly rather
 * than carried from an upstream coupler — there is no fibre-link model yet.
 */
export interface FiberLauncherData extends BaseNodeData {
  type: 'fiber_launcher';
  /** Collimator focal length, mm. Informational: w₀ ≈ λf/(π·w_fibre). */
  focalLength: number;
  wavelength: number;   // nm
  outputPower: number;  // mW launched into free space
  polarization: 'H' | 'V' | 'circular' | 'custom';
  /** 1/e² waist radius of the collimated output, µm. */
  waist?: number;
  mSquared?: number;
  /** Legacy field from when the launcher was a pass-through; no longer used. */
  couplingEfficiency?: number;
  /**
   * Fibre this output is fed from: the id of a `fiber_coupler` elsewhere in the layout.
   *
   * Unset means free-running — it states its own wavelength and power, as it always has.
   * Tagged, it carries what actually went into that coupler: wavelength and RF detuning,
   * and (for a launcher) the coupled power. **Polarisation does not carry.** These are PM
   * fibres, but the key angle relative to the bench is arbitrary, so the state at the far
   * end is whatever this component says it is, not what went in. The spatial mode does not
   * carry either — a fibre is a mode filter, which is most of the reason to use one.
   */
  fiberInputId?: string;
}

export interface FiberCableData extends BaseNodeData {
  type: 'fiber_cable';
  length: number;
  pmFiber: boolean;
  connectorType: 'FC/APC' | 'FC-PC' | 'SMA';
}

// ─── Modulation ───────────────────────────────────────────────────────────────
export interface AOMData extends BaseNodeData {
  type: 'aom';
  /** Drive frequency, MHz — also the frequency shift of the ±1 order. */
  rfFrequency: number;
  rfPower: number;              // dBm
  /** Fraction of *incident* power in the diffracted order, %. */
  diffractionEfficiency: number;
  /** RF-off throughput of the cell, %. Sets how much lands in the 0th order. */
  transmission: number;
  /** Which order is used downstream. '0' means the undiffracted beam is used. */
  activeOrder: '+1' | '-1' | '0';
  /**
   * Block the undiffracted order inside the cell (the default). Set false to route it
   * out along the dump lane so it can be blocked with a real beam block.
   */
  dumpZeroOrder?: boolean;
}

export interface AODData extends BaseNodeData {
  type: 'aod';
  /** Centre drive frequency, MHz — scanning is not modelled. */
  rfFrequency: number;
  rfPower: number;              // dBm
  /** Fraction of *incident* power in the diffracted order, %. */
  diffractionEfficiency: number;
  /** RF-off throughput of the cell, %. Sets how much lands in the 0th order. */
  transmission: number;
  /** Block the undiffracted order inside the cell (the default). */
  dumpZeroOrder?: boolean;
}

export interface EOMData extends BaseNodeData {
  type: 'eom';
  eomType: 'fiber' | 'free_space';
  transmission: number;
  rfFrequency: number;
  rfPower: number;
}

export interface SLMData extends BaseNodeData {
  type: 'slm';
  pixelCount: string;
  frameRate: number;
}

export interface GalvoData extends BaseNodeData {
  type: 'galvo';
  scanAngleRange: number;
  scanFrequency: number;
}

// ─── Detection ───────────────────────────────────────────────────────────────
export interface PhotodiodeData extends BaseNodeData {
  type: 'photodiode';
  bandwidth: number;
  /**
   * Volts out per mW in, as read on a scope. This lumps the diode's responsivity
   * together with whatever transimpedance or amplifier gain follows it, which is the
   * number you actually calibrate on the bench — a bare diode into 50 Ω and the same
   * diode into a 10 kΩ transimpedance differ by more than two decades.
   */
  signalFactor: number;
  /** Print the signal in volts beside the component. */
  showSignal?: boolean;
}

export interface APDData extends BaseNodeData {
  type: 'apd';
  gain: number;
  bandwidth: number;
}

export interface CameraData extends BaseNodeData {
  type: 'camera';
  resolution: string;
  pixelSize: number;
  frameRate: number;
}

export interface BeamProfilerData extends BaseNodeData {
  type: 'beam_profiler';
  sensorSize: number;
}

// ─── Cavities ────────────────────────────────────────────────────────────────
export interface FabryPerotData extends BaseNodeData {
  type: 'fabry_perot';
  linewidth: number; // MHz
  fsr: number;       // MHz
  finesse: number;
}

export interface ReferenceCavityData extends BaseNodeData {
  type: 'reference_cavity';
  linewidth: number; // kHz
  fsr: number;       // GHz
  finesse: number;
}

export interface DelayLineData extends BaseNodeData {
  type: 'delay_line';
  delayLength: number; // m
}

// ─── Cold Atom ───────────────────────────────────────────────────────────────

/**
 * Sealed atomic vapour cell: a glass tube with wedged end windows and a side
 * reservoir (the "bell") holding the metal.
 *
 * Resonant absorption is **not** modelled — the cell passes the beam through and any
 * attenuation comes from the generic `loss` field. Doing it properly needs a Doppler
 * profile against `BeamState.detuningHz` and a vapour pressure curve for the species.
 */
export interface VaporCellData extends BaseNodeData {
  type: 'vapor_cell';
  species: 'Rb' | 'Cs' | 'K' | 'Na' | 'Sr' | 'other';
  /** Cell length along the beam, mm. */
  length: number;
  /** Reservoir temperature, °C — sets the vapour pressure on a real cell. */
  temperature: number;
  /** End-window wedge away from normal incidence, °. Kills etalon fringes. */
  windowAngle: number;
  /** Buffer gas fill, if any (e.g. "20 Torr N₂"); empty for a pure cell. */
  bufferGas?: string;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Reads the beam where it sits and prints the value beside itself. **Not an optic** —
 * it is filtered out of the trace (see NON_OPTICAL_NODE_TYPES) so it cannot terminate,
 * attenuate or split anything, and it finds its beam by looking up the finished
 * segments instead. Snapped onto the nearest beam by `probeSnaps`.
 */
export interface PowerProbeData extends BaseNodeData {
  type: 'power_probe';
  /** Readout position relative to the probe point, in canvas px. */
  labelDx: number;
  labelDy: number;
  showWavelength?: boolean;
  showDetuning?: boolean;
  showSpot?: boolean;
}

/**
 * A spherical-polygon vacuum chamber, in plan view: a Kimball spherical octagon or
 * dodecagon seen from above, with one side port per flat.
 *
 * Parameterised rather than fixed to one part, because the same drawing serves both sizes on
 * the shelf. Defaults are the MCF1000-SphDodecagon (10 in, 12 ports) — see
 * `physics/chamber.ts` for where every number comes from.
 *
 * The geometry is per instance, so `sizeOf` computes its box rather than the type table.
 */
export interface VacuumChamberData extends BaseNodeData {
  type: 'vacuum_chamber';
  /** Side ports, equally spaced. 12 for a dodecagon, 8 for an octagon. */
  sides: number;
  /** Centre to flange face, mm — the polygon's inradius. */
  inradiusMm: number;
  /** Side port clear aperture, mm. A beam further off the axis than its radius hits metal. */
  boreMm: number;
  /** Bore length through the wall, mm. Drawn, not optical. */
  tubeMm?: number;
  /** Vertical (top/bottom) port bore, mm. Drawn as the inner circle in plan view. */
  topBoreMm?: number;
  /**
   * State of each side port, index 0 at the chamber's own 0 degrees. Anything missing reads
   * as a viewport, so a chamber you have just dropped passes light.
   */
  ports?: ('closed' | 'viewport')[];
  /** Transmission of one window, %. A crossing goes through two of them. */
  transmission?: number;
}

// ─── Annotation ──────────────────────────────────────────────────────────────

/**
 * A highlighted area of the bench: "cooling arm", "double-pass AOM", "in vacuum".
 *
 * **Not an optic.** Filtered out of the trace (see NON_OPTICAL_NODE_TYPES), so it neither
 * blocks, bends nor attenuates anything, and the router never snaps it to a beam. It is a
 * wash of colour behind the layout with a caption, and it exists so a figure can say which
 * part of a crowded bench a paragraph is talking about.
 *
 * First node type whose **size is per instance** rather than per type — `sizeOf` prefers
 * `w`/`h` here and falls back to the geometry table for optics.
 */
export interface RegionData extends BaseNodeData {
  type: 'region';
  /** Size in canvas px. */
  w: number;
  h: number;
  shape: 'rect' | 'ellipse';
  /** Border colour; the wash is the same colour at `fillOpacity`. */
  colour: string;
  fillOpacity: number;
  /** Drawn inside one corner, out of the way of the optics. */
  caption?: string;
  /**
   * Which corner the caption sits in, or `'none'` to keep the text without showing it.
   * Unset reads as the top-left, where every region drawn before this option existed has it.
   */
  captionCorner?: 'tl' | 'tr' | 'bl' | 'br' | 'none';
  /** Behind the optics (default for a region) or in front of everything. */
  layer?: 'behind' | 'front';
  /** Order within the layer, for annotations that overlap each other. */
  zOrder?: number;
}

/**
 * Free text on the bench — a caption, a detuning, a note to the reader.
 *
 * Also not an optic. The text takes the small markup in `utils/richText`: `\lambda`-style
 * names, `^{}` and `_{}` scripts. That is deliberately not LaTeX: a real TeX engine cannot
 * render into the vector export, and a figure caption does not need one.
 */
export interface NoteData extends BaseNodeData {
  type: 'note';
  text: string;
  fontSize: number;
  colour: string;
  align: 'left' | 'center';
  /** Wrap width in px. The note is as tall as its content. */
  w: number;
  /** In front of everything (default for a note) or behind the optics. */
  layer?: 'behind' | 'front';
  /** Order within the layer, for annotations that overlap each other. */
  zOrder?: number;
}

// ─── Union type ───────────────────────────────────────────────────────────────
export type OpticalNodeData =
  | LaserSourceData
  | OpticalAmplifierData
  | FiberAmplifierData
  | IsolatorData
  | LinearPolarizerData
  | HWPData
  | QWPData
  | NDFilterData
  | IrisData
  | BeamBlockData
  | DielectricMirrorData
  | DichroicMirrorData
  | RetroreflectorData
  | NPBSData
  | PBSData
  | NonlinearCrystalData
  | SHGCrystalData
  | SFGCrystalData
  | PlanoConvexLensData
  | PlanoConcaveLensData
  | FiberCouplerData
  | FiberLauncherData
  | FiberCableData
  | AOMData
  | AODData
  | EOMData
  | SLMData
  | GalvoData
  | PhotodiodeData
  | APDData
  | CameraData
  | BeamProfilerData
  | FabryPerotData
  | ReferenceCavityData
  | DelayLineData
  | VaporCellData
  | VacuumChamberData
  | PowerProbeData
  | RegionData
  | NoteData;

/** xyflow node types that are annotations, not optics — kept out of the beam trace. */
export const NON_OPTICAL_NODE_TYPES = new Set([
  'beam_endpoint', 'power_probe', 'region', 'note',
]);

/** Node types that annotate the figure rather than describing the bench. */
export const ANNOTATION_NODE_TYPES = new Set(['region', 'note']);

/** True for a region or a note — draggable in the figure tab, invisible to the tracer. */
export function isAnnotationNode(node: { type?: string }): boolean {
  return ANNOTATION_NODE_TYPES.has(node.type ?? '');
}

/** True for a canvas node the beam tracer should consider. */
export function isOpticalNode(node: { type?: string }): boolean {
  return !NON_OPTICAL_NODE_TYPES.has(node.type ?? 'optical');
}

export interface PaletteEntry {
  type: OpticalNodeData['type'];
  label: string;
  /** xyflow node type to create; defaults to the standard optical node renderer. */
  nodeType?: string;
  category: ComponentCategory;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultData: any;
}

export interface BeamEdgeData {
  [key: string]: unknown;
  wavelength: number;
  power: number;
  polarization: string;
  w0?: number;
  zR?: number;
  computedOutput?: import('./beam').BeamState;
  /** Explicit canvas coordinates for the beam path endpoints (auto-routed edges only).
   *  Using these instead of xyflow's handle-measurement avoids sub-pixel misalignment. */
  sx?: number;
  sy?: number;
  tx?: number;
  ty?: number;
}
