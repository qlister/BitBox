# Portal Host Contract — Specification

**Contract version: `2.0.1`** (semver — see "Versioning rules" below)

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

## The `window.bitbox` surface (v2.0.0)

```js
window.bitbox = {
  contractVersion: "2.0.0",       // string, always present
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
  environment: string,    // "dev" | "staging" | "prod" | "test"
  version:     string,    // version of whichever app is providing the host (e.g. portal version, or planner version in standalone)
  isProdData:  boolean,   // true iff database === "BITBOXMRP" AND environment !== "dev"
  ready:       Promise,   // resolves once the values above have been populated from the host
}
```

This shape matches the existing `/api/insight/databaseName` portal endpoint
and the planner's `/api/env`. `isProdData` is a derived convenience for
"should I make the navbar dark and warn before destructive actions?".

**Critical invariant (MUST):** the values reported in `env.database` and
`env.environment` MUST match the database the sub-app's backend is actually
connected to. The pill in the header is the operator-visible report of this
invariant — if it's wrong, every "is this dev or prod?" judgement made by
the operator that day is wrong. Implementations MUST guarantee no drift
between the displayed value and the actual backend connection. See "Env
handling" below for how each implementation does so.

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

## Env handling

This section formalises how the values that flow through `bitbox.env` are
**produced** in each mode, and how implementations guarantee the
"no-drift" invariant from the `env` section above. The contract is
deliberately silent on file layout — implementations may use `.env` files,
secrets managers, or any other source — but it does mandate the runtime
behaviour each implementation MUST provide.

### Standalone-mode hosts (MUST)

A sub-app served directly on its own port (e.g. planner on 8082, purchasing
on 8084) MUST expose a JSON endpoint:

```
GET /api/env  →  { "database": <string>,
                   "environment": <string>,
                   "version": <string> }
```

- `database` MUST be the database the sub-app's backend is currently
  connected to. The simplest implementation is `os.getenv("DB_DATABASE")`,
  read from the same environment as the actual SQL connection string. A
  more defensive implementation queries `SELECT DB_NAME()` and returns
  the live answer from the connection itself (the portal does this for
  `/api/insight/databaseName`).
- `environment` MUST be the value of the canonical `APP_ENV` env var
  (`"dev"` / `"staging"` / `"prod"`). Pre-1.1.0 sub-apps used per-app names
  (`PLANNER_ENV`, `PURCHASING_ENV`) — those were renamed to `APP_ENV` in
  the 1.1.0 sweep. Terminology was updated from "live"/"beta" to "prod"/"staging" in 2.0.0.
- `version` MUST be the sub-app's own version string.

The standalone shim populates `window.bitbox.env` from this endpoint at
page load. The shim's lazy `env.ready` promise resolves when the fetch
completes; pages that need accurate values before rendering MUST `await`
it before reading `env.*`.

### Integrated-mode hosts (MUST)

The portal populates `window.bitbox.env` from its own `/api/insight/databaseName`
endpoint, which queries the live SQL connection (`SELECT DB_NAME()`) and
returns it alongside `version` and a normalised `environment` string.
Whatever transport the host uses, the values reported via `bitbox.env`
MUST reflect the database that the sub-app's *backend container* is
actually connected to — not just the host's own connection.

In practice, this means the integrated stack MUST wire a single `.env`
into both the portal and every sub-app container, so the env vars all
three processes read are identical. The `BitBox/docker-compose.yml`
combined orchestrator achieves this with `env_file: ./portal/.env` on
every service.

### Canonical env-var names

The following names MUST be used consistently across portal, planner,
purchasing, and any future sub-app that wants its `.env` to be portable
into the integrated stack:

| Var               | Meaning                                                    |
| ----------------- | ---------------------------------------------------------- |
| `DB_SERVER`       | MSSQL hostname or IP                                       |
| `DB_DATABASE`     | initial-catalog database name (drives `bitbox.env.database`) |
| `DB_UID`          | SQL Server auth login                                      |
| `DB_PWD`          | SQL Server auth password                                   |
| `DB_DRIVER`       | ODBC driver name (sub-apps using pyodbc)                   |
| `DB_TRUSTED`      | `"yes"` for Windows Auth, `"no"` for SQL auth              |
| `DB_ENCRYPT`      | `"yes"` recommended                                        |
| `DB_TRUST_CERT`   | `"yes"` required for self-signed BB-DC01 cert              |
| `APP_ENV`         | `"dev"` / `"staging"` / `"prod"` (drives `bitbox.env.environment`) |

Other env vars (session secrets, log keys, sub-app-specific extras like
`DB_PSCR_SQL_AUTH_*`) are not part of the contract — implementations may
name them as they wish.

---

## Changelog

- **2.0.1** — patch. Modified `portal-shim-standalone.js` to automatically inherit `window.parent.bitbox` when running inside an iframe, allowing the purchasing iframe integration to work seamlessly with the portal host.
- **2.0.0** — breaking. Renamed `env.isLive` to `env.isProdData`. Environment values are now `"dev"`, `"staging"`, and `"prod"` instead of `"dev"`, `"beta"`, and `"live"`.
- **1.1.0** — additive. Adds `env.ready` to the documented `env` shape
  (already present in both implementations since 1.0.0; now formalised).
  Adds the **"Env handling"** section: standalone-mode hosts MUST expose
  `GET /api/env` with the documented shape; integrated-mode hosts MUST
  ensure backend and pill cannot diverge (and SHOULD use a single shared
  `.env` for the combined stack). Standardises canonical env-var names —
  notably `APP_ENV` (replacing per-app `PLANNER_ENV` / `PURCHASING_ENV`)
  and `DB_DATABASE` / `DB_UID` / `DB_PWD` (portal renamed from `DB_NAME`
  / `DB_USER` / `DB_USER_PASS`).
- **1.0.0** — initial contract. `contractVersion`, `session`, `env`, `api`,
  `logger`, `barcodeScanner`, `nav`. Back-compat for `window.PLANNER_API_BASE`,
  `window.PURCHASING_API_BASE`, and the legacy `(clockNumber, baseUrl)`
  constructor arguments retained.
