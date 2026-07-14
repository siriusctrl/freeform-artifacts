# Changelog

All notable user-facing changes to this project should be documented here.

## 0.1.0 - Unreleased

### Added

- Initial React/TypeScript/Vite freeform artifact canvas.
- DOM-based artifact nodes with pan, zoom, drag, selection, resize, and deletion
  interactions.
- Light/dark mode support.
- Artifact contract and registry with metric, table, and flow-diagram examples.
- Managed ECharts artifact host for standard chart artifacts.
- Probability chart and Sankey examples backed by ECharts options.
- Self-hosted Instrument Sans interface typography and Geist Mono data
  typography.
- Sample database rows and transform helpers.
- Published template forking into per-browser IndexedDB workspaces.
- Synchronous localStorage recovery mirrors for close/reopen resilience.
- Versioned board-data JSON import/export and explicit reset-to-demo control.
- Default-on 38px snap-to-grid placement with a toolbar setting.
- Selected-card resize handles.
- Selected-artifact deletion from the title bar and with `Delete`/`Backspace`.
- Transform registry with checked raw-row fixtures.
- Zod-backed artifact payload validation with invalid-artifact fallback UI.
- Playwright browser smoke test for core canvas interactions.
- Production build preview verification.
- Browser proof recorder that writes WebM, GIF, screenshot, manifest, and
  inspection artifacts.
- Internal proof contact sheet generation for keyframe inspection.
- Lightweight proof frame checks for blank-like sampled frames.
- README, AGENTS, architecture, testing, and visual-verification handoff docs.
- Project-local `freeform-artifact-builder` skill for future agents creating
  compliant artifacts and canvas layouts.
- Layered artifact directories and registries for core, examples, and generated
  artifacts.
- Auto-discovery for repo-generated `*.artifact.tsx` modules.
- Trusted runtime ESM artifact loading through
  a base-aware `artifacts/generated/manifest.json`.
- GitHub Pages deployment under `/freeform-artifacts/`.
- Mobile-first template framing that opens the primary chart at a useful scale.
- Multiple named browser-local canvas views with a collapsed sidebar and
  centered inline title editing.
- Trusted artifact bundles persisted in IndexedDB, with direct Agent API and
  file-import installation paths that require no app commit or deployment.
- Agent-neutral **Build with AI** handoff that installs the project skill before
  asking the agent to clarify what artifact the user wants.
- Smooth **Views** sidebar transitions and data-derived canvas previews beneath
  each view name.
- Polished default examples: removed the internal table name, simplified the
  artifact pipeline, generalized supply copy, and added distinct light/dark
  Sankey node palettes.
- Artifact skill visual style guide with mandatory dual-theme chart and browser
  verification rules.
- Published-example migration that refreshes the three shared demo payloads in
  existing local forks while preserving personal layout, deletions, and added
  artifacts.
- Compact 54px top bar with a grouped display control, flat save state, and
  restrained command button hierarchy.
- Runtime artifact definition validation, per-card render isolation, immutable
  package identities, atomic view installation, and partial-failure loading.
- Debounced and per-view ordered workspace saves with page-close recovery.
- Pull-request browser verification in GitHub Actions.
- Declarative Chart Kit v1 for managed bar, line, and combo charts, including
  dataset encoding, shared visual tokens, ARIA, and strict capability checks.
- Non-persisting `validateArtifact()` and browser-visible renderer capabilities
  for agent bundle preflight.
- Explicit Browser View Bundle versus Self-Deployed Repo workflows in the
  project skill and Build with AI handoff.
- Shared Artifact Library with Built-in/Yours tabs, search, click placement,
  drag-to-canvas placement, and personal package reuse across local views.
- Complete live Artifact Library previews backed by the real React, Chart Kit,
  and ECharts renderers, with contained scaling and visibility-managed chart
  lifecycles in both themes.
- Canvas shortcuts for Views, Artifacts, viewport reset, zoom, Escape, and
  deletion with editable-field and modal guards.
