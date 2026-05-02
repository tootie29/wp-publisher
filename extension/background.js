// extension/background.js
// Service worker. Handles fetch-source messages from the dashboard's content
// script. Frase / Surfer are SPAs — a raw fetch returns the empty app shell.
// We open the URL in a hidden background tab, wait for the SPA to render,
// scrape the article DOM, then close the tab.

const RENDER_TIMEOUT_MS = 25000;  // poll for content up to this long
const POLL_INTERVAL_MS = 1000;    // how often to check the tab for content
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

    // Poll the tab until article content shows up (or we hit the timeout).
    // Faster on simple pages, gives slow SPAs (Frase preview view) time to
    // fetch the document over the network.
    const ready = await waitForContent(tab.id, RENDER_TIMEOUT_MS);
    if (!ready) {
      return {
        error: `Could not detect article content on the ${source} page after ${RENDER_TIMEOUT_MS / 1000}s. URL: ${finalUrl}`,
      };
    }

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

// Poll a tab until any of our article selectors has substantive content.
// Cheap to run repeatedly — the executeScript call is fast.
async function waitForContent(tabId, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => {
          const selectors = [
            '.ProseMirror',
            '.tiptap.ProseMirror',
            '[role="textbox"][contenteditable="true"]',
            '[contenteditable="true"]',
            '[data-testid="editor-content"]',
            '[data-testid="document-content"]',
            '[data-testid*="preview"]',
            '.preview',
            '.document-preview',
            '.preview-content',
            'main article',
            'article',
          ];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
              const text = (el.innerText || '').trim();
              if (text.length >= 200) return true;
            }
          }
          return false;
        },
      });
      if (results.some((r) => r?.result === true)) return true;
    } catch {
      // Tab may not be ready yet for scripting — keep polling.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
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
    // Frase preview / read-only views
    '[data-testid*="preview"]',
    '.document-preview',
    '.preview-content',
    '.preview',
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

  // Title: ONLY trust the article's own H1, or a dedicated title input on the
  // editor page. Never use document.title — Frase / Surfer set that to their
  // brand name, which would silently become the WP post title.
  let title = '';

  // 1. H1 inside the cleaned article body
  const h1 = clone.querySelector('h1');
  if (h1?.textContent) title = h1.textContent.trim();

  // 2. H1 anywhere on the live page that is NOT inside known UI chrome
  if (!title) {
    const allH1s = Array.from(document.querySelectorAll('h1'));
    for (const el of allH1s) {
      if (el.closest('header,nav,aside,footer,[role="toolbar"],[data-testid*="header"],[data-testid*="sidebar"]')) continue;
      const t = (el.textContent || '').trim();
      if (t.length >= 3 && t.length <= 200) {
        title = t;
        break;
      }
    }
  }

  // 3. Frase / Surfer "Document title" input
  if (!title) {
    const inputs = Array.from(
      document.querySelectorAll(
        'input[placeholder*="title" i], input[aria-label*="title" i], input[name*="title" i]'
      )
    );
    for (const el of inputs) {
      const v = (el.value || '').trim();
      if (v.length >= 3 && v.length <= 200) {
        title = v;
        break;
      }
    }
  }

  // No title found → leave empty; the worker will fall back to the sheet's
  // Primary Keyword column.
  return { title, html, length: text.length };
}
