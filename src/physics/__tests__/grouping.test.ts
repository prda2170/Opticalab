import { describe, it, expect } from 'vitest';
import type { Node, NodeChange } from '@xyflow/react';
import {
  groupIdOf, membersOf, groupSiblingMoves, rigidGroupSnaps, groupBounds, selectedGroupIds,
} from '../../utils/grouping';
import { getNodeGeometry } from '../../utils/nodeGeometry';
import { layoutToJSON, layoutFromJSON } from '../../utils/export';
import type { OpticalNodeData } from '../../types/components';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function node(
  id: string,
  x: number,
  y: number,
  extra: Partial<OpticalNodeData> = {},
): Node<OpticalNodeData> {
  return {
    id, type: 'optical', position: { x, y },
    data: {
      type: 'dielectric_mirror', name: id, category: 'steering', reflectivity: 99, ...extra,
    } as OpticalNodeData,
  };
}

/** A three-component group and a loner. */
const bench = () => [
  node('A', 100, 100, { groupId: 'g1' }),
  node('B', 200, 100, { groupId: 'g1' }),
  node('C', 200, 200, { groupId: 'g1' }),
  node('X', 500, 500),
];

const move = (id: string, x: number, y: number, dragging = true): NodeChange => ({
  id, type: 'position', position: { x, y }, dragging,
});

const posOf = (changes: { id: string; position?: { x: number; y: number } }[], id: string) =>
  changes.find(c => c.id === id)?.position;

// ── Membership ────────────────────────────────────────────────────────────────

describe('group membership', () => {
  it('reads a group id, and treats blank as ungrouped', () => {
    expect(groupIdOf(node('A', 0, 0, { groupId: 'g1' }))).toBe('g1');
    expect(groupIdOf(node('A', 0, 0))).toBeNull();
    expect(groupIdOf(node('A', 0, 0, { groupId: '' }))).toBeNull();
  });

  it('finds every member and nothing else', () => {
    expect(membersOf(bench(), 'g1').map(n => n.id)).toEqual(['A', 'B', 'C']);
    expect(membersOf(bench(), 'nope')).toEqual([]);
  });
});

// ── Dragging ──────────────────────────────────────────────────────────────────

describe('groupSiblingMoves', () => {
  it('moves the rest of the group by the same delta', () => {
    const extra = groupSiblingMoves([move('A', 130, 140)], bench());
    expect(extra).toHaveLength(2);
    expect(posOf(extra, 'B')).toEqual({ x: 230, y: 140 });   // +30, +40
    expect(posOf(extra, 'C')).toEqual({ x: 230, y: 240 });
  });

  it('leaves an ungrouped component alone', () => {
    expect(groupSiblingMoves([move('X', 600, 500)], bench())).toEqual([]);
  });

  it('does not double-move a sibling that is already moving', () => {
    // Dragging a multi-selection that happens to contain the whole group: xyflow already
    // emits a change per selected node, and adding to them would shift twice.
    const changes = [move('A', 110, 100), move('B', 210, 100)];
    const extra = groupSiblingMoves(changes, bench());
    expect(extra.map(c => c.id)).toEqual(['C']);
    expect(posOf(extra, 'C')).toEqual({ x: 210, y: 200 });
  });

  it('ignores changes that are not a move', () => {
    const changes: NodeChange[] = [
      { id: 'A', type: 'select', selected: true },
      { id: 'A', type: 'dimensions', dimensions: { width: 44, height: 44 } },
    ];
    expect(groupSiblingMoves(changes, bench())).toEqual([]);
  });

  it('ignores a move that goes nowhere', () => {
    expect(groupSiblingMoves([move('A', 100, 100)], bench())).toEqual([]);
  });

  it('leaves a fixed member where it is', () => {
    // "Fix position" is a statement about the bench; a group does not get to override it.
    const nodes = [
      node('A', 100, 100, { groupId: 'g1' }),
      node('B', 200, 100, { groupId: 'g1', locked: true }),
    ];
    expect(groupSiblingMoves([move('A', 150, 100)], nodes)).toEqual([]);
  });

  it('carries the dragging flag, so the canvas knows the move is live', () => {
    expect(groupSiblingMoves([move('A', 110, 100, true)], bench())[0].dragging).toBe(true);
    expect(groupSiblingMoves([move('A', 110, 100, false)], bench())[0].dragging).toBe(false);
  });

  it('handles two groups moving at once without crossing them', () => {
    const nodes = [
      node('A', 0, 0, { groupId: 'g1' }), node('B', 50, 0, { groupId: 'g1' }),
      node('C', 0, 300, { groupId: 'g2' }), node('D', 50, 300, { groupId: 'g2' }),
    ];
    const extra = groupSiblingMoves([move('A', 10, 0), move('C', 0, 310)], nodes);
    expect(posOf(extra, 'B')).toEqual({ x: 60, y: 0 });
    expect(posOf(extra, 'D')).toEqual({ x: 50, y: 310 });
  });
});

