# BitBox — Platform Umbrella

This is the top-level orchestration repository (`github.com/qlister/BitBox`) for
the BitBox internal platform. It contains **no application code of its own** —
it holds the combined `docker-compose.yml`, the Cursor workspace file, the
shared **Portal Host Contract**, and this README.

The actual applications live in four independent git repositories cloned as
sub-folders.

---

## Repository structure

```
BitBox/                          ← this repo  github.com/qlister/BitBox
├── bitbox.code-workspace        ← multi-root Cursor workspace (5 roots)
├── docker-compose.yml           ← combined orchestrator (portal + planner + purchasing)
├── README.md                    ← this file
├── .gitignore                   ← excludes the four sub-repos so they aren't tracked here
├── PORTAL_CONTRACT.md           ← spec for window.bitbox.* (host ↔ sub-app interface)
├── portal-shim/                 ← canonical portal-shim-standalone.js + refresh script
│   ├── portal-shim-standalone.js
│   ├── refresh-shims.ps1
│   └── README.md
├── portal/                      ← git repo  github.com/qlister/portal
├── planner/                     ← git repo  github.com/qlister/planner
├── purchasing/                  ← git repo  github.com/qlister/purchasing
└── erp_query_engine/            ← git repo  github.com/qlister/vanna   ← note: repo name ≠ folder name
```

The four sub-folders are **independent git repositories** with their own
GitHub remotes, their own Dockerfiles, their own deployment cadences, and
their own `.env` files. The umbrella's `.gitignore` excludes them so this
repo doesn't accidentally try to track their contents.

---

## What each sub-project does

### portal — `github.com/qlister/portal`

The intranet shell. Login (two-step: badge scan or username + password),
sessions, role-aware navigation, ERP Query page, Gemma AI chat, application
log dashboard. Reverse-proxies `/planner/` and `/purchasing/` to the
sibling containers so the operator only ever sees port 8081.

Stack: Python 3.12 / FastAPI / uvicorn / `pyodbc` / `passlib[bcrypt]`,
ES modules + jQuery + Bootstrap 5 frontend.
Schema: `BitBoxIntranet` on top of read-only ERP tables.

Full docs: [`portal/AGENTS.md`](portal/AGENTS.md), [`portal/README.md`](portal/README.md).

### planner — `github.com/qlister/planner`

Shop-floor scheduling. Loads constraints from the ERP, runs Google
**OR-Tools CP-SAT** server-side, returns a JSON schedule rendered as a
Gantt chart in the browser.

Stack: Python 3.12 / FastAPI / OR-Tools / `pyodbc`. Plain JS + DHTMLX Gantt
frontend. Schema: `BitBoxPlanner`.

Full docs: [`planner/AGENTS.md`](planner/AGENTS.md), [`planner/README.md`](planner/README.md).

### purchasing — `github.com/qlister/purchasing`

Purchasing tools. Daily-driver Purchasing Grid (MRP demand + ERP / Luminovo /
User-typed suppliers, per-row source selection, per-supplier PO processing
into 123Insight via the SDK CLR procs); BoM Comparison Tool; staged-order
basket reconciliation flow for Farnell.

Stack: Python 3.12 / FastAPI / `pyodbc` / `openpyxl`. Plain JS + HTML
frontend. Schema: `BitBoxPurchasing`. **Two deployment targets**: dev
(SANDBOX, standalone) and staging (BITBOXMRP, via the umbrella stack).

Full docs: [`purchasing/AGENTS.md`](purchasing/AGENTS.md), [`purchasing/README.md`](purchasing/README.md).

### erp_query_engine — `github.com/qlister/vanna`