- Short-lived encrypted Artifact Delivery Relay with target-view-bound Build
  Sessions, Turnstile, separate browser/uploader capabilities, hibernating
  WebSockets, SQLite Durable Objects, and a 30-minute cleanup alarm.
- Dependency-free skill delivery script for one or more bundles per delivery,
  reusable session-scoped uploads, AES-256-GCM payloads, and idempotent retries.
- Atomic browser validation and persistence for multi-artifact deliveries,
  host-owned viewport placement, and delivery receipts that prevent duplicate
  cards when an acknowledgement is lost.
- Worker/DO emulator adversarial tests and real-browser relay journeys covering
  reconnect, expiry, bad bundle rollback, view binding, placement, and replay.
- Transactional session Undo/Redo, marquee and additive multi-selection, group
  movement, alignment/distribution, duplicate, and in-session copy/paste.
- View duplication, persistent drag ordering, delete with short-lived Undo, and
  clean Fit All presentation with keyboard View navigation.
- Pointer-accessible responsive drawer/presentation exits and menu-based View
  ordering for touch and keyboard workflows.
- Visible active Build Session controls after closing the handoff, separate
  transport/delivery status, and phone-width focus containment for Views and
  Artifacts.
- Worktree-safe Playwright port selection through `FREEFORM_TEST_PORT`.
- Progressive Build with AI handoff: a capability-free bundle brief is usable
  immediately, then upgrades to a live-delivery step without rebuilding work.
- Theme-matched, responsive Turnstile verification in a dedicated automatic
  delivery panel, plus an always-visible **Install from agent** fallback.

### Fixed

- Removed the dead period while Turnstile, session creation, or WebSocket setup
  was pending; relay failures and expiry now leave artifact authoring available.
- Kept real Turnstile iframe focus inside the Build with AI dialog and cancel
  unfinished verification explicitly when the dialog closes.
- Prevented a native Turnstile challenge from covering the build brief in short
  landscape layouts, removed its duplicate hidden file control from the
  accessibility tree, and raised dark-theme error contrast.
- Made every live handoff continuation-safe after reopen or manual copy,
  prevented delayed clipboard completions from marking a newer handoff copied,
  and made dialog close independent of slow server cleanup.
- Bound direct same-browser target installs to a View incarnation and rejected
  stale calls after deletion and restoration.
- Centered a complete multi-card delivery as a readable non-overlapping grid
  whenever it fits, and kept true no-opening fallbacks at distinct snapped,
  visible top-layer positions; overlap with an already full viewport remains
  intentional.
- Preserved autosave-window edits, cross-tab revisions, prior Undo history, and
  the latest deletion-generation snapshot across relay installation and
  repeated delete/restore races.
- Locked mounted editing surfaces only during the atomic artifact-install
  critical section so a late local edit cannot be overwritten by its result.
- Separated relay transport state from delivery outcome and kept active session
  controls and visible install progress after the Build with AI dialog closes;
  mobile dialog close now returns focus to a visible opener.
- Refreshed **Artifacts > Yours** immediately after a delivery to a background
  View and returned strict CORS on allowlisted browser uploads.
- Kept off-view file fallback installs bound to their original View and showed
  the destination plus an explicit **Open** action after success.
- Canonicalized equivalent IPv6 rate-limit sources without collapsing NAT64
  addresses into bare IPv4 buckets.
- Restricted the development Turnstile bypass to loopback browser origins and
  loopback Worker request URLs, including for accidentally public previews.

- Prevented stale tabs, overlapping autosaves, recovery mirrors, and stale View
  Undo from overwriting newer browser-local workspace revisions.
- Preserved edits still inside the autosave window during relay/offline install,
  and kept each relay delivery undoable without clearing earlier history.
- Replaced relay's occupied-center fallback with nearest non-overlapping world
  grid placement for every artifact in a multi-item delivery.
- Prevented an in-flight relay delivery from resurrecting a View deleted during
  module preparation; the browser now rejects it and preserves the tombstone.
