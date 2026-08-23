// Physics-based beam auto-routing engine.
//
// Traces beam rays from laser sources, auto-connects components near the beam,
// handles mirror reflection (90° turns), splitters, and beam terminators.
//
// This is the *only* place beam geometry is computed.  It emits `BeamSegment[]`
// (canvas coordinates + resolved physics) which every view renders directly, and
// it delegates all physics to `componentOutputs` in propagate.ts.  Views must not
// re-derive either.
import type { Node, Edge } from '@xyflow/react';
import type { OpticalNodeData, BeamEdgeData } from '../types/components';
import type { BeamSegment, BeamState } from '../types/beam';
import { getNodeGeometry, artworkOf, bodyBox, SURFACE_AT_45 } from '../utils/nodeGeometry';
import { advanceBeam, componentOutputs, emitterBeam, isEmitter, outputPortFor, MIN_POWER_MW, type PortKind } from './propagate';
import { mirrorReflect, perpOf, dirKey, rotateBy, boxHalfExtent, angleOf, snapAngle, type Vec2, type Pt } from './geometry';
import { mmToPx, pxToMm } from './scale';
import { drawnEndpoints, fanCollinearSegments } from './beamLayout';
import { bodyAxis, componentLanes, laneNormal } from './lanes';
import { placeLabels } from './labelPlacement';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Max perpendicular distance (px) to auto-snap a component onto a beam.
 *  10 px — component center must be very close to the beam axis to snap. */
export const BEAM_SNAP_DIST = 10;

/** Minimum forward distance (px) for a component to count as "in front of" a ray. */
const MIN_FORWARD = 8;

/** How far (px) a beam that hits nothing is drawn past its origin. */
const FAR = 4000;

// NOTE: there is deliberately no visual-offset constant here. Rays carry their true
// positions; beams that end up sharing a line are separated for drawing only, by
// fanCollinearSegments in beamLayout.ts.

/** Max ray-trace steps before bailing out, to bound pathological layouts. */
const MAX_TRACE_STEPS = 300;

/**
 * Max components a single ray may pass through. Loops are already caught exactly, so
 * this only bounds a resonator whose mirrors are good enough to keep it above the
 * power floor for a very long time — and it is far beyond any real component chain.
 */
const MAX_RAY_HITS = 64;

/**
 * Components that keep their user-set rotation — never auto-rotated to face the beam.
 * Exactly the ones whose optical surface lies at 45° across the body: you point a mirror,
 * it does not point itself.
 */
const MIRROR_TYPES = SURFACE_AT_45;

/**
 * Component types where the beam should be drawn through the body (center-to-center),
 * because they are optically transparent or the beam meets the active surface at
 * the node center (e.g. mirror/galvo reflective surface passes through center).
 * All other symbol nodes trim the edge to their entry/exit face so the beam is
 * only drawn in the gap between components, not inside the body.
 */
const BEAM_THROUGH_TYPES = new Set([
  'npbs', 'pbs', 'dichroic_mirror',   // beamsplitters — split/reflect, beam visible
  'plano_convex', 'plano_concave',     // lenses — physically transparent
  'vapor_cell',                        // glass cell — beam runs the length of the tube
  'dielectric_mirror', 'galvo',        // reflective surface is the diagonal at center
]);

/**
 * Emitters, which are "through" in one direction only.
 *
 * A ray *leaving* one already starts on its output face (`emitterOrigin`), so trimming
 * the departure again would leave the beam floating clear of the body. A beam *arriving*
 * is a different matter — optical feedback enters through that same face — so it is
 * trimmed like any other body. Lumping both directions together drew a returning beam
 * 45 px inside the laser's case and reported a path 45 px too long, which a diagonal
 * double pass makes obvious: the return leg measured longer than the outbound one.
 */
const EMITTER_FACE_TYPES = new Set(['laser_source', 'fiber_launcher', 'fiber_amplifier']);

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Where a ray has already been, as a linked list so extending a path costs one
 * allocation and branching at a splitter shares the tail.
 */
