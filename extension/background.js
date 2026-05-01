// extension/background.js
// Service worker. Handles fetch-source messages from the dashboard's content
// script. Frase / Surfer are SPAs — a raw fetch returns the empty app shell.
// We open the URL in a hidden background tab, wait for the SPA to render,
// scrape the article DOM, then close the tab.

const RENDER_DELAY_MS = 8000;     // time for the SPA to fetch + render
const NAV_TIMEOUT_MS = 30000;     // max wait for the tab to finish loading

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'fetch-source') return false;
  handleFetchSource(msg).then(sendResponse).catch((e) => {
    sendResponse({ error: e?.message || String(e) });
  });
  return true; // keep the message channel open for the async response
});

async function handleFetchSource(msg) {
  const url = msg.url;
  const source = msg.source || 'source';

  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
  } catch (e) {
    return { error: `Could not open tab: ${e?.message || e}` };
  }

  try {
    await waitForTabComplete(tab.id, NAV_TIMEOUT_MS);

    const finalUrl = (await chrome.tabs.get(tab.id)).url || '';
    if (/\/(login|sign[-_]?in)/i.test(finalUrl)) {
      return {
        error: `${source} redirected to login. Open ${source} in this Chrome profile and sign in, then try again.`,
      };
    }

    // Give the SPA time to fetch + render the article.
    await sleep(RENDER_DELAY_MS);

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeArticle,
    });
    const r = results[0]?.result;

    // For some SPAs the article lives inside an iframe — try those too.
    let html = r?.html || '';
    let title = r?.title || '';

    if (!html || html.length < 200) {
      try {
        const frameResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: scrapeArticle,
        });
        for (const fr of frameResults) {
          const fhtml = fr?.result?.html || '';
          if (fhtml && fhtml.length > html.length) {
            html = fhtml;
            title = title || fr.result.title;
          }
        }
      } catch {
        /* ignore frame scrape errors */
      }
    }

    if (!html) {
      return {
        error: `Could not find article content on the ${source} page. The page type may not be supported, or the SPA didn't finish rendering in ${RENDER_DELAY_MS / 1000}s.`,
      };
    }

    return { html, title };
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* tab already gone */ }
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(handler);
      err ? reject(err) : resolve();
    };
    const handler = (id, info) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    chrome.tabs.onUpdated.addListener(handler);
    chrome.tabs.get(tabId, (tab) => {
      if (tab && tab.status === 'complete') finish();
    });
    setTimeout(() => finish(new Error(`Tab navigation timeout after ${timeoutMs}ms`)), timeoutMs);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Runs in the target tab's page context.
function scrapeArticle() {
  const candidates = [
    '.ProseMirror',
    '[contenteditable="true"]',
    '[data-testid*="editor"]',
    '[data-testid*="content"]',
    'main [role="document"]',
    'article',
    'main',
  ];
  let best = null;
  for (const sel of candidates) {
    document.querySelectorAll(sel).forEach((el) => {
      const len = (el.innerText || '').trim().length;
      if (len > (best?.len || 0)) best = { el, len };
    });
  }
  const titleEl = document.querySelector('h1');
  const title =
    titleEl?.textContent?.trim() ||
    (document.title || '').split(/[–|-]/)[0].trim() ||
    'Untitled';
  return {
    title,
    html: best ? best.el.innerHTML : '',
    length: best ? best.len : 0,
  };
}
