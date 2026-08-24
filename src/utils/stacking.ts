// What is drawn on top of what.
//
// Only annotations need this. Optics never meaningfully overlap — the router keeps them on
// their beams — but two regions can, a note can sit over a region, and the whole point of a
// highlight is that it goes *behind* the bench while a caption goes in front of it.
//
// The model is two fields, both optional so every existing layout already has an answer:
//
//   layer   'behind' the optics (a wash) or 'front' of everything (text). The default is by
//           type, because that is what each is for: regions behind, notes in front.
//   zOrder  order *within* a layer, for annotations that overlap each other. Higher is nearer
//           the viewer. Defaults to 0, and Bring Forward / Send Back just add ±1.
//
// The canvas turns this into an xyflow `zIndex`; the export sorts its paint order by it. Both
// call the same functions here, so a figure stacks the way the screen did.
import type { OpticalNodeData } from '../types/components';

export type StackLayer = 'behind' | 'front';

/**
 * xyflow z-index bases.
 *
 * The beam edge layer is raised to CSS `z-index: 10` (see styles/handles.css) so beams stay
 * visible right up to a mirror's surface. So "behind the bench" is anything below the optics
 * at 0, and "in front of everything" is anything above the beams at 10 — with room either
 * side for `zOrder` to move within a layer without crossing into the other.
 */
export const STACK_BASE: Record<StackLayer, number> = { behind: -200, front: 200 };

/** Which side of the bench this annotation sits on. */
export function stackLayerOf(data: OpticalNodeData): StackLayer {
  const explicit = (data as { layer?: unknown }).layer;
  if (explicit === 'behind' || explicit === 'front') return explicit;
  // Unset: what the type is for. A region is a wash, a note is a caption.
  return data.type === 'note' ? 'front' : 'behind';
}

/** Order within the layer. Higher is nearer the viewer. */
export function stackOrderOf(data: OpticalNodeData): number {
  const z = (data as { zOrder?: unknown }).zOrder;
  return typeof z === 'number' && Number.isFinite(z) ? z : 0;
}

/**
 * The xyflow `zIndex` for a node, or `undefined` to leave it where xyflow puts it.
 *
 * Optics get `undefined` on purpose: they have always been at the default and moving them
 * would change how every existing layout draws.
 */
export function stackZIndex(node: { type?: string; data: OpticalNodeData }): number | undefined {
  if (node.type !== 'region' && node.type !== 'note') return undefined;
  return STACK_BASE[stackLayerOf(node.data)] + stackOrderOf(node.data);
}

/**
 * Sort annotations for painting: furthest first, so a later `<g>` covers an earlier one.
 *
 * Ties break on array position, which is stable — the same layout always paints the same way,
 * and two annotations created in order stay in that order.
 */
export function byStackOrder<T extends { data: OpticalNodeData }>(nodes: T[]): T[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) =>
      stackOrderOf(a.node.data) - stackOrderOf(b.node.data) || a.index - b.index)
    .map(entry => entry.node);
}

/** Annotations on one side of the bench, in paint order. */
export function annotationsInLayer<T extends { type?: string; data: OpticalNodeData }>(
  nodes: T[],
  layer: StackLayer,
): T[] {
  return byStackOrder(nodes.filter(n =>
    (n.type === 'region' || n.type === 'note') && stackLayerOf(n.data) === layer));
}
