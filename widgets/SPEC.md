# SPEC — Tide‑graph widget for `signalk-tides` (`widgets/` enhancement)

> **Scope:** a **single** full‑fidelity **2×1 tide‑graph widget** ("Tide Cycle
> (Advanced)") contributed to the `signalk-tides` plugin, powered by its own
> **Neaps** data. Not a whole‑project spec and not a pack — exactly one premium
> widget that shows how a data plugin can publish an integrated chart‑plotter
> widget alongside its core service, via the host‑agnostic **Plotter Extensions
> API**.
>
> A separate, standalone pack (`signalk-basic-tide-widgets`) covers the
> lightweight, deltas‑only widgets (a 1×1 level and a 2×1 *estimated* cycle).
> **This** widget is the high‑fidelity counterpart and lives **with**
> `signalk-tides` because only it has the Neaps harmonic data.

---

## 1. Objective & intent

Add one optional, full‑fidelity **tide‑graph widget** to `signalk-tides` that
renders the same multi‑day harmonic curve as its webapp — reusing `@neaps/react`
— so any Plotter Extensions host (Freeboard‑SK and others) can place it directly
on the chart. The plugin's existing behaviour is **unchanged** (webapp, deltas,
Neaps API, `tides` resource all untouched); the feature is purely additive.

**Why this PR exists.** It is a *demonstration* of the Plotter Extensions API and
a *spotlight* on excellent existing work, not a takeover. It should be
deferential and minimal, **credit Neaps / openwaters.io**, and read as a template
other plugin authors can copy.

### Upstream / fork context

`joelkoz/signalk-tides` is a fork of **`openwatersio/signalk-tides`** (Brandon
Keepers / openwaters.io, the Neaps authors). The PR targets `openwatersio:main`.
Standard Signal K contribution rules apply: Conventional‑Commits title, one
logical change, **no version bump**, minimal footprint.

### Reference material

- **API contract:** the Plotter Extensions API (`docs/api/plotter-extensions-api.md`
  in `SignalK/freeboard-sk`).
- **Wire contract:** the `signalk-plotterext-bus` npm package (JSON‑RPC over
  `postMessage`); the widget uses its `/extension` entry.
- **Registration / packaging pattern:** a read‑only `plotterExtensions` resource
  provider plus a self‑served public static route (mirrors
  `signalk-instrument-widgets` / `signalk-basic-tide-widgets`).

---

## 2. The widget — `graph` (2×1) — "Tide Cycle (Advanced)"

| id | title | size | extension (manifest name) |
|----|-------|------|---------------------------|
| `graph` | **Tide Cycle (Advanced)** | `2x1` | **Tides** |

A host's picker reads `Tides › Tide Cycle (Advanced)` — deliberately paired
against `Basic Tides › Tide Cycle (Basic)` from the standalone pack, so the
premium (Neaps‑powered) one is easy to tell apart.

**Behaviour**

- Renders the multi‑day tide **curve** with high/low markers, the mean‑low
  reference line, daylight shading and a live "now" indicator — reusing
  `@neaps/react`'s **static** graph pieces (see §3).
- **Static, not interactive.** A widget is a guest on the chart, not an app:
  **no scrolling, no "Now" button, no tooltip/selection.** Pointer events pass
  through (`pointer-events: none` on the chart) so the host still sees the
  press‑and‑hold that opens the config panel.
- Honours the host's preferred depth unit (`units.get`, then the server's active
  unit preset, then the locale default).
- Shows the **tide station name** clipped in the top‑left corner (so in
  chart‑follow mode the user can see which station the charted area resolved to).
- Compact and legible at 2×1; translucent‑dark; transparent background;
  responsive. Degrades quietly before a position/forecast exists (placeholder),
  never an error stack.
- Provides a **configuration panel** (`graph-config`, §3b) opened on long‑press.

**Out of scope (this PR)**

- The 1×1 text widget (that lives in `signalk-basic-tide-widgets`).
- Background runtimes, buttons, routes/filters.
- Any change to existing deltas, the Neaps API, the `tides` resource, or the webapp.

---

## 3. Architecture & data flow

The widget is a sandboxed **iframe** the host loads from
`/plotterext/signalk-tides/…` (same origin as the SK server). It connects to the
host over the bus via `signalk-plotterext-bus/extension`.

- **Host bus** is used for: handshake/lifecycle, display‑unit preference
  (`units.get`), per‑instance config (`state.get`/`state.set` — the graph window
  and location mode), the long‑press → `ui.openConfigPanel` gesture, and — in
  chart‑follow mode — the chart view (`map.getView`).
- **Tide data** comes from the plugin's own public **Neaps API** over same‑origin
  REST, via `@neaps/react`'s `NeapsProvider` pointed at `/signalk/v2/api`. This
  reuses the existing, tested data path and gives multi‑day fidelity the deltas
  can't.

