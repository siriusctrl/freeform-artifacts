# freeform-artifacts

Browser-first Freeform-style canvas for AI-generated data artifacts.

`freeform-artifacts` is a demo product surface for placing JS/TS-rendered
artifact cards on a zoomable and pannable canvas. The first use case is
database-backed cards: raw rows can be transformed into normalized artifact data,
then rendered by declarative Chart Kit specs, managed raw ECharts options, or
registry-approved React/TypeScript components.

## Product Boundary

This project is canvas-first, not dashboard-first. The first screen should stay
focused on placing, moving, resizing, panning, zooming, and viewing artifacts
in a Freeform-style workspace.

It is not a landing page, admin dashboard, or server management console. It is
also not a general drawing engine yet. Generated artifacts enter through the
artifact registry contract; they do not own the whole page or mutate canvas
internals directly.

## Quick Start

Install dependencies:

```sh
npm install
```

Install the browser used by Playwright verification:

```sh
npm run setup:browsers
```

Run the app:

```sh
npm run dev
```

To exercise **Build with AI** locally, run the relay emulator in another
terminal:

```sh
npm run relay:dev:test
```

The development client uses Cloudflare's always-pass Turnstile test key and the
emulator-only `test-turnstile-pass` token. The relay accepts it only when both
the browser origin and actual Worker request URL are loopback; production and
public preview URLs never accept that bypass.

Open the local URL:

```text
http://127.0.0.1:4177
```

Run deterministic checks:

```sh
npm run check
npm run verify:ui
npm run verify:preview
```

Create a shareable browser proof GIF:

```sh
npm run verify:proof
```

The proof run writes local evidence under:

```text
artifacts/verification/<timestamp>/
```

Those artifacts are ignored by git and are meant for local handoff evidence.
The recorder drives a complete asserted UX journey, exposes its current action
with a verification-only cursor and label, and writes `ux-checks.json` plus a
30-cell contact sheet for internal review. The GIF remains the only proof users
need to inspect.

## Project Skill

This repo includes a project-local Codex skill for future agents:

```text
skill/freeform-artifact-builder/
```

Use it when adding or revising canvas artifacts:

```sh
npx skills use ./skill --skill freeform-artifact-builder --full-depth
```

To confirm the package exposes the skill to the current `skills` CLI:

```sh
npx skills add . --list --full-depth
```

## Interactive Canvas

Current controls:

- Drag an artifact card to move it.
- Hold `Shift` while dragging blank canvas space to marquee-select artifacts;
  use `Shift`/`Cmd`/`Ctrl` click to adjust the selection, then drag any selected
  card to move the whole selection.
- Use the contextual selection toolbar to align, distribute, duplicate, or
  delete multiple artifacts.
- Drag the selected card's labeled bottom-right resize control to resize it.
- Delete the selected artifact from its title bar, or press `Delete` or
  `Backspace` while canvas focus is outside an input.
- Keep snap-to-grid on by default for 38px world-coordinate placement; toggle
  it from **More > Snap to grid**, where a compact switch shows the current
  state while changing the setting.
- Drag empty canvas space to pan.
- Scroll with a trackpad or mouse wheel to pan naturally in either direction.
- Pinch on a trackpad to zoom around the pointer.
- Use the bottom-left zoom controls to zoom or reset the view.
- Toggle light/dark mode from the top toolbar.
- Double-click the centered canvas name to rename the current view.
- Open the collapsed **Views** sidebar to browse real canvas previews, create
  views, duplicate or delete them, drag them into a stable order, and switch
  between independent browser-local workspaces. A deleted view can be restored
  from the short-lived Undo notice. On touch layouts, use the visible close
  button or tap outside the drawer; **Move up** and **Move down** provide a
  non-drag ordering path.
- Open **Artifacts** from the top bar to search built-in and personal items,
  inspect a complete live preview, then click to add one at the nearest open
  position in the current viewport, or drag it to a specific canvas position.
  Removing a card does not remove its reusable artifact package.
- Use `Cmd/Ctrl+Z` and `Shift+Cmd/Ctrl+Z` for session Undo/Redo; `Cmd/Ctrl+A`
  selects all artifacts, `Cmd/Ctrl+D` duplicates, and `Cmd/Ctrl+C` / `V`
  copy and paste within the active browser view. Use `Cmd/Ctrl+B` for Views,
  `Shift+Cmd/Ctrl+A` for Artifacts, `Cmd/Ctrl+0` to reset the viewport,
  `+`/`-` to zoom, and `Escape` to close the active panel or clear selection.
  Canvas shortcuts do not intercept editable fields or the Build with AI dialog.
