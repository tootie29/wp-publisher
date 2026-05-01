# WP Publisher Connector — Chrome Extension

A small extension that lets the WP Publisher dashboard read your Surfer SEO and Frase content using the login you already have in this Chrome profile. **No passwords are stored on the server.** The extension only forwards session cookies for `surferseo.com` and `frase.io` to your own dashboard, encrypted at rest with a key only your server knows.

## Install (one minute)

1. Open `chrome://extensions` in Chrome.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/` folder from this repo.
5. Pin the puzzle-piece icon and pin "WP Publisher Connector" so it's always visible.

## Use it

1. Sign in to the dashboard at `http://localhost:3030` (or your deployed URL — change it in the extension's popup → "App URL" if needed).
2. Sign in to **Surfer SEO** and/or **Frase** in the same Chrome profile (just like you normally would).
3. Open a project page in the dashboard: `…/wp-publisher/{your-project-id}`.
4. Click the extension icon → **Connect Surfer** and/or **Connect Frase**.
5. The popup will show "Connected" — that project can now extract Surfer/Frase content on the server.

## What it does

- Reads the cookies your browser already has for `surferseo.com` and `frase.io`.
- POSTs them to `{app-url}/api/projects/{id}/connector`, authenticated with your dashboard session.
- Nothing else.

## What it does not do

- It does **not** read any other website. Permissions are scoped to two domains, enforced by Chrome.
- It does **not** see your password. It only borrows session cookies that already exist in your browser.
- It does **not** run in the background. It does work only when you click it.
- It does **not** send data to any third party — only to your own dashboard URL.

## Refreshing

Surfer/Frase session cookies expire eventually (usually weeks). When extraction starts failing, just sign back into Surfer/Frase normally and click **Connect …** again. The new cookies replace the old ones.

## Removing

Right-click the extension icon → **Remove from Chrome**. Done. Server-side stored cookies for that user/project remain until cleared from the dashboard's "Disconnect" button.

## Code review

Everything the extension does is in three small files:

- `manifest.json` — declares the host permissions (the only domains the extension can touch).
- `popup.html` — the UI you see when you click the icon.
- `popup.js` — the logic. ~150 lines. Plain JavaScript, no dependencies.

Read it before installing if you want to verify there are no surprises.
