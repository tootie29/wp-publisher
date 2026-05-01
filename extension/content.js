// extension/content.js
// Runs in any open dashboard tab. Polls the app for fetch jobs, asks the
// extension's background service worker to fetch the source URL (so we can
// bypass CORS via host_permissions), then posts the HTML back.

const POLL_MS = 3000;
const APP_URL = location.origin;

async function pollOnce() {
  let res;
  try {
    res = await fetch(`${APP_URL}/api/extension/jobs`, {
      credentials: 'include',
      cache: 'no-store',
    });
  } catch {
    return;
  }
  if (res.status !== 200) return;

  let job;
  try {
    job = await res.json();
  } catch {
    return;
  }
  if (!job?.id || !job?.url) return;

  let html = '';
  let title = '';
  let error = '';
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'fetch-source',
      url: job.url,
      source: job.source,
    });
    if (result?.error) error = result.error;
    else if (typeof result?.html === 'string') {
      html = result.html;
      title = result.title || '';
    } else error = 'No response from background worker';
  } catch (e) {
    error = e?.message || String(e);
  }

  try {
    await fetch(`${APP_URL}/api/extension/jobs/${job.id}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, title, error: error || undefined }),
    });
  } catch {
    // Server-side timeout will eventually clean it up.
  }
}

setInterval(pollOnce, POLL_MS);
// And once on load so a freshly-opened dashboard picks up any pending job
// without waiting POLL_MS.
pollOnce();