- Use the **More** menu to load sample query rows, import/export a versioned
  workspace backup, enter a clean Fit All presentation, or explicitly reset to
  the authored demo. In presentation mode, use Left/Right to move between views
  and `Escape` to return without changing the saved viewport, or use the compact
  on-canvas navigation and exit controls.
- Open **Build with AI** from the desktop top bar or the Artifact Library footer
  and copy the build brief immediately; artifact generation no longer waits for
  browser verification or relay connection. The capability-free brief asks the
  agent to keep validated bundle files while automatic delivery connects in the
  background. When the private, roughly 30-minute, target-bound Build Session is
  ready, copy the live-delivery step into the same conversation and the agent
  reuses those exact bundles. This remains safe after reopening the dialog or
  manually copying the preparation brief. If the relay stays unavailable,
  choose **Install from agent** and install each returned bundle file instead.
  If you navigated elsewhere, the dialog confirms the original destination and
  offers an **Open** action after installation. The browser validates live
  selections completely and installs them in one local transaction. Build
  Sessions require browser Web Locks so delivery and cross-tab deletion share one
  safe commit boundary; unsupported browsers keep the file workflow available.
  Build Session capabilities stay in page memory only; reloading or closing the
  page ends the browser side of that session and requires a new click.

The canvas stores nodes in world coordinates. The viewport stores screen offset
and scale. Rendering converts world coordinates into a single transformed DOM
layer, which keeps artifact components as normal React/DOM content instead of
forcing them into a low-level drawing API.

Board state is automatically saved in the browser-local workspace and restored
on reload, including the current theme and snap-to-grid preference.

## Artifact Runtime

Artifacts are registered in `src/artifacts/registry.ts`.

The registry is layered:

- `src/artifacts/core/` contains platform-provided building blocks such as
  metric and table cards.
- `src/artifacts/examples/` contains demo and verification artifacts such as the
  probability chart, Sankey, and flow diagram.
- `src/artifacts/generated/` is the entry point for self-deployed user or
  AI-generated artifacts.
- `src/canvas/seeds/demoBoard.ts` chooses which artifacts appear on the default
  demo board.

## Adding A Customized Artifact

There are separate trusted-code delivery modes. Runtime bundles are the default
for personal browser views; repo-compiled TSX is for users who own and deploy the
application. The skill requires this choice before files are created.

The product's **Build with AI** dialog creates an agent-neutral handoff. Copy
the generated install command rather than reconstructing it: the handoff pins
the Skills CLI version, fetches the project skill at a full commit SHA, verifies
`FETCH_HEAD` equals that SHA, and installs from the detached local checkout. It
then supplies a launcher-digest verification command that must pass before the
delivery process reads credentials.

The generated instruction includes `Delivery mode: BROWSER_RELAY`, a fixed
target view id and incarnation, short-lived upload capability,
browser-generated AES-GCM key, and the exact `scripts/deliver.mjs` command.
After skill installation, it tells
the agent to ask what the user wants to build and clarify its data, visual form,
and layout. One delivery may contain several self-contained trusted bundles
with `artifactId`, ESM `moduleSource`, and initial node data, while explicitly
forbidding application repo changes.
Bundle code is stored once per browser origin in IndexedDB; the installed node
belongs only to the target local view. Artifact ids are immutable package
identities: installing different code under an existing id is rejected instead
of silently changing cards in other views. Installed packages also appear under
**Artifacts > Yours**, shared by every local view in that browser profile, so a
deleted node can be placed again without reinstalling its bundle.

### Browser Relay

Use the in-product handoff for normal remote agent work. The relay is transport
only: it stores capability hashes and bounded pending ciphertext in one
short-lived SQLite Durable Object. It cannot decrypt bundles and never stores
canvas or package state. The browser owns full-selection validation, grid-aware
placement, atomic persistence, and acknowledgement. Placement searches the
target view's persisted viewport for complete empty space; when it is full, the
browser keeps a top-layer fallback at the viewport center and grid-staggers
additional cards from the same delivery instead of hiding them off-screen.

The session remains bound to the exact view incarnation selected at creation
even if the user navigates elsewhere. Deleting and restoring that view creates
a new incarnation, so the old handoff cannot target the restored board. Each
delivery has an idempotency UUID; an IndexedDB receipt prevents duplicate nodes
when a post-commit acknowledgement is lost. During an
ambiguous upload, the agent uploader privately retains only the authenticated
encrypted envelope so a later `--delivery-id` retry is byte-identical; it
deletes the entry on a definitive result and never caches tokens, keys, or
plaintext bundles.