interface PathNode {
  /** `nodeId|direction|lane` — one traversal of one component. */
  key: string;
  prev: PathNode | null;
}

function pathHas(path: PathNode | null, key: string): boolean {
  for (let n = path; n; n = n.prev) if (n.key === key) return true;
  return false;
}

interface Ray {
  id:           number;  // unique per ray, used for trace bookkeeping
  sourceId:     string;
  sourceHandle: string;
  /** The beam's true position — not a nominal axis with a separate offset. */
  origin:       Pt;
  dir:          Vec2;   // normalised unit vector
  beam:         BeamState;
  /** Components this ray has already traversed, for exact loop detection. */
  path:         PathNode | null;
  /** How many components this ray has passed through. */
  hits:         number;
}

export interface RouteResult {
  /** Auto-generated beam edges (id prefix: 'auto_') */
  autoEdges: Edge<BeamEdgeData>[];
  /** Every drawn beam stretch, for any view to render. Single source of geometry. */
  segments: BeamSegment[];
  /** edge id → beam travelling along it (covers auto-routed and user-wired edges) */
  beams: Map<string, BeamState>;
  /** node id → beam arriving at that node (strongest, when several arrive) */
  nodeBeams: Map<string, BeamState>;
  /**
   * node id → *every* beam arriving at that node, in trace order. A detector needs the
   * lot (its reading is their total), whereas an optic is resolved from the strongest
   * arrival in `nodeBeams` — two beams on one mirror are two beams, not one.
   */
  nodeArrivals: Map<string, BeamState[]>;
  /** Node-id → new {x, y} for positions that need to be snapped to the beam */
  snaps: Map<string, Pt>;
  /** Node-id → auto-computed rotation for symbol nodes: the lattice angle of the beam */
  rotations: Map<string, number>;
  /** Node-id → direction of beam entering that node (used for handle placement) */
  beamInDirs: Map<string, Vec2>;
  /**
   * Node-id → which way its label should sit from its centre, chosen to keep clear of the
   * beams. Only for nodes that show one. Both views read this, so the canvas and the
   * exported figure place labels identically.
   */
  labelSides: Map<string, Vec2>;
  /** Invisible phantom endpoint nodes for beams with no component in their path */
  phantomNodes: Node[];
  /** True when the trace hit a step or hit limit and some beams were dropped. */
  truncated: boolean;
  /** Physical problems worth telling the user about, per component. */
  warnings: RouteWarning[];
}

export interface RouteWarning {
  nodeId: string;
  message: string;
}

/**
 * The nodes as this trace has just decided them — snapped position, chosen rotation.
 *
 * Label placement has to see the component where it will actually be drawn: a cell that
 * turned to face the beam has a different label side than it did a moment ago, and using
 * the stale data would place every label one trace behind.
 */
