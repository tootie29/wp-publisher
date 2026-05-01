# RM Dashboard — WP Publisher

Local Next.js dashboard. First feature: **WP Publisher** — watches client Google Sheets for "In-Progress" rows and publishes drafts to WordPress automatically. Everything is configured through the UI — no editing code or JSON files by hand.

## What it does (per project)

1. Polls a Google Sheet every N minutes (default 5)
2. For each row where your chosen Status column = "In-Progress", reads:
   - Page Type column
   - Primary Keyword column
   - Content Link column (Google Doc / Surfer SEO / Frase URL)
3. Extracts content from the link:
   - **Google Docs** — via Google Docs API (fast, reliable)
   - **Surfer SEO** — via headless browser using a saved login session (see Surfer setup below)
4. Routes to WordPress as `post` or `page` based on your Page Type routing map
5. Creates a draft (configurable per project)
6. Writes "Content Live" back to the Status column

Already-processed rows are tracked locally so re-polling won't re-publish.

## Install

```bash
cd wp-publisher
npm install
cp .env.example .env

# One-time — downloads the Chromium binary used for Surfer scraping (~150MB)
npx playwright install chromium

npm run dev
```

Open **http://localhost:3030**.

## First-time setup (through the UI)

### 1. Upload your Google service account key

Click **Setup** in the nav — follow the walkthrough:
- Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
- Enable **Google Sheets API**, **Google Docs API**, **Google Drive API**
- Create a Service Account and download its JSON key
- **Drag-drop the JSON file into the upload area**

The dashboard saves and validates the key. You'll then see the service account email — copy it and share client Sheets and Google Docs with that email.

### 2. Add your first project

From WP Publisher page, click **Add project**. Fill in:

- **Basic** — Display name and enabled toggle
- **WordPress** — Site URL, admin username, and Application Password (WP admin → Users → Profile → Application Passwords)
- **Google Sheet** — Sheet ID, tab name, and column letters for Status / Page Type / Primary Keyword / Content Link
- **Page Type routing** — Map each Page Type value to `post` or `page`
- **Publish status** — `draft` (safe) / `pending` / `publish`

Click **Test now** to verify everything before saving.

### 3. (If you have Surfer SEO links) Log in to Surfer

If your Content Link column contains `app.surferseo.com` URLs, the project card will show a **Surfer SEO session** row.

1. Click **Log in to Surfer** → a real Chromium window opens on your Mac, pointed at Surfer's login page
2. Log in normally — handle 2FA, remember-me, any Surfer prompts
3. **Close the Chromium window** once you see the Surfer dashboard. Cookies persist to `config/browser-profiles/<project-id>/`
4. Click **Check session** in the dashboard — the pill should turn green ("Authenticated")

The worker reuses this profile for every run. Each project has its own profile, so you can have different Surfer accounts for different clients.

**When the session expires** (Surfer logs you out eventually), the pill will go amber. Click **Log in to Surfer** again and repeat.

## Safe testing

Default `publishStatus` is `draft` — nothing goes live without your review in WP admin.

- Click **Run now** on a project card to process the current queue
- Watch the live status strip at the top of the card (polling → extracting → publishing → writeback)
- Switch to the **Published** tab to see what landed in WP, with edit/view/source links

## Environment variables

`.env`:

- `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` — default `./config/service-account.json` (managed via Setup UI, no edit needed)
- `POLL_INTERVAL_MINUTES` — default 5

## Project files

Normally you don't touch these — the UI manages them. Listed for reference:

```
app/                          Next.js App Router
  setup/                        Service account upload
  wp-publisher/                 Main feature, list + queue + published
  wp-publisher/new/             Add project form
  wp-publisher/edit/[id]/       Edit project form
  wp-publisher/logs/            Log viewer
  api/                          Backend endpoints
    projects/[id]/surfer/login      Opens Surfer login window
    projects/[id]/surfer/session    Check/clear Surfer session
lib/
  extract.ts                    Google Docs API + Surfer browser scrape
  sheets.ts                     Read queue with hyperlink extraction
  wordpress.ts                  WP REST client (Application Password auth)
  worker.ts, scheduler.ts       Polling + processing
  state.ts, logger.ts           Local persistence
components/                     UI components
config/
  service-account.json          (gitignored) Created by Setup page
  projects/*.json               (gitignored) Created when you add a project
  browser-profiles/<id>/        (gitignored) Playwright session for each project
logs/*.jsonl                    Runtime logs
data/*.processed.json           "Already published" ledger per project
```

## Troubleshooting

**"Extraction failed: No Surfer login session"** — You haven't completed the Surfer login for this project yet. Click **Log in to Surfer** on the project card.

**Surfer extraction returns empty / weird HTML** — Surfer's DOM may have changed. Open the audit URL in a regular browser to confirm the content is visible. Check logs for the specific failure mode. The extractor tries ProseMirror, contenteditable, iframes — if Surfer restructures their editor we may need to adjust selectors in `lib/extract.ts`.

**Google Sheet shows "Link" in the Doc column instead of opening** — means the cell has the word "Link" as display text with no URL attached. Check that cell in the sheet — the URL should be embedded as a hyperlink (`Ctrl+K` → paste URL) or entered as a plain URL.

**Published post appears but status isn't "Content Live" in sheet** — Service account needs Editor permission on the sheet (not Viewer). Also shown as an amber warning triangle on the Published tab row.

**Want to reprocess everything** — Click **Reset history** on the Published tab. WordPress posts stay; only the local "already published" ledger clears.

## Safety notes

- All credentials stay on your Mac — `config/` is gitignored
- Writeback to the Status column only happens after WP returns 201
- Browser profiles are per-project, never shared across projects
- The dashboard is localhost-only — don't expose it to the internet without adding auth (the edit form returns secrets in plaintext for the UI)
