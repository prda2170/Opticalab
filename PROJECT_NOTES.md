# OpticaLab — Project Notes

Working reference for this codebase: what it is, how it fits together, what's been
changed, and what's still open. Kept up to date as work proceeds.

Last updated: 2026-08-15

---

## 1. What it is

Desktop/web app for designing free-space optical layouts (cold-atom / AMO lab
benches). You drag components onto a canvas, and beams are traced automatically
from laser sources through mirrors, splitters, waveplates, AOMs, crystals and
detectors. Two views:

- **Editor tab** — interactive React Flow canvas (drag, snap, edit properties).
- **Diagram tab** — read-only SVG render intended for figures/publication.

### Stack

| Piece | Choice |
|---|---|
| UI | React 18 + TypeScript, Vite 8 |
| Canvas | `@xyflow/react` v12 (React Flow) |
| State | Zustand v5 (`src/store/layoutStore.ts`) |
| Styling | Tailwind v4 (via `@tailwindcss/vite`) + inline styles |
| Desktop shell | Electron 41 (`electron/main.cjs`), electron-builder |
| Tests | Vitest (added 2026-08-15) |

### Commands

```bash
npm run dev            # vite dev server on :5173
npm run build          # tsc -b && vite build
npm run lint           # eslint
npm test               # vitest run
npm run electron:dev   # vite + electron together
```

There is **no git repository** in this tree — edits are not recoverable via VCS.
Avoid deleting files; prefer repurposing them.

---

## 2. Architecture

```
palette (utils/palette.ts)
   │  drag & drop
   ▼
EditorCanvas ──── xyflow local state (nodes, edges)
   │                    │
   │  autoRoute(nodes, userEdges)        ← THE engine (src/physics/autoRoute.ts)
   │      ├── snaps / rotations / beamInDirs  → written back into xyflow nodes
   │      ├── phantomNodes                    → invisible endpoints for free beams
   │      ├── autoEdges (id prefix `auto_`)   → xyflow edges, coords baked in data
   │      ├── segments: BeamSegment[]         → geometry + physics, view-agnostic
   │      ├── beams:     Map<edgeId, BeamState>
   │      ├── nodeBeams: Map<nodeId, BeamState>  (strongest beam *entering* that node)
   │      └── nodeArrivals: Map<nodeId, BeamState[]>  (every beam entering it)
   │
   ├── syncFromCanvas() ──▶ layoutStore ──▶ BeamEdge / PropertiesPanel / DiagramPanel
```

### Key invariants

- **Auto edges** have ids starting with `auto_`; everything else is a user-drawn
  edge. Only user edges are persisted to the store / saved to JSON. Auto edges are
  recomputed from scratch on every route pass and cannot be deleted by the user
  (filtered in `EditorCanvas.onEdgesChange`).
- **Phantom nodes** (`type: 'beam_endpoint'`) exist only because xyflow requires
  every edge to have a target. They are 1×1, non-interactive, excluded from the
  store, and re-derived each pass. IDs are stable per (source, handle, direction).
- **Beam coordinates are baked into edge data** (`sx, sy, tx, ty`) by the router
  rather than measured from xyflow handles — this avoids sub-pixel misalignment
  and guarantees axis-aligned beams.
- **Angles live on a lattice: 15° for beams and bodies, 7.5° for mirror surfaces**
  (`DIR_STEP_DEG`, `MIRROR_STEP_DEG`; `angleStepFor(type)` picks per component).
  Reflection doubles the surface angle, which is why mirrors get the finer grain — a 15°
  mirror lattice would confine beams to 30° multiples. A mirror's surface is 45° behind
  its body angle (`mirrorSurfaceDeg`), so rotation 0 is still `/` and 90 is `\`.
- **Three different boxes, and confusing them is the source of every rotation bug
  this project has had** (`utils/nodeGeometry.ts`):
  - `artworkOf(type)` — the component's own frame, unrotated; width along its
    optical axis. Sizes the icon, and gives an emitter its reach.
  - `getNodeGeometry(type, rotation)` — the axis-aligned box the node *occupies*,
    which is what xyflow lays out and what every `position = centre − size/2`
    needs. The bounding box of the turned artwork, for every component — an exact
    w/h swap at 90/270, and a genuine AABB in between.
  - `bodyBox(type)` — the *optical* extent a beam is trimmed to. `beamFaceHalf`
    narrows the axial half-extent only; the cross extent is the artwork's.
  Every component's artwork is drawn unrotated at its own size and then turned, centred
  in the occupied box — symbols, instruments and mirrors alike.
- **Layout files are versioned, and the version is enforced on load** (`LAYOUT_VERSION`,
  `MIGRATIONS` in `utils/export.ts`). A schema change means a minor bump plus a migration
  entry; anything a load has to change or drop comes back in `notes` and is shown to the
  user. A newer *major* version is refused rather than guessed at.
- **The 1 inch hole grid is decorative.** Components snap to *beams*, not to holes,
  so once beams tilt off-axis they stop coinciding. The grid stays as visual
  reference for the table, nothing more.
- **Scale: 40 px = 1 inch** (one breadboard hole; ≈1.575 px/mm), defined once in
  `physics/scale.ts`. Both grids and every physical distance in the physics go
  through it — nothing else may hard-code 40 or 25.4.
- **Every beam carries a Gaussian mode.** Lasers seed `q` at a waist on their
  output face, the tracer advances `q` through each free-space gap, and components
  apply their ABCD matrix. `BeamState.q` is authoritative; `w`, `w0`, `zR`,
  `waistDistance` and `divergence` are derived for display by `refreshGaussian`
  and must never be set by hand.
- **Carrier and detuning are separate quantities.** `BeamState.wavelength` is the
  carrier (nm), changed only by nonlinear conversion. Every RF-scale shift lives in
  `BeamState.detuningHz`. An 80 MHz AOM shift is 2 parts in 10⁷ of a 780 nm
  carrier — unrepresentable in nm — so `outputWavelength` deliberately has no AOM
  case. True optical frequency = `c/wavelength + detuningHz`.
- **A port may be `dumped`.** `componentOutputs` reports it with real power so the
  properties panel can show it, but the tracer traces no ray from it. Used for an AOM's
  undiffracted order, and for light coupled into a fibre (`dumpedAs` names which).
- **Emitters seed the trace.** `isEmitter(type)` covers `laser_source` and
  `fiber_launcher`; both launch along `bodyAxis(rotation)` from their output face, are
  their own `firstTouch` so an arriving beam can't re-aim them, return `[]` from
  `componentOutputs` (light reaching one is feedback, and warned about), and are in
  `BEAM_THROUGH_TYPES` so their beam starts flush with the body instead of trimmed clear
  of it.
- **Not every canvas node is an optic.** `isOpticalNode(node)` (types/components.ts) is the
  filter the tracer and the store both use; `NON_OPTICAL_NODE_TYPES` currently holds
  `beam_endpoint` (phantom beam ends) and `power_probe` (annotation). Anything in that set
  is invisible to the physics — it cannot terminate, attenuate or split a beam — and finds
  what it needs by reading the finished `segments` instead. Probes are still in
  `store.nodes`, so they persist, undo, and appear in the diagram.
- **A component may declare more than one beam axis.** `componentLanes(data)`
  (`physics/lanes.ts`) returns perpendicular offsets from the centre; lane 0 is always
  0, so every single-lane component behaves as if lanes didn't exist. Offsets are
  measured along `laneNormal(rotation)` — **fixed to the component, never to the beam
  direction** — because a lane is a place on the device and must not flip when a beam
  traverses it backwards. `OutputPort.lane` selects the axis a port leaves on.
- **A ray's `origin` is the beam's true position.** There is no nominal "routing
  axis" plus a perpendicular offset scalar. Components snap onto the true hit point,
  and beams that genuinely share a line are separated *for drawing only* by
  `fanCollinearSegments` (`beamLayout.ts`), which writes `BeamSegment.renderShift`.
  Segment coordinates stay physically true — `lengthMm`, waist positions and hit
  points are unaffected. **Renderers must draw via `drawnEndpoints(seg)`**, never
  the raw coordinates, or the two views will disagree.

### Routing algorithm (`src/physics/autoRoute.ts`)

1. Seed one ray per `laser_source`, from its rotation-mapped output face.
2. Pop a ray; linear-scan all nodes for the nearest one within
   `BEAM_SNAP_DIST = 10 px` perpendicular and `≥ MIN_FORWARD = 8 px` ahead.
3. Miss → emit a phantom endpoint `FAR = 4000 px` downrange + a free segment.
4. Hit → record entry direction, auto-rotate symbol nodes to face the beam,
   **snap the node onto the beam axis**, trim endpoints to the optical face,
   emit a segment, **advance the Gaussian mode over the centre-to-centre gap**,
   then ask `componentOutputs()` for the outgoing beams.
5. Loop control via `visitedDirs`: anti-parallel re-entry banned; ≤2 co-propagating
   passes for normal nodes; ≤2 entries for splitters; global `safety < 80` cap.
6. Finally, explicit user-drawn edges are resolved with the same
   `componentOutputs()` physics (`resolveUserWires`), so manual wiring and
   auto-routing agree.

### Physics (`src/physics/`)

| File | Responsibility |
|---|---|
| `propagate.ts` | `componentOutputs(inBeam, node)` → the **one** table of what each component emits (handle, transmit/reflect, resolved `BeamState`). Also `transformBeam`, `componentABCD`, `advanceBeam`, `refreshGaussian`, `laserBeam`. |
| `power.ts` | `transmissionFraction(node)` — physics loss × insertion loss. |
| `wavelength.ts` | `outputWavelength` — SHG halving, AOM RF shift. |
| `jones.ts` | Complex arithmetic, Jones matrices (HWP/QWP/polarizer), `polarizationToJones`. |
| `gaussian.ts` | ABCD matrices and the complex `q` parameter. All mm; M² via the embedded-Gaussian effective wavelength. |
| `scale.ts` | px ↔ mm (40 px = 1 inch) and length/spot formatting. |
| `geometry.ts` | `mirrorReflect(dir, rotation)` — shared by router and node handles. |
| `autoRoute.ts` | Ray tracer + geometry + segment/beam emission. |

`componentOutputs` is the seam to extend when adding a component: give it its
output handles and their beams, and both the router and the display follow.

---

## 3. Display

### Editor (`components/Edges/BeamEdge.tsx`)

Straight path from `data.sx/sy → data.tx/ty` (auto edges) or xyflow handle coords
(user edges). Stroke colour from `wavelengthToRGB`. λ/P/pol labels are opt-in via
the `showBeamLabels` toggle. Auto edges are `pointerEvents: none` because they sit
above nodes in z-order.

### Diagram (`components/Diagram/DiagramPanel.tsx`)

Pure renderer over `store.segments` + `store.nodes` — no independent geometry.
Icons are **nested `<svg>`**, not `<foreignObject>`, so the SVG rasterises and
opens in Illustrator/Inkscape. Per-component annotations (λ, f, θ, R:T…) come from
`getAnnotations` and can be toggled per key / per category. Exports SVG and PNG
by serialising the one `<svg>` node.

### Colour

`utils/colormap.ts` maps 380–700 nm to a visible-spectrum RGB ramp; 700–1200 nm
collapses to three discrete dark reds (`#dd3300`, `#aa2200`, `#773300`) plus a
dashed stroke, and anything outside 380–1200 nm renders grey. **852 nm and 1064 nm
are the same colour** — a real limitation for an AMO lab.

---

## 4. Known limitations / open work

Ranked roughly by leverage. Items marked ✅ were fixed on 2026-08-15.

- ✅ **A — Two competing physics engines.** `autoRoute` traced rays while
  `propagateAll` re-walked the edge graph; they disagreed on wavelength for
  co-propagating beams, and `BeamEdge` had to pick per-field which to trust.
