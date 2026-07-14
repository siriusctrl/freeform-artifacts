# Architecture

`freeform-artifacts` is a browser canvas for placing AI-generated data
artifacts. The product is not a dashboard builder yet, and it is not a drawing
engine. The first boundary is a zoomable/pannable workspace that hosts
registry-approved React/TypeScript artifact cards and managed chart artifacts.

The core boundary is:

```text
  +------------------+      +------------------+      +-------------------+
  | User / AI intent |      | Data source      |      | Transform         |
  |                  |      |                  |      |                   |
  | "show revenue"  +----->+ database rows    +----->+ normalized data   |
  +------------------+      +------------------+      +---------+---------+
                                                               |
                                                               v
                       +----------------+----------------------+-------------+
                       |                |                      |             |
                       v                v                      v             v
                 +-----------+    +-------------+       +------------+  +---------+
                 | Artifact  |    | Canvas node |       | Viewport   |  | Browser |
                 | registry  |    | world coords|       | pan/zoom   |  | render  |
                 +-----------+    +-------------+       +------------+  +---------+
```

## Product Boundary

The app should answer four questions:

- What artifact types are allowed?
- What data shape does an artifact expect?
- Where is the artifact placed in the canvas world?
- How does the user inspect, move, pan, and zoom that world?

It should not let generated code own the whole page or mutate canvas internals.
Generated artifacts are plugins only at the registry boundary.

## Canvas State

Canvas state is split into two layers:

```ts
interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

interface CanvasNode {
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
  config: Record<string, unknown>;
}
```

`CanvasViewport` is screen-facing state. `CanvasNode` positions are world-facing
state. Keep them separate so board serialization, collaboration, and replay can
store stable artifact positions independent of the user's current zoom.

The current runtime exposes `window.__FREEFORM_STATE__` only for browser
verification. Do not build product features on that debug handle.

Canvas board state is serialized inside a versioned `WorkspaceRecord`. Published
templates are immutable seeds. On first visit, the selected template is copied
to the first browser-local view. Additional named views use unique ids while
retaining the historical `templateId` field as their IndexedDB key. Navigation
summaries retain only node geometry and artifact ids for page previews; they do
not cache screenshots or mount artifact renderers a second time. Each summary
also carries the workspace incarnation so a storage event can distinguish a
restored lifetime from the deleted View that reused its id. IndexedDB is the
primary store. Every workspace carries a monotonic revision and a random commit
identity, so a recovery journal can identify its own exact predecessor without
depending on millisecond timestamps.
Interaction-driven saves are debounced, single-flight per mounted view, and
committed with an IndexedDB compare-and-swap so a stale tab cannot overwrite a
newer board. A later edit made while a save is in flight is rebased onto that
tab's returned revision; a genuinely external revision reports a conflict.
If IndexedDB is unavailable, a versioned fallback save takes a same-origin,
per-workspace exclusive Web Lock before it re-reads the localStorage mirror,
checks the revision/incarnation, and writes. Browsers without Web Locks fail
that fallback closed rather than silently accepting last-writer-wins behavior.
`pagehide` synchronously writes a per-page localStorage recovery journal if a
page closes before the next IndexedDB transaction. An in-flight journal records
the random identity of the commit it follows; queued obsolete save generations
cannot run after pagehide and erase the newer journal. Ambiguous legacy
expectations fail closed, an older tab cannot replace a newer mirror, and a
newer fallback revision is promoted when IndexedDB recovers. The persisted board
includes nodes, viewport, selected node, theme mode, and the snap-to-grid
preference. Node positions can be snapped to the 38px world-coordinate grid by
the canvas shell. Resize remains aspect-locked and independent of grid snapping;
artifacts do not own placement behavior.

View order is lightweight origin-local navigation metadata stored separately
from workspace records. Duplicating a view clones its serializable board while
continuing to reference the same origin-wide artifact package ids. Deleting a
view removes its workspace records but keeps packages; the UI retains the
deleted workspace briefly so Undo can restore it at the previous list position.
Active-view duplicate and delete operations receive the live in-memory snapshot
so the 400 ms autosave window cannot discard a just-finished edit. Each logical
workspace lifetime has a stable incarnation id. Every delete writes a separate,
fresh per-View deletion UUID, which remains the authoritative logical deletion
when IndexedDB is temporarily unavailable. Restore is a conditional one-time
write that requires the current deletion generation, deleted revision, and old
incarnation before clearing the tombstone; the restored workspace receives a
new incarnation. An older Undo or Build Session therefore cannot be mistaken
for the restored View after another tab restores, edits, or deletes it again.
On cross-tab tombstone changes, the app compares both id and incarnation; an
active View whose id survived a delete-plus-restore is reloaded and remounted.
Relay commits and deletions additionally share the same abortable per-workspace
Web Lock. A deletion that queues first leaves its tombstone before relay commit;
a relay commit that queues first finishes atomically before deletion begins.
Build Session creation therefore fails closed when Web Locks are unavailable,
while file installation remains the offline fallback.

