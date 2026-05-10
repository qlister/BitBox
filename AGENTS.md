# BitBox (umbrella) — AGENTS.md

> **Read this first.** Then read `README.md` in this folder for the full
> layout, port map, cloning instructions, and combined-stack docker-compose
> details. The Portal Host Contract spec lives in `PORTAL_CONTRACT.md` and
> is the authoritative description of `window.bitbox.*` — read it before
> touching `portal-shim/` or anything that consumes the contract.

---

## What this folder is

The **BitBox umbrella** — a thin orchestration repo that holds:

- `bitbox.code-workspace` — multi-root Cursor workspace (5 roots).
- `docker-compose.yml` — combined-stack orchestrator (portal + planner + purchasing).
- `README.md` — top-level overview, cross-project couplings, port map, cloning.
- `PORTAL_CONTRACT.md` — versioned spec for `window.bitbox.*` (the host ↔ sub-app interface).
- `portal-shim/` — canonical standalone shim + `refresh-shims.ps1` + its own README.
- `.gitignore` — excludes the four sub-repos so they aren't accidentally tracked here.

**No application code lives at this level.** All code lives in the four
sub-project folders, each of which is an independent git repository:
`portal/`, `planner/`, `purchasing/`, `erp_query_engine/`.

---

## When the user is asking about app code, redirect

If the user's question is about a feature, bug, SQL view, API endpoint, or
deployment of one of the sub-projects, the relevant context is **not here**.
Open the matching sub-project's `AGENTS.md` and `README.md` instead:

| Sub-project          | AGENTS.md path                  | Common cues that work belongs there                                         |
|----------------------|---------------------------------|-----------------------------------------------------------------------------|
| **portal**           | `portal/AGENTS.md`              | login, sessions, ERP query page, Gemma chat, intranet auth, AppLog dashboard. |
| **planner**          | `planner/AGENTS.md`             | OR-Tools, CP-SAT, scheduling, Gantt, skills matrix, WO readiness, timing audit. |
| **purchasing**       | `purchasing/AGENTS.md`          | purchasing grid, PSCR, PO creation, supplier exporters, basket reconciliation, BoM compare. |
| **erp_query_engine** | `erp_query_engine/AGENTS.md`    | NL → SQL, MCP server, ChromaDB / Vanna, training, Anthropic Claude.         |

Don't try to solve sub-project work from inside the umbrella unless the
change genuinely spans multiple sub-projects (e.g. a contract bump that
touches host + spec + every consumer at once).

---

## Work that DOES belong here

- Editing `bitbox.code-workspace` (e.g. adding a new sub-project root).
- Editing the combined `docker-compose.yml` (e.g. adding a new service).
- Maintaining `README.md` (top-level layout, cross-project coupling notes,
  port map, cloning instructions).
- **Maintaining `PORTAL_CONTRACT.md`** — see "Contract discipline" below.
- **Maintaining `portal-shim/`** — see "Shim discipline" below.

---

## Contract discipline

`PORTAL_CONTRACT.md` is the **single source of truth** for the
`window.bitbox.*` surface (currently version `1.1.0`). It follows semver:

- **PATCH** — wording fixes, no surface change.
- **MINOR** — additive (new keys on `window.bitbox.*`). Existing sub-apps unaffected.
- **MAJOR** — breaking (removing or changing the shape of an existing key).

If you change the contract:

1. Update `PORTAL_CONTRACT.md` *first* — including the changelog at the bottom.
2. Bump the `contractVersion` constant in **both** implementations:
   - `portal-shim/portal-shim-standalone.js` (canonical) — and re-run
     `portal-shim/refresh-shims.ps1` to push to the vendored copies.
   - `portal/static/clientJS/portal-host.js` (real portal implementation).
3. Update any back-compat fallback chains in sub-app code if needed (see the
   "Backwards compatibility" section of `PORTAL_CONTRACT.md`).
4. If the bump is **MAJOR**, audit all consumers (`planner/static/`,
   `purchasing/static/`) for the affected keys before merging.

Spec and code MUST stay in lock-step — if they diverge, the spec wins until
the code is updated.

---

## Shim discipline

