# Artifact Bundle Contract

Use a bundle when an AI-created artifact belongs to a user's local canvas view
and should not change or redeploy the application repository.

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
- `moduleSource` is self-contained browser ESM. Do not import packages or fetch
  code/data. ECharts artifacts return options; React artifacts may use
  `window.React` without JSX.
- Export one artifact as `artifact` or `default`.
- Keep `node.data` and `node.config` serializable.
- Follow [visual-style-guide.md](visual-style-guide.md), including the required
  light/dark implementation and browser review in both modes.
- Treat the module as trusted code. It executes in the page and is not sandboxed.
- Validate the bundle in a real browser before installation.

Direct installation when the agent controls the user's page:

```js
await page.evaluate(
  ({ bundle, viewId }) => window.__FREEFORM_AGENT__.installArtifact(bundle, { viewId }),
  { bundle, viewId },
);
```

Use `window.__FREEFORM_AGENT__.listViews()` to resolve a target id. If the agent
cannot control the same browser profile, return a `.freeform-artifact.json` file
for the dialog's **Install bundle** action. Never commit a personal-view bundle
to the application branch.
