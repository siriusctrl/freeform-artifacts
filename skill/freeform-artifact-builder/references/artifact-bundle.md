# Artifact Bundle Contract

Use a bundle when an AI-created artifact belongs to a user's local canvas view
and should not change or redeploy the application repository.

For a copied `Delivery mode: BROWSER_RELAY` handoff, deliver one or more bundles
with `../scripts/deliver.mjs` as described in
[browser-relay.md](browser-relay.md). The manual **Install from agent** action below
remains the offline fallback.

```json
{
  "version": 1,
  "artifactId": "regional-capacity",
  "moduleSource": "export const artifact = { ... };",
  "node": {
    "title": "Regional capacity",
    "data": {},
    "config": {}
  }
}
```

Rules:

- `artifactId` uses lowercase kebab-case and matches the exported artifact id.
- Treat `artifactId` as immutable. Reinstalling the same source can add another
  node, but different source under an installed id is rejected; use a new id for
  a new implementation.
- `moduleSource` is self-contained browser ESM. Do not import packages or fetch
  code/data. Prefer a `renderer: "chart-kit"` artifact returning a declarative
  chart spec; raw ECharts artifacts return options, and React artifacts may use
  `window.React` without JSX.
- Export one artifact as `artifact` or `default`.
- Keep `node.data` and `node.config` serializable.
- Follow [visual-style-guide.md](visual-style-guide.md), including the required
  light/dark implementation and browser review in both modes.
- Treat the module as trusted code. It executes in the page and is not sandboxed.
- Validate the bundle in a real browser before installation.
- When browser control is available, call `validateArtifact(bundle)` before
  `installArtifact`. Preflight must report `persisted: false`.
- A bundle package is browser-origin scoped while its node is view scoped. Board
  backup JSON does not include executable package source, so install the bundle
  separately when moving a board to another browser.
- After installation, the package appears under **Artifacts > Yours** in every
  local view for that browser profile. Deleting one node does not uninstall the
  package; users can click or drag it from the library to create another
  view-scoped placement.

Direct installation when the agent controls the user's page:

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

Use `window.__FREEFORM_AGENT__.listViews()` to resolve both the target `id` and
`incarnationId`. An explicit `viewId` without its matching `viewIncarnationId`
is rejected so deletion and restoration cannot silently retarget an install. If the agent
cannot control the same browser profile and no Browser Relay session was
provided, return a `.freeform-artifact.json` file for the dialog's **Install
bundle** action. Never commit a personal-view bundle to the application branch.
