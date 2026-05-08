# BitBox Portal Shim

This folder is the **canonical home** of the standalone-mode implementation of
the [Portal Host Contract](../PORTAL_CONTRACT.md).

## What's here

- **`portal-shim-standalone.js`** — the canonical shim. Builds `window.bitbox`
  with stub implementations of every contract key (session, env, api, logger,
  barcodeScanner, nav). Used by sub-apps when they run on their own port for
  dev work.
- **`refresh-shims.ps1`** — copies the canonical file into each sub-app's
  `static/` folder. Run after every edit to the canonical.
- **`README.md`** — this file.

## Vendoring discipline

The shim is **vendored** (file-copied) into each sub-app rather than served
from a shared location at runtime. This is deliberate:

- Each sub-app's standalone HTML can reference the shim with a simple relative
  `<script src="./portal-shim-standalone.js">` tag — no path tricks, no CORS,
  no dependency on the shared folder being mounted by the dev server.
- A sub-app cloned in isolation still works for standalone dev — the shim is
  right there alongside the rest of the static assets.

The cost is drift risk: if you edit a vendored copy directly, your edit is
local to that one sub-app and will be overwritten next time someone runs
`refresh-shims.ps1`.

**Rules:**

1. **Edit only the canonical** at `BitBox/portal-shim/portal-shim-standalone.js`.
2. **Run `refresh-shims.ps1`** after every edit to copy into all sub-apps.
3. **Bump the `contractVersion`** string inside the shim if you change the
   `window.bitbox.*` surface — and update [`../PORTAL_CONTRACT.md`](../PORTAL_CONTRACT.md)
   in the same change.

The vendored copies have a header comment pointing back here, so a colleague
who finds one in a sub-app and wonders where to edit will be redirected
correctly.

## Adding a new sub-app

When a new sub-app adopts the Portal Host Contract:

1. Add its `static/portal-shim-standalone.js` path to the `$targets` array
   inside `refresh-shims.ps1`.
2. Run `refresh-shims.ps1` to drop the file in.
3. In the sub-app's standalone HTML, load the shim **before** any
   `<script type="module">` block:

   ```html
   <script src="./portal-shim-standalone.js"></script>
   <script type="module">
       import { mySubAppPage } from './mySubAppPage.js';
       // ... window.bitbox is now populated
   </script>
   ```

4. In integrated mode, the portal will set `window.bitbox.api.base` to your
   sub-app's reverse-proxy prefix (e.g. `/mySubApp`) before dynamic-importing
   your page module. No work in the sub-app for that — the shim is only used
   in standalone mode.

## Future hardening (not done yet)

- A pre-commit hook in each sub-app could `diff` the vendored copy against
  the canonical to catch accidental direct edits or stale copies. Captured
  in the plan's "Future / opportunistic work" section.
