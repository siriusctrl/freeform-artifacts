# Architecture Decisions

This document records durable implementation decisions, tradeoffs, rejected
alternatives, and the conditions that should trigger a revisit.

Use this for decisions that a fresh agent should not have to rediscover from
chat history.

## ADR-0001: Use DOM-based React artifacts inside a transformed canvas world

Status: Accepted

Date: 2026-07-07

### Context

The product goal is a Freeform-style browser canvas where users can drag,
place, pan, and zoom arbitrary JS/TS-based artifacts. The important artifact
class is database-backed cards: metrics, tables, compact charts, transformed
records, and future AI-generated UI modules.

Artifacts need to remain normal frontend components. They should be able to use
text, layout, tables, SVG, lightweight controls, and future accessibility
semantics without forcing every visual element through a custom drawing layer.

### Decision

Use a DOM-based runtime:

- React renders artifact components.
- A canvas stage owns viewport state.
- A transformed world layer applies pan and zoom.
- Each canvas node is positioned with world coordinates.
- Artifact definitions are registered through a typed artifact registry.

Current layout:

```text
canvas-stage
  grid-plane
  canvas-world transform(translate + scale)
    canvas-node transform(translate)
      node chrome
      artifact React render
```

### Why this route

DOM/React is the most direct fit for data artifacts:

- Tables, text, SVG charts, forms, badges, and selection affordances remain normal
  browser content.
- AI-generated cards can target a clear TypeScript interface instead of a
  graphics command API.
- Database data can be transformed into props and rendered by typed components.
- Browser verification can assert both DOM state and visual behavior.
- The first demo stays small enough for a new Codex session to understand.

### Rejected alternative: pure `<canvas>` renderer

A pure canvas renderer would make pan/zoom and drawing primitives efficient, but
it is the wrong first boundary for arbitrary data cards.

Costs:

- Every card layout would need a drawing implementation.
- Text wrapping, tables, inputs, links, accessibility, and selection become
  custom runtime work.
- AI-generated artifacts would need to emit drawing commands instead of
  conventional frontend components.
- DOM-level Playwright assertions would become weaker because most content
  would be pixels.

Revisit if the product becomes primarily freehand drawing, geometric objects,
or tens of thousands of simple primitives.

### Rejected alternative: React Flow

React Flow is strong for node graphs, edges, and workflow editors. This product
is closer to a freeform board than a graph editor.

Costs:

- The graph model would bias the UI toward nodes and connections.
- Free placement, board-like composition, and arbitrary artifacts are more
  central than edge routing.
- It adds a product metaphor before the artifact runtime is proven.

Revisit if relationships, lineage, joins, or executable workflow edges become a
primary product requirement.

### Rejected alternative: tldraw or Excalidraw as the base runtime

tldraw and Excalidraw are strong whiteboard foundations. They are not the first
choice for this demo because the main problem is not drawing. The main problem
is an artifact contract for AI-generated JS/TS cards backed by transformed
database data.

Costs:

- Their object models become the product's object model.
- Embedding arbitrary generated React artifacts may require deeper integration
  than the demo needs.
- The first handoff would be about adapting to a whiteboard framework instead
  of validating the artifact runtime boundary.

Revisit if the product needs mature whiteboard features such as multiplayer
presence, drawing tools, sticky notes, shape libraries, or polished selection
handles before the artifact registry work deepens.

### Consequences

Positive:

- Fast demo path.
- Clear AI artifact interface.
- Normal frontend rendering and inspection.
- Straightforward browser proof recording.

Negative:

- Very large boards will need virtualization.
- CSS transform scaling can affect text rendering and pointer math details.
- Rich resize/rotate/multi-select behavior must be implemented or introduced
  through a focused interaction library later.

### Follow-up work

- Add resize handles and multi-select after the core artifact contract is
  stable.
- Add board serialization before persistence.
- Add schema validation before accepting generated artifact modules.
- Add a sandbox before loading untrusted generated code.

## ADR-0002: Use Playwright browser proof as required visual evidence

Status: Accepted

Date: 2026-07-07

### Context

The app runs on an SSH server, but user-facing behavior must still be verified
through a real browser. Static checks and build success do not prove drag,
pan, zoom, selection, or rendered artifact behavior.

### Decision

Use Playwright Chromium for browser verification and recording:

- `npm run verify:ui` runs assertions against real interactions.
- `npm run verify:proof` records an asserted end-to-end browser journey with a
  verification-only cursor and action label.
- `ffmpeg` converts the Playwright WebM recording to `proof.gif`.
- `ffmpeg` also writes `contact-sheet.png` so agents can inspect keyframes for
  temporal glitches before reporting completion.
- The journey writes `ux-checks.json` with layout, gesture, pointer-anchor,
  rendering, and persistence assertions collected during the recording.
- Proof artifacts are written under `artifacts/verification/<timestamp>/`.

### Why this route

- Chromium can run headlessly on the SSH server.
- Playwright can drive real pointer and wheel events.
- Tests can assert state changes, not only produce a recording.
- GIF/WebM/screenshot/contact-sheet evidence gives the next Codex session a
  concrete replay of the current behavior, while the user-facing proof can stay
  focused on the GIF.

### Tradeoffs

- Browser binaries must be installed with `npm run setup:browsers`.
- GIF generation depends on `ffmpeg`.
- Headless proof is not identical to a human's local GPU/browser environment.

Revisit if local visual differences become important enough to require headed
Xvfb recordings or multi-browser evidence.

## ADR-0003: Own pointer interaction in the canvas shell

Status: Accepted

Date: 2026-07-07

### Context

The canvas must support card drag, blank-stage pan, and wheel navigation without
the browser interpreting the same gesture as text selection, native element
drag, or page-level scrolling/zooming.

The first prototype used React pointer handlers attached mostly to the stage and
nodes. That worked in automated happy paths but could let browser selection
behavior leak in during longer real drags.

### Decision

The canvas shell owns pointer interaction during active gestures:

- pointer movement and pointer release are handled at `window` scope;
- active drags add `body.dragging-canvas`;
- drag targets call `preventDefault`;
- canvas nodes are marked `draggable={false}`;
- the stage disables user selection and touch browser gestures;
- wheel navigation uses a non-passive DOM listener on the stage.

### Why this route