function labelNodes(
  nodes: Node<OpticalNodeData>[],
  result: Pick<RouteResult, 'snaps' | 'rotations' | 'beamInDirs'>,
): Node<OpticalNodeData>[] {
  return nodes.map(node => {
    const snap = result.snaps.get(node.id);
    const rotation = result.rotations.get(node.id) ?? node.data.rotation ?? 0;
    const beamIncomingDir = result.beamInDirs.get(node.id) ?? (node.data as { beamIncomingDir?: Vec2 }).beamIncomingDir;
    return {
      ...node,
      position: snap ?? node.position,
      data: { ...node.data, rotation, beamIncomingDir },
    };
  });
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function nodeCenter(node: Node<OpticalNodeData>): Pt {
  const g = getNodeGeometry(node.data.type, node.data.rotation ?? 0);
  return { x: node.position.x + g.width / 2, y: node.position.y + g.height / 2 };
}

/**
 * Point on an emitter's output face, for any rotation.
 *
 * Centre of the node's box, plus half the artwork's *own* length along the body axis.
 * Two separate boxes on purpose: `g` is the space the node occupies on the canvas (a
 * 90°-turned laser is 66×90, not 90×66) and gives the centre; `artwork` is the shape
 * before it is turned, and its width is the distance from centre to output face measured
 * along the axis the emitter points down — true at any angle, since that axis is the
 * artwork's own.
 *
 * Reproduces the four-case switch it replaces exactly. Using the *unrotated* box for the
 * centre used to put the emission point 12 px off a vertical laser's axis — more than
 * BEAM_SNAP_DIST, so its beam sailed past components properly lined up with it.
 */
function emitterOrigin(node: Node<OpticalNodeData>, rotation: number): Pt {
  const g       = getNodeGeometry(node.data.type, rotation);
  const artwork = artworkOf(node.data.type);
  const axis    = bodyAxis(rotation);
  const reach   = artwork.width / 2;
  return {
    x: node.position.x + g.width / 2  + axis.dx * reach,
    y: node.position.y + g.height / 2 + axis.dy * reach,
  };
}

/**
 * Half-extent from a node's centre to the surface where the beam meets it, measured
 * along the beam — exact at any angle.
 *
 * The beam direction is taken into the component's own frame and intersected with its
 * body box, so which face the beam meets falls out of the maths instead of being decided
 * by `isHorizontal`. For an axis-aligned beam on an axis-aligned component this returns
 * exactly what the old two-case version did; the difference only shows up off-axis, and
 * off-axis the old answer was wrong (a 45° beam was trimmed by the full half-width,
 * ending well inside the artwork).
 */
export function faceHalf(type: OpticalNodeData['type'], rotation: number, dir: Vec2): number {
  const body  = bodyBox(type);
  const local = rotateBy(dir, -rotation);
  return boxHalfExtent(body.halfAlong, body.halfCross, local);
}

/**
 * Distance to trim a beam endpoint at `node`, or 0 if the beam is drawn through it.
 *
 * `rotation` must be the angle this trace has *decided* for the node, not the angle
 * still sitting in its data: a component auto-rotated to face the beam is trimmed by its
 * axial figure, and using the stale rotation trims it as though the beam were crossing
 * it. Invisible while everything was axis-aligned (turning a symbol 90° swapped its box
 * and the beam direction together, so the old two-case rule gave the same answer either
 * way); at 45° it showed up as a waveplate trimmed 8.49 px instead of 6.
 */
function trimFor(
  node: Node<OpticalNodeData> | undefined,
  dir: Vec2,
  rotation: number,
  side: 'source' | 'target',
): number {
  if (!node || BEAM_THROUGH_TYPES.has(node.data.type)) return 0;
  if (side === 'source' && EMITTER_FACE_TYPES.has(node.data.type)) return 0;
  return faceHalf(node.data.type, rotation, dir);
}

/**
 * Where the beam comes to a focus along a drawn segment, if it does so inside it.
 *
 * `beam` is the state at (x1, y1). Returns undefined unless the waist falls
 * strictly inside the segment — a waist sitting at the very start is just the
 * upstream component's own output plane, which isn't worth marking.
 */
function waistMarker(
  beam: BeamState,
  x1: number, y1: number, x2: number, y2: number,
): BeamSegment['waist'] {
  if (!beam.q || beam.waistDistance === undefined || beam.w0 === undefined) return undefined;
  const lenPx = Math.hypot(x2 - x1, y2 - y1);
  if (lenPx < 1) return undefined;
  const t = mmToPx(beam.waistDistance) / lenPx;
  if (t <= 0.01 || t >= 0.99) return undefined;
  return {
    x: x1 + (x2 - x1) * t,
    y: y1 + (y2 - y1) * t,
    radius: beam.w0,
  };
}

/** Which way a beam leaves a component, for each kind of port. */
function portDirection(kind: PortKind, incoming: Vec2, rotation: number): Vec2 {
  switch (kind) {
    case 'reflect': return mirrorReflect(incoming, rotation);
    case 'retro':   return { dx: -incoming.dx, dy: -incoming.dy };
    default:        return incoming;
  }
}

/** Reserve a unique id derived from `base`, appending a counter on collision. */
function uniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) { used.add(base); return base; }
  let n = 2;
  while (used.has(`${base}#${n}`)) n++;
  const id = `${base}#${n}`;
  used.add(id);
  return id;
}

