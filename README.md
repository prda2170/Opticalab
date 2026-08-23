# OpticaLab

A free-space optical layout designer for AMO / laser labs. Drop components on a virtual
breadboard, and the beams route themselves — with real physics behind them: Gaussian mode
propagation, polarisation through Jones matrices, AOM diffraction orders with their RF
frequency shifts, and power bookkeeping from the laser to the photodiode.

Built because drawing a beam path in Inkscape tells you nothing about whether it works, and
a full ray-tracer tells you far more than you want while you are still deciding where the
mirrors go.

<!-- A screenshot belongs here. Editor tab, a layout with an AOM double pass, dark theme. -->

## What it does

- **Beams route themselves.** Put a component anywhere near a beam and it snaps onto the
  axis, turns to face it, and passes the beam on. One tracer computes every beam path; both
  views render exactly the same geometry.
- **Real Gaussian beams.** Every beam carries a complex `q` parameter. Lenses transform it
  through ABCD matrices, waists are marked where they actually fall, and spot sizes are
  reported at every plane. M² is carried through the embedded-Gaussian trick.
- **Polarisation that behaves.** Jones calculus through waveplates, polarisers and
  polarising beamsplitters — a λ/2 before a PBS really does steer the split.
- **Acousto-optics properly.** Diffracted and 0th orders on separate lanes, RF frequency
  shift tracked separately from the carrier wavelength (`detuningHz`), and a double-pass
  works — including the classic PBS + λ/4 arrangement where the second pass leaves on its
  own path.
- **Angles on a lattice.** Components sit on 15° steps, mirror surfaces on 7.5° (reflection
  doubles the surface angle, so the finer grain is what makes every 15° beam reachable).
- **Two views of one layout.** An editor canvas for building, and a clean read-only diagram
  for figures — exportable as SVG or PNG, with components as native SVG so it opens in
  Illustrator or Inkscape.
- **Measurements.** Photodiodes report volts from a V/mW signal factor; power probes read
  the beam anywhere along its path; beat notes between beams on one detector are reported
  (though not modelled — see limitations).

## Quick start

Requires [Node.js](https://nodejs.org/) 20 or newer (24 is what it is developed against —
see `.nvmrc`).

```bash
npm install
npm run dev
```

Then open <http://localhost:7432>.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload, port 7432 |
| `npm run build` | Type-check (`tsc -b`) then build to `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Run the test suite once (vitest) |
| `npm run test:watch` | Re-run tests on change |
| `npm run lint` | ESLint over the project |
| `npm run electron` | Run the desktop shell against a build |
| `npm run electron:dev` | Desktop shell against the dev server |
| `npm run electron:build` | Build, then package installers into `release/` |

## Distributing it

The app is entirely client-side — no server, no database, nothing native — so the built
`dist/` is a self-contained static site with relative paths. Any static host works, and
that is the lowest-friction way to share it.

For desktop installers, `electron-builder` is configured (NSIS / dmg / AppImage) but two
things are outstanding:

- **Icons.** `electron-builder` expects `build/icon.ico`, `build/icon.icns` and a ≥512 px
  `build/icon.png`. Without them you ship the default Electron icon.
- **Signing.** Unsigned builds mean a SmartScreen warning on Windows and a Gatekeeper block
  on macOS. Windows wants an OV code-signing certificate; macOS wants an Apple Developer
  account and notarization, and cannot be built from Windows at all. A CI matrix
  (windows/macos/ubuntu) is the usual way around the last part.

Note that `npm run electron:dev` points at port 5173 while the dev server runs on 7432, so
that script needs one of the two numbers changed before it will attach.

## Layout files

Save writes a JSON file containing every node and edge, with a `version` field.

**The version field is not yet checked on load.** Layouts saved by an older build load
with whatever fields they had, so a renamed property comes back missing — see
[PROJECT_NOTES.md](PROJECT_NOTES.md) §4. Worth fixing before other people rely on it.

`Layouts/D1_Layout.json` is a real example: a Rb D1 bench with an AOM double pass.

## How it fits together

```
src/
├── physics/          the model — no React anywhere in here
│   ├── autoRoute.ts    the only place beam geometry is computed
│   ├── propagate.ts    componentOutputs(): the one physics table
│   ├── geometry.ts     angles, reflection, the direction lattice
│   ├── gaussian.ts     complex q, ABCD matrices
│   ├── jones.ts        polarisation
│   ├── lanes.ts        parallel beam axes through one component
│   ├── beamLayout.ts   cosmetic separation of overlapping beams
│   └── detector.ts     what a photodiode reads
├── components/
│   ├── Editor/         canvas, palette, properties panel, toolbar
│   ├── Diagram/        read-only figure renderer
│   ├── Nodes/          component artwork and node rendering
│   └── Edges/          beam rendering on the canvas
├── store/            zustand store; runs the tracer, holds the results
├── types/            component data and beam state
└── utils/            geometry boxes, palette, export, formatting
```

Two invariants are worth knowing before changing anything:

1. **`autoRoute` is the only source of beam geometry.** It emits `BeamSegment[]`, and every
   view renders those coordinates directly. No view re-derives a beam path.
2. **`componentOutputs` is the only physics table.** One function maps an incoming beam and
   a component to its output ports.

[PROJECT_NOTES.md](PROJECT_NOTES.md) is the long-form companion: architecture, the reasoning
behind each design decision, gotchas that have bitten before, and a change log.

## Tests

```bash
npm test
```

350 tests, all in `src/physics/__tests__/`, covering the tracer, the physics table,
Gaussian propagation, polarisation, AOM orders and double passes, the angle lattice, face
trimming, detectors and the layout helpers. They are plain functions — no DOM, no React —
which is why they run in about two seconds.

`npm run lint` currently reports 7 pre-existing errors in `Toolbar.tsx` and `NodeIcons.tsx`
(inline component definitions and mixed exports). They are cosmetic and predate the current
work; CI runs lint without failing on them.

## Known limitations

- **Angles are quantised** to 15° for bodies and 7.5° for mirror surfaces. Continuous
  angles are not supported, and the 1 inch hole grid is decorative — components snap to
  beams, not to holes.
- **AOM lane separation is a caricature.** The real first-order deflection is ~15 mrad,
  which would separate the orders by a few pixels; the schematic draws them one inch apart
  and reports the true angle as physics instead.
- **No interference.** Beam powers add on a detector; relative phase is not tracked, so a
  beat note between two beams is reported but not modelled.
- **No ASE** from an optical amplifier: unseeded, it outputs nothing.
- **Selection boxes stay axis-aligned**, so a turned component's outline and drag target are
  its bounding box rather than its artwork.

## License

MIT — see [LICENSE](LICENSE).
