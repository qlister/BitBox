
# BitBox — Platform Overview

This is the top-level orchestration repository for the BitBox internal platform.
It contains no application code of its own — it holds the combined `docker-compose.yml`
that starts all services together, and the Cursor workspace file for multi-repo editing.

---

## Repository Structure

```
BitBox/                          ← this repo (github.com/qlister/BitBox)
├── docker-compose.yml           ← combined orchestrator (runs portal + planner)
├── bitbox.code-workspace        ← open in Cursor to see portal and planner together
├── README.md
├── portal/                      ← git repo (github.com/qlister/portal)
└── planner/                     ← git repo (github.com/qlister/planner)
```

`portal/` and `planner/` are fully independent git repositories sitting inside this
folder. This repo does not track their contents — they manage their own history and
GitHub remotes.

---

## What Each Repo Contains

### portal — `github.com/qlister/portal`

The BitBox intranet shell and framework. Everything user-facing lives here.

| Folder | Purpose |
|---|---|
| `intranet/` | PHP 8.3 + Apache web app. Login, sessions, role-aware nav, logging dashboard. Runs on port **8081**. |
| `mes/` | Existing Manufacturing Execution System (MES) web app. |
| `wombat/` | Data analysis tools. |

Tech stack: PHP 8.3, Apache, Microsoft `sqlsrv` PECL extension, Bootstrap 5, jQuery, ES modules.
Database: MSSQL on BB-DC01 / SANDBOX, schema `BitBoxIntranet`.

### planner — `github.com/qlister/planner`

Shop floor scheduling tool. Uses Google OR-Tools CP-SAT to solve production constraints
loaded from the ERP database and returns a Gantt-ready schedule via REST API.

| Folder | Purpose |
|---|---|
| `backend/` | Python FastAPI app (`main.py`, `db.py`, `solver.py`). Runs on port **8082**. |
| `static/` | JS frontend (`plannerPage.js`, `linkToPlannerAPI.js`). Served by FastAPI. |
| `static/index.html` | Standalone dev entry point (not used in integrated mode). |
| `sql/` | MSSQL schema and view scripts for the `BitBoxPlanner` schema. |

Tech stack: Python 3.12, FastAPI, OR-Tools CP-SAT, pyodbc, MSSQL on BB-DC01 / SANDBOX.

**How the planner UI integrates with the portal:**
The planner's JS frontend lives in the planner repo and is served by FastAPI as static files.
When running the full system, Apache in the portal container proxies all `/planner/` requests
to the planner container — so the browser only ever talks to port 8081. The portal's `main.js`
dynamically imports `plannerPage.js` via this proxy when the user clicks the Planner nav button.

---

## Port Map

| Service | URL | Container name |
|---|---|---|
| Portal (PHP/Apache) | http://localhost:8081 | `bitbox_portal` |
| Planner (Python/FastAPI) | http://localhost:8082 | `bitbox_planner` |

---

## Development Workflows

### Scenario 1 — Working on the Planner only

Use this when you are developing the planner's Python backend (`backend/`) or its
JS frontend (`static/plannerPage.js`). The portal does not need to be running.

**Cursor:** open the `BitBox\planner\` folder directly, or open `bitbox.code-workspace`
and work in the `planner` root.

**Container to run** (from `BitBox\planner\`):

```powershell
docker-compose up --build     # first build, or after Dockerfile / requirements.txt change
docker-compose up -d          # start in background on subsequent runs
docker-compose logs -f        # tail logs
docker-compose down           # stop
```

**Browser:** `http://localhost:8082` — the planner serves its own standalone UI directly.

Both `backend/` and `static/` are live-mounted inside the container, so you can edit
Python or JS files and see changes immediately without rebuilding. Note that Python
changes require uvicorn to reload — either restart the container or run uvicorn with
`--reload` for a tighter loop during heavy backend work.

---

### Scenario 2 — Working on the full system (Portal + Planner together)

Use this when you need to test the planner running inside the portal shell — i.e. the
full login → role-aware nav → Planner page flow.

**Cursor:** open `BitBox\bitbox.code-workspace` for a multi-root view of both repos.

**Containers to run** (from `BitBox\`):

```powershell
docker-compose up --build     # first build, or after any Dockerfile change
docker-compose up -d          # start both in background on subsequent runs
docker-compose logs -f        # tail logs from both containers
docker-compose down           # stop both containers
```

**Browser:** `http://localhost:8081` — log in, then click the **Planner** button
(visible to Engineer, Admin, and SuperAdmin roles).

The portal's Apache proxies `/planner/` through to the planner container, so the
planner JS and API are loaded seamlessly without the browser knowing about port 8082.

Live-mount behaviour:
- Portal PHP/JS changes (`portal/intranet/wwwroot/`) — instant, no rebuild needed.
- Planner JS changes (`planner/static/`) — instant, no rebuild needed.
- Planner Python changes (`planner/backend/`) — restart container or use `--reload`.
- Dockerfile or `requirements.txt` changes — always requires `--build`.

---

### Scenario 3 — Working on the Portal only (no planner)

Use this when working solely on the portal shell — login, sessions, roles, MES
integration, etc. — with no need for the planner at all.

**Container to run** (from `BitBox\portal\intranet\`):

```powershell
docker-compose up --build
docker-compose up -d
docker-compose down
```

**Browser:** `http://localhost:8081`

The Planner nav button will show a "backend unreachable" error if clicked, which is
expected — the planner container simply isn't running.

---

## Opening in Cursor (multi-root workspace)

To see both `portal` and `planner` side by side in Cursor:

`File > Open Workspace from File...` → select `BitBox\bitbox.code-workspace`

This gives Cursor full visibility of both repos simultaneously — file explorer,
search, and AI context all span both projects.

---

## Database

Both services connect to the same MSSQL instance:

- **Server:** BB-DC01 (IP: 172.16.1.2)
- **Database:** SANDBOX
- **Portal schema:** `BitBoxIntranet`
- **Planner schema:** `BitBoxPlanner`

Connection credentials live in each project's `.env` file (git-ignored).
See each project's own README for connection details and SQL migration history.

---

## Cloning from Scratch

Each repo must be cloned independently:

```powershell
mkdir BitBox
cd BitBox
git init
git remote add origin https://github.com/qlister/BitBox.git
git pull origin main

git clone https://github.com/qlister/portal.git portal
git clone https://github.com/qlister/planner.git planner
```

Then copy `.env` files into `portal/intranet/` and `planner/` from a trusted source
(never committed to git).