// ── Main routing function ─────────────────────────────────────────────────────

/**
 * Given the current node/edge layout, computes beam segments, per-edge and
 * per-node beam states, auto-edges connecting components that lie on a beam
 * path, and snap positions to centre those components on the beam.
 *
 * Pure function — no React, no store, no DOM. Safe to call from anywhere.
 *
 * @param nodes     All nodes on the canvas (including lasers, excluding phantoms).
 * @param userEdges Edges drawn manually by the user (no 'auto_' prefix).
 */
export function autoRoute(
  nodes: Node<OpticalNodeData>[],
  userEdges: Edge[],
): RouteResult {
  const result: RouteResult = {
    autoEdges: [], segments: [], beams: new Map(), nodeBeams: new Map(),
    nodeArrivals: new Map(),
    snaps: new Map(), rotations: new Map(), beamInDirs: new Map(), labelSides: new Map(),
    phantomNodes: [], truncated: false, warnings: [],
  };

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Nodes already connected by user edges — skip auto-routing for them.
  const userTargets = new Set(userEdges.map(e => e.target));

  // First beam to reach each component. Positioning, auto-rotation and handle
  // placement all follow the first arrival, so later beams must find the component
  // where it already is.
  const firstTouch = new Map<string, { dir: Vec2; lane: number }>();

  /** Lasers already warned about optical feedback, so we report each one once. */
  const warnedFeedback = new Set<string>();

  const usedSegmentIds = new Set<string>();
  const usedPhantomIds = new Set<string>();

  /**
   * Record the beam arriving at a node: appended to that node's arrivals, and promoted to
   * `nodeBeams` if it is the strongest so far. Both are needed — a detector adds up
   * everything that lands on it, while an optic acts on one beam at a time.
   */
  const recordNodeBeam = (nodeId: string, beam: BeamState) => {
    const arrivals = result.nodeArrivals.get(nodeId);
    if (arrivals) arrivals.push(beam);
    else result.nodeArrivals.set(nodeId, [beam]);

    const prev = result.nodeBeams.get(nodeId);
    if (!prev || beam.power > prev.power) result.nodeBeams.set(nodeId, beam);
  };

  /**
   * The rotation this trace has settled on for a node — what the router just decided,
   * falling back to what is stored. Face trimming has to use this, or the first frame
   * after a component turns is drawn with the previous angle's geometry.
   */
  const tracedRotation = (node: Node<OpticalNodeData> | undefined): number =>
    node ? (result.rotations.get(node.id) ?? node.data.rotation ?? 0) : 0;

  /** Emit a segment and register its beam. */
  const emit = (seg: BeamSegment) => {
    result.segments.push(seg);
    result.beams.set(seg.id, seg.beam);
    return seg;
  };

  /** Unique ray counter — bookkeeping only; ids are not used in output. */
  let raySeq = 0;

  // ── Seed rays from every emitter ───────────────────────────────────────────
  // Lasers and fibre launchers both launch a beam into free space along the way they
  // face; a launcher states its own output rather than carrying it down a fibre.
  const rays: Ray[] = [];
  for (const n of nodes) {
    const beam = emitterBeam(n.data);
    if (!beam) continue;
    const rot = n.data.rotation ?? 0;
    const dir = bodyAxis(rot);
    rays.push({
      id:           ++raySeq,
      sourceId:     n.id,
      sourceHandle: 'out',
      origin:       emitterOrigin(n, rot),
      dir,
      beam,
      path:         null,
      hits:         0,
    });
    // An emitter is its own first touch, so a beam arriving later can't re-aim it.
    firstTouch.set(n.id, { dir, lane: 0 });
    recordNodeBeam(n.id, beam);
  }

  // ── Trace rays ────────────────────────────────────────────────────────────
  let steps = 0;
  while (rays.length > 0) {
    if (steps++ >= MAX_TRACE_STEPS) { result.truncated = true; break; }
    const ray = rays.shift()!;
    const srcNode = nodeById.get(ray.sourceId);

    // Find the closest node along this ray within BEAM_SNAP_DIST of one of its lanes.
    let best: Node<OpticalNodeData> | null = null;
    let bestAlong = Infinity;
    let bestLane = 0;

    for (const node of nodes) {
      // No per-node entry caps: a component may be reached by any number of beams
      // from any direction, and componentOutputs decides what each one does.
      // Runaway loops are caught exactly, after the hit, by the ray's own path.
      if (userTargets.has(node.id)) continue; // respect manual wiring

      const center = nodeCenter(node);
      const rel    = { dx: center.x - ray.origin.x, dy: center.y - ray.origin.y };

      // Signed distance along the ray
      const along = rel.dx * ray.dir.dx + rel.dy * ray.dir.dy;
      if (along < MIN_FORWARD) continue; // must be in front of origin

      // Signed displacement of the node centre from the ray line, measured along the
      // ray's own perpendicular. Lane L of the node sits at `centre + n·L`, so the
      // ray meets that lane when `s + L·(n·perp) == 0`.
      const rayPerp = perpOf(ray.dir);
      const s = rel.dx * rayPerp.dx + rel.dy * rayPerp.dy;
      const lanes = componentLanes(node.data);
      const n = laneNormal(node.data.rotation ?? 0);
      const k = n.dx * rayPerp.dx + n.dy * rayPerp.dy;

      // With the beam crossing the body axis, every lane projects to the same place,
      // so the extra axes are meaningless — fall back to the centre.
      const testable = Math.abs(k) > 0.5 ? lanes : [0];

      let lane = 0;
      let laneErr = Infinity;
      testable.forEach((L, i) => {
        const err = Math.abs(s + L * k);
        if (err < laneErr) { laneErr = err; lane = i; }
      });
      if (laneErr > BEAM_SNAP_DIST) continue;

      if (along < bestAlong) { best = node; bestAlong = along; bestLane = lane; }
    }

    const srcTrim = trimFor(srcNode, ray.dir, tracedRotation(srcNode), 'source');

    // ── Nothing in the path: draw a free beam to an off-canvas endpoint ──────
    if (!best) {
      const x1 = ray.origin.x + ray.dir.dx * srcTrim;
      const y1 = ray.origin.y + ray.dir.dy * srcTrim;
      const x2 = x1 + FAR * ray.dir.dx;
      const y2 = y1 + FAR * ray.dir.dy;

      // Stable id: same source handle travelling the same way keeps the same
      // phantom across route passes, so xyflow doesn't remount the endpoint.
      const phantomId = uniqueId(
        `phantom_${ray.sourceId}_${ray.sourceHandle}_${dirKey(ray.dir)}`,
        usedPhantomIds,
      );
      result.phantomNodes.push({
        id: phantomId,
        type: 'beam_endpoint',
        position: { x: x2, y: y2 },
        data: {},
        width: 1,
        height: 1,
        handles: [{ id: 'in', type: 'target', position: 'left' as const, x: 0, y: 0, width: 1, height: 1 }],
        selectable: false,
        draggable: false,
        focusable: false,
        connectable: false,
      } as unknown as Node);

      // The beam state applies at the segment start, which is srcTrim downstream
      // of the ray origin.
      const startBeam = advanceBeam(ray.beam, pxToMm(srcTrim));
      emit({
        id: uniqueId(`auto_${ray.sourceId}_${ray.sourceHandle}_${dirKey(ray.dir)}_free`, usedSegmentIds),
        sourceId: ray.sourceId,
        sourceHandle: ray.sourceHandle,
        targetId: phantomId,
        x1, y1, x2, y2,
        beam: startBeam,
        lengthMm: pxToMm(FAR),
        free: true,
        wired: false,
        waist: waistMarker(startBeam, x1, y1, x2, y2),
      });
      continue;
    }

    // ── Loop detection ──────────────────────────────────────────────────────
    // A beam that re-enters the same component, travelling the same way, on the
    // same lane, has closed a loop: it is a resonator going round again. Draw the
    // closing segment so the loop is visible, then stop this ray. This is exact,
    // unlike the old direction caps, so counter-propagation is free.
    const visitKey = `${best.id}|${dirKey(ray.dir)}|${bestLane}`;
    const closesLoop = pathHas(ray.path, visitKey);

    // isSecondEntry: has any beam reached this component before? Drives positioning,
    // rotation and handle placement — first arrival wins — and is deliberately global,
    // not per-ray.
    const isSecondEntry = firstTouch.has(best.id);
    if (!isSecondEntry) firstTouch.set(best.id, { dir: ray.dir, lane: bestLane });

    // A beam arriving at an emitter is optical feedback — into the diode, or back down
    // the fibre — and worth saying so. Only for a beam carrying real power: an ideal PBS
    // leaves a 0 mW port on the wrong polarisation, which nobody needs warning about.
    if (isEmitter(best.data.type) && ray.beam.power >= MIN_POWER_MW && !warnedFeedback.has(best.id)) {
      warnedFeedback.add(best.id);
      result.warnings.push({
        nodeId: best.id,
        message: best.data.type === 'fiber_launcher'
          ? 'A beam is entering this launcher and coupling back down the fibre. Add an isolator if that reaches a diode.'
          : best.data.type === 'fiber_amplifier'
            ? 'A beam is entering this amplifier backwards. Feedback into a gain medium is how amplifiers die — add an isolator.'
            : 'A beam is entering this laser. Real feedback into the diode is damaging — add an isolator.',
      });
    }

    // Free-space propagation from the ray origin to this component's plane.
    // `bestAlong` is the centre-to-centre distance, which is the physical path
    // length regardless of how the drawn segment is trimmed for display.
    const beamAtNode = advanceBeam(ray.beam, pxToMm(bestAlong));
    recordNodeBeam(best.id, beamAtNode);

    // Record the beam's incoming direction for handle placement (first entry wins).
    if (!isSecondEntry) result.beamInDirs.set(best.id, ray.dir);

    // Rotation: everything that lies *along* a beam turns to face it, at whatever lattice
    // angle it arrives on — a beam at 45° gets a component at 45°, not one squared up to
    // the nearest axis. Instrument nodes (an AOM, an EOM, a camera) are included: they are
    // inline devices like any other, and since their artwork turns too they now face the
    // beam properly instead of sitting square while the physics treated them as turned.
    //
    // Two exceptions. Mirror-like components are *pointed*, not aligned — their surface
    // sits at 45° across the body, so the user chooses where it sends the beam. And a
    // second beam never re-aims a component the first one already placed.
    //
    // A component whose lanes encode a physical *side* — an acousto-optic cell, whose 0th
    // order peels off towards its transducer — aligns to the beam's **axis** rather than
    // its direction. Turning such a cell to face a beam running backwards through it would
    // flip which side the dumped order leaves by, and a lane is a place on the device: that
    // invariance is what lets a double-passed cell retrace its own path.
    const beamAngle = snapAngle(angleOf(ray.dir));
    const sidedLanes = componentLanes(best.data).length > 1;
    const autoRot = (isSecondEntry || MIRROR_TYPES.has(best.data.type))
      ? (best.data.rotation ?? 0)
      : (sidedLanes ? beamAngle % 180 : beamAngle);

    if (!isSecondEntry) result.rotations.set(best.id, autoRot);

    const effGeom = getNodeGeometry(best.data.type, autoRot);
    const effW = effGeom.width;
    const effH = effGeom.height;
    /**
     * Where this beam meets the component. `ray.origin` is the beam's true
     * position, so this is the true hit point — no offset bookkeeping.
     */
    const hit = { x: ray.origin.x + bestAlong * ray.dir.dx, y: ray.origin.y + bestAlong * ray.dir.dy };

    // Lane geometry. The beam arrived on lane `bestLane`, whose axis is offset from
    // the component centre by `laneNormal · L`, so the centre that puts that lane on
    // this beam is `hit − laneNormal · L`. For every single-lane component L is 0 and
    // this is just `hit`.
    const lanes = componentLanes(best.data);
    /**
     * Measured along the rotation this trace just *decided*, not the one still in the
     * node's data — an acousto-optic cell that has turned to face the beam must put its
     * 0th order on the new normal, or the dumped order leaves along the beam axis instead
     * of beside it.
     *
     * Safe against the hit test having used the stored rotation: the two can only differ
     * when the beam runs across the old body axis, and in that case every lane projects to
     * the same place, so the hit test falls back to lane 0 and `entryOffset` is 0.
     */
    const laneN = laneNormal(autoRot);
    const entryOffset = lanes[bestLane] ?? 0;
    const laneCentre = {
      x: hit.x - laneN.dx * entryOffset,
      y: hit.y - laneN.dy * entryOffset,
    };

    // Centre the component on the beam. Only the first beam to arrive positions a
    // component; later beams have to find it where it already is.
    if (!isSecondEntry) {
      const rotSnap = { x: laneCentre.x - effW / 2, y: laneCentre.y - effH / 2 };
      const cur = best.position;
      if (Math.abs(rotSnap.x - cur.x) > 1 || Math.abs(rotSnap.y - cur.y) > 1) {
        result.snaps.set(best.id, rotSnap);
      }
    }

    // ── Segment endpoints ───────────────────────────────────────────────────
    // Face-trimming: for non-beam-through nodes, pull the endpoint back from the
    // component centre to its physical surface, so the beam is only drawn in the
    // gap between components.
    const tgtTrim = trimFor(best, ray.dir, autoRot, 'target');
    const x1 = ray.origin.x + ray.dir.dx * srcTrim;
    const y1 = ray.origin.y + ray.dir.dy * srcTrim;
    const x2 = hit.x - ray.dir.dx * tgtTrim;
    const y2 = hit.y - ray.dir.dy * tgtTrim;

    const startBeam = advanceBeam(ray.beam, pxToMm(srcTrim));
    emit({
      id: uniqueId(`auto_${ray.sourceId}_${ray.sourceHandle}_to_${best.id}`, usedSegmentIds),
      sourceId: ray.sourceId,
      sourceHandle: ray.sourceHandle,
      targetId: best.id,
      x1, y1, x2, y2,
      beam: startBeam,
      lengthMm: pxToMm(Math.hypot(x2 - x1, y2 - y1)),
      free: false,
      wired: false,
      waist: waistMarker(startBeam, x1, y1, x2, y2),
    });

    // ── Continue tracing ────────────────────────────────────────────────────
    // Sub-µW beams are drawn (segment already emitted) but don't propagate further.
    if (ray.beam.power < MIN_POWER_MW) continue;
    // The loop-closing segment is drawn, but the beam is not followed round again.
    if (closesLoop) continue;
    // Bound a single ray's journey, so a high-finesse resonator can't consume the
    // whole trace budget. Far longer than any real component chain.
    if (ray.hits >= MAX_RAY_HITS) { result.truncated = true; continue; }

    const path: PathNode = { key: visitKey, prev: ray.path };
    for (const port of componentOutputs(beamAtNode, best.data, { entryLane: bestLane, entryDir: ray.dir })) {
      // A dumped port is absorbed inside the component — its power is reported by
      // componentOutputs (so the properties panel can show it) but no beam leaves.
      if (port.dumped) continue;
      // Nor does an extinguished one. An ideal PBS fed pure H puts nothing in its V
      // port, and drawing that as a beam clutters the figure with a line carrying no
      // light — most visibly in a double-pass, where it would streak off the PBS.
      if (port.beam.power < MIN_POWER_MW) continue;
      // Each output leaves from its own lane on the component. For a single-lane
      // component that is exactly the point where the beam met it. Beams that end up
      // sharing a line are separated at draw time by fanCollinearSegments.
      const exitOffset = lanes[port.lane ?? bestLane] ?? 0;
      rays.push({
        id:           ++raySeq,
        sourceId:     best.id,
        sourceHandle: port.handle,
        origin: {
          x: laneCentre.x + laneN.dx * exitOffset,
          y: laneCentre.y + laneN.dy * exitOffset,
        },
        dir:          portDirection(port.kind, ray.dir, best.data.rotation ?? 0),
        beam:         port.beam,
        path,
        hits:         ray.hits + 1,
      });
    }
  }

  // ── Resolve explicit user wiring with the same physics ────────────────────
  resolveUserWires(nodeById, userEdges, result, recordNodeBeam, emit);

  // ── Separate beams that share a line, for drawing only ────────────────────
  fanCollinearSegments(result.segments);

  // ── Choose which side each label sits on, now that the beams are known ─────
  // After fanning, so a label measures against the beams as they will be drawn.
  result.labelSides = placeLabels(labelNodes(nodes, result), result.segments);

  // ── Derive xyflow edges from the segments ─────────────────────────────────
  for (const seg of result.segments) {
    if (seg.wired) continue; // the user's own edge already exists
    // Edges are a pure display artefact, so they carry the drawn coordinates.
    const { x1, y1, x2, y2 } = drawnEndpoints(seg);
    result.autoEdges.push({
      id:           seg.id,
      source:       seg.sourceId,
      sourceHandle: seg.sourceHandle,
      target:       seg.targetId,
      targetHandle: 'in',
      type:         'beam',
      data: {
        wavelength:   seg.beam.wavelength,
        power:        seg.beam.power,
        polarization: seg.beam.polarization.type,
        sx: x1, sy: y1, tx: x2, ty: y2,
      } as BeamEdgeData,
    });
  }

  return result;
}