This keeps interaction ownership inside the canvas runtime instead of relying on
the browser's default text/element drag behavior. It also makes drags resilient
when the pointer leaves the original card or stage bounds.

### Tradeoffs

- The canvas becomes responsible for restoring global drag state correctly.
- Future text-editing artifacts will need an explicit edit mode or an opt-out
  region so text can be selected inside a card intentionally.

Revisit when artifacts support editable text, embedded inputs, or nested
interactive widgets that need their own pointer semantics.

## ADR-0004: Remove the sidebar from the initial demo surface

Status: Accepted

Date: 2026-07-07

### Context

The first demo briefly included a Freeform-like board sidebar. It showed board
labels, data sources, and AI drafts, but those controls were not connected to
real navigation or multi-board state.

The primary product question is whether the canvas can host AI-generated
database artifacts with clear drag, pan, zoom, theme, and verification behavior.

### Decision

Remove the sidebar for now. Keep the first screen focused on:

- the canvas;
- the top toolbar;
- theme switching;
- artifact insertion;
- zoom controls;
- selection inspection.

### Why this route

The sidebar consumed horizontal space without proving a meaningful product
capability. Removing it makes the demo cleaner, gives artifacts more room, and
reduces handoff surface area for the next implementation pass.

### Tradeoffs

- There is no visible multi-board navigation yet.
- Future data-source and AI-draft management will need another surface.
- A future sidebar can return when it has real state and workflows behind it.

Revisit when boards, source connections, artifact library browsing, or AI draft
management become real product features rather than decorative navigation.

## ADR-0005: Default standard charts to a managed ECharts artifact host

Status: Accepted

Date: 2026-07-07

### Context

The demo needs to prove that artifacts can be more than simple metric cards.
The next useful examples are data-heavy visuals: probability timelines,
cumulative line charts, and Sankey-style allocation flows.

Hand-written React/SVG examples were a useful first sketch, but they made the
wrong long-term boundary look attractive. If AI has to generate bespoke axis
layout, label collision handling, scales, legends, tooltips, and interaction for
every chart, the host is not providing enough leverage.

### Decision

Default standard chart artifacts to ECharts:

- `renderer: "echarts"` artifacts expose `buildOption`.
- The host owns `echarts.init`, `setOption`, `resize`, and `dispose`.
- The host chooses the concrete chart renderer, defaulting to SVG for crisp
  canvas-card output.
- `InflectionProbability.tsx` and `SankeyFlow.tsx` are ECharts artifacts.
- Custom React artifacts remain available for visuals or interaction patterns
  that ECharts cannot express well.

### Why this route

ECharts gives the AI and the host a practical shared chart grammar. The model
can generate normalized data plus an option object, while the application keeps
ownership of lifecycle, sizing, theme context, and canvas interaction rules.

This is a better default than asking AI to hand-roll charts because:

- common chart families are already implemented;
- tooltips, legends, axes, scales, Sankey layout, and animation are available;
- SVG and canvas renderers can be selected by the host;
- the artifact interface stays declarative for normal charts;
- the custom React path remains open for specialized artifacts.

### Tradeoffs

- ECharts adds bundle weight.
- The host must explicitly register the chart and component modules it supports.
- ECharts option objects are powerful enough to need validation before accepting
  untrusted runtime-generated artifacts.
- Some visuals will still need custom React or another specialized runtime.
- Sankey data must remain a directed acyclic graph for ECharts Sankey layout.

### Rejected alternative: keep complex examples as hand-written SVG

Hand-written SVG keeps bundle size small and is easy to inspect, but it pushes
too much charting work into every generated artifact. That is acceptable for one
or two bespoke examples and weak as the default AI-generation contract.

### Rejected alternative: let generated artifacts manage ECharts lifecycle

Generated artifacts could call `echarts.init` directly, but then every artifact
would need to solve resize, disposal, theme updates, event isolation, and canvas
pointer interaction. Keeping lifecycle in the host makes artifacts smaller and
keeps the canvas runtime in charge.

Revisit if ECharts bundle size becomes unacceptable, if the product needs a
more constrained declarative grammar such as Vega-Lite, or if untrusted runtime
code loading requires iframe or worker-based sandboxing.

## ADR-0006: Ship a project-local artifact builder skill

Status: Accepted

Date: 2026-07-07

### Context

Future agents need to add artifacts without rediscovering the renderer split,
ECharts lifecycle boundary, registry wiring, layout expectations, and visual
proof process. README and architecture docs are useful for humans, but a new
agent benefits from a directly invokable skill with concise procedural rules.

### Decision

Add `skill/freeform-artifact-builder/` as a project-local skill:

- `SKILL.md` gives the short artifact-building workflow and hard rules.
- `references/artifact-contract.md` contains TypeScript artifact patterns.
- `references/layout-verification.md` contains initial canvas layout and proof
  review guidance.
- `agents/openai.yaml` provides UI metadata for skill lists.

The skill is intentionally repo-local so it evolves with the artifact contract.

### Why this route

The artifact interface is a product boundary, not just documentation. Keeping a
skill in the repository gives future agents a compact operational entry point
that can be indexed or invoked by skill tooling while staying versioned with the
code it describes.

### Tradeoffs

- The skill must be maintained whenever artifact contracts or verification
  expectations change.
- The current `skills` CLI discovers this nested location with full-depth scans
  such as `npx skills add . --list --full-depth`.
- Duplicating small amounts of guidance across docs and skill references is
  acceptable when it keeps agent behavior reliable.

Revisit if the artifact contract stabilizes enough to publish this as a shared
external skill package, or if skill tooling standardizes on a different project
layout.

## ADR-0007: Add runtime persistence, transforms, and validation before sandboxing

Status: Accepted

Date: 2026-07-07

### Context

The first canvas proved drag, pan, zoom, theme switching, and managed ECharts
artifacts. The next risk was not more visual examples. The next risk was whether
the board could preserve user work and whether database-shaped inputs could
enter artifacts through a repeatable, validated path.

### Decision

Implement the next productization layer before untrusted-code sandboxing:

- persist board state as versioned local-storage JSON;
- add selected-card resize handles;
- route imported query rows through `src/data/transforms.ts`;
- attach Zod validators to artifact definitions;
- render an invalid-artifact fallback when payload validation fails;
- add production preview verification;
- add lightweight sampled-frame checks to proof recording.