Node editing uses a bounded in-memory document history. Discrete commands store
one before-snapshot, while drag and resize open a transaction on pointer down and
commit one entry on pointer up regardless of pointer-move count. Node arrays and
selection are restored together. Viewport pan/zoom, theme, panel state, and
selection-only changes are intentionally outside history, and history does not
survive a reload or View switch.

This is browser-profile isolation, not account identity. The static app has no
shared board backend, so separate browser contexts cannot see each other's
workspaces. Clearing site data removes the workspace, and cross-device sync is
outside the current product boundary. Versioned `.freeform.json` import/export
is the explicit portability path for serializable board data, not executable
personal artifact packages. Import validates that every referenced artifact is
available and asks the user to install missing packages before changing the view.
Artifact render data remains serializable and is validated when rendered.

Trusted runtime artifact bundles are stored separately in the IndexedDB
`artifact-packages` store. A bundle contains self-contained ESM source and one
initial node payload. The runtime Blob-imports installed sources, merges them
into the registry, and stores only node references/data in each view. The
`window.__FREEFORM_AGENT__` bridge lets a browser-controlling agent list views
and inspect renderer capabilities, validate a bundle without persistence, and
install it into a target view without rebuilding the app. Explicit targets must
include the `id` and `incarnationId` returned by `listViews()`; the host rejects
id-only targeting so a delete/restore generation cannot receive stale work.
Package ids are browser-origin-wide immutable identities, while nodes remain
view-scoped. Package and target workspace writes share one IndexedDB transaction;
invalid targets and payloads are rejected before persistence. Loader failures
are quarantined per source/package, and renderer errors are isolated per card.

## Artifact Delivery Relay

**Build with AI** opens a roughly 30-minute, view-bound delivery session. It does
not move durable workspace state to a backend. The browser creates separate
browser and uploader capabilities plus a 256-bit AES-GCM key, sends only
capability hashes to the relay, and copies the uploader capability and key into
the agent handoff. The Worker therefore sees routing metadata, artifact count,
ciphertext size, and encrypted payloads, but never bundle source, node data, or
the decryption key.

Artifact authoring is independent from that transport lifecycle. The first
dialog frame serializes a capability-free `BROWSER_VIEW_BUNDLE` brief from the
explicit target View request, so verification, session creation, WebSocket
connection, browser feature gaps, and relay outages cannot block the agent from
generating and validating bundle files. Only a matching created session can
produce the `BROWSER_RELAY` handoff. If the user already copied the preparation
brief, every live handoff remains continuation-safe and reuses matching bundle
files already present in the conversation, even after reopen or manual copy.
Closing before session creation dismisses immediately, cancels the unfinished verification, and
runs bounded server cleanup without blocking the dialog;
closing after creation preserves the visible active-session strip and consent.
The dialog's file fallback uses the same requested View id and incarnation even
after navigation, and fails closed if that View was deleted or replaced. A
successful off-view install keeps the dialog open, names the fixed destination,
and offers an explicit **Open** action instead of making a silent background
change.

The modal keeps transport health separate from both authoring readiness and the most recent delivery
outcome, so reconnecting cannot be presented as a successful install and a
rejection can state that nothing was installed without truncation. Closing the
modal does not revoke session-level consent: a compact active-session strip
keeps the fixed target, connection state, expiry, reopen action, and End action
visible until the session ends. A slow atomic install changes that strip or the
dialog detail to **Installing delivery…** while transport health remains
separate. On phone-width overlays, the canvas background is inert, focus is
contained inside Views or Artifacts, and closing Build with AI, switching,
deleting, or exiting presentation restores focus to a visible control; if its
drawer opener became inert, focus returns to the visible Artifacts toggle.
Turnstile remains an official interaction-only widget: its supported flexible
size and explicit light/dark theme sit in a dedicated automatic-delivery panel;
the application does not restyle or imitate the challenge iframe. Status and
authoring content share one scroll boundary at short heights, so the native
challenge cannot cover the build brief or fixed actions.