/**
 * Walk user-drawn edges, resolving each one's beam with the same
 * `componentOutputs` physics the ray tracer uses.  Repeats until no further edge
 * can be resolved, so manual chains of any length work.
 */
function resolveUserWires(
  nodeById: Map<string, Node<OpticalNodeData>>,
  userEdges: Edge[],
  result: RouteResult,
  recordNodeBeam: (nodeId: string, beam: BeamState) => void,
  emit: (seg: BeamSegment) => BeamSegment,
): void {
  const pending = userEdges.filter(e => nodeById.has(e.source) && nodeById.has(e.target));
  const done = new Set<string>();

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const edge of pending) {
      if (done.has(edge.id)) continue;
      const source = nodeById.get(edge.source)!;
      const target = nodeById.get(edge.target)!;

      // What beam is available at the source's output?
      let outBeam: BeamState | undefined;
      const emitted = emitterBeam(source.data);
      if (emitted) {
        outBeam = emitted;
      } else {
        const inBeam = result.nodeBeams.get(source.id);
        if (!inBeam) continue; // upstream not resolved yet — try again next round
        outBeam = outputPortFor(inBeam, source.data, edge.sourceHandle)?.beam;
      }
      done.add(edge.id);
      progressed = true;
      if (!outBeam) continue; // e.g. a wire dragged off a detector

      const a = nodeCenter(source);
      const b = nodeCenter(target);
      const lengthMm = pxToMm(Math.hypot(b.x - a.x, b.y - a.y));

      result.beams.set(edge.id, outBeam);
      // The beam at the far end has travelled the length of the wire.
      recordNodeBeam(target.id, advanceBeam(outBeam, lengthMm));

      emit({
        id: edge.id,
        sourceId: edge.source,
        sourceHandle: edge.sourceHandle ?? 'out',
        targetId: edge.target,
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        beam: outBeam,
        lengthMm,
        free: false,
        wired: true,
        waist: waistMarker(outBeam, a.x, a.y, b.x, b.y),
      });
    }
  }
}
