# CLAUDE.md

Guidance for Claude Code when working in this repo. Focused on **WP Publisher** — the only feature shipped today. Other dashboard pages may be added later but are out of scope here.

## What this project is

A local Next.js dashboard that automates publishing content from Google Sheets to WordPress. Each row in a configured sheet represents a piece of content; when its status flips to "In-Progress", the worker pulls the content from a linked source (Google Doc or Surfer SEO audit), creates a WP draft via the REST API, and writes the row's status back to "Content Live".

Designed to run **locally on each team member's machine** — not as a hosted service. Credentials, browser sessions, and processed-row state all live in `config/`, `data/`, and `logs/` on disk. The dashboard is localhost-only by default and has no auth layer.

## How to run

```bash
npm install
npx playwright install chromium   # one-time, needed for Surfer SEO scraping
cp .env.example .env
npm run dev                        # → http://localhost:3030
```

The scheduler boots automatically inside the Next.js server and polls every `POLL_INTERVAL_MINUTES` (default 5).

## Architecture

**Single Next.js app, App Router, TypeScript.** No separate backend — API routes under `app/api/` handle everything. The polling worker runs inside the Next server process via a `setInterval` attached to `globalThis` (so it survives hot-reload during dev).

```
app/
  page.tsx                          Overview/home
  setup/                            Service account upload (first-run wizard)
  wp-publisher/
    page.tsx                          List of projects with status cards
    new/                              Add project form
    edit/[id]/                        Edit project form
    logs/                             JSONL log viewer
  api/
    setup/                            GET/POST/DELETE service account JSON
    projects/                         GET (list), POST (create)
    projects/[id]/                    GET (full config incl. secrets), PUT, DELETE
    projects/[id]/health/             GET — Sheet + WP probes
    projects/[id]/published/          GET (recent), DELETE (reset history)
    projects/[id]/surfer/login/       POST — opens headed Chromium for login
    projects/[id]/surfer/session/     GET (probe), DELETE (clear cookies)
    projects/test/                    POST — test connection without saving
    queue/                            GET — current "In-Progress" rows for a project
    worker/run/                       POST — manual trigger (single project or all)
    worker/status/                    GET — live run state for the running tick
    logs/                             GET — log tail

lib/
  google.ts                         Service-account auth singleton
  sheets.ts                         Sheet read/write with hyperlink extraction (see "Sheets gotcha")
  extract.ts                        Google Docs API + Surfer Playwright extraction
  wordpress.ts                      WP REST client (Application Password auth)
  worker.ts                         Per-row pipeline: extract → publish → writeback
  scheduler.ts                      setInterval poller, attached to globalThis
  live-state.ts                     Shared in-memory live run state (separate from
                                    scheduler.ts to avoid worker↔scheduler cycle)
  state.ts                          Processed-row ledger + run summary
  logger.ts                         Per-project JSONL logs
  projects.ts                       JSON config loader/writer
  types.ts                          Shared types
  worker-cli.ts                     Standalone CLI for cron usage

components/
  Nav.tsx                           Top nav
  ProjectCard.tsx                   Live status, queue/published tabs, Surfer session
  ProjectForm.tsx                   Reusable create/edit form

config/                             ALL gitignored — runtime data only
  service-account.json              Created by Setup UI
  projects/<id>.json                Created by Add Project form (contains WP creds)
  browser-profiles/<id>/            Per-project Playwright persistent context

data/<id>.processed.json            "Already published" ledger
logs/<id>.jsonl                     Runtime logs
```

## Conventions

### Configuration is UI-driven — never edit JSON files by hand

`config/service-account.json` and `config/projects/*.json` are managed entirely through the dashboard UI (Setup page and Add/Edit Project forms). When making changes, never instruct the user to edit these files directly — extend the UI instead. The user has explicitly stated they don't want to touch code or config files.

### Project schema (lib/types.ts → ProjectConfig)

```ts
{
  id: string                        // slug, derived from name
  name: string
  enabled: boolean
  wordpress: { baseUrl, username, appPassword }   // appPassword = WP Application Password
  sheet: {
    sheetId, tabName,
    columns: { status, pageType, primaryKeyword, contentLink },  // letters: 'A', 'D', 'H', 'L'
    headerRow: number,              // data starts at headerRow + 1
    triggerValue: string,           // 'In-Progress' (case-insensitive match)
    completedValue: string          // 'Content Live'
  }
  pageTypeRouting: Record<lowercaseString, 'post' | 'page'>
  publishStatus: 'draft' | 'pending' | 'publish'
}
```

### Public vs full config

Most APIs return `publicProject(p)` which strips `wordpress.appPassword` and other secrets. The single exception is `GET /api/projects/[id]` (used by the edit form) which returns the full config. This is acceptable **only because the dashboard is localhost-only**. If we ever expose this app to the network, that endpoint MUST gain auth + secret redaction.

### Status pipeline (lib/worker.ts → processRow)

For each "In-Progress" row:

1. Skip if already in processed ledger
2. Validate `contentLink` is a real `http(s)://` URL (see "Sheets gotcha")
3. Extract content based on URL host (`gdoc` | `surfer` | unsupported)
4. Resolve Page Type → `post` | `page` route via `project.pageTypeRouting`
5. POST to `/wp-json/wp/v2/{posts|pages}` as `publishStatus`
6. On success: write `completedValue` back to the Status column
7. Append to `data/<id>.processed.json` (always — even if writeback fails, so we don't double-publish on next poll)

`status: 'partial'` on a processed record means WP succeeded but sheet writeback failed. UI shows an amber warning triangle on those rows.

### Live run state (lib/live-state.ts)

The worker emits state updates as it moves through phases (`polling` → `extracting` → `publishing` → `writeback`). The UI polls `/api/worker/status` every 2 seconds while a run is active. **Always go through `updateLiveState()`** when adding new pipeline steps — don't bypass it or the UI will appear stuck.

`live-state.ts` is separate from `scheduler.ts` deliberately — `worker.ts` imports from `live-state.ts`, and `scheduler.ts` imports from `worker.ts`. Putting the state in `scheduler.ts` would create a circular dependency.

## Sheets gotcha — read this before touching `lib/sheets.ts`

Cells in a Google Sheet often display short text like "Link" with the actual URL hidden as a **cell-level hyperlink attribute**. The standard `spreadsheets.values.get` endpoint returns only the display text — you'd get back the literal string `"Link"` and never see the URL.

`fetchAllCells()` uses `spreadsheets.get` with `includeGridData: true` and a field mask that pulls both `formattedValue` AND `hyperlink`, plus `userEnteredValue.formulaValue` to handle `=HYPERLINK(...)` formulas. The queue reader (`fetchQueue`) prefers the hyperlink over display text for the content-link column.

If you change the sheet read path, **don't drop back to `values.get`** — it'll silently break for any client whose sheet uses link-text cells.

## Content extraction (lib/extract.ts)

### Google Docs (`extractFromGoogleDoc`)

Uses the Docs API directly, walks `body.content` paragraph-by-paragraph, converts named styles (`HEADING_1`-`HEADING_6`, `TITLE`, `NORMAL_TEXT`, bullets) to clean HTML. The post title prefers the first `<h1>` if present, falling back to the doc title. Output is WP-ready and predictable — this is the preferred content source for any new project.

### Surfer SEO (`extractFromSurfer`)

Uses `chromium.launchPersistentContext` against `config/browser-profiles/<projectId>/`. Each project has its own isolated cookie jar so different team members can use different Surfer accounts. Login is interactive: `openSurferLogin()` launches a **headed** browser pointing at `app.surferseo.com/login` and lets the user authenticate manually. The persistent context flushes cookies to disk when the window closes.

Extraction selectors, in priority order: `.ProseMirror` → `[contenteditable="true"]` → `[data-testid*="editor"]` → `[data-testid*="content"]` → `main [role="document"]` → `article`. Picks whichever has the most innerText. Falls through to iframes if nothing matches in the main frame. Detects login redirects and throws a clear error rather than returning the login page HTML.

**Surfer DOM changes will eventually break this.** When they do, open a real audit URL in a regular browser, inspect the editor element, and update the selector list. Don't add complex retry logic — fail fast and tell the user.

### Don't add new sources without the user's say-so

The codebase intentionally only handles `gdoc` and `surfer`. Frase support is stubbed out and throws a "not implemented" error directing users to export to Google Docs. Don't expand without explicit instruction.

## Adding a new feature to the dashboard

The user calls this whole thing "RM Dashboard" and WP Publisher is the first feature. Future features (Figma → Oxygen, etc.) live alongside as siblings under `app/<feature>/`. Keep cross-feature dependencies in `lib/` only when they're truly shared (e.g. `google.ts`, `logger.ts`).

## Conventions Claude should follow

- **TypeScript strict mode is on.** Don't use `any` to silence errors — use `unknown` and narrow, or define proper types.
- **Optional chaining everywhere on API responses.** API errors return `{ error: '...' }` with no other fields. The ProjectCard crashed once because `health?.sheet.ok` only protected `health`, not `sheet`. Always write `health?.sheet?.ok`.
- **Server actions are not used** — everything goes through API routes. This is intentional: server actions don't compose well with the worker/scheduler pattern.
- **No localStorage / sessionStorage in components.** Persistent state goes through the API → JSON files.
- **Logging convention**: every meaningful step in the worker pipeline calls `log(projectId, level, message, meta?, rowIndex?)`. Levels are `info | warn | error | success`. The Logs page tails everything.
- **Tailwind only** — no CSS modules, no styled-components. Dark theme baked into globals.css.
- **Lucide for icons** — already in deps. Don't add another icon set.
- **Avoid extra dependencies.** This app deliberately has a small surface area. Before adding a package, check if the standard library or existing deps cover it.

## When things break

**"Extraction failed" for every Surfer row** — Surfer session likely expired. User clicks "Log in to Surfer" on the project card to refresh.

**Sheet shows "checking..." indefinitely** — Service account doesn't have access to the sheet, or the tab name in the project config doesn't match what's in the actual sheet. Both errors surface in the health probe response.

**WP writes succeed but the Status column never updates** — Service account has Viewer access on the sheet instead of Editor.

**Worker appears stuck mid-run** — Check `/api/worker/status`. If `running: true` but the timestamp is old, the Next.js server probably crashed mid-tick. Restart `npm run dev`. The processed-row ledger ensures nothing double-publishes.

**Hot-reload during dev triggers two scheduler instances** — The `globalThis.__wpPublisherScheduler` guard prevents this. If you see double-firing logs, check that the guard is intact in `lib/scheduler.ts`.

## What NOT to do

- Don't add user authentication unless we're explicitly moving to hosted mode. Localhost-only is the security model.
- Don't centralize state in a database. Per-machine JSON files are intentional — they keep credentials per-user and avoid shared-state bugs across team members.
- Don't try to make the Surfer login flow work headlessly. We tried; Surfer's login is too brittle. The headed browser approach is the deliberate compromise.
- Don't reformat or "clean up" the project JSON files programmatically — they're the source of truth for that user's setup. Only the UI's Add/Edit/Delete actions should mutate them.
- Don't add Frase or any other third-party content source without checking with the user first.