Browser-local Views use revision-checked saves, a stable incarnation for each
logical lifetime, and a unique generation for each deletion. A stale tab cannot
overwrite a delivered dashboard, revive a deleted View, or apply an older Undo
to a later deletion. Trusted module preparation runs before the short UI
mutation boundary, so navigation and editing remain available while code loads.
At commit time, pending edits are flushed and the browser requires the expected
revision and incarnation; a concurrent edit reloads the newest workspace,
re-runs host placement, and retries a bounded number of times. Editing surfaces
are inert only through that atomic commit/application boundary, and the complete
delivery remains one Undo step.

Browser Relay wire messages use protocol v2, including the target View
incarnation in session metadata and AES-GCM authenticated data. Protocol-v1
sessions fail closed after the upgrade. This is separate from the artifact
bundle schema: `.freeform-artifact.json` bundles remain version 1.

### Runtime Artifact Bundle (offline/direct fallback)

Use this for same-browser automation or as the offline fallback. An agent with
browser control calls:

```js
await page.evaluate(
  (bundle) => window.__FREEFORM_AGENT__.validateArtifact(bundle),
  bundle,
);

await page.evaluate(
  ({ bundle, viewId, viewIncarnationId }) => window.__FREEFORM_AGENT__.installArtifact(
    bundle,
    { viewId, viewIncarnationId },
  ),
  { bundle, viewId, viewIncarnationId },
);
```

Resolve both target values with `listViews()`. Explicit targets are
incarnation-bound: passing `viewId` without its matching `viewIncarnationId` is
rejected, so deleting and restoring a View cannot silently retarget an install.

Without browser control or an active relay session, choose **Install from agent** in
the Build with AI dialog. Bundle modules are trusted code and are not sandboxed.

### Relay development and deployment

The independently deployable relay lives in `relay/`:

```sh
npm run relay:types
npm run relay:check
npm run relay:test
npm run relay:dev:test
```

Production deployment requires a Cloudflare account with a registered
`workers.dev` subdomain and a Turnstile widget. Keep `TURNSTILE_SECRET` and the
session-locator HMAC key `RELAY_ROUTING_SECRET` as Worker secrets, never
Wrangler vars or repository files:

```sh
npx wrangler secret put TURNSTILE_SECRET --config relay/wrangler.jsonc
npx wrangler secret put RELAY_ROUTING_SECRET --config relay/wrangler.jsonc
npm run relay:deploy
npm run verify:relay:production:security
```

The production smoke uses the real widget without bypassing it: automation
checks widget startup, protocol-v2 health, strict CORS, and the pre-token
fail-closed UI. Because Turnstile intentionally detects automated browsers, a
full live delivery requires an operator to run the same command with
`FREEFORM_HEADLESS=false npm run verify:relay:production` and complete the
widget. The emulator and browser CI use Cloudflare's official test-key pair
for deterministic end-to-end delivery; those keys never belong in production.

`RELAY_ENABLED` is the kill switch. The committed production allowlist contains
only the GitHub Pages origin; local origins are explicit command-line overrides
in the development and proof scripts. The
relay uses Durable Objects, Workers Rate Limiting, and Turnstile—no D1, KV, or
R2.

### Repo-Compiled TSX

Use Self-Deployed Repo mode when an agent can write into the app repo and the
user intends to rebuild and deploy it.

1. Create `src/artifacts/generated/my-artifact.artifact.tsx`.
2. Export `artifact`, `default`, or `artifacts`.
3. The generated registry auto-discovers `*.artifact.tsx` files with Vite
   `import.meta.glob`.
4. If the artifact should appear on the default board, add a `CanvasNode` in
   `src/canvas/seeds/demoBoard.ts`.
5. Run the verification commands.

### Runtime External ESM

Use this when the deployed app owner wants to drop trusted JavaScript modules
under `public/` without rebuilding the main app.

1. Add a compiled ESM file such as:

```text
public/artifacts/generated/my-artifact.js
```

2. Add it to:

```text
public/artifacts/generated/manifest.json
```

```json
{
  "artifacts": [
    { "module": "./my-artifact.js" }
  ]
}
```

3. Export `artifact`, `default`, or `artifacts` from the module.

External runtime modules are trusted self-hosted code. They execute in the page,
are not sandboxed, and should be treated as "take your own risk" plugins.
The loader fetches these files and imports them as Blob-backed browser modules,
so keep runtime modules self-contained instead of using relative imports.
Runtime React artifacts can use `window.React.createElement`; runtime `.js`
files cannot contain raw JSX unless they are compiled first.