```mermaid
sequenceDiagram
    participant B as "Browser-local view"
    participant R as "Relay Worker and session DO"
    participant A as "Remote agent delivery script"
    B->>R: "Turnstile-verified session plus token hashes"
    B->>R: "Hibernating WebSocket with browser capability"
    A->>R: "AES-GCM ciphertext plus upload capability"
    R-->>B: "Pending delivery over WebSocket"
    B->>B: "Decrypt and prepare every trusted bundle while UI remains interactive"
    B->>B: "Flush, place, and strict revision-plus-incarnation CAS commit"
    B->>R: "Installed or rejected ACK"
    R->>R: "Delete pending ciphertext"
```

The protocol-v2 transport lives under `relay/` and uses one SQLite-backed Durable
Object per session. Access ends at the 30-minute expiry timestamp; its alarm
then deletes the SQL tables and ciphertext. Hibernating
WebSockets avoid polling and allow an idle session to release Worker memory.
The Durable Object stores session metadata, SHA-256 capability hashes,
idempotency outcomes, and bounded pending ciphertext. It does not use D1, KV, or
R2 and never stores canvases or artifact registries.

One session accepts several deliveries; one delivery contains 1–12 bundles.
The uploader capability is reusable only within that session, while every
delivery uses a UUID plus an envelope digest that cannot represent different
ciphertext on retry. The delivery script keeps the encrypted envelope (never
the key or upload capability) in a private OS cache only while an outcome is
ambiguous so a later process can make a byte-identical retry. Definitive results
delete it; later runs opportunistically prune owned entries older than 24 hours.
A changed payload, unauthenticated cache entry, or missing retry cache fails
locally. The browser serializes processing. It decrypts and prepares the complete
trusted selection outside the UI mutation gate; module evaluation can take an
unbounded amount of time, so navigation and editing remain available during
that phase. Ending the session prevents any later commit even if an already
evaluating module eventually resolves. The browser then writes all packages,
the target workspace, and a delivery receipt in one IndexedDB transaction. If
the network drops after that commit but before ACK, the Durable Object replays
the ciphertext and the browser uses the receipt to ACK without adding duplicate
nodes. Rejected selections leave no package, workspace, or receipt fragment.

The short commit boundary flushes pending current-tab edits, reads the current
workspace, lays out every delivered node against that exact board, and commits
only when both its revision and incarnation still match. A concurrent revision
change reloads the latest record, re-runs host placement against its nodes, and
retries a bounded number of times; repeated conflicts reject the delivery
instead of silently merging stale placement. From that flush through applying
the committed record, mounted editing surfaces are inert and any active drag is
ended. Build Session controls remain available. The live tab applies the exact
committed record and skips a redundant autosave.
The delivered node set is then recorded as one Undo step;
external sibling-tab node changes are rebased through older history snapshots
so undoing the delivery does not erase either the sibling change or earlier
local Undo entries.
The same serialized boundary checks browser-local deletion tombstones and the
session's immutable target incarnation before and during the transaction. If
the target was deleted, restored, or replaced while a module was preparing, the
browser sends a terminal rejected ACK and writes no package, workspace, or
receipt; the relay path never clears the tombstone or retargets to the new
incarnation.
When the target is not the mounted View, a successful commit also refreshes the
mounted origin-wide artifact runtime so **Artifacts > Yours** and package-aware
imports see the new package without navigation or reload.

Browser-only capability material stays in module-private page memory and is not
written to Web Storage. Reloading therefore ends the browser side of a Build
Session. The upload capability and encryption key appear only in the copied
agent handoff, are visually masked in the dialog, and enter the uploader over
stdin rather than process arguments. That handoff pins the Skills CLI, fetches
the project skill by full commit SHA, verifies `FETCH_HEAD`, installs from the
detached local checkout, and provides an expected launcher digest. The launcher
verifies itself and its dependency-free core before reading stdin.

Wire protocol v2 binds the target workspace incarnation into session creation,
ready/status metadata, uploader retry identity, and AES-GCM authenticated data.
The relay and browser reject v1 messages, and pre-upgrade sessions without an
incarnation fail closed. The executable artifact bundle schema remains version
1; its version is independent of the relay wire protocol. The HTTP route prefix
remains `/v1` as the deployed endpoint family and does not identify a wire
message version.