// ── Snapping ──────────────────────────────────────────────────────────────────

describe('rigidGroupSnaps', () => {
  it('applies one member snap to the whole group', () => {
    // B is the one the beam touched: it moves 6 px up, so everyone moves 6 px up.
    const snaps = new Map([['B', { x: 200, y: 94 }]]);
    const out = rigidGroupSnaps(bench(), snaps);
    expect(out.get('A')).toEqual({ x: 100, y: 94 });
    expect(out.get('B')).toEqual({ x: 200, y: 94 });
    expect(out.get('C')).toEqual({ x: 200, y: 194 });
  });

  it('keeps the group rigid when two members disagree', () => {
    // Two beams, two snaps, one group: only one offset can win, and the geometry has to
    // survive. First in node order decides, which is stable across renders.
    const snaps = new Map([
      ['B', { x: 200, y: 94 }],
      ['C', { x: 200, y: 210 }],
    ]);
    const out = rigidGroupSnaps(bench(), snaps);
    const dx = out.get('A')!.x - 100;
    const dy = out.get('A')!.y - 100;
    for (const [id, base] of [['B', { x: 200, y: 100 }], ['C', { x: 200, y: 200 }]] as const) {
      expect(out.get(id)).toEqual({ x: base.x + dx, y: base.y + dy });
    }
  });

  it('anchors a group that contains a fixed component', () => {
    const nodes = [
      node('A', 100, 100, { groupId: 'g1' }),
      node('B', 200, 100, { groupId: 'g1', locked: true }),
    ];
    const out = rigidGroupSnaps(nodes, new Map([['A', { x: 100, y: 80 }]]));
    expect(out.has('A')).toBe(false);
    expect(out.has('B')).toBe(false);
  });

  it('leaves ungrouped snaps exactly as they were', () => {
    const snaps = new Map([['X', { x: 500, y: 480 }]]);
    expect(rigidGroupSnaps(bench(), snaps)).toEqual(snaps);
  });

  it('does nothing when the group was not snapped at all', () => {
    const snaps = new Map([['X', { x: 500, y: 480 }]]);
    const out = rigidGroupSnaps(bench(), snaps);
    expect([...out.keys()]).toEqual(['X']);
  });

  it('returns the same map when there is nothing to snap', () => {
    const empty = new Map<string, { x: number; y: number }>();
    expect(rigidGroupSnaps(bench(), empty)).toBe(empty);
  });

  it('is idempotent — snapping an already-snapped group changes nothing', () => {
    const once = rigidGroupSnaps(bench(), new Map([['B', { x: 200, y: 94 }]]));
    const moved = bench().map(n => ({ ...n, position: once.get(n.id) ?? n.position }));
    const twice = rigidGroupSnaps(moved, new Map([['B', { x: 200, y: 94 }]]));
    expect(twice.get('A')).toEqual(once.get('A'));
    expect(twice.get('C')).toEqual(once.get('C'));
  });
});

// ── The outline ───────────────────────────────────────────────────────────────

describe('groupBounds', () => {
  it('spans every member', () => {
    const g = getNodeGeometry('dielectric_mirror', 0);
    const box = groupBounds(bench(), 'g1')!;
    expect(box.x).toBe(100);
    expect(box.y).toBe(100);
    expect(box.width).toBe(100 + g.width);
    expect(box.height).toBe(100 + g.height);
  });

  it('is null for a group with no members left', () => {
    expect(groupBounds(bench(), 'gone')).toBeNull();
  });

  it('honours a per-instance size, so a region in a group is measured properly', () => {
    const nodes = [
      node('A', 0, 0, { groupId: 'g1' }),
      {
        id: 'R', type: 'region', position: { x: 0, y: 0 },
        data: { type: 'region', name: 'R', category: 'utility', w: 400, h: 300,
          shape: 'rect', colour: '#3b82f6', fillOpacity: 0.08, groupId: 'g1' } as unknown as OpticalNodeData,
      } as Node<OpticalNodeData>,
    ];
    expect(groupBounds(nodes, 'g1')!.width).toBe(400);
  });
});

describe('selectedGroupIds', () => {
  it('lists each group with a selected member, once', () => {
    const nodes = bench().map(n => (n.id === 'B' || n.id === 'C' ? { ...n, selected: true } : n));
    expect(selectedGroupIds(nodes)).toEqual(['g1']);
  });

  it('is empty when nothing in a group is selected', () => {
    const nodes = bench().map(n => (n.id === 'X' ? { ...n, selected: true } : n));
    expect(selectedGroupIds(nodes)).toEqual([]);
  });
});

// ── Saving ────────────────────────────────────────────────────────────────────

describe('groups in the layout file', () => {
  it('round-trip, with no format bump', () => {
    const back = layoutFromJSON(layoutToJSON(bench(), []));
    expect(back.nodes.filter(n => groupIdOf(n) === 'g1')).toHaveLength(3);
    expect(groupIdOf(back.nodes.find(n => n.id === 'X')!)).toBeNull();
  });
});
