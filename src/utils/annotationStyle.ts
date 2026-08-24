// How regions and notes look — read by the canvas node components and by the SVG export.
//
// Same reason as `canvasStyle`: two renderers draw these, and the only way they stay in
// agreement is to take their numbers from one file.
/** Region wash and border. */
export const REGION_STYLE = {
  borderWidth: 1.5,
  borderStyle: 'dashed' as const,
  /** SVG dash pattern matching the CSS `dashed` border above closely enough. */
  dashArray: '6,4',
  radius: 8,
  minSize: 48,
  /** Invisible grab band inside the border, px — a region is picked up by its edge so the
   *  optics inside it stay clickable. */
  grabWidth: 10,
  captionSize: 11,
  captionInset: 6,
};

/** Notes. The text size is per note; this is the furniture around it. */
export const NOTE_STYLE = {
  lineHeight: 1.35,
  /** Padding inside the note's box, px. */
  pad: 2,
  minWidth: 40,
};

/** Colours offered for regions and notes: readable on both themes, distinct from the beams. */
export const ANNOTATION_COLOURS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // violet
  '#64748b', // slate
];

/** `#rrggbb` plus an alpha, as `rgba()` — the wash behind a region. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}