- ✅ **B — Diagram reimplemented geometry.** It drew centre-to-centre, applied a
  bogus L-elbow to reflected edges, and dropped every free-space beam (phantom
  targets aren't in the store). Now renders shared `BeamSegment[]`.
- ✅ Jones calculus was never applied during routing → a λ/2 plate before a PBS
  had no effect on the split.
- ✅ `loss %` was silently discarded on PBS / NPBS / dichroic / AOM / SHG.
- ✅ Properties panel "computed beam" block read `beamMap.get(nodeId)` against an
  edge-keyed map, so it never rendered.
- ✅ PNG/SVG export serialised only the xyflow edge layer (beams, no components).
- ✅ **C — No physical scale.** Lasers now carry `waist` + `mSquared`, `scale.ts`
  converts px↔mm, and the tracer propagates `q` through every free-space gap and
  lens. Spot sizes, waist locations and divergence are live everywhere.
- **Gaussian coverage is still partial.** `componentABCD` only knows thin lenses;
  extend it for curved mirrors (`curvedMirror` exists), fibre mode-matching
  (`fiber_coupler`/`fiber_launcher` should re-seed the mode, and `fiber_launcher`
  already has a `focalLength`), and cavities. Aperture clipping at `iris` /
  `aperture` is still unmodelled — a beam larger than the aperture passes
  untouched. Astigmatism is not modelled (one `q` per beam, not tangential +
  sagittal).
- **Beam-path length is computed but barely surfaced.** `BeamSegment.lengthMm`
  exists; a "distances" toggle drawing dimension lines between components would
  finish the figure story.
- ✅ **D — Cycle handling was a heuristic.** Replaced by exact per-ray path
  signatures; anti-parallel and multi-direction entry are now free, and a closed
  loop is detected precisely. Remaining gap: `mirrorReflect` has no notion of a
  front face, so a beam striking the back of a mirror still reflects. Now that
  entry from any direction is allowed, this is reachable — `getNodeIcon` already
  computes `slashFront`/`backslashFront`, so the information exists to block it.
- ✅ **E — the 1.5 px `BEAM_VISUAL_OFFSET`** and its retroactive segment patch are
  gone. Rays carry true positions; separation is a display post-pass
  (`fanCollinearSegments`, 3 px, first beam stays on the true line).
  Remaining refinement: the gap is a fixed number of *canvas* px, so it shrinks at
  low zoom and exaggerates at high zoom. Zoom-aware fanning would need the renderers
  to pass the current zoom into `drawnEndpoints`.
- **F — Snapping is perpendicular-only.** Along-axis position is wherever the
  mouse dropped; snapping to the 40 px (1") hole grid would make layouts
  reproducible on a real breadboard.
- **Undo is incomplete.** `saveSnapshot` is only called on drop and connect —
  property edits (`updateNodeData`) and deletions don't snapshot.
- **`PropertiesPanel` and `Toolbar` hard-code dark colours** (`#0f1117`,
  `bg-gray-800`) while everything else honours `theme` → light mode is broken.
### AOM roadmap (design agreed 2026-08-16)

Two target use cases: **(1)** 0th order blocked while the diffracted order
propagates, **(2)** double-passed AOM. The decisive physical fact: first-order
deflection is θ₁ = λ·f_RF/v_a ≈ **14.9 mrad** for 80 MHz / 780 nm / TeO₂, so the
orders separate by only ~7 px over 300 mm of canvas and you would need 1.7 m to
separate them by one inch. True-angle geometry therefore solves neither display nor
component placement, while breaking every axis-aligned assumption in the app.
**Decision: keep the deflection angle as annotated physics, render it as parallel
lanes on the hole grid.**

| Phase | Work | Status |
|---|---|---|
| 1 | `detuningHz`; AOM emits both orders on one lane; 0th dumped | ✅ done |
| 2 | `Ray.offset` → true ray positions; render-time fanning (item E) | ✅ done |
| 3 | `componentLanes()` + per-lane snap + `OutputPort.lane` → **case 1** | ✅ done |
| 4 | Path-based traversal (item D); laser as terminator; directional isolator | ✅ done |
| 5 | `retroreflector` component + `PortKind: 'retro'` → **case 2** | ✅ done |
| 6 | Deflection-angle annotation, double-pass preset (icon done, see below) | todo |

Key points of the design:

- **The AOM is a two-lane device.** `order1` (diffracted) stays on the lane the beam
  arrived on; `order0` peels off onto the other. **This is inverted from the original
  design**, which had the diffracted order cross lanes. Crossing would have orphaned
  every existing AOM layout — downstream components sit on the entry axis and would
  have received nothing — and a chain of cells would walk 40 px each. Keeping the used
  beam as the through-line preserves those layouts, still gives the 0th order a lane to
  be blocked on, and *still* gives double-pass for free, because a retroreflected beam
  re-enters on the lane it left by and diffracts straight back out along it. The cost:
  the schematic draws the 0th order as the deviated one, which is geometrically
  backwards. It is a labelled convention, and the deflection is a caricature either way.
- **Lane spacing must exceed 2 × `BEAM_SNAP_DIST`** (40 px vs 20 px) or lanes capture
  each other's beams, *and* exceed a beam block's half-height (26 px) so a block on the
  dump lane doesn't cover the main beam. One inch satisfies both and lands on the hole
  grid. It is a fixed constant rather than per-component because `getNodeGeometry` would
  have to see node data to size the body around a variable separation.
- **Anti-parallel re-entry is the blocker for case 2** (`autoRoute.ts`, the
  `dot(d, ray.dir) < -0.5` guard). Replacing `visitedDirs` with per-ray path
  signatures `(nodeId, dirKey, lane)` also lets the `≤2 co-propagating` caps go —
  independent rays have independent paths, so the caps were only ever loop guards.
- Once counter-propagation exists, two things need attention: `laser_source` must
  become a terminator in `componentOutputs` (a beam reaching a laser is optical
  feedback — worth warning about), and `isolator` must actually attenuate the
  reverse direction by its `isolation` dB.
- **Rejected:** a composite `double_pass_aom` black box. It skips phases 2–5 but you
  can't see the lens, put a QWP inside, or model the PBS extraction. Ship the same
  convenience as a *preset template* of real components after phase 5.
- **The cell body does not have to contain its lanes.** It was briefly 64×88 so the
  dump lane sat inside it; it is now 60×44 (mirror height) with a dashed peel-off line
  drawn from inside the body out to where the 0th-order beam starts. That point is the
  exit face, `centre + width/2`, which is what the router trims to — icon and beam must
  keep agreeing there, and a test pins it. Height is otherwise free to choose, since a
  horizontal beam's trim comes from `width/2`.
- **Known limitations to state in the UI:** lane separation is a caricature; box nodes
  still don't auto-rotate to face the beam. The cat-eye's focal length *is* modelled
  (see the change log), so a badly placed one shows a mis-sized return beam — but
  nothing warns about it, and beam walk with f_RF is still not modelled at all
  (the lane model has no angle to walk).
- **Dead code:** `components/Edges/BeamTailOverlay.tsx` (superseded by phantom
  nodes), `computedInput`/`computedOutput` on `BaseNodeData`, `cascadeABCD` and
  `curvedMirror` (kept deliberately — both are wanted for cavity support).
- **README.md is still the unmodified Vite template.**
- **Angles are still limited to the four axes in the UI** — see the arbitrary-angle
  roadmap below. The physics primitives no longer are.
- `BaseNodeData` has an `[key: string]: unknown` index signature (required by
  xyflow's `Node<T>` constraint) which defeats excess-property checking on the
  whole discriminated union.

---

### Arbitrary-angle roadmap (assessed 2026-08-22)

Goal: beams and components on a lattice of **15°** multiples instead of the four axes.
The tracer turned out to be mostly angle-agnostic already — hit testing projects onto the
ray direction, snapping is `centre ± laneNormal · L`, and all Gaussian propagation is
distance-based — so the work splits cleanly.

**Decided 2026-08-22:** beams on a **15°** lattice, mirror surfaces on **7.5°** (reflection
doubles the surface angle, so a 15° mirror lattice would confine beams to 30° multiples).
The 1 inch hole grid stays exactly as it is, as visual reference only — components snap to
beams, not to holes.

| Stage | Work | Status |
|---|---|---|
| 1 | `geometry.ts` angle primitives, `bodyAxis`, `emitterOrigin`; UI still 0/90/180/270 | ✅ done |
| 2 | Exact face trimming at any angle; artwork / occupied / body boxes split | ✅ done |
| 3 | Any lattice angle as a first-class *body* angle; general collinearity/fanning | ✅ done |
| 4 | Lattice open in the UI: one mirror artwork, angle entry, label slack, box-node rotation | ✅ done |

Facts that shape the design:

- ✅ **The w/h swap is gone** — `getNodeGeometry` is a true bounding box and the artwork
  and body boxes are separate functions (stage 2). Icon sizing now reads the artwork, so a
  turned symbol's icon no longer grows with its box. Still on the render side for stage 4:
  `labelLayout`'s slack is computed against the occupied box, which is right at 0/90 but
  will place a 45° label too low, since a square icon turned 45° fills √2 more of the box
  than the slack formula assumes.
- ✅ **`faceHalf` is exact** (stage 2): the beam direction is taken into the component's
  own frame and intersected with its body box, so which face the beam meets falls out of
  the maths. `beamFaceHalf` still means "distance to the optical surface along the
  component's axis"; the cross-axis extent comes from the artwork.
- ✅ **Fanning works at any angle** (stage 3). A `Line` is now direction-in-[0°,180°) plus
  signed perpendicular offset from the origin, so a diagonal double pass separates
  properly; the half-circle fold is what puts a beam and the beam retracing it in the same
  group. Diagonal *user wires* now take part too, which the old exclusion existed to
  prevent — with a real line test that exclusion is unnecessary, since only genuinely
  collinear-and-overlapping segments fan.
- ✅ **All four stage-4 items are done** (see the change log): one mirror artwork turned by
  rotation, an angle control on the component's own grain, label slack that accounts for a
  turned icon, and instrument nodes that turn like everything else.
- ✅ **Handles were free, as expected.** `Position.Left/Right/Top/Bottom` and `rotatePosition`'s 90°
  steps look blocking but aren't: symbol nodes already use `atNodeCentre()` and auto-edges
  carry explicit coordinates, so only a handle's *existence* matters to xyflow. Give box
  nodes centre handles too and the problem evaporates.
- **15° beams need 7.5° mirrors.** Reflection doubles the surface angle, so from a 0°
  source via 15°-quantised mirrors you can only reach **30°** multiples. Either allow
  mirror surfaces on a half-step lattice, or accept that off-lattice beam directions come
  only from rotated sources. Decide before opening up the UI — it sets whether the
  quantiser is one constant or two.
- **The 1" hole grid stops working.** 45° is special because it keeps components on the
  breadboard grid; a 15° beam passes through no hole centres, so "snap component to beam"
  and "component sits on the grid" become mutually exclusive. Either stop implying grid
  alignment or model the rotated mount plate explicitly. This is a product question, not
  a code one.
- **Selection boxes stay axis-aligned** (xyflow nodes are rectangles), so a 15° waveplate's
  outline won't hug its artwork, and its drag target is the bounding box. Permanent and
  visible; judged acceptable.
- **Still open after stage 4:** the AOM peel-off marker is drawn in the artwork frame, so it
  turns correctly, but its 1 inch dump lane can now stick well outside the occupied box at
  odd angles — harmless, since `overflow: visible`, but the node's hit area doesn't cover
  it. And `beamFaceHalf` figures were measured off the artwork by hand; nothing checks them
  against the drawn SVG, so a redrawn icon can silently disagree with its trim.

### Store shape

**Two stores, and the split is the point.** `createLayoutStore()` is a *factory*: every
open document gets its own instance, holding that document's layout, trace output, undo
history and selection. `workspaceStore` is the single app-wide store, holding the list of
open documents, which one is active, and the preferences that belong to the window rather
than to a bench (`theme`, `activeView`, `showBeamLabels`, `labelScale`).

`DocumentTabs` renders the open documents; `App` provides the active one's store and keys
the panel subtree by document id, so switching tabs mounts a clean canvas. The whole set is
persisted to IndexedDB by `sessionSync` and read back before the first render — see the
phase 5 entry in the change log. Components never
import a document store. They call `useLayout(selector)` from
`layoutContext.ts`, which reads whichever instance the surrounding
`LayoutContext.Provider` supplies — so switching documents is a change of provider value,
and no component knows there is more than one. `useLayoutApi()` is the escape hatch for a
read that must not subscribe (`EditorCanvas`'s reload effect wants the state *now*).

Two things forced the factory rather than a `documents: Record<DocId, …>` map inside one
store: `lastRouteKey`, which memoises the trace, is a closure variable, and
`history`/`future` must never let an undo in one document pop another's state. Both come
out per-document for free this way.

Each document store holds the persisted layout (`nodes`, user `edges`) plus three
derived outputs, all published by one `trace()` helper that calls `autoRoute`:

| Field | Keyed by | Consumed by |
|---|---|---|
| `segments: BeamSegment[]` | — | `DiagramPanel` |
| `beamMap: Map<id, BeamState>` | edge id | `BeamEdge` |
| `nodeBeams: Map<id, BeamState>` | node id | `PropertiesPanel` (strongest arrival) |
| `nodeArrivals: Map<id, BeamState[]>` | node id | `PropertiesPanel`, `OpticalNode`, `DiagramPanel` — a detector reads the total |

`routeKey()` memoises the trace over node data **and positions** plus user
wiring. `recomputeBeams()` forces a re-trace from store state. An inactive document simply
stops tracing — nothing calls it — and keeps its last results until it is shown again.

---

## 5. Gotchas

- `EditorCanvas`'s route effect depends on `nodes` and *writes* node data
  (`rotation`, `beamIncomingDir`), so it can retrigger itself. It is guarded by
  explicit change-detection before `setNodes`; keep that guard intact or you get
  an infinite loop.
- Routing is debounced 50 ms and store sync 150 ms; sync is skipped entirely while
  dragging and flushed on `onNodeDragStop`.
- `App.tsx` mounts *either* `EditorPanel` or `DiagramPanel`. When the Diagram tab
  is active `EditorCanvas` is unmounted, so the **store** must be able to run the
  tracer on its own (it does, in `recomputeBeams`).
- `physicsKey` in the store memoises recomputation. It must include node
  **positions** now that the engine produces geometry — beams move when nodes move.
- Mirror icon selection depends on `beamIncomingDir` (which face is hatched), so
  the router writing that field back into node data is load-bearing for rendering.
- **The editor canvas needs a working `ResizeObserver`.** xyflow v12 measures nodes
  with one; without it `node.measured` stays undefined, it has no handle bounds, and
  it renders **no edges at all** — silently, with no error, even though
  `rf.getEdges()` shows them present. Seen in a restarted preview browser where
  `ResizeObserver` never fired. If beams vanish from the Editor but the Diagram tab
  still draws them, suspect this rather than the router: the Diagram is plain SVG and
  needs no measurement.
- **`await import('/src/store/layoutStore.ts')` from the preview console gives you a
  *different store instance* than the running app** — Vite serves the app's copy under a
  cache-busting query, so a bare-path import is a second module. A full page reload does
  not fix it. `loadLayout` on that copy computes correct segments and changes nothing on
  screen (`store.nodes` reads 0 while three nodes sit in the DOM). Fine for exercising
  physics against the app's real code, useless for driving the UI. To test the UI, drag
  from the palette (a synthetic `drop` carrying
  `dataTransfer['application/opticalab-node']` does work) or load a layout file.
- **A component that can be a beam target needs an `in` handle**, or xyflow drops
  every edge pointing at it without a word. This bit lasers as soon as they became
  terminators in phase 4.
- **zustand v5 has no equality-function argument.** `useStore(selector, eqFn)` is a
  type error and the comparator is ignored at runtime. To keep a component from
  re-rendering on every trace, select **scalars** (as `BeamEdge` does), not the
  `BeamState` object — it is rebuilt each pass, so reference equality never holds.
- Beams above 700 nm are drawn with a `6,3` dash. When sampling rendered pixels
  in a test or a debug script, expect ~⅓ of samples along a beam to be gaps.
- **A segment's `beam` is the state at its *start*.** So the label on the segment
  leaving a lens shows the spot size *at the lens*, not at the focus — the focus is
  marked separately. `nodeBeams` is likewise the beam *arriving* at a component,
  after the upstream free-space run — and only the **strongest** one. For everything
  that lands there, use `nodeArrivals`; a detector's reading is their sum.
- A laser's rays start at its **output face** (`position.x + width`, i.e. 90 px
  right of its own origin for the default 90×66 laser), not at its centre. Easy to
  get wrong when computing expected distances in a test. For a rotated laser the face
  comes from the **rotated** geometry (a vertical laser is 66×90), so it emits from the
  centre of its own bottom edge.
- `refreshGaussian` must be called after **any** change to `q` *or* wavelength,
  since the spot size a given `q` describes depends on λ. `componentOutputs`
  refreshes every port on the way out, so per-component branches only carry `q`.
- The eslint config's `react-hooks/static-components` and
  `react-refresh/only-export-components` rules currently fail in `Toolbar.tsx`
  (inline `Btn` component) and `NodeIcons.tsx` (mixed exports). Pre-existing,
  7 errors, unrelated to the physics — `npm run lint` is not clean.
- `npm run build` was failing before 2026-08-15 because of the zustand v5 issue
  above. If it breaks again, run `npx tsc -b` alone first: vite build succeeds
  even when types don't.

---

## 6. Change log

### 2026-08-23 — cross-document clipboard

Copy a piece of one bench into another. This was half the reason for tabs: two windows can
already show two layouts side by side, but they cannot move components between them.

**The clipboard is workspace state**, not document state — its whole purpose is to outlive
the document it came from. It is deliberately *not* part of the session snapshot: a
clipboard surviving a restart would be a surprise, and no other editor does it.

**What a copy takes** is the selection as xyflow reports it (`node.selected`, so Shift-click
multi-select works), plus the user-drawn edges whose *both* ends are in that selection — an
edge to something you did not copy has nowhere to land. Phantom beam endpoints and `auto_`
routing edges are never taken: the tracer owns those. A power probe *is* taken, since it is
something the user placed. The node data is deep-copied, so editing the original afterwards
cannot reach into the clipboard.

**What a paste produces:** fresh ids for every node (pasting back into the source document
would otherwise collide), the copied edges rewired onto them, everything already on the
canvas deselected and the arrivals selected so they can be dragged straight away. A locked
component pastes unlocked — the lock is about *this* bench's layout, and a pasted copy has
just been moved by definition — and the stale `measured` size is dropped so xyflow sizes the
copy itself.

**Geometry rule:** pasting into a *different* document keeps the original coordinates,
because the spacing relative to the rest of the bench is the thing worth preserving; pasting
back into the *same* document offsets by one breadboard hole, so the copy is visibly
separate rather than exactly on top of the original.

`insertNodes` and `removeNodes` on the document store both snapshot first, so a paste or a
cut is one Ctrl+Z. `removeNodes` also drops any wiring that touched what it removed, since
an edge to a component that is gone would dangle. Both recompute the beams and refresh the
dirty flag.

Keyboard: Ctrl+C/X/V, added to `FileShortcuts` alongside Ctrl+S/O. Unlike save and open,
these are only taken **when the bench has focus** — inside a text field they must still copy
text, and the properties panel is full of fields. The toolbar carries Copy/Cut/Paste buttons
with live counts, since a cross-tab clipboard is not discoverable otherwise.

Verified in the running app: three components built in one tab, two selected with
Shift-click, Ctrl+C (the button then reads `Copy 2 components`, and Paste reads
`Paste (2) — from any tab`), a new tab opened, Ctrl+V pastes both with fresh `paste_*` ids,
a second Ctrl+V gives four nodes with all ids distinct, one Ctrl+Z takes a paste back
whole, Ctrl+X removes the selection while leaving it on the clipboard, and the source
document still has its three components.

23 tests added (`src/store/__tests__/clipboard.test.ts`): what a copy takes and refuses,
the deep copy, edge filtering both ways, fresh ids and rewiring, the two geometry rules,
selection handling, locked and measured handling, pasting twice without collision, and then
through real document stores — pasting between two documents, the paste being traced, the
receiving document going dirty while the source stays clean, undo in one step for both
paste and cut, cut dropping dangling wires, and removing nothing doing nothing.
**456 tests total.**

### 2026-08-23 — session restore (tabs, phase 5)

The open tabs survive a reload. One window holding several benches makes a refresh
expensive, and an installed app gets treated like a native one, so the workspace is written
to IndexedDB and read back on start.

**IndexedDB, for one specific reason:** a `FileSystemFileHandle` is structured-cloneable, so
a restored tab still knows which file it belongs to and Save can write back to it after a
single permission click. `localStorage` could only have held strings.

**Each layout is stored as layout JSON** — the same format Save writes — so restore goes
through `layoutFromJSON` and inherits its version check and migrations. A session can never
resurrect a schema the app no longer understands, and a snapshot written by an older build
is migrated on the way back in (there is a test for exactly that: a 1.0 photodiode comes
back with `signalFactor`).

**The saved baseline moved into state.** `dirty` is measured against the fingerprint of what
the *file* holds, which used to live in a closure — invisible to a snapshot, so a document
that was unsaved when the window closed would have come back looking saved. It is part of
what a document *is*, so it is now `savedFingerprint` on the store, and a dirty tab comes
back dirty with its unsaved work intact.

**Writes are debounced (400 ms) and flushed on `visibilitychange`.** Not on
`beforeunload`: a transaction opened there is not guaranteed to commit, so the debounce is
short rather than clever. A document's content lives in its own store, so the sync watches
every open document as well as the workspace — the workspace subscription alone would only
see tabs opening and closing, not a component being dragged inside one.

**Hydration gates the first render.** Reading IndexedDB is asynchronous, and the
alternative was a blank tab appearing first and being replaced under the cursor — or worse,
drawn in and then discarded. Blank unsaved documents are skipped when snapshotting, since
restoring a row of empty `Untitled` tabs is noise, but a blank document *with a file* or
*with unsaved changes* is kept (emptying a saved layout and not saving it is exactly the
case worth not losing).

**Two bugs found while verifying, both real:**

- **A restored document had no beams.** `createLayoutStore` set the initial nodes but never
  traced, and only the editor canvas provokes a trace on mount — the Diagram view just
  renders `segments`, and `activeView` is itself restored, so it could be the first thing
  you saw. The factory now traces when created with content, which also fixes opening a
  file into a new tab while on the Diagram. Caught by a test asserting a restored document
  has segments, and confirmed in the app: a restored D1 tab opened straight to the Diagram
  draws all 231 beam lines.
- **One unclonable handle lost the whole session.** IndexedDB rejects the entire value if
  any part of it cannot be cloned, so `writeSnapshot` now retries without handles on
  `DataCloneError`. The tabs and layouts come back; Save asks for a path again, which is
  what Firefox and Safari do anyway. Found because the stub handle used for testing
  contains functions, where a real one clones fine — the harness limitation exposed a
  genuine single point of failure.

Verified in the running app: two documents (the D1 bench opened from a file, and an
`Untitled` with one component left deliberately unsaved), each zoomed differently, then a
reload. Both came back with the right layout (41 nodes and 1), the right dirty state (clean
and dirty), and their own viewports restored exactly (scale 0.5 and 2). A restored tab's
Diagram shows all 231 beam lines with the expected 795 nm powers.

22 tests added (`src/store/__tests__/session.test.ts`): snapshot contents including name,
file, viewport, baseline and prefs; blank-document skipping and its two exceptions;
round-tripping several documents in order with their ids; clean and dirty both surviving;
migration on the way back in; dropping documents that no longer parse and counting them;
snapshot-shape validation; `adoptSession`'s replace/keep/fallback behaviour; and that a
restored document saves to the same bytes it would have before. **433 tests total.**

### 2026-08-22 — file identity per document (tabs, phase 3)

What makes tabs safe: each document knows which file it belongs to, whether it differs from
it, and asks before losing anything.

**Save writes in place.** A document carries a `FileSystemFileHandle` — obtained from
`showOpenFilePicker` on Open or `showSaveFilePicker` on Save As — so **Save** (Ctrl+S)
writes straight back to the file with no dialog, and **Save As** (Ctrl+Shift+S) asks and
adopts the new file for later saves. Every save used to open a picker, because there was
nowhere to keep a handle. Firefox and Safari hand back no handle, so Save there falls back
to a download, which `saveTextAs` already did.

**Open (Ctrl+O) no longer overwrites.** A file lands in the current document only when it is
blank and unsaved; otherwise it opens in a new tab. It also carries the handle in, so a
document opened from a file can be saved back to it immediately.

**Dirty is a fingerprint, not a flag.** `layoutFingerprint()` hashes the layout *as it would
be written*, and the document store keeps the fingerprint of the last save. Two properties
a boolean set by each action could not have:

- clicking a component is not an edit (the canvas syncs on selection changes too), and
- undoing back to the saved state clears the flag again, because the file and the document
  genuinely agree.

**Saved files got smaller and more honest.** `layoutToJSON` now whitelists the four fields
that *are* a node — `id`, `type`, `position`, `data` — and the six that are an edge.
xyflow's `selected`, `dragging`, `draggable` and `measured` were all being written out:
noise, stale geometry, and the reason a fingerprint over raw nodes would have flagged a
click. Re-saving the D1 bench with one component *added* came out at 17,979 bytes against
the original 23,634. No version bump: the dropped fields are recomputed on mount, so old
files still load and new ones simply omit them.

**Closing asks only when something would be lost** — the phase-2 guard counted components,
this one consults `dirty` — and `beforeunload` vetoes leaving the page while any document
is unsaved, which matters more now that one window holds several benches.

`useLayoutFile` is where the two stores meet: content from the document, file identity from
the workspace. The toolbar buttons and `FileShortcuts` share it, so they cannot drift.
`FileShortcuts` sits inside `LayoutContext` but outside the panels, so Ctrl+S works on the
Diagram tab too. Ctrl+S/Ctrl+Shift+S/Ctrl+O *are* taken from the browser with
`preventDefault` — unlike the tab shortcuts, which had to be Alt-based.

**Lint is down from 7 errors to 1.** Six of the seven were one cause: `Btn` was defined
*inside* `Toolbar`, so it was a new component type on every render and React remounted
every button on every keystroke. Adding a seventh button made it an eighth error, which was
the nudge to hoist it. Only `NodeIcons.tsx`'s mixed-exports warning remains, and the CI
lint step could be made blocking once that goes.

Verified in the running app against `Layouts/D1_Layout.json`, with the File System Access
API stubbed by a handle that records its writes: Open names the tab, loads 41 nodes clean,
and leaves Save disabled; dropping a component raises the dot and turns Save into `Save*`;
Ctrl+S writes 42 nodes back to `D1_Layout.json` with exactly the four node fields and clears
the dot; Save As writes again; a clean document closes without a question (and being the
last one, is replaced by a fresh `Untitled`); a dirty one asks by name and declining keeps
it; `beforeunload` is vetoed while unsaved.

20 tests added (`src/store/__tests__/dirty.test.ts`): what a file does and does not contain,
fingerprint insensitivity to transient state and sensitivity to real edits, every dirty
transition including the selection-only and auto-edge non-cases and the undo-to-saved case,
and file identity per document. **411 tests total.**

### 2026-08-22 — document tabs (phase 2)

Several layouts open at once, one tab each. `DocumentTabs` sits between the title bar and
the panels; the Editor/Diagram pair above it is a *view* of whichever document is active,
which is why that state is `activeView`.

`workspaceStore` gained `openDocument` / `closeDocument` / `setActiveDoc` /
`renameDocument`. Two invariants are worth stating, both tested:

- **The workspace is never empty.** Closing the last document replaces it with a fresh
  blank one, so there is always somewhere to draw rather than an empty shell.
- **Closing the active tab falls to its right-hand neighbour**, or the new last document —
  what every editor does — and closing an inactive tab leaves the active one alone.
  `setActiveDoc` ignores an id that is not open, so a stale id can never blank the editor.

**Viewport is now per document** (`viewport` on the document store, set from `onMoveEnd`).
This was listed as phase 4 but phase 1 made it mandatory: tabs unmount the canvas, and
`fitView` was unconditional, so every switch would have re-framed the layout. A document is
framed once, when it is first opened, and returns to wherever you left it after that.

**A tab takes its file's name** on load, so a row of tabs is readable rather than five
`Untitled`s. `useDocumentName` is the one place document state and workspace state meet.

**Closing asks before dropping a bench with anything on it.** That is a stand-in for the
real thing: a layout lives only in memory, and phase 3 will track a dirty flag against a
file so a *saved* document closes without a word, while an unsaved one says what is at
stake. Right now it counts components.

**Shortcuts are Alt-based** — Alt+T new, Alt+W close, Alt+1…9 switch — because the browser
owns Ctrl+T and Ctrl+W and will not give them up, and Alt combinations do not collide with
the canvas's own Delete/Shift handling. Ignored while a field has focus.

Verified in the running app with two documents: `D1_Layout.json` loaded into the first (41
nodes, tab renamed), a laser dropped into a second (1 node), and switching back and forth
keeps each layout intact. Zooming the second document to scale 2, visiting the first (which
sits at 0.5), and returning restores scale 2 exactly. The close guard asks with the
component count, declining keeps the tab, accepting closes it, and an empty document closes
silently. Alt+T and Alt+1 behave. No console errors beyond this pane's standing refusal to
register a service worker.

21 tests added (`src/store/__tests__/workspace.test.ts` — the first store tests): opening
and identity, layouts/undo/selection/viewport isolated between documents, each document
tracing independently rather than sharing the memo, every closing rule including the
never-empty invariant, switching and renaming, and preferences surviving a document switch
while being absent from the document store entirely. **391 tests total.**

### 2026-08-22 — one store per document (tabs, phase 1)

Groundwork for opening several layouts at once. **Nothing user-visible changes**: there is
exactly one document, and it behaves as before. Phase 2 adds the tab strip.

**The store is now a factory.** `createLayoutStore()` returns a vanilla zustand store per
document; `workspaceStore` is the app-wide one, holding the document list, the active id
and the preferences that belong to the window. A `Record<DocId, DocState>` inside one store
was the obvious alternative and the wrong one: `lastRouteKey` (trace memoisation) is a
closure variable and `history`/`future` must not let an undo in one document pop another's
state. Both are per-document by construction this way, with no bookkeeping.

**Preferences moved out of the document** — `theme`, `showBeamLabels`, `labelScale`, and
`activeTab` renamed to **`activeView`** (it means editor-vs-diagram, and would have
collided with document tabs). Moving them now avoided touching ~15 of the 49 call sites
twice, and it means switching documents will not reset the theme.

**All 49 `useLayoutStore(...)` call sites across 9 files** became `useLayout(...)` for
document state or `useWorkspace(...)` for preferences. The one non-reactive read
(`EditorCanvas`'s reload effect) uses `useLayoutApi()`.

**The panels are keyed by document id.** Inactive documents will *unmount* rather than
hide, because xyflow measures nodes with a `ResizeObserver` and a zero-size canvas never
gets `node.measured` — which means no edges at all, silently (§5). That also means phase 2
has to persist each document's viewport, since the canvas currently mounts with `fitView`
and would otherwise re-frame the layout on every tab switch.

Verified as a pure refactor, through the running app: `Layouts/D1_Layout.json` loads via
the real Load button to the same 41 nodes with the same migration dialog; the theme toggle
still works; the Diagram tab draws the same 231 beam lines for the active document; an
editor → diagram → editor round trip keeps all 41 nodes. 370 tests unchanged (they import
`src/physics/` and never touch a store), `tsc -b` and build clean, lint back to the same 7
pre-existing errors.

Still to come: tab strip and document open/close (phase 2), per-document file identity with
Save vs Save As and a close-confirmation for unsaved work (phase 3), viewport persistence
(phase 4), and session restore into IndexedDB (phase 5).

### 2026-08-22 — installable as a PWA, for handing to colleagues

Distribution route chosen: **hosted PWA on Netlify**, not signed desktop installers. The app
has no backend and no native dependency, so an install costs no certificate ($200–400/yr on
Windows, $99/yr on macOS), no per-platform CI matrix, and no 250 MB download — and updates
arrive on their own. `electron-builder` stays configured for anyone who wants the native
shell.

`vite-plugin-pwa@1.3` (which declares `vite: ^8`, so no version risk) plus
`@vite-pwa/assets-generator`. 13 precached entries, 482 KiB, and the bundle makes **zero**
runtime network calls — the only URLs in it are XML namespaces and React Flow's error-doc
links — so offline is complete rather than partial.

**Three decisions worth keeping straight:**

- **`registerType: 'prompt'`, not `autoUpdate`.** A layout exists only in memory until it is
  saved, so a background reload would discard the bench someone is mid-way through drawing.
  `UpdatePrompt` offers *Reload* / *Later* instead.
- **Registration is manual, guarded on `location.protocol`.** The Electron shell loads the
  same `dist/index.html` over `file://`, where registering a worker throws; the manifest
  `<link>` 404s there harmlessly.
- **Two different bases.** Vite keeps `base: './'` — an absolute base breaks the Electron
  `file://` load, since assets would resolve against the filesystem root — while the plugin
  is given `base: '/'` and `scope: '/'`, because a service worker's scope cannot be
  relative. Both are commented in `vite.config.ts`. Hosting under a subpath means changing
  both.

**Icons now come from one file.** `public/icon.svg` is the lens-and-axis mark the title bar
draws, at 512 px on the app's own `#0f1117` plate, kept inside the 80% circle Android may
crop a maskable icon to. `npm run icons` rasterises the 64/192/512 set, a padded maskable
512, a 180 for iOS and a `favicon.ico`; the PNGs are committed so a clone builds without
sharp. The old `public/favicon.svg` was the Vite template's purple lightning bolt — deleted,
since it would otherwise have been what colleagues saw in their Start menus.

**One bug found while verifying:** `registerSW()` defers to `window.onload` unless told
otherwise, and this effect runs after React mounts, which is usually after load has already
fired — so nothing registered and nothing cached. Fixed with `immediate: true`. Also set
`includeManifestIcons: false`, since `globPatterns` already catches the PNGs and the plugin
was listing the same five URLs twice (18 precache entries → 13).

Verified: clean build emits `sw.js` and `manifest.webmanifest`; the manifest serves with the
right name and four icons; `sw.js` serves 200 as `text/javascript` with real Workbox content;
the precache list contains exactly the app, its icons and the manifest; the 512 icon renders
correctly. **Not** verified here — installability and offline: this embedded browser pane
refuses `navigator.serviceWorker.register` with "unknown error when fetching the script" even
though `fetch('/sw.js')` returns 200 with the correct MIME type. Confirm with
`npm run build && npm run preview` in Chrome or Edge, where DevTools → Application should
show one activated worker with 13 cached entries.

### 2026-08-22 — layout files carry a version that means something; dev port aligned

Groundwork for handing the app to other people: their files have to survive the next schema
change, and the desktop shell has to start.

**`LAYOUT_VERSION = '1.1'`, and loading actually checks it.** `layoutToJSON` stamped a
version from the beginning; `layoutFromJSON` threw it away and did
`{ nodes: data.nodes ?? [], edges: data.edges ?? [] }`. That is fine until a field is
renamed — and three have been (`responsivity`→`signalFactor`,
`gain`+`saturatedPower`→`outputPower`, and the removal of the `optomechanics` category and
the vacuum chamber). An old file then loads with the field *missing*, which is not the same
as the field being unset: an amplifier with no `outputPower` computed
`Math.max(0, undefined)` = **NaN** and put a NaN power on every beam downstream of it.

Loading is now: parse → check version → migrate → validate → **report**.

- **Migrations are a list**, oldest first, each with the version it brings a file up to and
  a per-node transformation. A file is run through every migration newer than its own
  version, so adding the next one is one entry and a minor bump.
- **The 1.0 → 1.1 migration.** `responsivity` (A/W) → `signalFactor` (V/mW) assuming the
  reference case of a bare diode into 50 Ω, `V/mW = R × 50 × 1e-3` — there is no exact
  conversion, since the missing factor is the transimpedance, so the assumption is stated
  in the note the user sees. Amplifier `gain`/`saturatedPower` → `outputPower`, taking the
  saturated figure, which is the closest single number to what the old saturable model
  delivered when driven.
- **Unknown component types are dropped, with their names in the note.** Keyed off the
  geometry table via the new `isKnownComponentType`, so removed components and typos are
  both caught, rather than rendering as a fallback 60×36 mystery box the beam passes
  through. Edges pointing at a dropped node go too, since a dangling reference upsets
  xyflow. Saved `beam_endpoint` phantoms are discarded silently — every trace regenerates
  them.
- **Malformed nodes are skipped**, not handed to the canvas: an entry needs a string `id`
  and finite `position.x/y` to be placeable at all.
- **Throws only when there is nothing to load** — unparseable JSON, no node array, or a
  *newer major* version, which is refused rather than guessed at. A newer *minor* is read,
  since minors are additive by definition.
- **Nothing changes silently.** `LoadedLayout.notes` carries a human-readable line for
  every migration and every drop, and the toolbar shows them in a dialog after loading.
  The old `alert('Invalid layout file.')` is replaced by the actual error message.

Verified against the real `Layouts/D1_Layout.json` (41 nodes, format 1.0): detected as 1.0,
its one legacy photodiode migrated `0.5 A/W → 0.025 V/mW` with a note explaining the 50 Ω
assumption, all 41 nodes kept, 49 beam segments traced, no non-finite beams, no warnings,
not truncated.

**Dev-server port aligned.** `electron/main.cjs` loaded `localhost:5173` while
`vite.config.ts` pins `port: 7432, strictPort: true`, so `npm run electron:dev` waited on a
port nothing would ever serve. The port now lives in one constant in `main.cjs`
(overridable with `VITE_DEV_SERVER_URL`, with the comment pointing at the config), and the
`wait-on` URL and `.claude/launch.json` match it. Production is unaffected — it uses
`loadFile`.

20 tests added (`__tests__/layoutFile.test.ts`): version stamping and a clean round trip
with no notes; refusals for non-JSON, non-layouts and a newer major, and acceptance of a
newer minor and of a file with no version at all; both migrations including their fallbacks
and the note text; a migrated amplifier tracing to **finite** power end-to-end, paired with
a test that the same unmigrated data does *not*; removed components and their edges
dropped with names reported; malformed nodes skipped; phantoms discarded quietly; and a
five-component 1.0 bench loading, migrating and tracing with finite power throughout.
**370 tests total.**

### 2026-08-22 — angle generalisation, stage 4: the lattice is open

The editor now lets you put a component at any angle on its lattice — **15°** for a body
lying along the beam, **7.5°** for a mirror-like surface — and everything downstream draws
and traces it correctly. This is the first stage that changes what the app looks like.

**One mirror artwork, turned by rotation.** Eight hand-drawn variants (dielectric and
dichroic × slash/backslash × which-face-is-coated) collapse into `MirrorIcon` and
`DichroicMirrorIcon`, each drawing its surface along **−45°** — exactly what
`mirrorSurfaceDeg` says a mirror at rotation 0 presents — so turning the artwork by
`rotation` always draws the surface the physics is reflecting off. The galvo got the same
treatment (its two variants → one). At 0/90/180/270 the result is identical to before,
because rotating "/" by 90° *is* "\".

This also fixed a disagreement nobody had noticed: **the diagram rotates every icon**, so
it was rotating the already-backslash artwork again — a rotation-90 mirror drew "\" on the
canvas and "/" in the figure. One artwork, one rotation, both views agree.

Which face is polished is now computed rather than enumerated: `mirrorHatchSide` takes the
incoming direction back through the node's rotation and compares it with the artwork's own
surface normal, so the substrate hatching always ends up behind the beam. It replaces two
booleans (`slashFront`, `backslashFront`) that only had answers for two surface angles. A
test asserts it reproduces all four old variants and holds for every mirror angle × beam
direction on the lattice.

**Instrument nodes turn.** Box nodes used to be drawn identically at every rotation while
the physics treated them as turned — a vertical AOM was trimmed as though it were
horizontal (22 px instead of 30) and its dump lane left the side of an unturned box. Their
border, icon and peel-off marker now sit in one rotating group inside the occupied box, in
both views, and `getNodeGeometry` gives them a real bounding box. **This is the one
behaviour change for existing layouts:** a rotated AOM/EOM/camera now looks turned and its
beam endpoints move by up to 8 px.

**Handles are all at the node centre.** `rotatePosition`/`rotateStyle`/`applyRotation`
(90°-step handle mapping) are gone. Handles are 1×1 and transparent, they exist only so
xyflow keeps an edge, and auto-edges carry their own coordinates — so their position never
mattered, and it has no meaning at 15° anyway.

**Label slack accounts for the turn.** It was `(occupiedHeight − iconSize) / 2`, which
ignores that a square icon at 45° stands √2 taller than at 0°: a diagonal component's
label would have been pulled up into its artwork. Now measured against the icon's actual
vertical extent at that angle. Unchanged on the axes — 18 px for a waveplate at 0°, 0 at
90° — and 11.3 px at 45°.

**One angle control, on the component's own grain.** The "/"-vs-"\" pair and the
four-value dropdown are replaced by a stepper plus numeric field, snapping to
`angleStepFor(type)`: 7.5° for the five mirror-like types, 15° for everything else. Typed
values are snapped too, so a layout can never hold an angle the beam lattice cannot
express. Presets cover what used to be the whole menu, and for a mirror the control also
reports the *surface* angle, which is what you actually align on a bench.

`SURFACE_AT_45` now lives in `nodeGeometry.ts` and is what the router imports as
`MIRROR_TYPES` — one list instead of two, and the definition is meaningful: these are the
components whose surface lies at 45° across the body, which is exactly why the router
leaves their rotation alone.

Verified in the running app: a laser east → mirror at rotation **52.5** (surface 7.5°)
turns the beam to exactly **15°** → an AOM standing on that heading, trimmed 30 px along
its own axis with an occupied box of 69.3×58.0 (the true bounding box of 60×44 at 15°),
diffracting 80 mW at +80 MHz → detector auto-rotated to 15°. The mirror node in the DOM
draws the single "/" artwork with its hatching on the lower-right, i.e. behind the beam.
Palette and canvas render clean.

12 tests added (`__tests__/mirrorFace.test.ts`): `mirrorHatchSide` reproducing all four old
variants, keeping the polished face towards the beam across every mirror angle × beam
direction, flipping for a counter-propagating beam, and agreeing with where the beam is
actually sent; `SURFACE_AT_45` membership and square artwork; per-type angle grain; and
label slack on the axes, at 45°, never negative anywhere on the lattice, and flush for
instrument nodes. **350 tests total.**

*Not verified by clicking:* the angle control's own interaction. This preview session
can't select a node (`elementFromPoint` at a node's centre returns the pane, and the app's
store is unreachable — both in §5), so the control is covered by its unit-tested logic and
the type checker only.

### 2026-08-22 — angle generalisation, stage 3: bodies at any lattice angle

The physics now routes a bench built at any angle on the lattice, end to end. The UI still
offers four rotations, so nothing changes for an existing layout — all 312 previous tests
pass untouched, bar one that had encoded a limitation (see fanning below).

**Components turn to face the beam at any angle.** `autoRot` was a four-case switch on
`isHorizontal`; it is now `snapAngle(angleOf(ray.dir))`. A beam at 45° gets a waveplate at
45°, not one squared up to the nearest axis. Identical for axis-aligned beams. Mirrors and
box nodes still keep their user-set angle, for the reasons already in §4.

**Collinearity generalised** (`beamLayout.ts`). A `Line` was "horizontal or not, plus the
constant coordinate", which can only describe axis-aligned beams; it is now direction
folded to [0°, 180°) plus the signed perpendicular offset from the origin. The half-circle
fold is what keeps a beam and the beam retracing it in one group. A diagonal double pass
used to draw both passes exactly on top of each other; it now fans by 3 px, purely
perpendicular, at 0°, 45° and 15° alike. The old exclusion of diagonal segments existed to
stop user wires fanning spuriously — with a real line test that is unnecessary, since only
genuinely collinear *and* overlapping segments fan. One test asserted the old exclusion
and now asserts the new behaviour, plus a companion that crossing diagonals still don't
fan.

**Two real bugs, both surfaced by building a bench at 45°:**

- **Face trimming used a stale rotation.** `trimFor` read `node.data.rotation`, but a
  component auto-rotated to face the beam has not had that written back yet — so the trim
  was computed as though the beam were crossing it. Invisible while everything was
  axis-aligned (turning a symbol 90° swaps its box *and* the beam direction, so the old
  two-case rule gave the same answer either way); at 45° a waveplate was trimmed 8.49 px
  instead of 6. `trimFor` now takes the rotation the trace has *decided* — `autoRot` for
  the target, and a new `tracedRotation()` lookup for the source — so it converges within
  one pass instead of on the next frame.
- **A beam arriving at an emitter wasn't trimmed at all.** `BEAM_THROUGH_TYPES` included
  lasers and launchers, which is right for a *departing* ray (it already starts on the
  output face) and wrong for an *arriving* one: optical feedback enters through that same
  face. The returning beam was drawn 45 px inside the laser's case and reported a path
  45 px too long. Split out as `EMITTER_FACE_TYPES`, "through" on the source side only.
  This was equally wrong on the axes — a diagonal double pass just made it obvious,
  because the return leg measured longer than the outbound leg. Now equal to 6 decimal
  places at 0°, 45°, 90° and 135°.

Verified in the running app: a laser at 45° → λ/4 (auto-rotated to 45°) → mirror at
rotation 67.5 (surface 22.5°) folds the beam to **exactly 0°** → detector auto-rotated to
0°. First gap 149 px = 200 − 45 (laser reach) − 6 (waveplate axial trim), i.e. the
corrected trim; mirror loss applied; no spurious warnings. Retro double passes at 0°, 45°
and 15° all report equal out-and-back lengths and fan by exactly 3 px perpendicular.

25 tests added (`__tests__/diagonal.test.ts`), plus `snapAngle`/`angleDiff`: emission point
and direction at every one of the 24 lattice angles, the occupied box growing while the
centre holds, a three-component diagonal bench (chain, auto-rotation, exact trims, no
perpendicular drift down the chain, `lengthMm` measured along the diagonal, snap and
snap-miss), folding a diagonal onto an axis with a 7.5°-lattice mirror both in the
primitive and through the tracer, lane normals and a 1 inch dump lane at 45°,
auto-rotation unchanged on the axes and following the beam off them, first-arrival
priority, emitter-arrival trimming, and a diagonal double pass. **337 tests total.**

### 2026-08-22 — angle generalisation, stage 2: exact trimming, and three boxes

**Lattice decided:** 15° beams, **7.5°** mirror surfaces, hole grid unchanged and
decorative. `MIRROR_STEP_DEG = DIR_STEP_DEG / 2` carries the reason: reflection doubles
the surface angle, so from an eastward beam a 15° mirror lattice reaches only 30°
multiples. A test sweeps the mirror over its lattice and asserts all 24 beam directions
are reachable, plus the negative case for a 15° mirror lattice (30° yes, 15° and 45° no).

**Still nothing user-visible.** The UI offers the same four rotations, all 287 previous
tests pass untouched, and the same laser→λ/2→PBS→mirror→AOM→PD layout traces to the same
integer coordinates in the running app.

**Three boxes, named and separated** (`utils/nodeGeometry.ts`, and the header comment
there is the reference):

- `artworkOf(type)` — own frame, unrotated, width along the optical axis.
- `getNodeGeometry(type, rotation)` — the occupied axis-aligned box. Now a real bounding
  box, `(w|cos θ| + h|sin θ|, w|sin θ| + h|cos θ|)`, which *reduces exactly* to the old
  width/height swap at 90/270 because `unitAt` returns exact axis vectors there. A test
  asserts integer equality, not closeness, so no 65.99999 creeps into a position.
- `bodyBox(type)` + `bodyRotation(type, rotation)` — the optical extent a beam is trimmed
  to, and the angle it is drawn at.

**Box nodes deliberately still don't turn.** Their border and icon are drawn identically
at every rotation and only their handles move, so `getNodeGeometry` returns their artwork
box unrotated and `bodyRotation` reports 0 for them. That keeps the trim agreeing with
what is actually *drawn* — the alternative would trim an AOM at 30 px while drawing a
22 px half-body. The wart is now stated in one place instead of being implicit in a
`symbolType === 'symbol'` test, and stage 4 can fix it by rotating box artwork.

**`faceHalf` is exact.** It takes the beam into the component's frame (`rotateBy`) and
intersects its body box (`boxHalfExtent`, a ray/slab exit from the centre), so which face
the beam meets is computed rather than guessed by `isHorizontal`. A 44×44 iris hit along
its diagonal now trims at 22√2 = 31.1 px instead of 22 — the old answer drew the beam
9 px inside the artwork. A waveplate's 6 px axial trim stretches to 6.21 px for a beam
15° off its axis, and back to exactly 6 when the plate is turned to face it.

The equivalence proof is a table over **every placeable type × 4 rotations × 4 beam
directions**, comparing against the old rule inline. The only permitted divergence is a
narrow-bodied component (`beamFaceHalf`) pinned to a rotation with a beam crossing it
side-on, where the old rule returned the axial figure — 6 px into a 72 px plate — and the
new one trims at the artwork edge. The test asserts that divergence set is exactly the
narrow-bodied types and exactly the crosswise directions, so nothing else moved.

**Icon sizing now reads the artwork**, in both the canvas and the diagram: a turned
symbol's occupied box grows (a 90×66 laser at 45° occupies 110×110) and sizing the icon
from `min(box)` would inflate it. Identical at 0/90/180/270, where `min(w, h)` is the same
either way, so again invisible today.

24 tests added (`__tests__/faceTrim.test.ts`): the three boxes and their invariants,
box-node exemption, bounding box at 45° and its monotonic growth, the full equivalence
table, the crosswise-divergence characterisation, diagonal/first-face/off-axis trims,
turning a body into a tilted beam, no zero or non-finite trim anywhere on the lattice,
`boxHalfExtent` on-axis and quadrant symmetry, `rotateBy` exactness and round-trip, and
the three lattice-choice properties. **311 tests total.**

### 2026-08-22 — angle generalisation, stage 1: the primitives

Groundwork for beams at any angle (see the roadmap in §4). **Nothing user-visible
changes** — the UI still offers 0/90/180/270 — and that was the acceptance test: all 256
existing tests passed untouched, and a laser→"/"mirror→PD fold traces to the same integer
coordinates with the same segment ids (`auto_L1_out_to_M1`, `auto_M1_refl_to_PD`).

A full snapshot sits in `../opticalab_backup_pre-stage1/` (71 files, no `node_modules`);
revert with `robocopy <backup> <project> /E /PURGE /XD node_modules dist`.

**`geometry.ts` rewritten around angles rather than cases.** `unitAt(deg)`, `angleOf`,
`normalise`, `norm360`, `cleanDir`, `reflectAbout`, `mirrorSurfaceDeg`, and
`DIR_STEP_DEG = 15`. Angles are clockwise-from-+x in y-down screen coords: 90° is
*downward*. `unitAt` returns exact axis vectors for multiples of 90, so no float dust
enters the common cases.

**Reflection is now the general law**, `d − 2(d·n)n` about the surface normal, instead of
the two hard-coded 45° tables (`reflectSlash`/`reflectBackslash`, both now gone — they had
no callers outside this file, and neither did `quantiseDir`). A mirror's surface is
**45° behind its body axis**, so rotation 0 is "/" and 90 is "\"; that convention now
lives in one function, `mirrorSurfaceDeg`, instead of being spelled `rotation === 90 ||
rotation === 270` at each site. The physics gain is real: a mirror 15° off the beam now
turns it 30°, which the old code could not express at all. A test pins the old tables for
all four rotations × four directions so the change is provably behaviour-preserving there.

**`cleanDir` is float hygiene, not quantisation.** It snaps a direction onto the lattice
only when it is within 1e-6° of it, so `d − 2(d·n)n` off a 45° surface comes back as
exactly `(1, 0)` rather than `(0.9999999999999998, 2.2e-16)` — which matters because
segment ids, the `nodeId|dir|lane` loop key and the collinearity test all compare
directions. A genuinely off-lattice direction is returned as-is rather than silently
corrected; quantising *user input* is a later, separate decision.

**`dirKey` extended without breaking ids.** The four axes keep `e`/`s`/`w`/`n`, so every
generated id reads exactly as before; other directions become `d30`, `d315`, and so on.
Distinctness across the whole lattice is tested, because two directions colliding on one
key would make loop detection treat different beams as the same pass.

**`bodyAxis` is now `unitAt(rotation)`** — one line instead of a four-case switch, exact
for the axes, and answers for any angle.

**`emitterOrigin` generalised**, deleting its four-case switch: *centre of the node's box,
plus half the artwork's own length along the body axis*. Two geometries on purpose — the
rotated box gives the centre, the unrotated one gives the reach — and because the reach is
measured along the artwork's *own* axis, `artwork.width / 2` is correct at every angle, not
just multiples of 90. Verified to reproduce all four rotations exactly.

**One latent wart fixed:** `perpOf` returned `-0` for a zero component (`perpOf({1,0})`
→ `{dx: -0, dy: 1}`), which used to reach `renderShift` and edge data and needed
re-normalising downstream in `beamLayout`. Now cleaned at source. One old assertion had
encoded the `-0`; it now expects `0`.

31 tests added (`__tests__/angles.test.ts`): exact axes and no negative zero across the
lattice, `angleOf`/`unitAt` round-trip, `norm360` wrapping, `cleanDir` snapping dust while
leaving genuine off-lattice angles alone, perpendicularity at every lattice angle, the two
legacy mirror tables, double reflection returning a beam to itself, `mirrorSurfaceDeg`,
twice-the-surface-angle turning, grazing and head-on incidence, lattice closure under
reflection (every beam × every mirror angle, asserted *exactly*), `bodyAxis`/`laneNormal`
orthogonality, `dirKey` stability and distinctness, and `emitterOrigin` through the real
router for all four rotations. **287 tests total.**

### 2026-08-22 — two beams on one photodiode

A photodiode integrates: everything landing on the active area contributes, whatever
direction it came from and whatever colour it is. The trace only ever kept the *strongest*
arrival per node, so a second beam on a detector was drawn and then ignored.

**`nodeArrivals`, alongside `nodeBeams`.** `autoRoute` now publishes
`Map<nodeId, BeamState[]>` — every beam that reached that node, in trace order — while
`nodeBeams` keeps its old meaning, the strongest arrival. Both are needed and the
distinction is the point: a detector reads the *total*, an optic acts on *one beam at a
time*. Two beams on one mirror are still two beams, each with its own reflected port, and
summing them there would be nonsense.

`physics/detector.ts` gained `incidentPower(beams)` — the sum, or null when nothing
arrives, so "dark" stays distinguishable from "reads zero". The canvas node, the diagram
label and the properties panel all read the signal from it, so all three agree. The panel
lists each arrival as `Input Beam 1..N` and adds a `ΣP` row with the beam count.

**Beat notes are reported, not modelled.** `detectorBeat(node, beams)` gives the smallest
non-zero optical-frequency difference among the arrivals (carrier *and* detuning, since
those are stored separately) plus whether it fits inside the detector's `bandwidth`. The
panel says so when it applies. Powers add; fields do not — relative phase and spatial
overlap aren't tracked anywhere in this model, so the interference term genuinely isn't
there, and a heterodyne setup showing a flat DC level should say why.

**Bug found on the way: a turned laser emitted 12 px off its own axis.** `emitterOrigin`
took the *unrotated* geometry, so a 90° laser (a 66×90 box once turned, not 90×66) fired
from `x = centre + 12`. That is beyond `BEAM_SNAP_DIST = 10`, so a component correctly
lined up under a vertical laser was missed entirely and the beam ran off as a free ray —
which is exactly the geometry you need for two beams onto one detector. Now uses the
rotated geometry. Two older tests had quietly encoded the offset (`laser('L2', 388, …)`
to hit a mirror at 400); they now use 400, which is what they always meant.

The laser's rendering had the mirror-image of the same bug: the artwork was drawn at the
*rotated* size and then rotated again, so a vertical laser came out landscape inside a
portrait box, its visible output face off-axis. It now draws at the unrotated size,
absolutely centred, and turns from there — so the icon fills its box and the drawn face
is where the router emits. No change at all for rotation 0/180.

Verified against the app's own modules: a 30 mW carrier and the +80 MHz first order of an
AOM (8 mW) landing on one photodiode give **two** arrivals, `ΣP = 38 mW`, `38.00 V` at
1 V/mW, and a reported 80 MHz beat inside the diode's 100 MHz bandwidth; both beams get
their own edge into the detector, on handle `in`, with distinct ids. The panel/canvas
wiring itself is covered by types and tests rather than a screenshot — this preview
session can neither reach the app's store nor render edges (both in §5).

17 tests added (`detector.test.ts`): `incidentPower` summing, single-beam and empty cases;
a two-laser layout giving two arrivals, the total reading, the strongest still exposed
separately, both beams drawn to the detector (one horizontal, one vertical), two distinct
edges on handle `in`, no repositioning from the second beam, and the reading tracking both
powers; `detectorBeat` for the RF case, the over-bandwidth case, the two-carrier case,
the closest of three beams, and the nothing-to-beat cases. Plus one in `traversal.test.ts`
for the turned-laser axis. **256 tests total.**

### 2026-08-22 — optical amplifier (TA / fibre amp), and drive current on both sources

A seeded gain stage: takes a beam in, puts a stronger beam of the same colour out.
`optical_amplifier`, in the **Laser Sources** category next to the laser, defaults
`outputPower: 1000` mW at `current: 2000` mA — a plausible tapered amplifier.

**The output power is stated, not derived.** `P_out = outputPower` when seeded, `0` when
not. It was briefly parameterised as a saturable gain
(`min(P_in · G, P_sat)`) before being simplified on request, and the simpler form is the
better fit: on a real TA the output power is what you read off a power meter, and a gain
figure is only ever a way of guessing it. Insertion loss is *not* applied on top — the
stated figure is what leaves the device.

"Seeded" means `P_in ≥ MIN_POWER_MW`, so a beam that has decayed below the tracer's floor
can't be resurrected at full power by an amplifier sitting in its path — which would
otherwise be a way to manufacture watts out of a dead branch. A negative `outputPower`
gives 0 rather than a negative beam.

**Everything except power passes straight through.** The output port is
`{ ...inBeam, power }` on the entry lane: wavelength, `detuningHz`, polarisation and the
whole Gaussian `q` are the seed's. That is what "same frequency" means here — an
amplifier downstream of an AOM keeps the +80 MHz shift — and it makes the amplifier
invisible to the mode calculation, which is right for a gain medium and wrong only if you
wanted its internal telescope modelled (not done).

**No ASE.** An unseeded amplifier outputs exactly nothing, rather than a floor of
broadband light. Simplification, and stated in the properties-panel hint so it can't
surprise anyone.

Not in `power.ts`'s `transmissionFraction` table, deliberately: the output bears no fixed
relation to the input, so it can't be written as a fraction. A NOTE there says so, since
that table otherwise looks exhaustive.

Icon: a 64×44 module with a gain stripe tapering toward an emphasised output facet, so
the direction of amplification is readable at a glance. Geometry is `symbolType: 'symbol'`
so it rotates to face the beam — the taper is directional, unlike a box.

**Drive current, on lasers and amplifiers alike.** `current?: number`, mA, optional, and
read by nothing in the physics — it exists so a layout records the setting that produced
the quoted power, which is the number you actually want when you come back to a setup.
Stored in mA for both so one field covers a diode (~150 mA) and a TA (~2 A);
`utils/units.ts` `formatCurrent` quotes it in amps past 1000 mA, the way a spec sheet
does. It shows in the properties panel always, and as an `I` annotation in the Diagram
only when set, so old layouts don't sprout a `0 mA` label. `formatSourcePower` lives
beside it, replacing the inline mW/W formatting the diagram used for a source's own power.

Verified in the app: 30 mW seed → **1000 mW** out at 780 nm with `w` continuous across the
device (800 → 802 µm), 950 mW after a 95 % isolator; a 5 mW seed into a 900 mW amplifier
gives the same 900 mW out (the seed level doesn't matter, only that there is one); with a
beam block before it, the amplifier emits nothing at all. Palette currents format as
`150 mA` and `2.00 A`.

22 tests (`__tests__/amplifier.test.ts`): the stated output from three seed levels, zero
in → zero out, the `MIN_POWER_MW` seed floor, a negative output power refused, single
transmitted port on the entry lane, not an emitter, λ/Δf/pol/`w₀` pass-through, power
arriving downstream, seed level not mattering in a routed layout, going dark behind a beam
block, staying on axis, current changing nothing about the beam or a laser's emission,
current being optional, both formatters at every unit step, and the
palette/geometry/`transmissionFraction` wiring (including that `gain`/`saturatedPower` are
gone). **239 tests total.**

### 2026-08-16 — photodiodes read volts; Save asks where

**`responsivity` (A/W) → `signalFactor` (V/mW).** What you actually calibrate on a bench
is volts per mW on the scope, which folds the diode's responsivity together with whatever
transimpedance or amplifier gain follows it — a bare diode into 50 Ω and the same diode
into a 10 kΩ TIA differ by more than two decades, so A/W alone never told you the reading.
`physics/detector.ts` holds `detectorVolts` (takes power in mW, so callers subscribe to
just that scalar) and `formatVoltage`, which steps kV → V → mV → µV at ~3 significant
figures.

**Optional volts beside the component.** `showSignal` on a photodiode prints the reading
under its icon, in both views, via `detectorSignalLabel`. It is independent of
`showLabel` — the signal can show with the name hidden, which is the common case now that
names are off by default — and reuses the label-layout slack/scale rules. A detector with
no beam on it reads `— V` rather than `0 V`, so "nothing arrives" is distinguishable from
"nothing measured". The properties panel also shows the computed signal under the input
beam.

Scoped to `photodiode`, since that is where `responsivity` lived. An APD would want the
same treatment (it has `gain` and `bandwidth` but no signal factor) — not done.

**Save now opens a file dialog.** `saveTextAs` in `utils/export.ts` uses
`showSaveFilePicker`, so the user picks folder and name instead of the file landing in the
downloads folder. Dismissing the dialog is treated as a normal outcome, not an error.
Where the picker doesn't exist — Firefox and Safari — it falls back to the old anchor
download; Chromium, including the Electron build, has it. The figure exports (⤓SVG, ⤓PNG)
still download directly; they could use the same helper.

Verified in the app: 100 mW through an OD-1 filter into a 2 V/mW photodiode shows
**20.00 V** on the canvas with the name hidden, and `Signal 20.00 V` in the panel; Save
called the picker with `opticalab_layout.json` and wrote 1520 bytes of valid layout JSON;
cancelling raised nothing.

13 tests added (`__tests__/detector.test.ts`): volts from power at 50 Ω and 10 kΩ gains,
null for non-photodiodes / no beam / a non-numeric factor, every unit step of
`formatVoltage`, the label only appearing when asked and reading `— V` with no beam, the
signal tracking the power that actually arrives through a filter, and the palette carrying
`signalFactor` rather than `responsivity`. The `responsivity: 0.5` in ~30 test fixtures
became `signalFactor: 1`. **217 tests total.**

### 2026-08-16 — power probe

A measurement annotation: a ring that snaps onto a beam, a dashed leader, and a readout
you can drag independently. New category `utility` ("Layout & Annotation").

**It is deliberately not an optic.** `NON_OPTICAL_NODE_TYPES` now covers it as well as the
phantom endpoints, so the tracer never sees it — no split segment at the probe, no trace
budget consumed, and no need to exclude it from terminator/loss/annotation lists one by
one. `physics/probe.ts` instead projects the probe onto the nearest drawn beam
(`nearestBeam`), reads that segment's beam, and advances the Gaussian to the exact point
(`probeBeam`) so the spot size is the one at that plane. `probeSnaps` runs after the trace
in EditorCanvas and merges into the same snap map the optics use. A test asserts the trace
is byte-identical with and without a probe present.

**One node, not two.** The readout is an offset within the probe's own node, dragged by
pointer events (`nodrag`, zoom-compensated, committed to `labelDx`/`labelDy` on release so
the canvas isn't reloaded per frame). Two nodes joined by an edge would have been more
idiomatic xyflow, but that leader would be a *user edge*: `resolveUserWires` would try to
resolve a beam along it, and the label would land in `userTargets` and block auto-routing
at that point.

Worth knowing: **power is constant between components**, so sliding a probe along one beam
won't change the power — only which beam it finds. Spot size does vary. The properties
panel says so, alongside toggles for wavelength / detuning / spot size.

Verified in the app: two probes dropped *off* the beam snapped onto it, reading 100.00 mW
before an OD-1 filter and 10.00 mW after, with `w = 805 µm`; dragging a readout moved it
71 px for a 60 px gesture at 0.85 zoom while the probe itself stayed put; the editor still
showed exactly 2 segments; and the diagram drew both rings with matching readouts.

23 tests added (`__tests__/probe.test.ts`): projection and reach, clamping past a beam
end, picking the nearer of two beams, constant power vs varying spot along a segment,
snapping (including locked probes and no-beam cases), readout formatting down to nW, and
router-level checks that a probe leaves the trace untouched and reads correct powers
either side of a filter and at a lens focus. **204 tests total.**

### 2026-08-16 — palette trimmed, shallower concave lens

**Removed the whole `optomechanics` category** (rotation stage, linear stage, tip/tilt,
breadboard) **and the vacuum chamber.** None of them were in a beam path — they were
mounts and furniture — so nothing in the physics referenced them beyond a
`transmissionFraction` case. Cleared out of: the type union and `ComponentCategory`,
`CATEGORY_COLORS`, `CATEGORY_LABELS`, the palette, `nodeGeometry`, the sidebar's category
order, the minimap's colour map, `power.ts`, five properties-panel field blocks, and five
icon components. `coldatom` stays, since the vapour cell lives there.

One catch worth knowing: `BreadboardIcon` was doubling as `getNodeIcon`'s `default`
fallback, so deleting it would have left every unknown type without an icon. Replaced with
a deliberately plain dashed-box `UnknownComponentIcon` — which is also what a **previously
saved layout** containing one of the removed components will now render, with
`getNodeGeometry` falling back to 60×36 and the beam passing through. Those files still
load; the components just show as unknown.

**The plano-concave lens is half as hollowed out.** Its curve is a quadratic whose deepest
point sits at `(edge + 2·control + edge)/4`, so pulling the control from 7 to 11
(and 17 → 13 flipped) takes the dish from 4 units deep to 2 — centre thickness 4 against a
6-unit edge, instead of 2 against 6. Reads better at icon size.

Two tests were using removed types as convenient examples (`vacuum_chamber` as the
unrecognised-component case, `breadboard` in a box-node list) and now use `delay_line` and
`fiber_cable`. **181 tests still pass.**

### 2026-08-16 — component names are off by default

`showLabel` is now read as `=== true` rather than `!== false`, so a name is drawn only
when explicitly switched on. Both views follow it — the diagram was drawing names
unconditionally, which would have left the two panels disagreeing.

To keep names findable, every node carries a `title`, so hovering shows the name, and the
properties panel shows it whichever way the toggle is set. Nothing in the palette sets
`showLabel`, so freshly dropped components are unlabelled without each entry opting out.

Note this also hides names in **existing saved layouts**, since they store no `showLabel`
— per-component toggles bring them back.

2 tests added pinning the default and the palette entries. `!== false` vs `=== true` is a
one-character slip that would silently restore the old behaviour, hence encoding it.
**181 tests total.**

### 2026-08-16 — fibre optics behave like fibre

**Beams no longer pass through fibre components.**

- **Coupler** — free space *into* fibre, so it ends the free-space path. It emits a
  single `dumped` port (`dumpedAs: 'coupled in'`) carrying `P·η·loss`, so the panel
  reports what made it into the fibre while nothing continues downstream.
- **Patch cord** — not a free-space optic at all. Returns `[]`: a beam landing on one
  stops there rather than passing through as if the glass were a window.
- **Launcher** — now a **beam source**, like a laser. `isEmitter()` covers it, the tracer
  seeds from it, and it gained `wavelength` / `outputPower` / `polarization` / `waist`
  (its output is stated directly; there is no fibre-link model carrying power from a
  coupler). Light *arriving* at one is absorbed and warned about — it couples back down
  the fibre, the same hazard as feedback into a diode. `couplingEfficiency` is retained
  as a legacy no-op field so old files still load, and missing source fields fall back to
  780 nm / 1 mW / H.

Two things this shook out: the launcher needed adding to `BEAM_THROUGH_TYPES`, or its
emitted beam started 22 px clear of the icon (an emitter's ray already begins on the
face, so trimming again double-counts); and the properties panel titled its readout
"Input Beam", which is now `isEmitter()`-driven and reads "Output Beam".

**Icons redrawn**, and the launcher no longer shares the coupler's. The coupler shows a
lens converging onto a fibre tip in a ferrule with the cable curling away; the launcher
is its counterpart, ferrule then collimating lens with parallel rays leaving — the
converging-vs-collimated rays are what tell them apart at a glance. The patch cord is now
two connectors with slack cable between them, stretched to fill its box.

16 tests added (`__tests__/fiber.test.ts`): coupled power with and without insertion
loss, the coupler terminating a layout and stopping at its face, the cable having no
output, launcher emitter-ness and beam seeding with no laser present, fallbacks for older
files, emission direction, beam starting flush with the face, feeding a downstream chain,
absorbing and warning on incoming light, and launcher → free space → coupler end to end.
**179 tests total.**

### 2026-08-16 — vapour cell, and label placement/sizing

**New component: `vapor_cell`.** A glass tube drawn side-on with wedged end windows and
the reservoir bell standing up in the middle, in the editor's line-art style. Symbol
type, 88×44, so it auto-rotates to face the beam, and it is in `BEAM_THROUGH_TYPES` —
the beam runs the length of the tube. Fields: species, length, temperature, window
wedge (which tilts the windows in the icon), and buffer gas. **Resonant absorption is
not modelled** — the cell passes the beam and `loss` stands in for attenuation; doing
it properly needs a Doppler profile against `detuningHz` plus a vapour-pressure curve.

**Labels sit closer to their artwork.** Symbol icons are drawn square at
`min(width, height) + 4` and centred in the node's box, so a tall narrow component left
a band of empty box below it — a waveplate is 36 px of artwork in a 72 px box, leaving
its label floating 23 px below the glyph. `utils/labelLayout.ts` computes that slack and
both views subtract it (a negative margin on the canvas, a smaller y offset in the
diagram). Waveplates, lenses, polarizers and ND filters all gain 18–20 px; square and
box nodes are untouched, since the clamp at zero means the label can only move closer.

**Label size is adjustable.** A slider in the editor toolbar drives `labelScale`,
0.5×–1.5× in 0.05 steps, applied to both views (each against its own base — 9 px on the
canvas, 8 px in the diagram). The gap scales with the text, so smaller labels also sit
closer in. It is a view setting, so like theme it isn't saved with the layout.

Also moved `iconDimensions` out to `utils/iconMetrics.ts`. A few icons are wider than
they are tall (laser head, vapour cell) and the diagram positions icons by hand, so it
needs their real drawn size — keeping it in NodeIcons.tsx would have added a second
non-component export and a fresh lint error.

10 tests added (`__tests__/labelLayout.test.ts`): the waveplate slack figure, lenses and
polarizers getting the same treatment, square and box nodes getting none, slack never
negative, text and gap scaling together, per-view base sizes, rotation swapping the
geometry so a turned waveplate needs no correction, the slider range staying legible,
and the vapour cell lying along the beam and turning with it. **163 tests total.**

### 2026-08-16 — smaller acousto-optic cell

The AOM/AOD body went from 64×88 to **60×44**, the same height as a mirror or PBS, so it
no longer towers over a bench line. Nothing functional moved:

- The 88 px height existed only to keep the 1-inch dump lane inside the body. Lane
  separation is the constrained quantity — it must clear 2 × `BEAM_SNAP_DIST` (20 px) and
  a beam block's 26 px half-height, and sit on the hole grid — so it stays at 40 px.
- For a horizontal beam the face trim is `width/2`, so height never entered the physics;
  it only set the visible box, the bounding box, and the invisible `order0` handle.
- The dump lane is now outside the body, so both views draw a dashed **peel-off line**
  from inside the cell to the exact point where the 0th-order beam begins — the exit
  face, `centre + width/2`. A test pins that continuity so the icon and the router can't
  drift apart.
- The `order0` handle is clamped to the body edge rather than floating 40 px below it;
  its position is cosmetic, since auto-edges carry explicit coordinates and only the
  handle's existence matters to xyflow.

Verified: laser → AOM (0th order routed out) → block on the dump lane, detector on the
main lane. The cell renders 60×44 next to a 44×44 mirror, the diffracted beam still
starts at x = 530 for a cell centred at 500, and the 18 mW 0th order still starts at the
same x on its lane at +40 and terminates on the block. **153 tests pass.**

### 2026-08-16 — the classic double pass, with the PBS and λ/4 before the cell

Confirmed the arrangement AMO benches actually use — PBS and λ/4 *upstream* of the AOM,
so the double-passed arm is just AOM → retro — and fixed two things it exposed.

- **An extinguished port is no longer traced.** The tracer skips a port whose power is
  below `MIN_POWER_MW`. An ideal PBS fed pure H puts nothing in its V port, and that was
  being drawn as a full-length beam: in this layout it streaked 4000 px off the PBS and
  laid another dead leg back at the laser. Consequence to know about: a beam decaying
  *below* 1 µW now isn't drawn on its final leg either, which is consistent with treating
  that as extinguished. Three assertions got stronger as a result — "a 0 mW segment
  exists" became "no beam reaches that arm at all".
- **`jonesToPolarization` now recognises circular light.** Equal amplitudes a quarter
  wave apart report as `circular` with handedness instead of `custom`. The whole
  double-passed arm is circular in this configuration, so the readout used to say
  nothing useful there; the AOM panel now reads `Pol RCP`. Snapping to the canonical
  LCP/RCP vector discards only a global phase, which nothing in the model observes, and
  the H→V round trip through two waveplate passes is unaffected.

Verified in the app: Master → PBS → λ/4 @45° → AOM(+80) → cat-eye gives **eight beams and
no dead ones**, `+160 MHz · 64 mW · Pol V` extracted downward off the PBS, `Pol RCP`
through the cell, and nothing drawn back at the laser.

15 tests added: the arrangement's shift/power/polarisation and downward extraction, the
waveplate being crossed once each way, circular light on both AOM passes, upward
extraction with a "\" PBS, the −1 order giving −160 MHz, single-pass fallback when the
retro is removed, equivalence with the λ/4-after-cell arrangement, no dead segments
anywhere, and a waveplate block covering H→circular→V, handedness flip under two passes
(a λ/2 reverses it), and elliptical states still reporting `custom`. **153 tests total.**

### 2026-08-16 — AOM phase 5: retroreflector, and the double-passed AOM works

Case 2 done. The tracer change is four lines; everything else was already in place from
phases 1–4, which is the point of having sequenced it that way.

- **`PortKind` gained `'retro'`** and the tracer's direction choice moved into
  `portDirection(kind, incoming, rotation)`: `reflect` bounces off a 45° surface,
  `retro` returns `-incoming`, `transmit` carries on.
- **New `retroreflector` component** (palette "Retroreflector", default name "Cat-eye"),
  with `reflectivity` and `focalLength`. Symbol node, 44×44, `beamFaceHalf: 13` so the
  beam stops at the lens rather than the bounding box. It auto-rotates to face the beam,
  and its in/out handles share a face. New icon: lens, converging rays, and a hatched
  mirror at the focal plane.
- **The cat's eye is modelled optically.** Cascading lens f → space f → mirror → space f
  → lens f gives `[[-1, 2f], [0, -1]]`, i.e. q → q − 2f, which cancels the 2f the tracer
  adds for the flight out and back: a component one focal length away is imaged onto
  itself, so the return beam comes back the same size. `focalLength: 0` gives a corner
  cube (identity). This is what stops a real double-pass walking when the AOM is retuned.
- The laser feedback warning is now gated on `power ≥ MIN_POWER_MW`, since an ideal PBS
  leaves a 0 mW port on the wrong polarisation and that isn't feedback worth flagging.

**Everything about the double pass falls out of existing machinery**: the second
frequency shift from phase 1's accumulating `detuningHz`, the return path from phase 4's
per-ray loop detection (which sees `(AOM, west, lane 0)` as distinct from
`(AOM, east, lane 0)`), the visible separation of the counter-propagating legs from
phase 2's fanning, and the η² penalty from simply traversing the cell twice.

Verified in the app on Master → PBS → AOM(+80) → λ/4 @45° → cat-eye:
**+160 MHz and 64 mW = 100 × 0.8²** extracted downward off the PBS, drawn 3 px off the
outbound legs, with **0 mW** going back at the laser. The properties panel on the output
reads `Δf +160 MHz · P 64.00 mW · Pol V`, confirming the two waveplate passes rotated
H→V so the PBS could extract it. (Editor canvas still unusable in this preview browser —
see §5; checked via the Diagram and the panel.)

18 tests added (`__tests__/doublePass.test.ts`): the retro port and its reflectivity, the
cat-eye matrix and its determinant, exact imaging at f versus a corner cube's continued
divergence, retroreflection from two incident directions, the return beam being fanned,
and the full double pass — 2×f_RF, η² scaling with efficiency and with drive frequency,
H→V rotation, downward PBS extraction, exactly two traversals of the AOM/waveplate/PBS,
near-zero power back at the laser with no spurious warning, and round-trip path length.
**139 tests total.**

### 2026-08-16 — AOM phase 4: exact traversal, absorbing lasers, one-way isolators

Item **D**. The last blocker for double-pass (phase 5) is gone: a beam may now travel
back through a component.

**Removed** `visitedDirs` and its three heuristics — the anti-parallel ban, "≤2
co-propagating passes", and "≤2 entries for splitters". They existed only to stop
runaway loops, and they made counter-propagation and perpendicular re-entry impossible.

**Added** exact loop detection. Each ray carries a linked-list `path` of
`nodeId|direction|lane` keys; branching at a splitter shares the tail, so extending a
path is one allocation. Re-entering a component the same way on the same lane closes a
loop: the closing segment is drawn (so a resonator is visible) and the ray stops.
Termination now rests on three bounds — exact loop detection, the 1 µW power floor, and
caps `MAX_TRACE_STEPS = 300` (global, was 80) and `MAX_RAY_HITS = 64` (per ray).
First-touch bookkeeping for positioning/rotation moved to a separate `firstTouch` map,
since that is deliberately global rather than per-ray.

**Lasers absorb.** `componentOutputs` returns `[]` for `laser_source`, and the router
raises a warning: *"A beam is entering this laser… add an isolator."* `RouteResult`
gained `warnings`, the store exposes them keyed by node, and the properties panel shows
them in an amber box on the selected component. Lasers also gained an `in` handle —
without it xyflow silently dropped every edge pointing at one.

**Isolators are one-way.** `PortContext` gained `entryDir`, and the isolator compares it
against `bodyAxis(rotation)`: forward gives its transmission, reverse gives
`10^(−isolation/10)`. The first beam to arrive fixes the orientation (it is auto-rotated
like any symbol node), so a user wanting the other direction sets the rotation
explicitly. Absent `entryDir` means forward, which is what the properties panel wants.

Also clamped the collinear fan to 3 steps (±9 px) so a resonator's many passes on one
line can't smear across the figure.

Verified in the app on two facing lasers either side of an isolator (T = 90 %,
30 dB): the isolator is traversed **both ways**, giving **90 mW forward and 100 µW
reverse**, with the counter-propagating pairs fanned to y = 236 and 230 about the true
axis at 233. Both lasers absorb their incoming beam and both show the feedback warning.

*Verification note:* the editor canvas could not be used for this — see §5,
`ResizeObserver` does not fire in the restarted preview browser, so xyflow renders no
edges. Checked via the Diagram tab (same segments, no measurement needed), the
properties panel, and unit tests.

15 tests added (`__tests__/traversal.test.ts`): two beams crossing at one mirror,
first-arrival positioning, a ring cavity traced exactly once round with 50 % → 25 %
circulating power and `truncated === false`, a perfect-mirror ring terminating rather
than hanging, lasers absorbing and warning once each, and the isolator forward/reverse
by figure, by rotation, defaulting to forward, and end-to-end in a layout.
**121 tests total.**

### 2026-08-16 — AOM phase 3: beam lanes, and case 1 works

- **`physics/lanes.ts`** — `componentLanes(data)` returns the perpendicular offsets of
  a component's parallel beam axes (default `[0]`; AOM/AOD `[0, ±1 inch]`), plus
  `bodyAxis(rotation)` and `laneNormal(rotation)`. `autoRoute`'s private `laserDir` was
  the same 4-way map and now uses `bodyAxis`.
- **The tracer tests every lane.** The candidate loop computes the signed displacement
  `s` of a node's centre from the ray line and looks for the lane satisfying
  `|s + L·(n·perp)| ≤ BEAM_SNAP_DIST`, then snaps the component so *that* lane lands on
  the beam (`laneCentre = hit − n·L`). Output rays leave from `laneCentre + n·L_port`.
  With a beam crossing the body axis (`|n·perp| < 0.5`) the extra axes project onto each
  other, so it falls back to the centre.
- **AOM ports carry a lane.** The diffracted order stays on the entry lane; the 0th
  order goes to the other one. `dumpZeroOrder` (default true) keeps it blocked inside
  the cell as before; unticking it routes a real 18 mW beam out along the dump lane where
  a `beam_block` can be placed on it — **case 1**.
- **AOM/AOD geometry is now 64 × 88** so both lanes sit inside the body and a beam never
  appears to leave from empty space. The icon is a stretchable grating
  (`preserveAspectRatio="none"`) so it needed no redraw. The old 20°-upward decorative
  stub is replaced by a real dump-lane marker at the lane offset, solid with a block
  glyph when absorbed and dashed when routed out.
- Added the `order0` handle at the dump-lane percentage, and a "Block 0th order at cell"
  toggle to both the AOM and AOD panels.

Verified in the app: laser → AOM(+80, dump routed) → PD on the main lane, block on the
dump lane. Three beams — 100 mW in, **+80 MHz / 80 mW straight through at y = 232.8**,
and **18 mW at y = 272.8 terminating on the block**, which snapped exactly onto the dump
lane. Ticking the toggle removes the dump beam and flips the icon glyph; the panel still
reports the dumped 18 mW either way.

17 tests added: lane tables for ordinary vs acousto-optic components, the
separation-vs-snap-distance constraint, `bodyAxis`/`laneNormal`, port lane assignment
from either entry lane, and router-level checks — an existing centred AOM is still
found and needs no snap, the diffracted order stays on the entry axis, the 0th order
lands on its own lane (and on the opposite side for −1), no beam is emitted while
blocked, neither lane captures the other's components, a mispositioned AOM snaps by its
centre lane, the dump lane stays on the same physical side for a backwards beam, and
case 1 end to end. **106 tests total.**

### 2026-08-16 — AOM phase 2: rays carry their true positions

Item **E** from §4, and the prerequisite for lanes (phase 3) and counter-propagating
beams (phase 5). No user-visible physics change; a large simplification of the router.

**Removed.** `Ray.offset` (a ray-local perpendicular scalar), the
`BEAM_VISUAL_OFFSET = 1.5` constant, the `isPerpEntry` branch that displaced an
upstream mirror by 1.5 px to separate combined beams, and the retroactive segment
patch that reverse-scanned already-emitted segments to fix a `tx`/`ty` afterwards.
Net ≈55 lines of offset bookkeeping deleted from `autoRoute`; segment endpoints are
now four plain lines.

**Added.** `physics/beamLayout.ts`:
- `fanCollinearSegments(segments)` — post-pass over the finished segment list. Groups
  segments that are axis-aligned, collinear within 0.75 px, and genuinely overlap by
  more than 2 px; the first keeps its true position and the rest alternate outwards
  by `BEAM_FAN_SEPARATION = 3` px. Writes display-only `BeamSegment.renderShift`.
- `drawnEndpoints(seg)` — the one place a renderer gets drawn coordinates. Auto-edge
  `sx/sy/tx/ty` and the diagram's `<line>` both go through it, so the views cannot
  diverge; the diagram shifts its waist marker by the same vector.

Two subtleties handled: segments that merely **meet end-to-end** at a component (i.e.
every ordinary beam path) must not be fanned or the whole chain would zig-zag, and
**diagonal** segments are excluded because a user-drawn wire runs centre-to-centre
and has no single axis coordinate.

Verified in the app on a PBS combiner (H laser straight through; V laser up off a
mirror onto the same axis). The mirror now snaps to **x = 460.0 exactly** instead of
458.5, both combined beams reach the detector at 100 mW each, and they are drawn at
y = 132.82 and 135.82 — visibly separate where the old 1.5 px gap was not. Editor
and diagram report byte-identical coordinates.

19 tests added (`__tests__/beamLayout.test.ts`): fanning geometry in both
orientations, three-way fanning, the end-to-end and sub-minimum-overlap cases that
must *not* fan, sub-pixel axis tolerance, crossing and diagonal exclusion,
counter-propagating overlap (the phase-5 case), plus router-level checks that an
ordinary path is never fanned, that combined beams stay physically collinear while
drawing apart, that auto-edges carry drawn coordinates, and that `lengthMm` is
unaffected by the shift. **89 tests total.**

### 2026-08-16 — AOM phase 1: frequency detuning and a real 0th order

First slice of the AOM roadmap in §4. No geometry changes — that is phase 2/3.

- **`BeamState.detuningHz`** carries every RF-scale frequency shift; the carrier
  wavelength no longer moves at an AOM (`outputWavelength` lost its AOM case, which
  only ever perturbed λ by ~1e-7). Added `formatDetuning` and `opticalFrequencyHz`
  to `wavelength.ts`. Frequency doubling scales accumulated detuning with the
  carrier, so 780 nm +80 MHz → 390 nm +160 MHz.
- **The AOM now emits two ports.** `order1` carries η·P and ±f_RF; `order0` carries
  max(0, T−η)·P and is marked `dumped` — accounted and reported, but not traced.
  `OutputPort.dumped` is the new mechanism; the tracer skips those ports and
  `outputPortFor` never resolves a handle-less wire to one.
- **`transmission` is finally read**, as the RF-off throughput of the cell:
  P₁ = P·η, P₀ = P·max(0, T−η), lost = P·(1−T). Because η is read as a fraction of
  *incident* power, **first-order power in existing layouts is unchanged** — T only
  affects how much appears in the 0th order. Palette defaults moved to a realistic
  T = 98 % (AOM was 80, AOD 70) so new cells show a sensible dump.
- **UI:** beam labels in both views read `780 nm +80 MHz`; the properties panel
  gained a Δf row, a Transmission field, a live hint naming the shift, and a dimmed
  "0th Order — dumped" readout. `activeOrder: '0'` propagates the undiffracted beam
  at P·T with no shift (file compatibility).

Verified in the app on laser → AOM(+80) → AOM(−110) → PD: labels read
`+80 MHz / 80.0 mW` then `-30 MHz / 64.0 mW` (= 100 × 0.8²), with **3 edges** — no
stray 0th-order beams. AOM1's panel shows 80 mW diffracted + 18 mW dumped + 2 mW
lost to (1−T) = 100 mW in.

21 tests added (`__tests__/aom.test.ts`): detuning formatting across magnitudes,
carrier/detuning separation, port power accounting, −1 order, `activeOrder: '0'`,
the legacy T = η case, η > T clamping, insertion loss on both orders, chained and
cancelling shifts, SHG detuning doubling, AOD, and router integration.
**70 tests total.**

### 2026-08-15 — physical scale and live Gaussian beams

Implemented item **C** from §4. The ABCD code is no longer dead: every beam in the
layout carries a real Gaussian mode.

- **`scale.ts`** — `PX_PER_INCH`/`PX_PER_MM`, `pxToMm`/`mmToPx`, plus
  `formatLength`/`formatSpot`. The 40 px grid in both the editor `<Background>`
  and the diagram pattern now derives from `PX_PER_INCH`.
- **`gaussian.ts` rewritten** around explicit units (mm everywhere) and honest
  names: `waistQ`, `advanceQ`, `beamRadiusAt`, `waistRadiusOf`, `distanceToWaist`,
  `rayleighRangeOf`, `divergenceOf`, `effectiveWavelengthMm`. M² is handled with
  the embedded-Gaussian trick (propagate at M²·λ). Removed `lensFocusing` and
  `extractGaussianParams` — the former assumed the input waist sat at the lens,
  the latter returned `Re(q)` mislabelled as a waist.
- **Lasers gained `waist` (µm) and `mSquared`**, editable in the properties panel.
  Layouts saved without them fall back to `DEFAULT_WAIST_UM` (800 µm), so the
  chain is always live and old files still load.
- **The tracer advances `q` across every gap** (`advanceBeam` over the
  centre-to-centre distance) before asking the component for its outputs, so a lens
  anywhere along the beam is handled correctly. This replaced the old
  at-waist approximation in `transformBeam`, which recomputed `q` from scratch at
  each lens and so ignored where the beam actually was.
- **`componentABCD(node)`** is the new seam for optical power — thin lens today,
  identity elsewhere.
- **Display:** beam labels in both views gained `w=…`; the properties panel shows
  w, w₀, Δz-to-waist, z_R and θ for the input beam and every output port; the
  diagram marks each focus that falls inside a segment with a tick and `w₀=…`.
- `BeamSegment` gained `lengthMm` and an optional `waist { x, y, radius }`.

Verified in the running app on a laser → f=100 mm lens → detector bench: an
800 µm / 780 nm beam reads w=802 µm at the lens (158.75 mm downstream), and the
lens output reads **w₀ = 31.0 µm, 100 mm ahead, z_R = 3.9 mm, θ = 8.00 mrad** —
matching λf/(πw) = 31.0 µm analytically. The diagram's focus marker lands at
x = 557.62 px, i.e. the exact 100.088 mm focus rather than a nominal f.

25 further tests added (`__tests__/gaussian.test.ts`): scale round-trips, w(z)
against the closed form, √2 growth at z_R, far-field divergence, waist invariance
under free space, M² scaling, the analytic thin-lens waist/location relations,
diverging-lens sanity, SHG spot = w/√2, and end-to-end focus placement through
the router. **49 tests total.**

### 2026-08-15 — single engine + diagram as renderer

Implemented items **A** and **B** from §4.

**One physics engine.** `propagate.ts` now exposes `componentOutputs(inBeam,
node) → OutputPort[]`, the only description of what each component emits. The
ray tracer, the user-wire resolver, and the properties panel all call it.
`propagateAll` (the second, graph-walking engine) is gone.

- Polarization is now threaded through the trace, so `λ/2 → PBS` splits
  correctly (verified in the running app: 100 mW H → 50.0 mW H + 50.0 mW V).
- Insertion loss applies on every port, splitters included.
- `insertionLossFactor` split out of `transmissionFraction` in `power.ts`.
- New `geometry.ts` holds `mirrorReflect` etc.; `OpticalNode` uses it instead of
  its own copy, so handle placement can't disagree with the router.

**Diagram is a pure renderer.** It maps over `store.segments` and derives no
geometry:

- Free-space beams appear (they used to vanish — their phantom targets aren't in
  the store, so the old `nodePos` lookup returned `undefined`).
- The bogus L-elbow path for reflected beams is gone, along with labels that
  landed on top of mirrors.
- Icons are nested `<svg>` instead of `<foreignObject>`, so the figure rasterises
  and opens in vector editors. `⤓ SVG` / `⤓ PNG` buttons export it via
  `serializeSVG` / `downloadPNG`; the old `exportAsPNG`/`exportFlowAsSVG` (which
  serialised only the xyflow edge layer — beams, no components) are removed.
- Editor and Diagram were verified to emit byte-identical beam coordinates for
  the same layout.

**Also fixed along the way:** the properties panel's beam readout (was querying
an edge-keyed map with a node id, so it never rendered — now shows input beam
*and* one block per output port); segment/phantom/edge ids are stable across
route passes instead of depending on traversal order; `autoRoute` reports
`truncated` when it hits the step cap rather than dropping rays silently.

**Tests.** Vitest added; 24 tests in
`src/physics/__tests__/autoRoute.test.ts` covering tracing, snapping,
mirror handedness, PBS/NPBS/dichroic/SHG/AOM physics, insertion loss, user
wiring, id stability and axis-alignment. `npm test`.