Placement stays host-owned. The session captures its target view and stage size;
navigation never retargets it. Installation uses that view's current or last
persisted viewport, snaps the candidate to the 38px grid, searches outward from
the center for the nearest fully visible non-overlapping position, and assigns
successively highest z-indices. If the viewport has no complete opening, the
host keeps the fallback at the viewport center on the top layer instead of
hiding it elsewhere on the infinite canvas. Additional fallbacks in the same
delivery use deterministic 38px offsets around that center so every card stays
visible and distinguishable even though overlap is allowed in this full-view
case.

Session creation requires a strict allowed browser origin and Turnstile. The
Worker applies an IP creation limit and a per-source upload limit. Only a
request whose upload capability the Durable Object has authenticated consumes
the per-session upload budget. Additional limits include 24 delivery ids,
1.4 MB decoded ciphertext per delivery (leaving room for base64 and SQLite row overhead), and 8 MB pending ciphertext
per session. Browser WebSocket and agent upload capabilities cannot substitute
for one another. The fixed Turnstile test token is accepted only in the exact
`development` environment when both browser origin and the Worker's actual
request URL are loopback; every other environment and any public request URL
fails closed without a real secret. `RELAY_ENABLED` is the operational kill switch. The existing
file installer and direct same-browser Agent API remain offline/local fallbacks.
Allowlisted browser-origin delivery responses include strict CORS headers on
both success and error, while command-line uploads need no `Origin`. IPv6
rate-limit sources use canonical /64 buckets; genuine IPv4-mapped forms share
their IPv4 bucket and NAT64 addresses remain IPv6.

The Artifact Library projects two sources into one placement UI:

- Built-in entries pair registered system artifacts with reusable demo presets.
- Yours entries pair successfully loaded IndexedDB bundles with their initial
  node payloads.

The catalog does not duplicate executable source or workspace state. Removing a
node changes only its active view; the package remains available to every view
on the same browser origin. Clicking an entry starts at the current viewport
center and searches its visible world grid for an open position, falling back
to center/top when the view is full. Dragging carries only a catalog id and
converts the drop point from screen coordinates into canvas world coordinates
before optional grid snap. Separate browser profiles retain isolated package
stores.

Artifact Library recognition comes from the renderer itself rather than a
category glyph. Each entry mounts its catalog preset through the same validated
React, Chart Kit, or ECharts content surface used by a canvas node, at the
artifact's default size and current theme. A fixed thumbnail frame applies a
single contain scale to the complete node, including chrome, so it never crops a
chart annotation or stretches one axis. IntersectionObserver limits mounts to
the library scroller's visible neighborhood; offscreen ECharts instances are
disposed, and each preview subtree is inert with animation and pointer
interaction disabled. This is intentionally different from Views navigation
previews, which remain renderer-free geometry summaries of complete boards.

Canvas-level keyboard commands live in one guarded hook. `Cmd/Ctrl+B` toggles
Views, `Shift+Cmd/Ctrl+A` toggles Artifacts, `Cmd/Ctrl+0` resets the viewport,
`Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` traverse session history, `Cmd/Ctrl+A`
selects all, `Cmd/Ctrl+D` duplicates, `Cmd/Ctrl+C` / `V` use the in-session
canvas clipboard, `+`/`-` zoom, and `Escape` dismisses the active panel or
selection. Editable targets and the modal AI handoff are excluded from global
handling. Ordinary blank-stage drag remains pan; `Shift+drag` creates an
additive marquee, and dragging any selected node moves the full selection with
one shared snapped delta.

Presentation mode is a renderer state, not a board mutation. It hides editing
chrome and derives a Fit All viewport from current node bounds and live stage
dimensions. The persisted viewport remains untouched, so exiting restores the
exact editing frame. Left/Right switches browser-local Views while App-level
presentation state survives the workspace remount. `Escape` exits, while a
minimal pointer-accessible control strip keeps touch users from being trapped.

## Artifact Registry

Artifact definitions live behind this interface:

