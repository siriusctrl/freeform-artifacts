# Browser Relay Workflow

Browser Relay transfers trusted artifact bundles into the browser-local view
selected when the user clicked **Build with AI**. The relay stores only
ciphertext for a short time; the browser decrypts, validates, lays out, and
persists the delivery.

## Progressive handoff

Freeform may first provide `Delivery mode: BROWSER_VIEW_BUNDLE` while its live
delivery route is still being verified. Start authoring from that brief and keep
the exact validated bundle files; do not wait for relay setup and do not upload
without a capability-bearing handoff. If the same conversation later receives
`Delivery mode: BROWSER_RELAY` for the same View id and incarnation, treat it as
a delivery continuation: reuse the existing bundles, run the pinned launcher
verification, and deliver them without restarting discovery or regeneration.
If no live handoff arrives, return the files for **Install from agent**.

## Deliver

First generate and inspect one or more `.freeform-artifact.json` files outside
the application repository. Run the copied handoff's exact commit-pinned
checkout, version-pinned skill install, and launcher SHA-256 verification
commands first. Do not replace its immutable source ref with `main` or continue
after an integrity failure.
Then use the exact session values from the handoff:

```sh
node <skill-directory>/scripts/deliver.mjs \
  --relay-url <relay-url> \
  --session-id <session-id> \
  --credentials-stdin \
  --view-id <target-view-id> \
  --view-incarnation-id <target-view-incarnation-id> \
  first.freeform-artifact.json second.freeform-artifact.json
```

Launch the process without secrets in its arguments, then send the handoff JSON
containing only `uploadToken` and `encryptionKey` to its standard input exactly
once, followed by a newline. Prefer the agent harness's programmatic,
pipe-backed stdin and close it after the write. If the harness exposes only a
PTY, the script switches that terminal to hidden raw input before reading the
line and restores it immediately afterward. Do not place the JSON in a shell
pipeline, command arguments, or a file.

The script:

- verifies every dependency-free uploader module against the digest manifest
  in the externally verified launcher before reading credentials;
- checks the local bundle envelope and immutable artifact ids;
- creates a fresh UUID delivery id unless `--delivery-id` is supplied for an
  intentional retry;
- encrypts the complete selection with the v2 AES-256-GCM protocol and
  session/view/view-incarnation/delivery-bound additional authenticated data;
- stages only the authenticated encrypted envelope and its payload digest in a
  private, mode-0600 OS retry cache. It never caches either capability or the
  plaintext bundles, and removes the entry after a definitive response;
- uploads the ciphertext with the session-scoped upload capability;
- retries transient failures, including a later script invocation on the same
  machine, with the exact same ciphertext and id;
- prints only the delivery id, target view id, artifact ids, and relay acceptance
  state. A successful upload explicitly reports `outcome: "relay_accepted"` and
  `browserInstalled: false`; it never prints the token or encryption key;
- reports an ambiguous network outcome with the delivery id. Retry the same
  bundles with that exact `--delivery-id`; never create a new id for an
  uncertain attempt.

`--delivery-id` is a retry flag, not a way to choose an id for a new payload.
The original machine must still have the cached encrypted envelope. If the
cache is missing, corrupted, fails AES-GCM authentication, or the bundles
differ, the script stops locally instead of re-encrypting under an already-used
id. Only an ambiguous network outcome retains an entry; later uploader runs
opportunistically prune owned session-cache directories older than 24 hours.
It contains ciphertext but no upload token or encryption key and may be deleted
once the browser result is settled.

The relay's `accepted: true` response means the ciphertext was durably queued or
recognized as an idempotent duplicate. Browser installation is asynchronous.
When browser access is available, inspect the Build Session status and the
rendered cards before claiming they were installed. Otherwise report the exact
wording “relay accepted” and do not overstate it as browser-confirmed.

## Session Rules

- The session lasts about 30 minutes and can accept several delivery commands.
- Reloading or closing the target page ends its in-memory browser connection;
  ask the user to start a new session instead of assuming it survived.
- One delivery can contain 1–12 artifacts. The browser validates every bundle
  before a single package/workspace transaction; one failure rejects the whole
  selection.
- The target view and its incarnation are immutable for the session. Browser
  navigation does not retarget a delivery, and deleting then recreating the
  same view id does not make an old session valid for the replacement.
- A repeated `--delivery-id` is a retry, not a new placement. Never reuse one id
  for different plaintext.
- Never put credentials in artifact source, filenames, screenshots, logs,
  commits, issue comments, or the final response.
- If the session is expired or closed, ask the user to click **Build with AI**
  again. Do not weaken TLS, bypass Turnstile, or use the browser capability.

## Final Report

Name the target view, delivery id, and artifact ids. Distinguish:

- `relay accepted`: upload succeeded but the browser result was not observed;
- `browser installed`: the target browser visibly confirmed the delivery and
  the cards were inspected;
- `browser rejected`: report the validation error and keep all bundle files for
  correction and a new delivery id.