The canonical standalone shim lives at
`portal-shim/portal-shim-standalone.js`. It is **vendored** (file-copied)
into each sub-app's `static/` folder rather than served from a shared URL.

**Hard rules:**

1. **Edit only the canonical.** Vendored copies in
   `planner/static/portal-shim-standalone.js` and
   `purchasing/static/portal-shim-standalone.js` will be overwritten next
   time someone refreshes — any edits made there are guaranteed to be lost.
2. **Run `portal-shim/refresh-shims.ps1`** after every canonical edit to
   propagate the change to all vendored copies. The script reports byte-size
   per destination — confirm sizes match before assuming you're done.
3. **Bump `contractVersion`** in the canonical if (and only if) you change
   the `window.bitbox.*` surface — see "Contract discipline" above.
4. When adding a new sub-app that consumes the contract, edit the
   `$targets` array inside `refresh-shims.ps1` so future refreshes update
   the new vendored copy too.

See `portal-shim/README.md` for the design rationale (why vendoring rather
than a shared module).

---

## Combined-stack compose

`docker-compose.yml` here brings up portal + planner + purchasing together.
`erp_query_engine` is **deliberately not** in this compose file — it's
brought up separately from `erp_query_engine/docker-compose.yml`. The portal
reaches it at `host.docker.internal:8000` (set `ERP_QUERY_URL` in
`portal/.env`).

For developing one project in isolation, use the `docker-compose.yml`
*inside* that project's folder, not this one.

### Env source-of-truth in the combined stack

In the umbrella combined stack, **every** service is wired with
`env_file: ./portal/.env` — including planner and purchasing. This is the
mechanism that satisfies the Portal Host Contract's "no-drift" invariant
(see `PORTAL_CONTRACT.md` → "Env handling"): the database the sub-app's
backend connects to physically cannot disagree with the database name
shown in `window.bitbox.env.database` (and therefore the operator-visible
pill), because both come from the same env vars in the same shared file.

Each sub-project still keeps its own `.env` for **standalone** development
on its own port — `planner/.env` for `planner/docker-compose.yml`,
`purchasing/.env` for `purchasing/docker-compose.yml`. Variable names are
intentionally aligned across all three so a sub-app behaves identically in
both modes (`DB_DATABASE`, `DB_UID`, `DB_PWD`, `APP_ENV`, etc.). When you
change a variable in one of these files, consider whether the equivalent
file for the other modes needs the same change.

---

## Working conventions at this level

- **PowerShell `curl` quirk:** Never use `curl` in PowerShell to test API endpoints (like `curl http://localhost:8081/api/insight/version`) because `curl` is an alias for `Invoke-WebRequest` which often hangs indefinitely waiting to parse the response stream. Always use `curl.exe` explicitly (e.g. `curl.exe -s http://localhost:8081/api/insight/version`).
- **Don't commit** unless the user explicitly asks. The umbrella has its own
  git repo separate from the four sub-projects — when committing changes
  here, only the umbrella files (the workspace, contract, compose, shim,
  README, this AGENTS.md, .gitignore) are in scope. Sub-project changes
  belong in their own repo's commits.
- **Documentation** — `README.md` and `PORTAL_CONTRACT.md` are live
  documents. Keep them accurate as the architecture changes; they are the
  primary onboarding material for new colleagues.
- **No new heavyweight frontend dependencies** in the contract surface
  (React/Vue/Alpine/htmx, etc.) without explicit approval — the contract is
  designed around plain ES modules + jQuery to match the rest of the stack.

---

## Where to find things at this level

| What                                  | Where                                       |
|---------------------------------------|---------------------------------------------|
| Multi-root Cursor workspace           | `bitbox.code-workspace`                     |
| Combined-stack docker-compose         | `docker-compose.yml`                        |
| Top-level README (layout, ports, etc.)| `README.md`                                 |
| Portal Host Contract spec             | `PORTAL_CONTRACT.md`                        |
| Canonical standalone shim             | `portal-shim/portal-shim-standalone.js`     |
| Shim refresh script                   | `portal-shim/refresh-shims.ps1`             |
| Shim vendoring docs                   | `portal-shim/README.md`                     |
| Sub-repo exclusion list               | `.gitignore`                                |
