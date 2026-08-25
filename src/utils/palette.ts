// Component palette: all draggable optical components
import type { PaletteEntry } from '../types/components';

export const PALETTE: PaletteEntry[] = [
  // ─── Sources ──────────────────────────────────────────────────────────────
  {
    type: 'laser_source',
    label: 'Laser Source',
    category: 'source',
    defaultData: { name: 'Laser', category: 'source', type: 'laser_source', wavelength: 780, outputPower: 100, polarization: 'H', waist: 800, mSquared: 1, current: 150 },
  },
  {
    type: 'optical_amplifier',
    label: 'Optical Amplifier',
    category: 'source',
    // TA-ish defaults: ~1 W out at a couple of amps of drive current.
    defaultData: { name: 'TA', category: 'source', type: 'optical_amplifier', outputPower: 1000, current: 2000 },
  },
  {
    type: 'fiber_amplifier',
    label: 'Fiber Amplifier',
    category: 'source',
    // Fibre-seeded, so it needs no beam drawn to it. Defaults suit an erbium/ytterbium
    // fibre amplifier: a watt or two out of a collimator with a wider waist than a diode.
    defaultData: {
      name: 'FA', category: 'source', type: 'fiber_amplifier',
      wavelength: 1064, outputPower: 2000, polarization: 'H', waist: 1200, mSquared: 1.05,
      current: 3000,
    },
  },

  // ─── Conditioning ─────────────────────────────────────────────────────────
  {
    type: 'isolator',
    label: 'Optical Isolator',
    category: 'conditioning',
    defaultData: { name: 'ISO', category: 'conditioning', type: 'isolator', transmission: 95, isolation: 40 },
  },
  {
    type: 'linear_polarizer',
    label: 'Linear Polarizer',
    category: 'conditioning',
    defaultData: { name: 'POL', category: 'conditioning', type: 'linear_polarizer', angle: 0, polType: 'generic' },
  },
  {
    type: 'hwp',
    label: 'Half-Wave Plate',
    category: 'conditioning',
    defaultData: { name: 'λ/2', category: 'conditioning', type: 'hwp', fastAxisAngle: 0 },
  },
  {
    type: 'qwp',
    label: 'Quarter-Wave Plate',
    category: 'conditioning',
    defaultData: { name: 'λ/4', category: 'conditioning', type: 'qwp', fastAxisAngle: 0 },
  },
  {
    type: 'nd_filter',
    label: 'ND Filter',
    category: 'conditioning',
    defaultData: { name: 'ND', category: 'conditioning', type: 'nd_filter', od: 1.0 },
  },
  {
    type: 'iris',
    label: 'Iris Diaphragm',
    category: 'conditioning',
    defaultData: { name: 'Iris', category: 'conditioning', type: 'iris', apertureDiameter: 5 },
  },
  {
    type: 'beam_block',
    label: 'Beam Block',
    category: 'conditioning',
    defaultData: { name: 'BB', category: 'conditioning', type: 'beam_block' },
  },

  // ─── Steering & Splitting ─────────────────────────────────────────────────
  {
    type: 'dielectric_mirror',
    label: 'Dielectric Mirror',
    category: 'steering',
    defaultData: { name: 'M', category: 'steering', type: 'dielectric_mirror', reflectivity: 99.5 },
  },
  {
    type: 'retroreflector',
    label: 'Retroreflector',
    category: 'steering',
    defaultData: { name: 'Cat-eye', category: 'steering', type: 'retroreflector', reflectivity: 99.5, focalLength: 100 },
  },
  {
    type: 'dichroic_mirror',
    label: 'Dichroic Mirror',
    category: 'steering',
    defaultData: { name: 'DM', category: 'steering', type: 'dichroic_mirror', edgeWavelength: 650, mirrorType: 'LP' },
  },
  {
    type: 'npbs',
    label: 'NPBS',
    category: 'steering',
    defaultData: { name: 'NPBS', category: 'steering', type: 'npbs', splitRatio: '50:50' },
  },
  {
    type: 'pbs',
    label: 'PBS',
    category: 'steering',
    defaultData: { name: 'PBS', category: 'steering', type: 'pbs' },
  },
  {
    type: 'shg_crystal',
    label: 'SHG Crystal',
    category: 'steering',
    defaultData: { name: 'SHG', category: 'steering', type: 'shg_crystal', geometry: 'bulk', temperature: 25, conversionEfficiency: 30 },
  },
  {
    type: 'sfg_crystal',
    label: 'SFG Crystal',
    category: 'steering',
    defaultData: { name: 'SFG', category: 'steering', type: 'sfg_crystal', geometry: 'bulk', temperature: 25, conversionEfficiency: 30 },
  },

  // ─── Lenses ───────────────────────────────────────────────────────────────
  {
    type: 'plano_convex',
    label: 'Plano-Convex Lens',
    category: 'lens',
    defaultData: { name: 'L', category: 'lens', type: 'plano_convex', focalLength: 100 },
  },
  {
    type: 'plano_concave',
    label: 'Plano-Concave Lens',
    category: 'lens',
    defaultData: { name: 'L-', category: 'lens', type: 'plano_concave', focalLength: -100 },
  },

  // ─── Fiber ────────────────────────────────────────────────────────────────
  {
    type: 'fiber_coupler',
    label: 'Fiber Coupler',
    category: 'fiber',
    defaultData: { name: 'FC', category: 'fiber', type: 'fiber_coupler', couplingEfficiency: 80, inputNA: 0.12 },
  },
  {
    type: 'fiber_launcher',
    label: 'Fiber Launcher',
    category: 'fiber',
    defaultData: { name: 'FL', category: 'fiber', type: 'fiber_launcher', focalLength: 11, wavelength: 780, outputPower: 10, polarization: 'H', waist: 1100, mSquared: 1 },
  },
  {
    type: 'fiber_cable',
    label: 'Fiber Cable',
    category: 'fiber',
    defaultData: { name: 'Fiber', category: 'fiber', type: 'fiber_cable', length: 1, pmFiber: true, connectorType: 'FC/APC' },
  },

  // ─── Modulation ───────────────────────────────────────────────────────────
  {
    type: 'aom',
    label: 'AOM',
    category: 'modulation',
    defaultData: { name: 'AOM', category: 'modulation', type: 'aom', rfFrequency: 80, rfPower: 33, diffractionEfficiency: 80, transmission: 98, activeOrder: '+1' },
  },
  {
    type: 'aod',
    label: 'AOD',
    category: 'modulation',
    defaultData: { name: 'AOD', category: 'modulation', type: 'aod', rfFrequency: 80, rfPower: 33, diffractionEfficiency: 70, transmission: 98 },
  },
  {
    type: 'eom',
    label: 'EOM',
    category: 'modulation',
    defaultData: { name: 'EOM', category: 'modulation', type: 'eom', eomType: 'free_space', transmission: 90, rfFrequency: 9.2, rfPower: 30 },
  },
  {
    type: 'slm',
    label: 'SLM',
    category: 'modulation',
    defaultData: { name: 'SLM', category: 'modulation', type: 'slm', pixelCount: '1920×1080', frameRate: 60 },
  },
  {
    type: 'galvo',
    label: 'Galvo Mirror',
    category: 'modulation',
    defaultData: { name: 'Galvo', category: 'modulation', type: 'galvo', scanAngleRange: 20, scanFrequency: 1000 },
  },

  // ─── Detection ────────────────────────────────────────────────────────────
  {
    type: 'photodiode',
    label: 'Photodiode',
    category: 'detection',
    defaultData: { name: 'PD', category: 'detection', type: 'photodiode', bandwidth: 100, signalFactor: 1 },
  },
  {
    type: 'apd',
    label: 'APD',
    category: 'detection',
    defaultData: { name: 'APD', category: 'detection', type: 'apd', gain: 100, bandwidth: 50 },
  },
  {
    type: 'camera',
    label: 'CCD/CMOS Camera',
    category: 'detection',
    defaultData: { name: 'CCD', category: 'detection', type: 'camera', resolution: '2048×2048', pixelSize: 6.5, frameRate: 30 },
  },
  {
    type: 'beam_profiler',
    label: 'Beam Profiler',
    category: 'detection',
    defaultData: { name: 'Profiler', category: 'detection', type: 'beam_profiler', sensorSize: 8.6 },
  },

  // ─── Cavities ─────────────────────────────────────────────────────────────
  {
    type: 'fabry_perot',
    label: 'Fabry-Pérot',
    category: 'cavity',
    defaultData: { name: 'FP', category: 'cavity', type: 'fabry_perot', linewidth: 1, fsr: 300, finesse: 300 },
  },
  {
    type: 'reference_cavity',
    label: 'Reference Cavity',
    category: 'cavity',
    defaultData: { name: 'Ref Cav', category: 'cavity', type: 'reference_cavity', linewidth: 10, fsr: 1.5, finesse: 150000 },
  },
  {
    type: 'delay_line',
    label: 'Delay Line',
    category: 'cavity',
    defaultData: { name: 'Delay', category: 'cavity', type: 'delay_line', delayLength: 1 },
  },

  // ─── Cold Atom ────────────────────────────────────────────────────────────
  {
    type: 'vapor_cell',
    label: 'Vapor Cell',
    category: 'coldatom',
    defaultData: { name: 'Rb cell', category: 'coldatom', type: 'vapor_cell', species: 'Rb', length: 75, temperature: 25, windowAngle: 8, bufferGas: '' },
  },

  {
    type: 'vacuum_chamber',
    label: 'Vacuum Chamber',
    category: 'coldatom',
    defaultData: {
      name: 'Chamber', category: 'coldatom', type: 'vacuum_chamber',
      // Kimball MCF1000-SphDodecagon-H2C12, from the dimensioned drawing.
      sides: 12, inradiusMm: 134.62, boreMm: 38.10, tubeMm: 18.42, topBoreMm: 210.82,
      transmission: 100, showLabel: true,
    },
  },

  // ─── Utilities ────────────────────────────────────────────────────────────
  {
    type: 'power_probe',
    label: 'Power Probe',
    category: 'utility',
    nodeType: 'power_probe',
    defaultData: { name: 'P', category: 'utility', type: 'power_probe', labelDx: 34, labelDy: -30 },
  },
  {
    label: 'Region',
    type: 'region',
    category: 'utility',
    nodeType: 'region',
    defaultData: {
      name: 'Region', category: 'utility', type: 'region',
      w: 220, h: 150, shape: 'rect', colour: '#3b82f6', fillOpacity: 0.08,
      caption: 'Region',
    },
  },
  {
    label: 'Text Note',
    type: 'note',
    category: 'utility',
    nodeType: 'note',
    defaultData: {
      name: 'Note', category: 'utility', type: 'note',
      // Empty on purpose: an empty note opens straight into inline editing, and shows a
      // "double-click to edit" placeholder until it has something to say.
      text: '', fontSize: 12, colour: '#3b82f6', align: 'left', w: 180,
    },
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  source: 'Laser Sources',
  conditioning: 'Beam Conditioning',
  steering: 'Steering & Splitting',
  lens: 'Lenses & Imaging',
  fiber: 'Fiber Optics',
  modulation: 'Modulation & Control',
  detection: 'Detection & Diagnostics',
  cavity: 'Interference & Cavities',
  coldatom: 'Cold Atom / AMO',
  utility: 'Layout & Annotation',
};
