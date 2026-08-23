// Where a component's name label sits, and how big it is.
//
// Two things to get right, both shared by the editor canvas and the diagram so the
// views keep agreeing:
//
//  1. Symbol icons are drawn square, at min(width, height) + 4, and centred in the
//     node's box. A tall narrow component — a waveplate is 32×72 — therefore has a
//     band of empty box below its artwork, and a label placed under the *box* floats
//     far from the thing it names. Pull it back up by that slack.
//  2. The label can be scaled, and smaller text should sit closer in, so the gap is
//     proportional rather than fixed.
import { getNodeGeometry, artworkOf } from './nodeGeometry';
import { unitAt } from '../physics/geometry';
import type { OpticalNodeData } from '../types/components';

/** Base label size in px, at scale 1. */
export const LABEL_BASE_PX = 9;

/** Gap between artwork and label at scale 1, in px. */
const LABEL_BASE_GAP = 3;

export interface LabelLayout {
  /** Font size in px. */
  fontSize: number;
  /** Distance from the bottom of the icon artwork to the label, px. */
  gap: number;
  /**
   * Empty box below the artwork, px. The editor uses it as a negative margin; the
   * diagram subtracts it from the label's y offset.
   */
  slack: number;
  /** Total offset from the bottom of the node's box to the label baseline area, px. */
  offset: number;
}

export function labelLayout(
  type: OpticalNodeData['type'],
  rotation = 0,
  scale = 1,
  basePx = LABEL_BASE_PX,
): LabelLayout {
  const g = getNodeGeometry(type, rotation);
  const art = artworkOf(type);
  // Symbol artwork is drawn as a square of this size, from the *artwork* box so that
  // turning a component never resizes its icon.
  const iconSize = Math.min(art.width, art.height) + 4;
  // Vertical extent of that square once turned: a square at 45° is √2 taller than at 0°.
  // Box nodes fill their border exactly, so their artwork's own height is the extent.
  const { dx: cos, dy: sin } = unitAt(rotation);
  const drawnHeight = g.symbolType === 'symbol'
    ? iconSize * (Math.abs(sin) + Math.abs(cos))
    : art.width * Math.abs(sin) + art.height * Math.abs(cos);
  // Empty box below the artwork, which the label is pulled up through. Measured against
  // the occupied box, since that is what the label sits under.
  const slack = Math.max(0, (g.height - drawnHeight) / 2);
  const gap = LABEL_BASE_GAP * scale;
  return {
    fontSize: basePx * scale,
    gap,
    slack,
    offset: gap - slack,
  };
}