### Why this route

This keeps the demo focused on the artifact runtime boundary. AI-generated
cards still cannot mutate canvas state directly, but the app can now save a
board, restore it, validate artifact payloads, and prove production output in a
browser.

### Tradeoffs

- Local storage is not collaboration or durable backend persistence.
- Zod adds bundle weight, but catches invalid payloads at the runtime boundary.
- The import path currently uses a checked fixture instead of a live database or
  arbitrary file import.
- Frame checks catch blank-like frames, not all visual regressions.

The persistence portion of this decision is superseded by ADR-0011. Revisit the
remaining transform and validation boundaries when real data connectors arrive
or when untrusted generated code loading begins.

## ADR-0008: Split artifact registries by ownership

Status: Accepted

Date: 2026-07-07

### Context

The early demo artifacts were all stored in one flat artifact folder and one
registry. That was enough while every artifact was hand-written by the project,
but it blurred three different ownership classes:

- platform-provided primitives;
- demo and verification examples;
- future user or AI-generated artifacts.

### Decision

Split artifacts by ownership:

- `src/artifacts/core/` for platform-provided artifacts;
- `src/artifacts/examples/` for demo and verification artifacts;
- `src/artifacts/generated/` as the future user/AI extension point;
- `src/artifacts/registry.ts` only merges registry layers;
- `src/canvas/seeds/demoBoard.ts` owns the default demo layout.

### Why this route

This prevents example artifacts from becoming accidental product API. Tests can
continue to use rich examples, while future generated artifacts get a dedicated
mount point with separate policy and validation.

### Tradeoffs

- More files and import paths.
- Very small projects may not need this separation.
- Moving examples requires keeping docs and skills current.

Revisit if generated artifacts move into a sandboxed package boundary or if
core artifacts become a separately versioned artifact SDK.

## ADR-0009: Support trusted dynamic generated artifacts

Status: Accepted

Date: 2026-07-07

### Context

The generated artifact entry point should support user workflows where Codex or
Claude writes an artifact file and the self-hosted app owner wants to see it
without manually editing the central registry. The owner controls deployment and
accepts the risk of running generated code.

### Decision

Support two trusted loading paths:

- repo-compiled generated modules discovered from
  `src/artifacts/generated/**/*.artifact.tsx` with Vite `import.meta.glob`;
- runtime external ESM modules listed in
  `public/artifacts/generated/manifest.json` and imported with
  `import(/* @vite-ignore */ moduleUrl)`.

External modules can export `artifact`, `default`, or `artifacts`. The runtime
merges them into the in-memory artifact registry after startup.

### Why this route

This gives a low-friction self-hosted workflow without adding a browser-side
TypeScript compiler or iframe sandbox. TSX artifacts stay convenient during
repo development, while deployed owners can drop compiled ESM modules under
`public/` and update the manifest.

### Tradeoffs

- Runtime ESM artifacts are trusted page code and are not sandboxed.
- External modules must be browser-ready JavaScript, not raw TSX.
- External modules are fetched and imported as Blob-backed modules, so they
  should be self-contained and avoid relative imports.
- Production deployments need a writable/public artifact directory if users add
  artifacts after build.
- Artifact data validation still happens at the host boundary, but lifecycle and
  global JS side effects remain trusted-code risks.

Revisit when generated code should be accepted from untrusted users, or when the
product needs a server-side compiler/bundler for uploaded TSX artifacts.

## ADR-0010: Keep snap-to-grid in the canvas host

Status: Accepted

Date: 2026-07-08

### Context

As the demo gained larger charts and multiple artifact cards, freehand
placement became harder to keep tidy. The board already had a dotted grid, but
that was only visual; dragging and resizing still used arbitrary rounded world
coordinates.

Generated artifacts should not need to know about board alignment. They render
data inside a node. Placement, resize, pan, zoom, and future multi-select
behavior belong to the canvas shell.

### Decision

Add default-on snap-to-grid behavior in the canvas host:

- the grid interval is 38px, matching the visual dotted grid;
- dragged node positions snap in world coordinates;
- resize is owned by the canvas host but remains aspect-locked rather than
  snapping dimensions independently;
- the labeled toolbar setting toggles snap on and off;
- the snap preference is saved in the versioned board JSON.

### Why this route

World-coordinate snapping keeps layout stable across zoom levels. Keeping the
logic in the host also means AI-generated artifacts remain pure renderers and
do not duplicate alignment rules.

### Tradeoffs

- Default snap introduces visible jumps during drag rather than perfectly
  continuous motion.
- Users sometimes need free placement, so the toolbar exposes an explicit
  toggle.
- Future smart guides, alignment commands, or multi-select distribution should
  compose with this host-level placement policy instead of moving into artifact
  code.

Revisit if the product adds a full layout engine, constraint solver, or
collaborative selection model that needs richer alignment state than a single
grid preference.

## ADR-0011: Fork published templates into browser-local workspaces

Status: Accepted

Date: 2026-07-12

### Context

The public demo should open from one shareable URL and show an authored board.
Every visitor must be able to modify that board, close the page, and return to
their own changes without affecting the author or another visitor. Cross-device
sync and accounts are not required.

The earlier single-board localStorage implementation restored basic state, but
it did not distinguish an immutable published template from a visitor's local
copy. It also left limited room for larger artifact data and future local
assets.

### Decision

- Keep published templates in the application bundle as immutable seeds.
- Select templates with a static-hosting-safe `?board=<template-id>` query.
- On first visit, create a versioned `WorkspaceRecord` keyed by template ID.
- Persist the workspace in IndexedDB.
- Debounce interaction-driven IndexedDB saves, serialize writes per view, and
  write the latest localStorage recovery mirror synchronously on `pagehide` so
  an immediate close can still recover the latest serializable board.
- Prefer the newest valid record during bootstrap and repair IndexedDB from the
  recovery mirror when needed.
- Provide versioned `.freeform.json` import/export and an explicit reset action.
- Test persistence by closing/reopening a page and test isolation with two
  independent Playwright browser contexts.

### Why this route

Browser-origin storage gives the required visitor isolation without accounts,
APIs, or a shared database. IndexedDB gives the primary model room to grow,
while the small recovery mirror protects the current serializable board from
the asynchronous close timing that IndexedDB alone cannot fully control.

