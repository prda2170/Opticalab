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

/**
 * Where a region's caption sits — any corner, or nowhere.
 *
 * A caption in the top-left is right until the thing you are highlighting *is* in the
 * top-left, at which point the label sits on the optics it is naming. Rather than guess a
 * clever placement (a region is a hand-drawn thing; the author knows where the room is),
 * this is four corners and a way to turn it off.
 */
export type RegionCaptionCorner = 'tl' | 'tr' | 'bl' | 'br' | 'none';

/** For the picker, in reading order. */
export const REGION_CAPTION_CORNERS: { value: RegionCaptionCorner; label: string }[] = [
  { value: 'tl', label: 'Top left' },
  { value: 'tr', label: 'Top right' },
  { value: 'bl', label: 'Bottom left' },
  { value: 'br', label: 'Bottom right' },
  { value: 'none', label: 'Hidden' },
];

/**
 * The corner as two flags, which is all either renderer needs: the CSS one anchors with
 * `left`/`right` and `top`/`bottom`, the SVG one with `textAnchor` and a baseline. Both
 * measure the same inset from the same edges, so they land in the same place without
 * sharing coordinates.
 *
 * Anything unset or unrecognised reads as the top-left, which is where every region drawn
 * before this option existed has its caption.
 */
export function regionCaptionCorner(corner: unknown): {
  hidden: boolean; right: boolean; bottom: boolean;
} {
  switch (corner) {
    case 'none': return { hidden: true,  right: false, bottom: false };
    case 'tr':   return { hidden: false, right: true,  bottom: false };
    case 'bl':   return { hidden: false, right: false, bottom: true };
    case 'br':   return { hidden: false, right: true,  bottom: true };
    default:     return { hidden: false, right: false, bottom: false };
  }
}

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
