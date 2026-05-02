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
// Picks the most specific article-body element and strips UI cruft from it.
function scrapeArticle() {
  // Most specific → least specific. We take the FIRST viable hit per selector
  // and stop, so picking up the editor body is preferred over the whole page.
  const selectors = [
    '.ProseMirror',
    '.tiptap.ProseMirror',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
    '[data-testid="editor-content"]',
    '[data-testid="document-content"]',
    'main article',
    'article',
  ];

  let chosen = null;
  for (const sel of selectors) {
    const els = Array.from(document.querySelectorAll(sel));
    for (const el of els) {
      const text = (el.innerText || '').trim();
      if (text.length < 100) continue;
      chosen = el;
      break;
    }
    if (chosen) break;
  }
  if (!chosen) return { title: 'Untitled', html: '', length: 0 };

  // Clone so we can clean it without touching the live page.
  const clone = chosen.cloneNode(true);

  // Strip UI chrome that creeps in around / inside the editor.
  const cruftSelectors = [
    'button',
    'svg',
    'script',
    'style',
    'noscript',
    'iframe',
    'input',
    'textarea',
    'select',
    '[role="toolbar"]',
    '[role="menu"]',
    '[role="menuitem"]',
    '[role="tablist"]',
    '[role="tab"]',
    '[aria-haspopup]',
    '[contenteditable="false"]',
    '[data-testid*="toolbar"]',
    '[data-testid*="menu"]',
    '[data-testid*="sidebar"]',
    '[data-testid*="header"]',
    '[data-testid*="footer"]',
    '.toolbar',
    '.menu',
    '.sidebar',
    'header',
    'footer',
    'nav',
    'aside',
  ];
  clone
    .querySelectorAll(cruftSelectors.join(','))
    .forEach((n) => n.remove());

  // Strip Tailwind-style class spam — the kept tags are still useful, but the
  // 80-class strings make the WP draft unreadable.
  clone.querySelectorAll('*').forEach((n) => {
    if (n.removeAttribute) {
      n.removeAttribute('class');
      n.removeAttribute('style');
      n.removeAttribute('data-state');
      n.removeAttribute('data-testid');
      n.removeAttribute('data-radix-collection-item');
      n.removeAttribute('aria-label');
      n.removeAttribute('aria-expanded');
      n.removeAttribute('aria-controls');
      n.removeAttribute('aria-haspopup');
      n.removeAttribute('aria-hidden');
      n.removeAttribute('tabindex');
      n.removeAttribute('contenteditable');
      n.removeAttribute('translate');
    }
  });

  const html = clone.innerHTML.trim();
  const text = (clone.textContent || '').trim();

  // Title: prefer the article's own H1, fall back to document title.
  const h1 = clone.querySelector('h1') || document.querySelector('h1');
  const title =
    (h1?.textContent || '').trim() ||
    (document.title || '').split(/[–|-]/)[0].trim() ||
    'Untitled';

  return { title, html, length: text.length };
}
