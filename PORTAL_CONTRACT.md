# Portal Host Contract — Specification

**Contract version: `1.0.0`** (semver — see "Versioning rules" below)

This document is the **canonical, authoritative spec** of the JavaScript
interface between the BitBox Portal (the host) and the sub-apps that run
inside it (the planner, the purchasing tool, and any future siblings). The
same interface is implemented by a **standalone shim** so sub-apps can also
run on their own port for development.

If this document and the code disagree, the document wins until the spec is
updated. Code changes that alter the surface MUST be accompanied by an
update to this file and a contract-version bump.

---

## Why this exists

Sub-apps need to run in two modes:

1. **Standalone** — the sub-app serves its own `static/index.html` on its own
   port (e.g. planner on 8082). Used for fast development iteration.
2. **Embedded in portal** — the portal dynamic-imports the sub-app's main page
   class and renders it inside the portal's chrome. Shared services
   (session, barcode scanner, logger, etc.) come from the host.

The contract is the **single global object `window.bitbox`** that the host
populates *before* the sub-app's code runs. Sub-apps consume `window.bitbox`
without caring which mode they're in — same surface, different
implementations.

---

## Versioning rules

The contract follows **semantic versioning** (`MAJOR.MINOR.PATCH`):

- **PATCH** — fix bugs in the spec wording or in the canonical shim
  implementation, no surface change. Sub-apps are unaffected.
- **MINOR** — add new keys to `window.bitbox.*`. Existing sub-apps continue
  to work unchanged. New sub-apps can require a higher minor.
- **MAJOR** — remove or change the shape of an existing key. Sub-apps will
  need code changes.

`window.bitbox.contractVersion` always reports the version of the
implementation in use (real portal or standalone shim — they should agree).

Sub-apps MAY declare a `static minHostContract = "1.x.y"` on their main page
class. If present, the host SHOULD compare against `window.bitbox.contractVersion`
and refuse to instantiate the sub-app (with a clear console error) when
the host is older than the sub-app requires.

---

## The `window.bitbox` surface (v1.0.0)

```js
window.bitbox = {
  contractVersion: "1.0.0",       // string, always present
  session:         { ... },
  env:             { ... },
  api:             { ... },
  logger:          { ... },
  barcodeScanner:  { ... },
  nav:             { ... },
};
```

### `contractVersion`

A string like `"1.0.0"`. Sub-apps reading it can branch on capability:

```js
const [major] = window.bitbox.contractVersion.split('.').map(Number);
if (major < 1) throw new Error('Host contract too old');
```

### `session`

```js
session: {
  user: {
    clockNumber: number | null,    // ERP clock number, e.g. 20. null only in unauthenticated standalone fallback.
    name:        string,           // display name, e.g. "Quentin Lister"
    roles:       string[],         // ["SuperAdmin", "Admin", "Engineer", ...]
  },
  hasRole(role: string): boolean,  // case-sensitive membership check
}
```

Notes:
- `roles` matches the values in `BitBoxIntranet.Roles` — currently
  `Operator`, `Supervisor`, `Engineer`, `Admin`, `SuperAdmin`.
- Standalone shim hardcodes a SuperAdmin dev user so role-gated UI is fully
  visible during dev (see [`portal-shim/portal-shim-standalone.js`](portal-shim/portal-shim-standalone.js)).
- `hasRole('Admin')` returns `true` for that role only — it does NOT imply
  SuperAdmin elevates Admin. Sub-apps that want "Admin or above" should
  test both: `hasRole('Admin') || hasRole('SuperAdmin')`.

### `env`

```js
env: {
  database:    string,    // "SANDBOX" | "BITBOXMRP" | "BITBOX-TEST" | etc.
  environment: string,    // "dev" | "live" | "beta" | "test"
  version:     string,    // version of whichever app is providing the host (e.g. portal version, or planner version in standalone)
  isLive:      boolean,   // true iff database === "BITBOXMRP" AND environment !== "dev"
}
```

This shape matches the existing `/api/insight/databaseName` portal endpoint
and the planner's `/api/env`. `isLive` is a derived convenience for
"should I make the navbar dark and warn before destructive actions?".

### `api`