The template/workspace boundary also prevents a future deployment from silently
overwriting a visitor's edits. Resetting to the latest authored demo remains an
explicit user action.

### Tradeoffs

- Isolation is per browser profile and origin, not per human identity.
- Clearing site data or using short-lived private browsing removes the local
  workspace.
- There is no automatic cross-device sync.
- Very large boards may exceed the recovery mirror quota; IndexedDB remains the
  primary store and workspace export is the durable portability path for board
  data. Executable personal packages must be installed separately.
- Existing visitors do not automatically receive future template changes after
  they have forked a workspace.

Revisit when the product needs authenticated sync, public board sharing, binary
artifact assets, or a multi-workspace picker.

## ADR-0012: Deploy the app as a base-aware GitHub project Pages site

Status: Accepted

Date: 2026-07-12

### Context

The public demo is hosted at `/freeform-artifacts/`, not at the domain root.
Absolute root paths for the generated artifact manifest and modules would point
at the portfolio site and fail after deployment.

### Decision

- Configure Vite from `VITE_BASE_PATH`, defaulting to `/` locally.
- Build Pages with `VITE_BASE_PATH=/freeform-artifacts/`.
- Resolve the generated artifact manifest from `import.meta.env.BASE_URL`.
- Resolve module entries relative to the fetched manifest URL.
- Deploy `dist/` with the official GitHub Pages artifact actions.

### Tradeoffs

- Any future public asset loader must remain base-aware.
- Local verification must cover both the root development base and the
  production project base.

Revisit if the project moves to a custom domain root or another static host.

## ADR-0013: Separate wheel panning from trackpad pinch zoom

Status: Accepted

Date: 2026-07-12

### Context

The first interaction model treated every browser `wheel` event as zoom. On a
trackpad, that turns ordinary two-finger vertical scrolling into unexpected
zooming and conflicts with the spatial navigation users expect from Freeform.
Chromium reports trackpad pinch gestures as control-modified wheel events, so
the host can distinguish the two intents without device detection.

### Decision

- Ordinary wheel events pan the viewport by the inverse of their horizontal and
  vertical deltas, matching native content scrolling.
- Control-modified wheel events zoom continuously around the pointer and do not
  pan the viewport.
- Normalize line- and page-mode wheel deltas into pixels; trackpad pixel deltas
  pass through unchanged.
- Keep the stage listener non-passive so canvas navigation does not also scroll
  or zoom the browser page.
- Keep toolbar zoom controls as an explicit mouse and keyboard-accessible path.

### Why this route

The browser already applies the operating system's natural-scrolling preference
to wheel deltas. Consuming those values directly preserves the user's platform
setting and supports two-axis trackpad movement without user-agent or hardware
detection. An exponential pinch factor also converts high-resolution trackpad
deltas into smooth scale changes instead of fixed ten-percent jumps. The pinch
sensitivity is tuned against sequences of small deltas rather than a single
large synthetic wheel event, matching how physical trackpads report the gesture.

### Tradeoffs

- A mouse wheel pans instead of zooming while the pointer is over the full-screen
  canvas; explicit zoom controls remain visible.
- The control-modified wheel convention depends on browser behavior, although it
  is the standard Chromium representation used by the deployed app and tests.
- Preventing the default wheel action means the surrounding page will not scroll
  while the pointer is over the canvas. This is intentional for the full-screen
  workspace, but should be revisited if the canvas is embedded inside a longer
  document.

Revisit when native touch gestures, a configurable input map, or an embedded
canvas layout is introduced.

## ADR-0014: Reflow managed artifacts from live container size

Status: Partially superseded by ADR-0017

Date: 2026-07-12

### Context

Calling `chart.resize()` keeps the ECharts renderer the same size as its host,
but it cannot repair artifact options that use fixed annotation widths,
incorrect text anchors, or margins too small for external labels. The original
probability marker row extended 75px beyond its SVG host, while right-side
Sankey labels extended up to 44.5px beyond theirs. Enlarging the card preserved
those overflows because the fixed offsets moved with the container edge.

The read-only selection inspector also covered canvas content without enabling
any user action.

### Decision

- Add live `size` to `ArtifactRenderProps`.
- Let the managed ECharts host observe its content box, call `chart.resize()`,
  and rebuild options when dimensions change.
- Add optional artifact-level `minSize` and enforce it in the canvas resize
  interaction.
- Clamp existing browser workspaces and imported backups to registered artifact
  minimums so older saved dimensions migrate automatically.
- Require complex chart artifacts to reflow at both default and minimum sizes;
  canvas zoom remains the uniform-scale operation.
- Test essential SVG text bounding boxes against the ECharts host bounds.
- Remove the selection inspector from the product UI; debug state remains
  available through `window.__FREEFORM_STATE__` for verification tooling.

### Tradeoffs

- Rebuilding options while resizing costs more than `chart.resize()` alone, but
  keeps annotations and chart-specific layout correct.
- Artifact authors must define responsive option math and a realistic minimum
  size for dense visuals.
- Uniformly scaling a card would be simpler, but would make text unreadably
  small and does not match responsive data-card behavior.

Revisit if resize performance requires frame throttling, or if the product adds
an explicit aspect-ratio-locked scale mode for illustration-style artifacts.

## ADR-0015: Make artifact creation an agent handoff, not a placeholder insert

Status: Superseded by ADR-0018

Date: 2026-07-12

### Context

The original Add artifact button inserted one pre-authored metric card. That
behavior implied the browser could create arbitrary artifacts while only
duplicating a fixture, and it mixed the artifact-authoring workflow with board
editing. The toolbar also exposed separate select and data buttons even though
selection is direct manipulation and sample data is an occasional demo action.

### Decision

This decision is superseded by ADR-0018 for personal artifacts. Repository
generation remains available only for maintainers changing shared examples or
host capabilities.

- Replace Add artifact with **Build with AI**.
- Ask for an artifact description and generate a copyable Claude Code
  instruction that installs the public `freeform-artifact-builder` skill.
- For shared application artifacts, keep generation as a trusted repository workflow: implement under
  `src/artifacts/generated/`, add a demo node only when intended, bump the
  template version, verify, commit, push, and deploy.
