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

- Tables, text, SVG charts, forms, badges, and inspector UI remain normal
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
- `npm run verify:proof` records a browser session.
- `ffmpeg` converts the Playwright WebM recording to `proof.gif`.
- `ffmpeg` also writes `contact-sheet.png` so agents can inspect keyframes for
  temporal glitches before reporting completion.
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

The canvas must support card drag, blank-stage pan, and wheel zoom without the
browser interpreting the same gesture as text selection, native element drag, or
page-level scrolling/zooming.

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
- wheel zoom uses a non-passive DOM listener on the stage.

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

Revisit when board JSON import/export needs migration tooling, when real data
connectors arrive, or when untrusted generated code loading begins.

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