**Static graph — composed, not the interactive wrapper.** `@neaps/react`'s
high‑level `<TideGraph>` is a scrollable, infinite‑loading, tooltip‑driven chart
built for the webapp. A widget must be static, so instead we compose the
lower‑level **static** exports the library already provides — the pure
`<TideGraphChart>` SVG plus the `useTimeline` / `useExtremes` / `useCurrentLevel`
data hooks. No `@neaps/react` code is copied; only its public API is used at a
lower level. The chart's x‑domain is the fetched timeline's extent, so the chosen
window (§3b) is just the span of the timeline we request.

**Location — vessel or chart centre (§3c).** By default the graph shows tides for
the vessel's own station (`vessel/default`). Optionally it follows the charted
area, querying Neaps by the chart‑centre lat/lon.

**Capabilities.** `requires: ["widgets"]`; `optional: ["units", "panels.iframe",
"map"]`. No `signalk.stream` — data is REST, so the widget is offered even on
hosts that don't relay the stream. `map` is optional: without it the widget just
shows vessel tides.

**Manifest** (built in `src/plotterext.ts`; `version` from `package.json`):

```jsonc
{
  "signalk-tides": {
    "name": "Tides",
    "description": "Tide-curve widget for the vessel's position, powered by Neaps.",
    "version": "<package.json version>",
    "apiVersion": "1",
    "requires": ["widgets"],
    "optional": ["units", "panels.iframe", "map"],
    "widgets": [
      { "id": "graph", "title": "Tide Cycle (Advanced)", "type": "iframe",
        "url": "/plotterext/signalk-tides/graph.html", "size": "2x1",
        "configPanel": "graph-config", "lifecycle": "whileEnabled" }
    ],
    "panels": [
      { "id": "graph-config", "title": "Tide Cycle Settings", "type": "iframe",
        "url": "/plotterext/signalk-tides/config.html", "lifecycle": "onOpen" }
    ]
  }
}
```

Manifest key = package name `signalk-tides`; the SK plugin **id** is `tides`.

### 3b. Time window

The config panel picks how much of the forecast the graph shows. Kept short so
the curve stays legible in a 2×1 tile (7 days crams the extreme labels into an
unreadable smear):

| value | span |
|-------|------|
| `12h` | 12 hours |
| `24h` | 1 day (default) |
| `48h` | 2 days |
| `72h` | 3 days |

Stored per instance as `{ "window": "24h" }`; the panel writes it, the widget
follows `state.changed` and re‑requests the timeline for the new span.

### 3c. Location mode

`{ "locationMode": "vessel" | "chart" }` (default `vessel`).

- **`vessel`** — tides for the vessel's own station, via the server‑side
  `vessel/default` alias (the plugin's middleware resolves it to the configured
  or nearest station). Unchanged from the webapp.
- **`chart`** — tides for whatever point is centred in the host's chart. The
  widget queries Neaps by `{ latitude, longitude }` and re‑queries only when the
  rounded centre (~1 km) changes. It follows the viewport with the **`map.view`
  event** (chart panned/zoomed): responsive, one update per settled view. It
  reads `map.getView` once for the starting view. Chart mode is offered in the
  config panel **only** when the host advertises the `map` capability, and
  degrades to vessel tides when `map` is absent or before the first read.

  `map.view` was added to the API alongside **Freeboard‑SK v3.1**; on older hosts
  that expose `map` but not the event, the widget falls back to a slow
  `map.getView` poll (stopped as soon as a real `map.view` event arrives).

The existing Neaps middleware already honours explicit lat/lon queries (it only
injects the vessel position when lat/lon are *absent*), so chart‑follow needs
**no server change**.

### 3d. Configuration panel — `graph-config` ("Tide Cycle Settings")

An iframe panel (`lifecycle: onOpen`) the host opens on long‑press. It shows a
**Time window** chooser always, and a **Tides for: Vessel position / Chart
centre** chooser when the host supports `map`. It reads `state.get()` on load and
writes the full config on each change (safe whether the host merges or replaces
state). Every write emits `state.changed`, which the live widget follows.

### 3e. Serving

The widget build emits static iframe assets that our own registration serves via
a public static route — **not** the webapp `public/` mount, **not** `/plugins/*`:

```ts
app.use('/plotterext/signalk-tides', express.static(WIDGET_BUILD_DIR)); // widgets/dist
```

This keeps the root Vite build, `index.html`, and the webapp mount untouched.

---

## 4. Footprint — what changes where

**New browser code + build + tests under `widgets/`:**

```text
widgets/
├── SPEC.md                      # this document (npm-ignored)
├── vite.config.mts              # self-contained multi-entry build → widgets/dist
├── web/
│   ├── graph.html / graph.tsx           # 2×1 widget iframe entry
│   ├── config.html / config.tsx         # config-panel iframe entry
│   ├── TideGraphWidget.tsx              # static graph: TideGraphChart + data hooks
│   ├── GraphConfig.tsx                  # window + location choosers (state.get/set)
│   ├── host.ts                          # bus helper: connect, units, config, long-press, map poll
│   └── widgets.css                      # translucent-dark theme + Tailwind/@neaps styles
└── test/
    └── TideGraphWidget.test.tsx         # browser: renders, static, no header/table, chart-follow
```