- Do not mutate the current board when generating the handoff.
- Keep theme as a primary toolbar control. Put labeled grid snap with an
  accessible switch, sample data, workspace import/export, and reset in a More
  menu; remove the redundant select tool.
- Expose deletion on the selected card and through `Delete`/`Backspace`, while
  ignoring keyboard shortcuts inside editable controls.
- Use a recognizable scaling icon and tooltip for the selected-card resize
  affordance.

### Why this route

Artifact creation changes executable code and often data transforms, schemas,
layout, and verification. A repository-aware agent can make and review those
changes coherently; a static client-side button cannot. Keeping the handoff
honest also preserves the host boundary: the canvas renders registered code but
does not pretend to be a code-generation backend.

### Tradeoffs

- Creating an artifact is not instant and requires a local clone plus Claude
  Code or another compatible agent.
- Existing browser workspaces remain immutable forks after deployment and need
  **More > Reset demo** to adopt a newly published board.
- The generated instruction currently targets Claude Code explicitly; other
  agents can still use the repo skill manually.

Revisit when the product has an authenticated build service, reviewed artifact
packages, or a sandboxed runtime that can safely support in-browser generation.

## ADR-0016: Combine responsive card reflow with bounded visual scaling

Status: Superseded by ADR-0017

Date: 2026-07-12

### Context

Canvas zoom already scales the complete world layer, including chart content
and selected-card controls. Card resize is different: it changes world-space
dimensions and asks artifacts to rebuild at a new content-box size. The first
responsive implementation reflowed ECharts geometry but left typography,
marks, card chrome, and delete/resize controls at fixed CSS-pixel sizes. A
Sankey resized from 600x360 to 800x480 therefore had more empty space without a
correspondingly larger visual system.

### Decision

- Derive a card visual scale from its current size relative to the registered
  artifact `defaultSize`.
- Clamp the scale from 0.82 to 1.5 so controls remain usable and large cards do
  not produce oversized typography.
- Apply that scale to node chrome, title icons, Delete, and the resize handle.
- Let dense artifacts such as Sankey consume live content size to scale their
  title, subtitle, labels, nodes, gaps, and padding while still rebuilding a
  responsive ECharts option.
- Continue applying canvas zoom once at `.canvas-world`; do not counter-scale
  selected controls.
- Verify both layers separately: card resize changes internal/control sizes,
  then canvas zoom changes their final screen-space bounds by the same ratio.

### Tradeoffs

- Card resize is not a pure bitmap-like transform; charts still reflow, so some
  positions may change as well as their sizes.
- The visual-scale clamp means extreme card dimensions intentionally stop
  producing proportional typography changes.
- Artifact authors must decide which internal values belong to their visual
  system instead of assuming `chart.resize()` scales them automatically.

Revisit if artifacts need an explicit choice between responsive reflow,
aspect-ratio-locked scaling, and hybrid behavior.

## ADR-0017: Resize artifacts as aspect-locked objects

Status: Accepted

Date: 2026-07-12

### Context

The bounded visual-scale approach changed selected controls and selected Sankey
values, but the card was still a responsive container: ECharts received a new
client size and rebuilt its layout. That did not match the user's Freeform
mental model, where dragging one object's corner scales the entire object. A
font-size measurement changing was therefore insufficient evidence that object
resize worked correctly.

### Decision

- Treat every registered artifact `defaultSize` as a fixed internal coordinate
  system.
- Store the object's visual world-space bounds in `CanvasNode.width/height`.
- Normalize loaded and imported nodes to the artifact's default aspect ratio.
- Project resize-handle pointer movement onto that aspect ratio and enforce a
  proportional minimum derived from `minSize`.
- Render the node at `defaultSize` and apply one local CSS `scale()` to the full
  node, including ECharts/React content, chrome, Delete, and resize handle.
- Apply viewport zoom separately at `.canvas-world`; never counter-scale object
  controls.
- Verify real pointer resize by asserting that ECharts `clientWidth` stays fixed
  while its screen-space width and internal labels scale with the node.

### Why this route

One transform gives every descendant exactly the same ratio and makes the
interaction visually predictable. It also provides a crisp test boundary:
responsive resize changes `clientWidth`, while object scaling does not.

### Tradeoffs

- Card resize is aspect-locked; users cannot independently stretch width and
  height.
- Very small objects also have smaller controls. Artifact `minSize` is the
  usability boundary and must be chosen carefully.
- Responsive reflow remains available inside an artifact host if its internal
  coordinate size changes for another reason, but canvas object resize does not
  trigger that path.
- Existing non-proportional saved sizes are migrated to the smallest
  proportional bounds that contain the prior width and height.

Revisit only if the product introduces an explicit resize-mode selector rather
than silently mixing reflow and object scaling.

## ADR-0018: Store multiple local views and install personal artifacts as bundles

Status: Accepted

Date: 2026-07-12

### Context

A single workspace could not represent multiple canvases, and the first Build
with AI handoff still asked an agent to modify and deploy the application repo.
That workflow was too heavy for personal artifacts and could not install an
artifact into one user's browser-local canvas without changing everyone’s app.
The static GitHub Pages deployment also cannot accept server-side uploads.

### Decision

- Keep the existing IndexedDB `workspaces` store and treat its historical
  `templateId` key as a local view id, preserving old data without a store
  migration.
- Add a persisted title to each workspace, expose it as a centered inline-edit
  control, and list named views in a default-collapsed sidebar.
- Create new views as empty boards and remember the active view locally.
- Add an IndexedDB `artifact-packages` store for trusted bundle ESM source.
- Define a versioned bundle with `artifactId`, self-contained `moduleSource`,
  and serializable initial node data/config.
- Expose `window.__FREEFORM_AGENT__.listViews()` and `installArtifact()` for an
  agent controlling the same browser page.
- Provide file installation as the fallback when the agent cannot control the
  user's browser profile.
- Keep repo-compiled and deployed external modules as maintainer paths, not the
  default personal-view workflow.

### Tradeoffs

- Bundle modules execute as trusted page code and are not sandboxed.
- Automation can write only to the browser profile it controls. Cross-profile
  installation requires the user to import the generated bundle file.
- Artifact packages are browser-origin local and disappear when site data is
  cleared; cross-device sync remains outside this static architecture.
- The `templateId` field is now historically named, but retaining it avoids a
  destructive IndexedDB key migration.