```ts
interface ArtifactBase<TData = unknown, TConfig = JsonObject> {
  id: string;
  title: string;
  version: string;
  defaultSize: {
    width: number;
    height: number;
  };
  minSize?: {
    width: number;
    height: number;
  };
  dataSchema?: JsonObject;
  configSchema?: JsonObject;
  dataValidator?: ZodType<TData>;
  configValidator?: ZodType<TConfig>;
}

interface ReactArtifactDefinition<TData = unknown, TConfig = JsonObject>
  extends ArtifactBase<TData, TConfig> {
  renderer?: "react";
  render: (props: ArtifactRenderProps<TData, TConfig>) => React.ReactNode;
}

interface EChartsArtifactDefinition<TData = unknown, TConfig = JsonObject>
  extends ArtifactBase<TData, TConfig> {
  renderer: "echarts";
  chartRenderer?: "svg" | "canvas";
  interactive?: boolean;
  buildOption: (props: ArtifactRenderProps<TData, TConfig>) => EChartsOption;
}

interface ChartKitArtifactDefinition<TData = unknown, TConfig = JsonObject>
  extends ArtifactBase<TData, TConfig> {
  renderer: "chart-kit";
  buildChart: (props: ArtifactRenderProps<TData, TConfig>) => ChartKitSpec;
}

type ArtifactDefinition<TData = unknown, TConfig = JsonObject> =
  | ReactArtifactDefinition<TData, TConfig>
  | EChartsArtifactDefinition<TData, TConfig>
  | ChartKitArtifactDefinition<TData, TConfig>;
```

The registry maps `artifactId` to an `ArtifactDefinition`. Canvas nodes store
only the `artifactId`, placement data, config, and normalized render data.

Chart Kit is a declarative compatibility layer over managed ECharts. Version 1
supports Cartesian bar, line, and combo specs. It owns dataset encoding, dual-
theme tokens, axes, grid, tooltip, palette, ARIA, and SVG rendering. Raw ECharts
remains an escape hatch for registered bar, line, and Sankey behavior; a browser
bundle cannot register additional tree-shaken host modules.

The registry is layered:

- `core` artifacts are platform-provided primitives.
- `examples` artifacts are demo and verification fixtures.
- `generated` artifacts are the user/AI extension point.

The default demo board lives in `src/canvas/seeds/demoBoard.ts` so example
layout does not become part of the registry contract.

Generated artifacts have three trusted loading paths:

- browser-installed `.freeform-artifact.json` bundles, persisted in IndexedDB
  and attached to one local view through the Agent API;
- repo-compiled `src/artifacts/generated/**/*.artifact.tsx`, discovered by
  Vite `import.meta.glob`;
- runtime external ESM modules listed in
  `artifacts/generated/manifest.json`, fetched relative to the Vite base path
  and imported as Blob-backed
  modules.

Browser bundles and external ESM modules are not sandboxed. Browser bundles are
trusted personal code scoped to one browser origin. External modules are for
self-hosted deployments where the owner accepts the risk of running their own
generated code. Both forms must be self-contained browser JavaScript because
Blob module URLs do not provide a stable relative import base.

This keeps AI generation bounded:

- AI can propose a new artifact module.
- The runtime can validate and register that module.
- The canvas can place the artifact without knowing internal render details.

Artifacts keep lightweight JSON-schema-shaped hints for handoff and future
tooling, and current runtime validation uses Zod validators attached to artifact
definitions. If validation fails, the canvas renders an invalid-artifact
fallback instead of letting an artifact crash the board.

Use `renderer: "chart-kit"` for ordinary bar, line, and combo charts. Artifacts
provide analytical intent and normalized values; Chart Kit supplies the shared
dataset, axes, grid, tooltip, palette, ARIA, and light/dark styling. Use raw
`renderer: "echarts"` only for host-registered behavior Chart Kit cannot
express. In both paths, the ECharts host owns lifecycle, resize behavior, and
the concrete SVG/canvas renderer. Raw ECharts artifacts are non-interactive by
default so the card body still drags like any other canvas node. Set
`interactive: true` only for artifacts that need chart-level hover, tooltip,
click, or brush behavior. Use React artifacts for non-chart UI and bespoke
composition.

`ArtifactRenderProps.size` is the live artifact content-box size. The managed
host updates it through `ResizeObserver`, calls `chart.resize()`, and rebuilds
the option when its internal dimensions change. Canvas cards normally keep that
internal box at the registered `defaultSize`: the selected resize handle locks
the aspect ratio and applies one local transform to the complete node, including
chart, chrome, Delete, and resize controls. Canvas zoom is a second outer
transform on `.canvas-world`. Complex artifacts should declare `minSize`, which
the canvas converts into a proportional minimum object scale.

## Data Pipeline

Database data should flow through transforms before rendering:

```mermaid
flowchart LR
    source["Database / API rows"] --> transform["Transform"]
    transform --> data["Artifact data"]
    data --> node["CanvasNode.data"]
    node --> registry["Artifact registry"]
    registry --> component["Artifact render"]
```

Transform rules:

- Keep raw database rows out of render components unless the artifact explicitly
  declares a row-oriented shape.
- Name transforms and make them testable.
- Register reusable transforms in `src/data/transforms.ts`.
- Prefer stable normalized data over implicit database column assumptions.
- Keep network fetches outside artifact render functions.

## Renderer Choice

The demo uses DOM artifacts inside a transformed world layer:

```text
canvas-stage
  grid-plane
  canvas-world transform(translate + scale)
    canvas-node transform(translate)
      node chrome
      artifact React render or managed ECharts host
```

This is deliberate. DOM rendering keeps tables, labels, controls, and future
accessibility behavior on the browser platform. A pure `<canvas>` renderer would
make arbitrary TS/JS artifact cards harder to build and inspect.

ECharts artifacts still live in the DOM world. Their host mounts a chart inside
the card body and keeps the chart lifecycle separate from AI-generated
artifact definitions.

Theme adaptation belongs to each artifact definition because ECharts option
colors are not inherited from host CSS. Every ECharts artifact must derive its
title, axis, legend, annotation, tooltip, mark, node, link, and emphasis colors
from `theme.mode`; the generic host owns lifecycle only. React artifacts should
use host theme variables or the provided `CanvasTheme` rather than fixed light
surfaces.

Use a pure drawing engine only if the product boundary shifts toward freehand
ink, geometric shapes, or extremely large visual primitive counts.

## Runtime Module Boundaries

`src/App.tsx` is the view-bootstrap and relay-routing boundary: it opens,
creates, and switches browser-local views, and routes a delivery to the active
installer or the stored target view without retargeting it.
`src/canvas/CanvasWorkspace.tsx` composes the active canvas, while focused
runtime and autosave hooks load artifacts and persist board state.
The workspace publishes Playwright debug state and wires product actions such as
import/export, theme switching, snap preference, deletion, and the AI handoff dialog. Personal
artifact creation is bundle-first: a remote agent delivers encrypted bundles
through `src/relay/`, a same-browser agent uses `window.__FREEFORM_AGENT__`, or
the user imports the same bundle file. None requires an application commit or
deploy. The copyable handoff is agent-neutral: it installs the project skill,
then asks the agent to question the user before authoring one or more bundles.
`src/relay/handoff.ts` keeps capability-free preparation serialization separate
from capability-bearing live delivery serialization; the dialog only selects
the instruction that the current request/session state authorizes.

Canvas runtime behavior lives under `src/canvas/`:

- `components/` renders the toolbar, board, canvas nodes, and zoom controls.
- `hooks/useCanvasInteractions.ts` owns pointer drag, resize, wheel pan, pinch
  zoom, toolbar zoom, marquee selection, group movement, z-order bumping, and
  snap-to-grid math.
- `hooks/useCanvasDocumentHistory.ts` owns bounded session snapshots and gesture
  transactions; `hooks/useCanvasSelectionActions.ts` owns document commands.
- `selection.ts` keeps selection geometry, layout, cloning, and presentation
  framing pure and independently reviewable.
- `debugState.ts` is the only place that writes `window.__FREEFORM_STATE__`.
- `src/relay/` owns browser session consent, capabilities, encryption,
  reconnect/replay, atomic multi-bundle preparation, and placement.
- `relay/` is the independently deployable transport Worker and Durable Object;
  it must remain unable to decrypt artifact source or own durable product state.

Styles are also split by domain under `src/styles/` and imported through
`src/styles.css`. Keep new visual rules near the surface they style instead of
growing the entry file.

The typography system separates interface prose from data comparison:
Instrument Sans is self-hosted for chrome, headings, and explanatory text;
Geist Mono is self-hosted for numeric values, dates, quarters, and axes. The
top bar is intentionally compact application chrome, so secondary commands
must remain in More instead of accumulating equal-weight pills.

## Future Boundaries

Before loading untrusted AI-generated code, add a sandbox strategy. Candidate
approaches:

- Build-time only artifact review for trusted local demos.
- Runtime iframe sandbox for generated cards.
- Server-side validation and bundling before registry import.
- JSON-schema or Zod validation for `data` and `config`.

The current demo is a trusted-code prototype, not an untrusted plugin runtime.
