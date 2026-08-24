// How the layout looks — one place, because two renderers draw it.
//
// The canvas draws the layout in HTML/CSS (xyflow nodes are divs); the export renderer draws
// the same layout in one flat `<svg>`, because a figure has to open in Illustrator and a
// screenshot does not. The two must agree pixel-for-pixel, and the only way that survives
// contact with future edits is for both to read their numbers from here.
//
// The rule for what belongs in this file: anything the *export* has to reproduce. Interaction
// chrome — selection rings, handles, lock badges, the minimap — is the canvas's own business
// and is deliberately absent.
import { PX_PER_INCH } from '../physics/scale';

export interface ThemedColour { light: string; dark: string }

const pick = (c: ThemedColour, dark: boolean) => (dark ? c.dark : c.light);

/** Page behind the layout. */
export const CANVAS_BG: ThemedColour = { light: '#f8fafc', dark: '#0f1117' };

/** Optical-table grid: one dot per breadboard hole. */
export const CANVAS_GRID = {
  /** Hole pitch, px. One inch, as everywhere else. */
  gap: PX_PER_INCH,
  /** Dot diameter as xyflow's `Background size` — the SVG side halves it for a radius. */
  size: 2,
  colour: { light: '#c0c8d8', dark: '#2a2d3a' } as ThemedColour,
};

/** Instrument ("box") nodes. Symbol nodes draw bare — no background, no border. */
export const CANVAS_BOX = {
  radius: 3,
  borderWidth: 1.5,
  fill: { light: 'rgba(248,250,252,0.98)', dark: 'rgba(22,25,40,0.97)' } as ThemedColour,
  /** The canvas's `0 2px 8px rgba(0,0,0,0.25)`, as an SVG drop shadow. */
  shadow: { dy: 2, blur: 4, opacity: 0.25 },
};

/** Beams. Auto-routed beams are the traced ones; a user wire is drawn heavier. */
export const CANVAS_BEAM = {
  autoWidth: 1.5,
  autoOpacity: 0.9,
  userWidth: 2,
  userOpacity: 1,
  /** Beam label chip, when `showBeamLabels` is on. */
  label: {
    fontSize: 9,
    padX: 5,
    padY: 1,
    radius: 4,
    /** Offset from the beam's midpoint, across the beam. */
    offset: 14,
    background: 'rgba(15,15,25,0.85)',
  },
};

/** Component name and detector readout. */
export const CANVAS_LABEL = {
  basePx: 9,
  colour: { light: '#1e293b', dark: '#e2e8f0' } as ThemedColour,
};

export const canvasBg = (dark: boolean) => pick(CANVAS_BG, dark);
export const gridColour = (dark: boolean) => pick(CANVAS_GRID.colour, dark);
export const boxFill = (dark: boolean) => pick(CANVAS_BOX.fill, dark);
export const labelColour = (dark: boolean) => pick(CANVAS_LABEL.colour, dark);