Revisit when the product adds accounts, a shared artifact registry, or a
sandboxed package runtime.

## ADR-0019: Keep AI request discovery in the handoff and previews lightweight

Status: Accepted

Date: 2026-07-12

### Context

The first bundle handoff asked for an artifact description inside the app and
targeted Claude Code explicitly. That duplicated a conversation the coding
agent is better equipped to conduct and excluded other agents supported by the
Skills CLI. The first Views sidebar also used text-only rows and appeared or
disappeared without transition, which made switching canvases feel detached
from the Freeform spatial model.

### Decision

- Remove the artifact-request field from the app dialog.
- Copy an agent-neutral prompt that installs `freeform-artifact-builder`, then
  instructs the agent to ask the user what artifact they want and clarify data,
  visual form, and layout before building.
- Let the Skills CLI interactively choose the installed agent rather than
  hard-coding an `--agent` target.
- Keep the bundle file fallback and target-view Agent API unchanged.
- Keep the Views rail mounted but inert while closed, and animate its grid
  track, opacity, and translation when toggled.
- Build each view preview from saved node geometry and artifact ids. Never mount
  artifact code in the sidebar or persist screenshot blobs.

### Tradeoffs

- Users perform artifact discovery in their agent conversation rather than in
  the browser dialog.
- Preview thumbnails communicate composition and density, not exact chart
  pixels or live data values.
- The open/close animation causes a short continuous workspace resize; the
  canvas and managed chart hosts must tolerate container resize throughout it.
- Interactive agent selection adds one CLI prompt but keeps the handoff usable
  across supported agents.

Revisit screenshot previews only if exact visual recognition becomes more
valuable than storage size, freshness, and renderer isolation.

## ADR-0020: Make artifact hierarchy and dark-mode styling part of the contract

Status: Accepted

Date: 2026-07-12

### Context

The first examples proved renderer and persistence mechanics but carried weak
presentation defaults: an internal table name leaked into the UI, the pipeline
stacked counters and decoration into a small frame, generic supply analysis
still carried domain-specific wording, and every Sankey node used one fill.
ECharts also does not inherit the host's CSS theme for option-level text,
tooltips, axes, nodes, or links.

### Decision

- Treat internal data and transform names as implementation details, never
  presentation copy.
- Keep one primary idea and at most three visible hierarchy levels inside an
  artifact body. Remove redundant counters, badges, nested panels, and
  decoration before shrinking text.
- Keep public examples domain-generic unless specificity is necessary to
  understand the visualization.
- Give categorical and topological nodes distinct, controlled colors. Sankey
  links use source-to-target gradients rather than one anonymous fill.
- Require every ECharts `buildOption` to branch on `theme.mode` and style all
  relevant text, grid, tooltip, series, node, link, and emphasis tokens.
- Require browser inspection at default and minimum size in both light and dark
  mode, including SVG bounds and categorical color counts.
- Capture these constraints in the project skill's visual style guide so
  personal bundles follow the same quality bar as shared examples.
- Migrate only the payload and title of existing published Probability,
  Pipeline, and Sankey node ids. Preserve geometry, deletion, viewport, theme,
  personal artifacts, and every unknown node.

### Tradeoffs

- Artifact definitions contain more explicit theme tokens.
- Geometry-based checks cannot judge every aesthetic choice, so screenshot,
  contact-sheet, and GIF inspection remain required.
- Distinct palettes need deliberate contrast review in both themes rather than
  automatic reuse of the product accent.
- Known published example ids are reserved migration points; users who want a
  permanently divergent card should create a personal artifact with its own id.

Revisit shared theme-token helpers when three or more artifacts repeat the same
complete chart palette; do not centralize prematurely at the cost of chart-
specific legibility.

## ADR-0021: Use compact application chrome and separate prose from data type

Status: Accepted

Date: 2026-07-12

### Context

The original 66px top bar gave Theme, More, save status, and Build equal 44px
pill treatment with repeated borders and shadows. Combined with widespread
720-780 font weights, the chrome read heavier than the canvas content. Geist
also served both prose and data, reducing typographic distinction.

### Decision

- Use a 54px top bar with reduced horizontal padding.
- Group Theme and More in one 36px display-control surface; keep save status
  flat in a fixed-width slot before that group, and let the 38px Build button
  remain the only high-contrast command. Status text changes must not move the
  display controls or Build command.
- Use Instrument Sans Variable for product chrome, prose, artifact headings,
  and ECharts explanatory text.
- Retain Geist Mono for numeric values, dates, quarters, and axes where fixed
  widths improve comparison.
- Use a restrained weight hierarchy: approximately 450 for body copy, 520-580
  for controls and chrome, 600-650 for headings, and 700 only for primary data.
- Keep CJK system fallbacks after Instrument Sans rather than shipping a large
  bundled CJK font in this demo.

### Tradeoffs

- Mixed sans/mono typography requires chart definitions to choose families
  deliberately.
- Instrument Sans changes text metrics, so every managed chart label and note
  boundary must be reverified.
- The compact bar creates less room for future top-level actions; secondary
  actions should remain in More rather than expanding the bar again.

Revisit the type pairing only when multilingual product chrome becomes a core
requirement or a future design system provides its own licensed family.

## ADR-0022: Make runtime artifact packages immutable and failure-isolated

Status: Accepted

Date: 2026-07-12

### Context

Personal artifact bundles introduced executable code that lives longer than one
view. Nodes were view-local, but package source was keyed globally by
`artifactId`; a later install could silently replace code used by another view.
Installation also wrote the package before validating the target workspace, and
one damaged package could prevent every installed artifact from loading.

### Decision

- Treat `artifactId` as a browser-origin-wide immutable package identity. The
  same source may be reused in multiple views, but changed source needs a new id.
- Validate the exported artifact shape and target node payload before writing.
- Commit package source and the target workspace in one IndexedDB transaction.
- Load external sources and installed packages independently, retaining healthy
  registry entries and reporting quarantined failures.
- Isolate React render, ECharts option, and ECharts lifecycle failures to the
  affected card.
- Keep `.freeform.json` as a serializable board-data backup. Executable package
  transfer remains the explicit `.freeform-artifact.json` installation path.

### Tradeoffs

- Updating an installed artifact requires a new id; explicit package migration
  can be added later if versioned replacement becomes a real workflow.
