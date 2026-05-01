// extension/background.js
// Service worker that handles cross-origin fetches with the user's logged-in
// browser session. Triggered by messages from the dashboard's content script.
// We do NOT poll here — the content script does that, then asks us to fetch.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'fetch-source') return false;
  (async () => {
    try {
      const r = await fetch(msg.url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { 'User-Agent': navigator.userAgent },
      });
      if (/\/(login|sign[-_]?in)/i.test(r.url) || r.status === 401 || r.status === 403) {
        sendResponse({
          error: `${msg.source || 'source'} responded with login/redirect — sign in to ${msg.source} in this browser, then try again.`,
        });
        return;
      }
      const html = await r.text();
      sendResponse({ html });
    } catch (e) {
      sendResponse({ error: e?.message || String(e) });
    }
  })();
  return true; // keep the message channel open for the async response
});
