// How big a component's name is drawn, and how far from the icon.
//
// *Where* it goes is decided by `physics/labelPlacement` — it needs the beams, so it is a
// trace post-pass, and both views read the side it publishes. What is left here is the
// per-view sizing: the font size, and the gap between artwork and text.
//
// The old `slack` fudge is gone with it. It existed because a symbol's square glyph sits in
// a taller box (a waveplate is 36 px of artwork in a 72 px box), so a label placed below the
// *box* floated away from the thing it named. `labelDistance` measures from the glyph
// (`drawnHalfExtents`) instead, which is right in every direction rather than just downwards.
/** Base label size in px, at scale 1. */
export const LABEL_BASE_PX = 9;

export interface LabelLayout {
  /** Font size in px. */
  fontSize: number;
  /** Gap between the artwork and the label, px — scales with the text. */
  gap: number;
}

/**
 * Label sizing for one view.
 *
 * Takes no component and no rotation any more: those only ever mattered for *where* the
 * label went, and that is `labelPlacement`'s job now.
 */
export function labelLayout(scale = 1, basePx = LABEL_BASE_PX): LabelLayout {
  return { fontSize: basePx * scale, gap: 3 * scale };
}