- Board backup alone cannot recreate personal cards in a fresh browser until
  their trusted packages are installed there.
- Error boundaries preserve the rest of the canvas but cannot undo arbitrary
  global side effects from trusted module evaluation; sandboxing remains a
  separate future boundary.

Revisit immutable identity when packages gain signed versions, content hashes,
or an explicit user-approved upgrade and node-migration flow.

## ADR-0023: Make Chart Kit the default generated chart contract

Status: Accepted

Date: 2026-07-12

### Context

Generated artifacts repeatedly rebuilt the same ECharts axes, tooltip, palette,
font, grid, dark-mode, and sizing options. The skill also described chart
families that the tree-shaken host had not registered, so a syntactically valid
browser bundle could request an unavailable series. Browser-origin bundles and
self-deployed source artifacts additionally have different valid output
locations, but one skill workflow did not make that distinction prominent.

### Decision

- Add `renderer: "chart-kit"` as the default contract for ordinary Cartesian
  bar, line, and combo charts.
- Compile declarative specs into managed ECharts dataset, axes, grid, tooltip,
  palette, ARIA, SVG, and series options.
- Keep raw ECharts for registered bar, line, Sankey, and advanced options Chart
  Kit cannot express. Keep React for non-chart composition.
- Publish runtime capabilities through `window.__FREEFORM_AGENT__` and reject
  unsupported raw series during preflight and installation.
- Add non-persisting `validateArtifact()` checks across default/minimum sizes and
  both themes before a browser bundle can be installed.
- Split skill delivery into Browser View Bundle and Self-Deployed Repo modes.
  In-product Build with AI selects the browser-local bundle boundary and forbids
  repository source changes; self-deployed artifacts live under
  `src/artifacts/generated/*.artifact.tsx`. ADR-0025 later adds Browser Relay as
  the automatic transport for the same bundle boundary while retaining the
  manual Browser View Bundle fallback.

### Tradeoffs

- Chart Kit intentionally exposes fewer options than ECharts. It should cover
  common analytical intent, not mirror the full ECharts schema.
- Complex existing charts remain raw ECharts until a repeated pattern justifies
  a new declarative capability.
- Structural preflight catches invalid specs and unsupported capabilities but
  does not replace visual inspection of the installed card.
- New raw chart families require host registration and increase the shipped
  JavaScript bundle, so they should be added from demonstrated demand.

Revisit the v1 capability set when several real artifacts need the same missing
chart behavior; extend Chart Kit by repeated use case rather than by copying the
entire ECharts API.

## ADR-0024: Separate reusable artifact packages from view placements

Status: Accepted

Date: 2026-07-13

### Context

The canvas could install a trusted personal package and create a node, but the
only visible way to use that package again was reinstalling its bundle. Deleting
the node hid a still-valid origin-wide package, and built-in artifacts had no
reusable placement surface outside the published demo seed. Views and packages
already had intentionally different storage scopes.

### Decision

- Add a default-collapsed right-side Artifact Library, leaving the left side for
  Views.
- Present Built-in presets and successfully loaded personal bundles as separate
  tabs in one searchable catalog.
- Keep built-in preset payloads in the product catalog and personal executable
  source in the existing IndexedDB package store; do not create a second
  persistence layer.
- Treat click and drag as two placement inputs that both create ordinary
  view-scoped nodes, run payload preflight, honor grid snap, and autosave. Click
  placement starts at the current viewport center and searches only its visible
  grid for a nearby open position; if no opening exists, it stays centered on
  the top layer. Explicit drag placement honors the user's drop point.
- Deleting a node never deletes its package. Personal packages remain available
  to every local view on the same browser origin and remain isolated from other
  browser profiles.
- Keep global canvas shortcuts in one guarded hook and ignore editable targets
  and modal workflows.

### Tradeoffs

- Built-in catalog entries need an explicit reusable preset; a renderer
  definition alone cannot invent meaningful sample data.
- Personal package uninstall and version migration remain separate future
  workflows. Node deletion is deliberately not overloaded with either action.
- The right panel overlays rather than resizes the canvas so drag targets and
  world coordinates do not jump while browsing. It temporarily covers a narrow
  strip of the stage.
- HTML drag/drop is a desktop enhancement; click placement remains the complete
  keyboard and mobile path.

Revisit the catalog model when artifacts support multiple named presets,
package metadata editing, explicit uninstall, or cross-device package sync.

## ADR-0025: Deliver browser-local artifacts through a short-lived relay

Status: Accepted

Date: 2026-07-13

### Context

The browser Agent API can install a bundle when an agent controls the same page,
and the file fallback works when a user manually transfers the bundle. A remote
agent running on another machine cannot write the site's origin-scoped IndexedDB
or initiate an inbound connection to a user's Chrome profile. The browser must
receive the bundle through a connection it initiated and then perform its own
validation and persistence.

The desired Build with AI workflow should support several artifacts in one
conversation without requiring browser automation, repository changes, or a
separate manual upload for every artifact. Long-term canvas and package state
must remain in the user's browser.

### Decision

- Add an ephemeral HTTPS relay, initially deployed as a Cloudflare Worker with
  one SQLite-backed Durable Object per Build Session.
- Treat a Build Session as a temporary delivery channel rather than a single
  artifact. A session may receive multiple deliveries, and one delivery may
  contain one or more independently validated artifact bundles.
- A click on **Build with AI** is explicit session-level consent. Let the browser
  create a target-view-bound session and maintain a hibernating WebSocket. Give
  the trusted agent a separate capability-scoped upload credential in the
  copied instruction. “One-time” means a credential exists only for one
  short-lived Build Session, not one upload: it may submit several deliveries
  until expiry, while every delivery has a unique idempotency UUID.
- Keep the relay transport-only. Refuse all access at the 30-minute expiry,
  delete acknowledged payloads immediately, and use the expiry alarm to delete
  every SQL table and remaining ciphertext. Never store canvas workspaces or
  browser package registries there.
- Generate an AES-256-GCM key in the browser and include it only in the agent
  handoff. Bind ciphertext authentication to protocol version, session id,
  target view id, and delivery id. Store only SHA-256 capability hashes in the
  Durable Object; the relay never receives the plaintext encryption key.
