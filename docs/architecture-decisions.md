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
- Proof artifacts are written under `artifacts/verification/<timestamp>/`.

### Why this route

- Chromium can run headlessly on the SSH server.
- Playwright can drive real pointer and wheel events.
- Tests can assert state changes, not only produce a recording.
- GIF/WebM/screenshot evidence gives the next Codex session and the user a
  concrete replay of the current behavior.

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