Standalone natural-language → T-SQL service over BITBOXMRP. Exposes both an
**MCP server** (consumed by Cursor as the `user-erp-query-engine` MCP) and a
REST API (consumed by the portal's ERP Query page). Anthropic Claude as the
LLM, ChromaDB as the vector store, `pymssql` for the read-only DB connection.

The repo is named `vanna` for historical reasons; we check it out into a
folder called `erp_query_engine`. The mismatch is documented in the
sub-project's own AGENTS.md.

Full docs: [`erp_query_engine/AGENTS.md`](erp_query_engine/AGENTS.md), [`erp_query_engine/README.md`](erp_query_engine/README.md).

---

## Cross-project dependencies

The four sub-projects are mostly independent, but a small number of couplings
matter and aren't obvious from filesystem layout alone:

- **portal → planner / purchasing** — HTTP reverse-proxy. Loose coupling; if
  a sub-app is down the portal still runs.
- **portal → erp_query_engine** — HTTP via `httpx`. Loose coupling.
- **purchasing → planner SQL views** — *Tight* coupling. Purchasing reads
  `BitBoxPlanner.v_bom`, `v_works_orders`, and `v_component_avail` for its
  stock timeline. A change to the columns of these views breaks purchasing
  at runtime, with no compile-time check.
- **All projects → unified SQL baseline** — `planner/sql/10_create_bitbox_svc.sql`
  creates the SQL logins (`portal_user`, `bitbox_svc`, `erp_mcp_read`) used by
  *every* sub-project. The script is owned by the planner repo by historical
  accident; it could be moved to a shared location later.

These dependencies are flagged in each sub-project's AGENTS.md.

---

## Portal Host Contract (browser-side integration)

Sub-apps (planner, purchasing) need to run in two modes:

1. **Standalone** for fast development iteration — they serve their own
   `static/index.html` directly on their own port.
2. **Embedded inside portal** — the portal dynamic-imports the sub-app's
   page class and renders it inside the portal's chrome, with shared services
   (session, barcode scanner, logger, env info, navigation) provided by the
   host.

The interface that mediates this is the **Portal Host Contract** —
documented in [`PORTAL_CONTRACT.md`](PORTAL_CONTRACT.md). It's a small,
versioned `window.bitbox.*` surface populated by the host (real
implementation in portal, stub implementation in standalone mode).

The standalone stub lives canonically in [`portal-shim/portal-shim-standalone.js`](portal-shim/portal-shim-standalone.js)
and is **vendored** (file-copied) into each sub-app's `static/` folder. The
[`portal-shim/refresh-shims.ps1`](portal-shim/refresh-shims.ps1) script
refreshes the vendored copies whenever the canonical changes. Never edit
the vendored copies directly — see [`portal-shim/README.md`](portal-shim/README.md).

---

## Port allocation across all BitBox tools

- **8081** — full stack staging (portal routing to planner/purchasing on BITBOXMRP)
- **8082** — planner dev (SANDBOX, amber navbar)
- **8084** — purchasing dev (SANDBOX, amber header)
- **8000** — erp_query_engine (MCP `/mcp` + REST `/api/*`)

LAN access from anywhere on the company network: `http://bb-14175.bitbox.local:<port>`
(replace hostname with whichever machine is hosting the container).

---

## Cursor workspace

This repo's [`bitbox.code-workspace`](bitbox.code-workspace) is a multi-root
workspace with **five** folders:

1. **BitBox (umbrella)** — this repo, for editing the workspace file, the
   compose, the contract, and the portal-shim.
2. **portal**
3. **planner**
4. **purchasing**
5. **erp_query_engine**

All paths are relative to this folder, so the workspace file works on any
machine as long as the colleague clones the same relative structure (see
**Cloning from scratch** below).

To open: `File → Open Workspace from File…` → `bitbox.code-workspace`.

Each sub-project root has its own `AGENTS.md` (slim, AI-targeted orientation)
and `README.md` (full reference). New AI agent sessions auto-load AGENTS.md
for whichever root the chat is scoped to. Cross-project facts that apply
everywhere (DB server, sqlcmd patterns, etc.) are duplicated between the
AGENTS.md files because Cursor only auto-loads the local one.

---

## Combined stack — Docker Compose

From this folder, the bundled `docker-compose.yml` brings up portal +
planner + purchasing together:

```powershell
docker-compose up --build       # first build or after Dockerfile changes
docker-compose up -d            # start all in background
docker-compose logs -f portal   # tail one container
docker-compose down             # stop and remove all
```

The portal container reverse-proxies `/planner/*` and `/purchasing/*` to
the sibling containers, so `http://localhost:8081` is the only URL the
operator needs.

The **erp_query_engine** is **not** part of this compose file — it's
brought up separately from `erp_query_engine/docker-compose.yml`. The
portal reaches it at `host.docker.internal:8000` (set `ERP_QUERY_URL` in
`portal/.env`). The engine also runs on the **BB-AIDEV** Ubuntu host as a
LAN-shared instance — see `erp_query_engine/README.md`.

For developing one project in isolation, use the `docker-compose.yml`
inside that project's folder.

---

## Cloning from scratch (colleague onboarding)

Pick any parent directory, e.g. `~\AI`. Then:

```powershell
mkdir ~\AI; cd ~\AI

# Clone the umbrella repo first
git clone https://github.com/qlister/BitBox.git
cd BitBox

# Clone each sub-project. Folder names matter — the workspace file
# references them by relative path.
git clone https://github.com/qlister/portal.git portal
git clone https://github.com/qlister/planner.git planner
git clone https://github.com/qlister/purchasing.git purchasing
git clone https://github.com/qlister/vanna.git erp_query_engine    # NB: repo is "vanna", checkout under "erp_query_engine"

# Open the multi-root workspace in Cursor
cursor bitbox.code-workspace
```

The colleague will also need:

- **MSSQL access to BB-DC01** — either their Windows AD account (preferred for
  interactive use) or `sa` credentials to populate `.env` files for container
  use.
- **An Anthropic API key** for `erp_query_engine/.env`.
- **Per-project `.env` files** — copy `.env.example` to `.env` in each
  sub-project and fill in the secret values out-of-band (`.env` files are
  never committed). The portal also needs `LLAMA_SERVER_URL` if the Gemma
  AI chat page is in use.
- **Docker Desktop** + **ODBC Driver 17 for SQL Server** installed locally.
- **Cursor MCP wiring** — `erp_query_engine/.cursor/mcp.json` is per-machine
  (URL differs between dev workstation and BB-AIDEV) and is git-ignored;
  copy from a colleague.

---

## Database

All sub-projects connect to the same MSSQL instance:

- **Server:** `BB-DC01` / `172.16.1.2` (never use `INSIGHT-SERVER`, `localhost`
  — they will time out).
- **Dev DB:** `SANDBOX`. **Prod DB:** `BITBOXMRP` (production).
- **Schemas:** `BitBoxIntranet` (portal), `BitBoxPlanner` (planner +
  purchasing reads), `BitBoxPurchasing` (purchasing).
- **Service logins:** `portal_user`, `bitbox_svc`, `erp_mcp_read` — all
  created by the unified `planner/sql/10_create_bitbox_svc.sql` baseline.

Connection details and migration history are in each sub-project's own README.

---

## Where to look for what

- **Workspace setup, port map, cloning** — this file.
- **Browser-side host/sub-app contract** — [`PORTAL_CONTRACT.md`](PORTAL_CONTRACT.md).
- **Standalone shim source + vendoring discipline** — [`portal-shim/README.md`](portal-shim/README.md).
- **Per-project orientation** (slim, AI-targeted) — `<project>/AGENTS.md`.
- **Per-project full reference** (deep) — `<project>/README.md`.
- **Combined-stack compose commands** — this file's "Combined stack" section.
- **Per-project compose** (single project in isolation) — `<project>/docker-compose.yml`.