```js
api: {
  base: string,                                                // URL prefix for sub-app's backend, e.g. "/planner" integrated, "" standalone
  headers(): { [key: string]: string },                        // standard headers including X-Clock-Number
  fetch(path: string, opts?: RequestInit): Promise<Response>,  // wrapped fetch, prefixes `base`, sends credentials, adds standard headers
}
```

Notes:
- `api.base` is set **per sub-app** by the host **before** the sub-app's
  dynamic-import. In integrated mode portal sets it to e.g. `/planner` (the
  reverse-proxy prefix). In standalone mode the shim sets it to `''` (same
  origin).
- `api.fetch(path, opts)` does:
  1. Prepend `api.base` to `path` if it starts with `/api/` or any other
     leading slash, otherwise leave alone.
  2. Set `credentials: 'same-origin'` so the portal session cookie travels.
  3. Merge `headers()` into `opts.headers` so `X-Clock-Number` is always
     present. (Caller-supplied headers win on conflict.)
- `api.fetch` returns the raw `Response` — caller is responsible for
  `.json()` / `.ok` / etc. This is intentional: it's a thin convenience,
  not a full client.
- Sub-apps that already have their own `linkToXxxAPI.js` wrappers (planner,
  purchasing) should derive their base URL from `window.bitbox.api.base`
  rather than constructing it themselves. See "Backwards compatibility"
  below for the migration fallback chain.

### `logger`

```js
logger: {
  info(channel: string, message: string, context?: object): void,
  warning(channel: string, message: string, context?: object): void,
  error(channel: string, message: string, detail?: object|string): void,
}
```

Notes:
- `channel` is a short tag like `"login"`, `"solver"`, `"purchasing"` — the
  portal's `BitBoxIntranet.AppLog` table indexes on it for filtering.
- The host implementation in portal POSTs to `/api/log/entry` (with the
  `X-Log-Key` shared secret). Errors also send an email alert if
  `LOG_ERROR_EMAIL` is configured.
- The standalone shim writes to the browser console with a `[CHANNEL]`
  prefix. No persistence.
- `error(...)` accepts a `detail` argument (string or object) instead of
  `context` to match the existing `Logger.error()` Python signature in the
  portal.

### `barcodeScanner`

```js
barcodeScanner: {
  onScan(callback: (scannedString: string) => void): subscriptionId,
  offScan(subscriptionId): void,
  pause():  void,
  resume(): void,
}
```

Notes:
- Backed by [`portal/static/clientJS/common/barcodeScanner.js`](portal/static/clientJS/common/barcodeScanner.js)
  in *both* modes. The class itself is a `keydown` listener — it works
  identically with or without the rest of portal.