**Server registration lives in `src/` (not `widgets/server/`).** The plugin's
flat `dist/index.js` output depends on `src/` being the sole TypeScript
`rootDir`; pulling a `widgets/server` tree into that program would relocate the
whole `dist/` layout. So the read‑only provider + manifest sit in
`src/plotterext.ts` (compiled to `dist/plotterext.js`), and only the browser code
lives under `widgets/`.

**Edited existing files — minimal and enumerated:**

1. **`src/index.ts`** — import `registerTideGraphWidget` and call it once in
   `start()`. ~2 lines.
2. **`src/plotterext.ts`** *(new)* — pure `buildManifest()` + `registerTideGraphWidget(app)`
   (public static mount + read‑only `plotterExtensions` provider).
3. **`test/plotterext.test.ts`** *(new)* — node tests for the manifest + provider.
4. **`package.json`** — add runtime dep `signalk-plotterext-bus`; extend `build`
   (`&& vite build --config widgets/vite.config.mts`). No version bump.
5. **`tsconfig.app.json`** — add `widgets/web` + `widgets/test` to `include` so
   the widget TSX is type‑checked by `tsc -b`.
6. **`vitest.config.browser.ts`** — add `widgets/test/**/*.test.tsx` to `include`.
7. **`.npmignore`** — ship the built `widgets/dist`; keep widget source out.
8. **`.gitignore`** — ignore vitest browser artifacts (`__screenshots__`,
   `.vitest-attachments`).

No existing file is deleted/renamed; `app/`, `index.html`, `vite.config.mts`, the
deltas, the Neaps API, and the `tides` resource are untouched.

---

## 5. Commands

| Action | Command |
|--------|---------|
| Install | `npm install` |
| Build (webapp **+ widget**) | `npm run build` |
| Lint | `npm run lint` |
| Node tests | `npm run test:node` |
| Browser tests | `npm run test:browser` |
| All tests | `npm test` |

---

## 6. Code style & conventions

- **TypeScript** per the repo's strict `tsconfig.*`; `npm run lint` clean.
- **React 19** + hooks, mirroring `app/App.tsx`. Reuse `@neaps/react`
  components/hooks — do not reimplement tide math or the chart.
- **Tailwind v4** + `@neaps/react` theme in `widgets.css` (the widget build runs
  Tailwind and `@source`s the neaps dist, matching `app/App.css`).
- Widgets are **guests on someone else's chart:** responsive, transparent
  background, static (no navigation / `window.open` / modal), never block the UI
  thread.
- Recoverable failures (host lacks a capability, bus silent, no forecast yet) →
  `console.warn` + graceful fallback, never `console.error` or a thrown crash.
- Read‑only provider: `setResource`/`deleteResource` throw.
- Keep `buildManifest()` a **pure**, testable function.

---

## 7. Testing

- **`test/plotterext.test.ts`** (node) — one `plotterExtensions` provider;
  `listResources()` → `{ "signalk-tides": manifest }`; `apiVersion "1"`,
  `requires` includes `widgets`; **one** widget `graph` (2×1), `type iframe`, url
  under `/plotterext/signalk-tides/`, `configPanel: "graph-config"`; one panel
  `graph-config`; read‑only rejects; assets served on a public (non‑`/plugins`)
  route.
- **`widgets/test/TideGraphWidget.test.tsx`** (browser) — with the host bus mocked
  and Neaps fetched via the dev proxy, the widget mounts and renders the graph
  (an `svg`) **without** a header or table and **without** console errors/warnings;
  a second case exercises chart‑follow (`map.getView` + location query) and the
  station‑name caption.

CI (`.github/workflows/ci.yml`) stays unchanged and green.

---

## 8. Boundaries

**Always**
- Keep the change **additive** and the footprint **minimal**.
- Serve assets from a **public**, self‑mounted route
  (`/plotterext/signalk-tides/…`), never `/plugins/*` or the webapp build.
- Credit Neaps / openwaters in the PR description; keep the tone deferential.
- Add tests for new behaviour.

**Never**
- **Bump the package version** — the maintainer owns versioning.
- Modify existing `environment.tide.*` deltas, the Neaps API shape, the `tides`
  resource, or the webapp.
- Add server‑side runtime deps for the widget, or block read‑only users.

### PR workflow (contributor → upstream)

1. Sync `main` with `upstream/main`; branch off it.
2. Implement + test locally; one logical change; **no version bump**.
3. Open an **origin stand‑in PR first** (on the fork) so CodeRabbit reviews from
   the contributor's account; address findings.
4. Open the PR into `openwatersio:main` with a Conventional‑Commits title, e.g.
   `feat(widgets): add Neaps-powered tide-graph widget for plotter-extension hosts`.
   Credit Neaps and link the Plotter Extensions API; attach a screenshot.
5. `widgets/SPEC.md` is npm‑ignored regardless; decide with the maintainer whether
   it ships in the tree or is dropped.