An artifact is a typed object with an id, version, default size, optional
minimum size, schema hints, and a renderer-specific body.

Chart Kit is the default for bar, line, and combo charts. It produces managed
ECharts options with consistent light/dark tokens, dataset encoding, axes,
tooltip, palette, ARIA, SVG rendering, and lifecycle:

```ts
export interface ChartKitArtifactDefinition<TData = unknown, TConfig = JsonObject> {
  id: string;
  title: string;
  version: string;
  renderer: "chart-kit";
  defaultSize: ArtifactSize;
  minSize?: ArtifactSize;
  buildChart: (props: ArtifactRenderProps<TData, TConfig>) => ChartKitSpec;
}
```

React artifacts own their component render function:

```ts
export interface ReactArtifactDefinition<TData = unknown, TConfig = JsonObject> {
  id: string;
  title: string;
  version: string;
  defaultSize: {
    width: number;
    height: number;
  };
  minSize?: { width: number; height: number };
  dataSchema?: JsonObject;
  configSchema?: JsonObject;
  dataValidator?: ZodType<TData>;
  configValidator?: ZodType<TConfig>;
  render: (props: ArtifactRenderProps<TData, TConfig>) => React.ReactNode;
}
```

Raw ECharts artifacts are the advanced escape hatch and only build chart
options. The host owns `echarts.init`,
`setOption`, `resize`, and `dispose`. Every render receives `size`, the live
internal content-box dimensions. On this canvas, a card renders in its
registered `defaultSize` coordinate system and the resize handle scales the
complete artifact at a locked aspect ratio. Complex artifacts should declare
`minSize` to set the smallest permitted object scale:

```ts
export interface EChartsArtifactDefinition<TData = unknown, TConfig = JsonObject> {
  id: string;
  title: string;
  version: string;
  renderer: "echarts";
  chartRenderer?: "svg" | "canvas";
  interactive?: boolean;
  defaultSize: {
    width: number;
    height: number;
  };
  minSize?: { width: number; height: number };
  dataSchema?: JsonObject;
  configSchema?: JsonObject;
  dataValidator?: ZodType<TData>;
  configValidator?: ZodType<TConfig>;
  buildOption: (props: ArtifactRenderProps<TData, TConfig>) => EChartsOption;
}
```

Canvas nodes reference artifact definitions by `artifactId`:

```ts
export interface CanvasNode<TConfig = JsonObject> {
  id: string;
  artifactId: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  dataBinding?: DataBinding;
  data: unknown;
  config: TConfig;
}
```

## AI Artifact Contract

AI-generated artifacts should follow these rules:

- Export exactly one `ArtifactDefinition`.
- Prefer `renderer: "chart-kit"` for ordinary bar, line, and combo charts.
- Use raw `renderer: "echarts"` only for registered capabilities Chart Kit
  cannot express. The current raw host registers bar, line, and Sankey.
- For raw ECharts artifacts, generate data transforms and `buildOption`; do not
  call `echarts.init` or manage chart lifecycle inside the artifact.
- Leave raw ECharts artifacts non-interactive by default so the whole card remains
  draggable. Set `interactive: true` only when the chart needs hover, tooltip,
  click, or brush behavior.
- Use React artifacts when the visual is not well represented by ECharts or
  needs custom UI composition.
- Do not mutate canvas state directly.
- Receive all display input through `data`, `config`, `theme`, and `size`.
- Keep database-specific logic outside the render component.
- Put data shaping in a named transform before artifact rendering.
- Add a Zod `dataValidator` to repo-compiled artifacts. Self-contained runtime
  bundles cannot import Zod, so keep their payload guards inside renderer code;
  the host isolates renderer failures to the affected card.
- Use deterministic layout; do not depend on global timers, random values, or
  network fetches during render.
- Declare default width and height so the canvas can place the artifact before
  rendering it.

The intended pipeline is:

```mermaid
flowchart LR
    db["Database rows"] --> transform["Transform function"]
    transform --> artifactData["Normalized artifact data"]
    artifactData --> node["CanvasNode.data"]
    node --> registry["Artifact registry"]
    registry --> render["Chart Kit, raw ECharts, or React render"]
```

## Rendering Boundary

This demo intentionally uses DOM-based artifacts rather than drawing all content
into `<canvas>`. That keeps tables, charts, forms, text selection, layout, and
future accessibility work close to the browser platform.

The product boundary is:

```text
  user input / AI request
          |
          v
  artifact definition + data transform
          |
          v
  registry-approved artifact
          |
          v
  canvas node in world coordinates
          |
          v
  DOM render inside pan/zoom viewport
```