- The host installs a **single shared instance** (singleton). Sub-apps
  subscribe to scan events via `onScan(cb)` and receive the scanned string
  (typically `"CN-<integer>"` for a clock-number badge, but the contract
  doesn't constrain the format).
- `subscriptionId` is opaque — pass the same value back to `offScan` to
  unsubscribe. Sub-apps SHOULD `offScan` in their `destroy()` lifecycle
  hook so badges scanned after the page is gone don't fire stale
  callbacks.
- `pause()` / `resume()` toggle the underlying `keydown` listener. Use
  when the sub-app shows a modal or input field where keystrokes should
  go to the form rather than the scanner.

### `nav`

```js
nav: {
  dispatch(name: string): void,    // e.g. nav.dispatch('Home') fires document event 'navHome'
}
```

Notes:
- Real portal implementation does
  `document.dispatchEvent(new Event('nav' + name))`, matching the
  long-standing portal pattern in [`portal/static/clientJS/main.js`](portal/static/clientJS/main.js).
- Standalone shim logs to console and is otherwise a no-op (there's no
  portal nav to navigate to).
- Future contract bumps may add `nav.back()`, `nav.replace(name)`, etc.

---

## Sub-app contract

Each sub-app SHOULD export a default page class with this shape:

```js
export class plannerPage {

  static minHostContract = "1.0.0";   // optional but recommended

  constructor() {
    // Read session/env from window.bitbox HERE, not at module top-level.
    // Constructor MAY take optional positional args for back-compat.
  }

  render() {
    // Returns a jQuery DOM fragment to be appended to portal's #main
    // (or to the standalone shim's #main).
    return $('<div>...</div>');
  }

  destroy() {
    // OPTIONAL but recommended. Called by host before constructing the
    // next page. Use to:
    //   - barcodeScanner.offScan(your subscription IDs)
    //   - clear any setInterval / setTimeout you started
    //   - detach any document-level event listeners
  }
}
```

The host calls `new SubAppPage()` then appends `subAppPage.render()`. When
navigating away, the host calls `subAppPage.destroy()` (if defined) before
constructing the next page.

---

## Initialisation order rules

These rules apply to **both** modes:

1. **Host MUST populate `window.bitbox` before the sub-app's module loads.**
   - In integrated mode, portal builds `window.bitbox` after a successful
     login, then sets `window.bitbox.api.base = '/<sub-app>'` immediately
     before the dynamic `import('/sub-app/static/...')`.
   - In standalone mode, the shim is loaded via a synchronous
     `<script src="./portal-shim-standalone.js"></script>` tag **before**
     the `<script type="module">` block that imports the sub-app's page
     class. Plain `<script>` tags execute in document order, blocking the
     module loader, so the bitbox object is guaranteed populated.

2. **Sub-apps MUST NOT touch `window.bitbox` at module top-level.**
   - Top-level `import` evaluation of an ES module is async with respect
     to the surrounding HTML, and there's no guarantee `window.bitbox` is
     populated by the time the sub-app's module body runs in every host.
   - Read `window.bitbox.*` from inside class methods (`constructor`,
     `render`, etc.) — those run only when the host explicitly invokes
     them, by which time the host has finished populating.

3. **Async setup is the host's responsibility.**
   - Some `window.bitbox` keys may be lazily fetched (e.g. the standalone
     shim's `env` is fetched from `/api/env` on first access). The shim
     MUST cache after the first fetch so callers can use a synchronous
     getter shape and not worry about race conditions.

4. **Sub-apps MUST be idempotent on second construction.**
   - Portal constructs a fresh page instance every nav click; if the user
     bounces between two nav buttons, your `constructor` will run twice
     (with `destroy` called in between). Don't leak global state or
     duplicate document-level listeners.

---

## Backwards compatibility

During migration to this contract, the **pre-existing implicit interface**
continues to work. Specifically:

- `window.PLANNER_API_BASE` and `window.PURCHASING_API_BASE` (if any) MUST
  continue to resolve correctly when set by older host code.
- The current `linkToPlannerAPI` constructor signature `(clockNumber, baseUrl)`
  MUST continue to work; new code can omit the args and the wrapper will
  read from `window.bitbox`.
- Page-class constructors that previously took `(user)` MUST continue to
  accept it; the constructor falls back to `user ?? window.bitbox?.session?.user`.

Recommended fallback chain for API base URL inside any `linkToXxxAPI`:

```js
this.base = baseUrl
         ?? window.bitbox?.api?.base
         ?? window.PLANNER_API_BASE       // or PURCHASING_API_BASE
         ?? window.location.origin;
```

Recommended fallback chain for the active user:

```js
this.user = explicitUser
         ?? window.bitbox?.session?.user
         ?? null;
```

Once all sub-apps are migrated and the back-compat globals are no longer
referenced anywhere, a future minor or major version of this contract MAY
remove the back-compat fallbacks. That removal will be flagged in this
spec's changelog at the bottom.

---

## Implementations

- **Real portal implementation:** [`portal/static/clientJS/portal-host.js`](portal/static/clientJS/portal-host.js)
  — `installPortalHost(currentUser)` is called by [`portal/static/clientJS/main.js`](portal/static/clientJS/main.js)
  after login.
- **Standalone shim:** [`portal-shim/portal-shim-standalone.js`](portal-shim/portal-shim-standalone.js)
  (canonical) — vendored into each sub-app's `static/` folder by
  [`portal-shim/refresh-shims.ps1`](portal-shim/refresh-shims.ps1). Never
  edit the vendored copies directly.

---

## Changelog

- **1.0.0** — initial contract. `contractVersion`, `session`, `env`, `api`,
  `logger`, `barcodeScanner`, `nav`. Back-compat for `window.PLANNER_API_BASE`,
  `window.PURCHASING_API_BASE`, and the legacy `(clockNumber, baseUrl)`
  constructor arguments retained.