- Kept presentation framing derived from live node bounds so entering and
  leaving presentation never overwrites the user's editable viewport.
- Prevented parallel Playwright runs from silently testing a different
  worktree's already-running Vite server.
- Preserved unsaved active-View edits across duplicate and delete Undo, kept
  failed IndexedDB deletions hidden with local tombstones, fixed downward View
  ordering, equalized visible distribution gaps, and kept click-only selection
  out of Undo history.
- Made Artifact Library arrow-key tab focus move synchronously with selection,
  avoiding stale-focus reversals under a busy browser event loop.
- Kept click-added artifacts inside the current visible canvas and placed them
  at the nearest available grid position before falling back to center/top.
- Made live library previews keyboard-inert and scoped lazy renderer mounting
  to the library's own scroll viewport.
- Aligned the Pipeline connector and stage markers to one shared grid geometry
  so the line remains continuous through all three stages.
- Centered the More icon without relying on inline-button baseline layout.
- Replaced textual snap state with a compact, accessible switch labeled
  `Snap to grid`.
- Replaced responsive frame resizing with aspect-locked whole-object scaling:
  artifact content, chrome, Delete, and resize controls now share one local
  scale before the outer canvas zoom is applied.
- Made browser proof journeys visibly demonstrate every changed product
  function instead of relying on hidden structured assertions alone.
- Moved snap-to-grid into a labeled More-menu setting with immediate On/Off
  feedback.
- Split probability chart guidance into three independently positioned SVG
  lines so What, Read, and Logic remain inside the note panel.
- Replaced domain-specific demo wording with a generic supply and allocation
  scenario.
- Reflowed managed ECharts options from live content-box dimensions so
  probability markers and Sankey labels stay inside their hosts.
- Added artifact-specific minimum resize dimensions for dense charts.
- Normalized older browser workspaces and imported backups that contain chart
  sizes below the registered artifact minimum.
- Made ordinary trackpad and mouse-wheel scrolling pan the canvas naturally;
  trackpad pinch now performs smooth pointer-anchored zoom.
- Increased pinch responsiveness for the small, high-frequency deltas emitted
  by real trackpads.
- Expanded proof recording into an asserted end-to-end UX journey with a
  visible verification cursor, close/reopen persistence, structured checks,
  and a denser internal keyframe review sheet.
- Enlarged the selected-card resize handle hit target for more reliable pointer
  and trackpad interaction.
- Hardened card drag and canvas pan so browser text selection and native drag
  behavior do not take over the gesture.
- Made zoom verification cover both pinch zoom and toolbar zoom controls.
- Improved theme toggle affordance with explicit Light/Dark labeling.
- Centered the primary toolbar action content optically.
- Reflowed the mobile toolbar into the topbar so controls do not cover the
  product title or canvas.
- Kept static ECharts artifacts from refreshing or entering hover states during
  canvas drag, pan, and zoom.
- Bound the dotted grid background to the same viewport pan and zoom model as
  canvas nodes.
- Corrected pointer-anchored zoom and bundle placement to use stage-local
  coordinates when the top bar or Views sidebar offsets the canvas.
- Split view bootstrap from active-canvas composition and extracted artifact
  runtime, autosave, and node-factory responsibilities from `App.tsx`.
- Moved local-save status into a fixed-width slot before Theme/More so changing
  status text no longer shifts either toolbar controls or the Build command.
- Prevented superseded autosave callbacks from overwriting newer import errors or
  installation status.
- Split the canvas runtime into focused components, an interaction hook, debug
  state helper, domain CSS files, and shared verification script helpers.
- Slimmed `AGENTS.md` into an agent source map and moved product framing into
  README/docs.
- Refactored board, transform, and node creation boundaries out of the main app
  component.
- Split demo artifact seeds away from the artifact registry.

### Removed

- Removed the read-only selection inspector from the canvas UI; browser debug
  state remains available to verification tooling.
- Removed the redundant select tool and placeholder Add artifact behavior.
