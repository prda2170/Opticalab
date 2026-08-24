// Components that move as one.
//
// A group is deliberately *not* an xyflow parent/child relationship. That would make
// `node.position` relative to the parent, and this whole codebase — the tracer, snapping,
// label placement, the figure renderer — reads `node.position` as absolute canvas
// coordinates. Rewriting the geometry layer to buy a drag behaviour is the wrong trade.
//
// So a group is just a shared `groupId` in node data, and two rules built on it:
//
//   1. Dragging one member moves all of them (`groupSiblingMoves`), by applying the same
//      delta to the rest. Independent of selection, so a group holds together whether or
//      not you happened to click every member first.
//   2. The router's snap moves the group *rigidly* (`rigidGroupSnaps`): one member lands on
//      the beam and the rest follow by the same offset, instead of each being pulled onto
//      whatever beam is nearest and quietly deforming the group.
//
// Everything else falls out of machinery that already exists: xyflow drags a multi-selection
// together, `clipboard.ts` copies whatever is selected, Delete removes it.
import type { Node, NodeChange, NodePositionChange } from '@xyflow/react';
import type { OpticalNodeData } from '../types/components';
import { sizeOf } from './nodeGeometry';

/** The group a node belongs to, or null. */
export function groupIdOf(node: { data?: { groupId?: unknown } }): string | null {
  const id = node.data?.groupId;
  return typeof id === 'string' && id !== '' ? id : null;
}

/** Node ids sharing a group with `groupId`. */
export function membersOf<T extends { id: string; data?: { groupId?: unknown } }>(
  nodes: T[],
  groupId: string,
): T[] {
  return nodes.filter(n => groupIdOf(n) === groupId);
}

/** Fresh group id. Timestamp plus a counter, like the node ids. */
let groupCounter = 1;
export function newGroupId(stamp: number): string {
  return `grp_${stamp}_${groupCounter++}`;
}

function isPositionChange(change: NodeChange): change is NodePositionChange {
  return change.type === 'position';
}

/**
 * The extra position changes needed so a dragged group arrives intact.
 *
 * Returns changes *in addition* to the ones passed in — the caller concatenates. Siblings
 * already moving in the same batch are left alone, which is what makes dragging a selection
 * that happens to contain a whole group behave normally rather than double-shifting it.
 */
export function groupSiblingMoves(
  changes: NodeChange[],
  nodes: Node<OpticalNodeData>[],
): NodePositionChange[] {
  const moving = new Set(changes.filter(isPositionChange).map(c => c.id));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const extra: NodePositionChange[] = [];
  // A sibling could be pulled by two members of its own group in one batch; first wins, and
  // the result is the same either way because every member shares the delta.
  const claimed = new Set<string>();

  for (const change of changes) {
    if (!isPositionChange(change) || !change.position) continue;
    const node = byId.get(change.id);
    if (!node) continue;
    const groupId = groupIdOf(node);
    if (!groupId) continue;

    const dx = change.position.x - node.position.x;
    const dy = change.position.y - node.position.y;
    if (dx === 0 && dy === 0) continue;

    for (const sibling of membersOf(nodes, groupId)) {
      if (sibling.id === change.id || moving.has(sibling.id) || claimed.has(sibling.id)) continue;
      // A fixed component stays fixed, even as part of a group. Deliberate: "fix position"
      // is a statement about the bench, and a group should not override it.
      if (sibling.data.locked) continue;
      claimed.add(sibling.id);
      extra.push({
        id: sibling.id,
        type: 'position',
        position: { x: sibling.position.x + dx, y: sibling.position.y + dy },
        dragging: change.dragging,
      });
    }
  }
  return extra;
}

/**
 * Rewrite the router's snaps so each group moves as one piece.
 *
 * The tracer snaps components onto the beams that hit them, one at a time. For a group that
 * tears it apart: the member the beam touches lands on the axis and the others stay put. So
 * for each group, one snapped member decides the offset and every member takes it.
 *
 * Which member decides: the first snapped one in node order. Stable, so the same layout
 * always snaps the same way, and in the normal case (one member on one beam) there is only
 * one candidate anyway.
 *
 * A group containing a **locked** member is anchored — every snap for it is dropped. A fixed
 * component is a statement about where the bench is, and the alternative is a group that
 * either tears or drags a bolted-down optic with it.
 */
export function rigidGroupSnaps(
  nodes: Node<OpticalNodeData>[],
  snaps: Map<string, { x: number; y: number }>,
): Map<string, { x: number; y: number }> {
  if (snaps.size === 0) return snaps;

  const groups = new Map<string, Node<OpticalNodeData>[]>();
  for (const node of nodes) {
    const groupId = groupIdOf(node);
    if (!groupId) continue;
    const list = groups.get(groupId);
    if (list) list.push(node); else groups.set(groupId, [node]);
  }
  if (groups.size === 0) return snaps;

  const out = new Map(snaps);
  for (const [, members] of groups) {
    const anchored = members.some(m => m.data.locked);
    const decider = members.find(m => snaps.has(m.id));

    if (!decider) continue;             // nothing in this group was snapped
    if (anchored) {
      for (const m of members) out.delete(m.id);
      continue;
    }

    const target = snaps.get(decider.id)!;
    const dx = target.x - decider.position.x;
    const dy = target.y - decider.position.y;
    for (const m of members) {
      out.set(m.id, { x: m.position.x + dx, y: m.position.y + dy });
    }
  }
  return out;
}

/** Axis-aligned box around a group's members, in canvas coordinates. */
export function groupBounds(
  nodes: Node<OpticalNodeData>[],
  groupId: string,
): { x: number; y: number; width: number; height: number } | null {
  const members = membersOf(nodes, groupId);
  if (members.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of members) {
    const { width, height } = sizeOf(m);
    minX = Math.min(minX, m.position.x);
    minY = Math.min(minY, m.position.y);
    maxX = Math.max(maxX, m.position.x + width);
    maxY = Math.max(maxY, m.position.y + height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Groups with at least one member selected — the ones worth outlining. */
export function selectedGroupIds(nodes: Node<OpticalNodeData>[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const groupId = groupIdOf(node);
    if (!groupId || !node.selected || ids.includes(groupId)) continue;
    ids.push(groupId);
  }
  return ids;
}