- Keep the browser capability in module-private page memory, never Web Storage
  or the agent handoff. Reloading ends the browser side of the session. Visually
  mask the uploader capability and encryption key; copy them only in the handoff
  and pass them to the delivery script over stdin rather than process arguments.
- Validate every artifact in the browser before installation. For a multi-item
  delivery, validate the complete selection before committing package and view
  writes so a failed item cannot leave an accidental partial dashboard.
- Place delivered artifacts using host-owned layout knowledge. Search the
  current target-view viewport for a complete non-overlapping position nearest
  its center, snap it to the grid, and append it at the highest z-index. If no
  complete position exists, place it at the viewport center; offset additional
  fallback items by one grid step so they do not become perfectly hidden.
- Keep the existing file installer as the offline fallback. Do not require an
  npm-published delivery CLI initially; the project skill may invoke a bundled
  script or the relay HTTP contract directly.
- Persist a successful browser delivery receipt in the same IndexedDB
  transaction as its packages and target workspace. If an ACK is lost, replay
  returns the receipt and sends another ACK without placing duplicate nodes.
- Bind each idempotency UUID to a digest of its complete encrypted envelope.
  Reject the same id with changed ciphertext. Let the uploader retain only that
  envelope and a payload digest in a private, mode-0600 OS cache only while an
  outcome is ambiguous, so a retry from a later process is byte-identical
  without persisting a capability, key, or plaintext bundle. Delete definitive
  results and opportunistically prune owned ambiguous entries after 24 hours.
- Bound abuse from the first deployment with strict production/dev origin
  allowlists, Turnstile on session creation, signed session locators, IP
  session-creation rate limiting, per-source and authenticated per-session
  upload and WebSocket-connect rate limiting, 12 artifacts per delivery, 24 deliveries per
  session, 2 MB ciphertext per delivery, 8 MB pending ciphertext per session,
  body limits, a 30-minute alarm, and an operational kill switch.
- Deploy the personal demo on `workers.dev`. Do not add D1, KV, or R2: the
  SQLite-backed Durable Object is sufficient for the session's bounded pending
  ciphertext and idempotency rows.

### Tradeoffs

- Fully automatic remote delivery introduces a small hosted service and an
  external availability dependency even though durable user state remains
  browser-local.
- Capability tokens authorize delivery of executable trusted code. Short
  lifetimes, narrow session scope, capability separation, local encryption, and
  complete browser validation are necessary boundaries. The Build Session click
  is the explicit consent boundary; repeating a confirmation for every artifact
  would break the intended conversational workflow without adding a distinct
  trust decision.
- Installed artifact modules execute inside the application origin because this
  feature deliberately accepts trusted code, not sandboxed third-party code.
  Keeping the browser capability out of storage and the React-visible session
  object preserves the server-side capability split, but does not turn artifact
  modules into an untrusted-code sandbox.
- Durable Object alarms are at-least-once and may run after their scheduled
  time. Every route enforces the expiry timestamp synchronously, so ciphertext
  becomes inaccessible at 30 minutes even if physical deletion is delayed until
  the alarm retry.
- The SQL schema-v2 upgrade adds envelope digests. An exact retry of still-
  pending schema-v1 ciphertext is compared field-by-field and backfills its
  digest. A terminal schema-v1 delivery whose ciphertext was already deleted is
  conservatively rejected as unverifiable; sessions last only 30 minutes.
- Free service quotas are ample for a personal demo only if the browser uses a
  hibernating WebSocket rather than periodic polling. Public deployment still
  needs rate limits to avoid quota exhaustion.
- A session bound to another view uses that view's last persisted viewport for
  placement; it must not silently retarget itself when the user navigates.

### Implemented boundary

`relay/` contains the Worker, initial SQLite-backed Durable Object class
migration, explicit version-2 in-object SQL schema, limits, and local
emulator tests. `src/relay/` owns browser capabilities, encryption, WebSocket
reconnect, delivery receipts, atomic installation, and host placement.
`skill/freeform-artifact-builder/scripts/deliver.mjs` is the dependency-free
agent uploader. The endpoint is deployed independently from the GitHub Pages
frontend so relay availability can be disabled without changing browser-local
canvas or package state.

## ADR-0026: Use contained live renderers for Artifact Library previews

Status: Accepted

Date: 2026-07-13

### Context

The first Artifact Library represented every catalog item with a category icon
and a renderer label. Neither communicated what a user would actually place on
the canvas, especially for personal artifacts whose composition cannot be
inferred from their renderer family. Cropped screenshots would improve
recognition but introduce stale binary state, theme drift, capture complexity,
and another persistence lifecycle.

The catalog already pairs every built-in or personal artifact definition with a
reusable initial node payload. That is enough to render the actual object.

### Decision

- Extract one validated ArtifactContent surface for React, Chart Kit, and raw
  ECharts, and use it in both CanvasNodeView and catalog previews.
- Render the catalog preset at the artifact's authored default size in the
  current host theme. Include node chrome so the thumbnail matches the object
  that will appear on the canvas.
- Fit the complete object into a stable 16:10 frame with one aspect-preserving
  contain scale capped at 1. Never crop the object or independently reflow its
  inner renderer to thumbnail dimensions.
- Remove category glyphs and renderer implementation labels from the browsing
  surface. Keep the title, concise summary, familiar Add affordance, click, and
  drag behavior.
- Disable host-managed chart animation and pointer interaction in preview mode.
  Use IntersectionObserver to mount only the visible scroll neighborhood and
  unmount offscreen content so ECharts cleanup remains bounded.
- Preserve renderer-free geometry summaries for the Views sidebar. Whole-board
  navigation and single-artifact discovery have different cost and recognition
  requirements.

### Tradeoffs

- Opening the library may mount a trusted artifact a second time. Custom React
  artifacts must keep render pure and clean up their own effects on unmount.
- Live thumbnails use more CPU than static glyphs, but they stay current across
  theme and package changes and avoid screenshot storage. Visibility-managed
  mounting bounds the active cost to a few entries.
- Dense charts become small by design. The preview optimizes accurate visual
  recognition, while the title and summary remain the readable catalog labels.
- A renderer failure affects only that preview through the existing error
  boundary and does not remove the package or break the rest of the library.

Revisit cached preview images only if measured renderer cost remains high after
visibility management, or if sandboxed artifacts can no longer be mounted in
the host document.
