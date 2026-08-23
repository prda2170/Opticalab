// The canvas ↔ bench scale.
//
// The dot grid is one dot per breadboard hole, and optical tables are laid out on
// a 1-inch (25.4 mm) hole pitch, so 40 canvas px = 1 inch. Every conversion
// between screen distance and physical distance goes through here — nothing else
// should hard-code 40 or 25.4.

/** Canvas pixels per breadboard hole (one grid dot). */
export const PX_PER_INCH = 40;

export const MM_PER_INCH = 25.4;

/** Canvas pixels per millimetre (≈1.575). */
export const PX_PER_MM = PX_PER_INCH / MM_PER_INCH;

/** Screen distance (px) → bench distance (mm). */
export function pxToMm(px: number): number { return px / PX_PER_MM; }

/** Bench distance (mm) → screen distance (px). */
export function mmToPx(mm: number): number { return mm * PX_PER_MM; }

/** Format a bench distance for display, switching unit by magnitude. */
export function formatLength(mm: number): string {
  const a = Math.abs(mm);
  if (a >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  if (a >= 1)    return `${mm.toFixed(a >= 100 ? 0 : 1)} mm`;
  return `${(mm * 1000).toFixed(0)} µm`;
}

/** Format a beam radius given in µm, switching to mm above 1000 µm. */
export function formatSpot(um: number): string {
  if (!Number.isFinite(um)) return '—';
  if (Math.abs(um) >= 1000) return `${(um / 1000).toFixed(2)} mm`;
  return `${um.toFixed(um >= 100 ? 0 : 1)} µm`;
}
