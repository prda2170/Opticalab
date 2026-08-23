# OpticaLab

A free-space optical layout designer for AMO / laser labs. Drop components on a virtual
breadboard, and the beams route themselves — with real physics behind them: Gaussian mode
propagation, polarisation through Jones matrices, AOM diffraction orders with their RF
frequency shifts, and power bookkeeping from the laser to the photodiode.

Built because drawing a beam path in Inkscape tells you nothing about whether it works, and
a full ray-tracer tells you far more than you want while you are still deciding where the
mirrors go.

It runs in a browser and installs as a desktop app, offline, with no setup — see
[Installing it as an app](#installing-it-as-an-app).

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
- **Several layouts at once.** One tab per open document, each with its own file, undo
  history, selection and viewport. Alt+T opens one, Alt+1…9 switches, Alt+W closes. A dot
  marks unsaved changes, and closing only asks when there are some.
- **Save means save.** Ctrl+S writes back to the file the layout came from; Ctrl+Shift+S
  picks a new one; Ctrl+O opens a file, in a new tab unless the current one is blank.
  (Firefox and Safari cannot hand back a writable file handle, so Save downloads there.)
- **Your tabs come back.** The open documents, their viewports and any unsaved changes are
  remembered across a reload, along with which file each one belongs to — so Save still
  writes to the right place after a restart, once you allow it.
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
| `npm run icons` | Regenerate every app icon from `public/icon.svg` |
| `npm run electron` | Run the desktop shell against a build |
| `npm run electron:dev` | Desktop shell against the dev server |
| `npm run electron:build` | Build, then package installers into `release/` |

## Installing it as an app

OpticaLab is a PWA, so the hosted version installs like a desktop app: open the link, click
the install icon in the address bar, and it gets a Start-menu / dock entry and its own
window. After the first visit it works **fully offline** — the whole app is 480 kB and makes
no network calls at runtime, so the service worker precaches all of it.

| Browser | Install | Save dialog |
|---|---|---|
| Chrome / Edge desktop | Full — own window, Start menu / dock entry | Native save dialog |
| Safari 17+ (macOS) | "Add to Dock" | Falls back to a download |
| Firefox desktop | Not supported — runs as a tab, offline still works | Falls back to a download |
| iOS / Android | Add to Home Screen | Download |

The save dialog uses the File System Access API where it exists (Chromium) and falls back to
an ordinary download elsewhere; loading works everywhere.

Updates are **offered, not applied**. A layout only exists in memory until you save it, so a
background reload would throw away whatever bench you were drawing. When a new build is
deployed, a bar appears — *Reload* now, or *Later* and it applies next launch.

## Hosting it

The app is entirely client-side — no server, no database, nothing native — so the built
`dist/` is a self-contained static site.

**Netlify** is what `netlify.toml` is set up for: point Netlify at the repo and it needs
nothing typed into the dashboard — build command, publish directory, Node version, the SPA
redirect and cache headers are all in the file. Any host works, but two things matter:

- **HTTPS is required** for a service worker, so installation only works over `https://` (or
  `localhost` while developing). An internal server with a self-signed certificate will
  serve the app but will not install it.
- **Serve it from a domain root.** The service worker's scope is `/`, set in
  `vite.config.ts`. Hosting under a subpath (a GitHub Pages *project* site, say) needs both
  Vite's `base` and the plugin's `base`/`scope` changed to that subpath.

Vite's own `base` is `'./'` on purpose, and the PWA plugin is given `'/'` separately: the
Electron shell loads the same `dist/index.html` over `file://`, where an absolute base would
resolve assets against the filesystem root, while a worker's scope cannot be relative.

To verify a build before sending the link round:

```bash
npm run build && npm run preview
```

Open the localhost URL in Chrome or Edge — an install icon should appear in the address bar,
and DevTools → Application → Service Workers should show one activated with 13 precached
entries. Tick *Offline* and reload to confirm it runs with no network.

## Desktop installers

`electron-builder` is configured (NSIS / dmg / AppImage), and the shell adds a native menu
and file associations the PWA cannot. Two things are outstanding:

- **Icons.** `electron-builder` expects `build/icon.ico`, `build/icon.icns` and a ≥512 px
  `build/icon.png`. `npm run icons` produces the PNG set for the web app but not the
  platform-specific `.ico`/`.icns`.
- **Signing.** Unsigned builds mean a SmartScreen warning on Windows and a Gatekeeper block
  on macOS. Windows wants an OV code-signing certificate; macOS wants an Apple Developer
  account and notarization, and cannot be built from Windows at all. A CI matrix
  (windows/macos/ubuntu) is the usual way around the last part.

Given that, the hosted PWA is the cheaper way to get OpticaLab onto a colleague's machine —
no certificate, no notarization, no 250 MB download, and updates that arrive on their own.

## Icons

Every icon comes from one file, `public/icon.svg` — the lens-and-axis mark the title bar
draws, on the app's own background so an installed window does not flash white on launch.
`npm run icons` rasterises it into the 64/192/512 set, a padded 512 for Android's maskable
crop, a 180 for iOS and a `favicon.ico`. The PNGs are committed, so a clone builds without
running the generator and a change to the mark shows up as a real diff.

## Layout files

Save writes a JSON file containing every node and edge, stamped with a schema version
(`LAYOUT_VERSION` in `src/utils/export.ts`). Only the layout goes in: the transient state
xyflow keeps on a node — selection, drag, measured size — is left out, since it is
recomputed on load.

Loading checks that version and migrates forward. Fields have been renamed more than once,
so an older file is brought up to date rather than read as though the field were simply
unset — and anything migrated or dropped is reported in a dialog, so what you see and what
the file says never differ silently. A file from a *newer* major version is refused instead
of guessed at.

Adding a schema change: bump the minor version and add an entry to `MIGRATIONS`, which is a
list of per-node transformations applied in order to any file older than each entry.

`Layouts/D1_Layout.json` is a real example — a Rb D1 bench with AOM double passes — and it
is also a format-1.0 file, so it exercises the migration path on load.

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
├── store/            one store per open document, the workspace store, session restore
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

433 tests, in `src/physics/__tests__/` and `src/store/__tests__/`, covering the tracer, the physics table,
Gaussian propagation, polarisation, AOM orders and double passes, the angle lattice, face
trimming, detectors, layout-file loading and migration, the workspace's document rules, the dirty/file-identity logic behind Save, and session
snapshots. They are plain functions — no DOM, no React —
which is why they run in about two seconds.

`npm run lint` reports one remaining error, in `NodeIcons.tsx` (a file that exports both
components and a helper, which breaks fast refresh). CI runs lint without failing on it.

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
- **Installing needs HTTPS and a Chromium or Safari browser.** Firefox runs the app fine but
  cannot install it, and neither can any host served over plain HTTP.
- **A layout lives in memory until you save it.** The open tabs are remembered across a
  reload, but that snapshot is a convenience, not a backup: it is only written a moment
  after each change, and only the file on disk is the real thing.

## License

MIT — see [LICENSE](LICENSE).