## Project Status

Implemented:

- React/TypeScript/Vite demo app.
- Pannable and zoomable dotted canvas.
- Draggable artifact nodes.
- Resizable selected artifact nodes.
- Selected-artifact deletion through a title-bar control and keyboard shortcuts.
- Bounded session Undo/Redo with one history entry per completed drag or resize.
- Additive and marquee multi-selection, group movement, alignment/distribution,
  duplicate, and in-session copy/paste commands.
- Default-on 38px snap-to-grid placement with a labeled More-menu toggle.
- Aspect-locked whole-object resizing with artifact-specific minimum scales.
- Published demo template with a per-browser local workspace fork.
- Multiple named local canvas views with a smoothly animated,
  default-collapsed **Views** sidebar, data-derived page previews, persistent
  ordering, duplicate, durable logical deletion, and short-lived delete Undo.
- Full-canvas presentation mode with derived Fit All framing and view navigation
  that leaves each view's editable viewport unchanged.
- Searchable, default-collapsed **Artifacts** library with Built-in and Yours
  sources, click placement, drag-to-canvas placement, and cross-view personal
  package reuse.
- Guarded canvas shortcuts for history, selection, clipboard, Views, Artifacts,
  viewport reset, zoom, Escape, and selected-node deletion.
- Debounced, ordered IndexedDB workspace persistence with a synchronous
  page-close recovery mirror and versioned board-data JSON import/export.
- Transform registry with fixtures for raw query rows.
- Zod-backed artifact payload validation with invalid-card fallback rendering.
- Registry-backed metric, table, flow-diagram, probability chart, and Sankey
  artifacts, polished and verified in both light and dark mode.
- Layered artifact registries for core, example, and future generated
  artifacts.
- Auto-discovered repo-generated TSX artifacts and base-aware trusted runtime
  ESM loading through `artifacts/generated/manifest.json`.
- GitHub Pages deployment under `/freeform-artifacts/`.
- Playwright UI smoke test, including real encrypted relay deliveries.
- Browser proof GIF recorder.
- Lightweight proof frame checks and production preview verification.
- Light/dark theme support.
- Compact application chrome with self-hosted Instrument Sans for interface
  prose and Geist Mono for comparable data values.
- No-deploy artifact bundle installation through **Build with AI** and the
  browser Agent API.
- Declarative Chart Kit with capability discovery and non-persisting browser
  preflight for ordinary bar, line, and combo charts.
- Hardened pointer dragging that suppresses browser text selection and native
  drag behavior during canvas moves.
- Handoff docs for the next Codex session.
- Project-local `freeform-artifact-builder` skill for future artifact work.
- Artifact visual style guide covering hierarchy, spacing, chart composition,
  categorical color, and required dark-mode behavior.

TODO:

- Add explicit z-order controls.
- Add sandbox strategy before loading untrusted generated code.
- Add file/API import for arbitrary database query result JSON.
- Add richer visual diff thresholds beyond the current blank-frame checks.

## Public demo and local workspaces

The public URL opens the `market-overview` template. The template is immutable:
on first visit, the app copies it into the first named view owned by that browser
origin. Users can create more empty views from the sidebar.
Every later drag, resize, delete, zoom, theme change, or data import
is saved locally and restored when the page is reopened.

Artifact packages have a wider lifetime than nodes: built-in presets ship with
the app, while trusted personal bundles are stored once per browser origin and
listed under **Artifacts > Yours** in every local view. Deleting a node removes
only that placement. Clearing site data removes both views and personal
packages.

```text
published template -> first-visit browser fork -> IndexedDB workspace
                                           \-> localStorage recovery mirror
```

Visitors do not share state because the static deployment has no shared board
backend. Isolation is scoped to the browser profile and site origin. It does not
provide account identity, cross-device sync, or persistence after the user
clears site data. Toolbar import/export transfers serializable board data only;
personal executable artifact packages remain browser-local and must be installed
separately in the destination browser. Import rejects a board that references
unavailable packages and names the missing artifact ids.

Template URLs use a query parameter so they remain compatible with static
GitHub Pages routing:

```text
https://siriusctrl.github.io/freeform-artifacts/?board=market-overview
```

## Documentation

Read these first when getting oriented:

1. `README.md`
2. `AGENTS.md`
3. `CHANGELOG.md`
4. `docs/INDEX.md`

Maintainer details live under `docs/`.

Design and engineering tradeoffs are recorded in
`docs/architecture-decisions.md`.
