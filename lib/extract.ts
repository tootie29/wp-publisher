// lib/extract.ts
import { google } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import { getAuth } from './google';
import type { ExtractedContent } from './types';

const PROFILE_ROOT = path.join(process.cwd(), 'config', 'browser-profiles');

export function profileDir(projectId: string): string {
  return path.join(PROFILE_ROOT, projectId);
}

export function hasProfile(projectId: string): boolean {
  const dir = profileDir(projectId);
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
}

export function classifyLink(url: string): 'gdoc' | 'frase' | 'surfer' | 'unknown' {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h.includes('docs.google.com') || h.includes('drive.google.com')) return 'gdoc';
    if (h.includes('frase.io')) return 'frase';
    if (h.includes('surferseo.com') || h.includes('app.surferseo.com')) return 'surfer';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

export function extractDocId(url: string): string | null {
  const m1 = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m1) return m1[1];
  try {
    const u = new URL(url);
    const id = u.searchParams.get('id');
    if (id) return id;
  } catch {}
  return null;
}

// --- Google Docs API extraction ---
interface DocsTextRun { textRun?: { content?: string; textStyle?: Record<string, unknown> } }
interface DocsParagraph {
  elements?: DocsTextRun[];
  paragraphStyle?: { namedStyleType?: string };
  bullet?: { listId?: string; nestingLevel?: number };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderParagraph(p: DocsParagraph): string {
  const style = p.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
  let text = '';
  for (const el of p.elements || []) {
    const run = el.textRun;
    if (!run?.content) continue;
    let t = run.content.replace(/\n$/, '');
    t = escapeHtml(t);
    const ts = run.textStyle || {};
    if ((ts as any).bold) t = `<strong>${t}</strong>`;
    if ((ts as any).italic) t = `<em>${t}</em>`;
    if ((ts as any).underline && !(ts as any).link) t = `<u>${t}</u>`;
    if ((ts as any).link?.url) {
      const href = escapeHtml((ts as any).link.url);
      t = `<a href="${href}">${t}</a>`;
    }
    text += t;
  }
  if (!text.trim()) return '';
  switch (style) {
    case 'TITLE':
    case 'HEADING_1': return `<h1>${text}</h1>`;
    case 'HEADING_2': return `<h2>${text}</h2>`;
    case 'HEADING_3': return `<h3>${text}</h3>`;
    case 'HEADING_4': return `<h4>${text}</h4>`;
    case 'HEADING_5': return `<h5>${text}</h5>`;
    case 'HEADING_6': return `<h6>${text}</h6>`;
    default: return p.bullet ? `<li>${text}</li>` : `<p>${text}</p>`;
  }
}

function wrapLists(html: string): string {
  const lines = html.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const isLi = line.startsWith('<li>');
    if (isLi && !inList) { out.push('<ul>'); inList = true; }
    if (!isLi && inList) { out.push('</ul>'); inList = false; }
    out.push(line);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export async function extractFromGoogleDoc(url: string): Promise<ExtractedContent> {
  const id = extractDocId(url);
  if (!id) throw new Error('Could not parse Google Doc ID from URL');
  const auth = getAuth();
  const docs = google.docs({ version: 'v1', auth });
  const res = await docs.documents.get({ documentId: id });
  const doc = res.data;
  const title = doc.title || 'Untitled';
  const parts: string[] = [];
  let firstHeading: string | null = null;
  for (const el of doc.body?.content || []) {
    const p = (el as { paragraph?: DocsParagraph }).paragraph;
    if (!p) continue;
    const rendered = renderParagraph(p);
    if (!rendered) continue;
    if (!firstHeading && rendered.startsWith('<h1>')) {
      firstHeading = rendered.replace(/^<h1>|<\/h1>$/g, '').replace(/<[^>]+>/g, '').trim();
    }
    parts.push(rendered);
  }
  return {
    title: firstHeading || title,
    htmlBody: wrapLists(parts.join('\n')),
    sourceType: 'gdoc',
  };
}

/* -------------------- Browser-based (Surfer / Frase) -------------------- */

async function launchPersistentContext(projectId: string, headless: boolean) {
  const { chromium } = await import('playwright');
  const dir = profileDir(projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return chromium.launchPersistentContext(dir, {
    headless,
    viewport: { width: 1400, height: 900 },
  });
}

// Check whether the saved profile has a valid Surfer session.
// We open the Surfer dashboard and look for signed-in indicators
// (absence of /login redirect + presence of workspace UI).
export async function checkSurferSession(projectId: string): Promise<{
  loggedIn: boolean;
  detail: string;
}> {
  if (!hasProfile(projectId)) {
    return { loggedIn: false, detail: 'No browser profile — click "Log in to Surfer" to create one.' };
  }
  let ctx;
  try {
    ctx = await launchPersistentContext(projectId, true);
    const page = await ctx.newPage();
    await page.goto('https://app.surferseo.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    const url = page.url();
    if (url.includes('/login') || url.includes('/sign-in') || url.includes('/signin')) {
      return { loggedIn: false, detail: 'Redirected to login — session expired.' };
    }
    // Probe for anything that would only exist in an authenticated dashboard
    const hasAppUi = await page.evaluate(() => {
      const text = document.body.innerText || '';
      return (
        text.includes('Workspace') ||
        text.includes('Content Editor') ||
        text.includes('Audit') ||
        !!document.querySelector('[data-testid*="workspace"]') ||
        !!document.querySelector('nav')
      );
    });
    return hasAppUi
      ? { loggedIn: true, detail: 'Authenticated.' }
      : { loggedIn: false, detail: 'Could not detect signed-in UI.' };
  } catch (e) {
    return { loggedIn: false, detail: (e as Error).message };
  } finally {
    if (ctx) await ctx.close();
  }
}

// Opens a visible Chromium window on Surfer's login page for the user to
// authenticate manually. Resolves immediately after launching; the window
// stays open and cookies persist to the profile dir when the user closes it.
export async function openSurferLogin(projectId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const ctx = await launchPersistentContext(projectId, false);
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto('https://app.surferseo.com/login', { waitUntil: 'domcontentloaded' });
    // Don't await ctx.close() — let the user drive the window.
    // When they close it manually, cookies are flushed to disk.
    // Register a noop close listener so the context isn't garbage-collected early.
    ctx.on('close', () => {
      // eslint-disable-next-line no-console
      console.log(`[${projectId}] Surfer login window closed`);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function extractFromSurfer(
  projectId: string,
  url: string
): Promise<ExtractedContent> {
  if (!hasProfile(projectId)) {
    throw new Error(
      'No Surfer login session for this project. Click "Log in to Surfer" on the project card and sign in first.'
    );
  }
  const ctx = await launchPersistentContext(projectId, true);
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Surfer sometimes bounces you to login if session is stale
    await page.waitForTimeout(3000);
    if (/\/(login|sign-?in)/i.test(page.url())) {
      throw new Error(
        'Surfer redirected to login — session expired. Click "Log in to Surfer" again.'
      );
    }

    // Wait for the editor to render. Surfer's Content Editor lives in an iframe
    // in some views; the Audit view shows article content inline.
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    // Try the inline editor first (audit/content pages share similar DOM)
    const result = await page.evaluate(() => {
      // Walk through likely containers; pick the one with the most text
      const candidates = [
        // Surfer's ProseMirror editor
        '.ProseMirror',
        '[contenteditable="true"]',
        // Audit/outline panels
        '[data-testid*="editor"]',
        '[data-testid*="content"]',
        'main [role="document"]',
        'article',
      ];

      type Pick = { el: Element; len: number };
      let best: Pick | null = null;
      for (const sel of candidates) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          const len = (el as HTMLElement).innerText?.trim().length || 0;
          const current: Pick | null = best;
          if (len > (current?.len || 0)) best = { el, len };
        }
      }

      const titleEl = document.querySelector('h1');
      const title =
        titleEl?.textContent?.trim() ||
        document.title.split(/[–|-]/)[0].trim() ||
        'Untitled';

      const picked: Pick | null = best;
      return {
        title,
        html: picked ? (picked.el as HTMLElement).innerHTML : '',
        found: !!picked,
        candidateCount: picked?.len || 0,
      };
    });

    // If we're in the Audit view, try clicking into "Content Editor" if one exists
    if (!result.found || result.candidateCount < 200) {
      // Look for iframes — Surfer sometimes embeds the editor in one
      const frames = page.frames();
      for (const f of frames) {
        if (f === page.mainFrame()) continue;
        const frameResult = await f.evaluate(() => {
          const pm = document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
          return pm ? (pm as HTMLElement).innerHTML : '';
        }).catch(() => '');
        if (frameResult && frameResult.length > (result.html?.length || 0)) {
          result.html = frameResult;
          result.found = true;
        }
      }
    }

    if (!result.found || !result.html) {
      throw new Error(
        'Could not find article content on this Surfer page. It might be a page type the extractor doesn\'t recognize (audit vs. editor), or the DOM has changed.'
      );
    }

    return {
      title: result.title,
      htmlBody: result.html,
      sourceType: 'surfer',
    };
  } finally {
    await ctx.close();
  }
}

// New cookie-based extractor used when the user has connected via the
// browser extension. Headless, no profile dir — works on any host.
async function extractWithConnectorCookies(
  projectId: string,
  url: string,
  source: 'surfer' | 'frase',
  runnerEmail: string
): Promise<ExtractedContent> {
  // Lazy-import so this module doesn't pull connector storage into client bundles.
  const { loadCookies } = await import('./connector');
  const { userKey } = await import('./users');
  const record = loadCookies(userKey(runnerEmail), projectId, source);
  if (!record) {
    throw new Error(
      `No saved ${source} cookies for this project. Open the project page and click the "WP Publisher Connector" extension to connect.`
    );
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    // Match a real Chrome UA so SaaS bot-detection (Frase, etc.) doesn't
    // immediately throw the session out.
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  });

  // Map cookie sameSite values from the extension format to Playwright's.
  const playwrightCookies = record.cookies.map((c) => {
    const sameSiteMap: Record<string, 'Lax' | 'Strict' | 'None'> = {
      lax: 'Lax',
      strict: 'Strict',
      no_restriction: 'None',
      unspecified: 'Lax',
    };
    return {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      sameSite: sameSiteMap[c.sameSite || 'lax'] || 'Lax',
      expires: c.expirationDate || undefined,
    };
  });
  await context.addCookies(playwrightCookies as never);

  // Populate localStorage / sessionStorage before any page script runs.
  // Frase / any Auth0-backed SPA stashes the JWT here, not in cookies.
  const lsEntries = record.localStorage || {};
  const ssEntries = record.sessionStorage || {};
  if (Object.keys(lsEntries).length || Object.keys(ssEntries).length) {
    await context.addInitScript(
      ([ls, ss]: [Record<string, string>, Record<string, string>]) => {
        try {
          for (const [k, v] of Object.entries(ls || {})) {
            window.localStorage.setItem(k, v);
          }
        } catch {}
        try {
          for (const [k, v] of Object.entries(ss || {})) {
            window.sessionStorage.setItem(k, v);
          }
        } catch {}
      },
      [lsEntries, ssEntries] as [Record<string, string>, Record<string, string>]
    );
  }

  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);

    if (/\/(login|sign-?in|sign_in)/i.test(page.url())) {
      throw new Error(
        `${source === 'surfer' ? 'Surfer' : 'Frase'} redirected to login — your saved session expired. Click "Connect ${source === 'surfer' ? 'Surfer' : 'Frase'}" in the extension again to refresh.`
      );
    }

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const result = await page.evaluate(() => {
      const candidates = [
        '.ProseMirror',
        '[contenteditable="true"]',
        '[data-testid*="editor"]',
        '[data-testid*="content"]',
        'main [role="document"]',
        'article',
      ];
      type Pick = { el: Element; len: number };
      let best: Pick | null = null;
      for (const sel of candidates) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          const len = (el as HTMLElement).innerText?.trim().length || 0;
          const current: Pick | null = best;
          if (len > (current?.len || 0)) best = { el, len };
        }
      }
      const titleEl = document.querySelector('h1');
      const title =
        titleEl?.textContent?.trim() ||
        document.title.split(/[–|-]/)[0].trim() ||
        'Untitled';
      const picked: Pick | null = best;
      return {
        title,
        html: picked ? (picked.el as HTMLElement).innerHTML : '',
        found: !!picked,
        len: picked?.len || 0,
      };
    });

    // Iframe fallback (Surfer sometimes embeds the editor in an iframe).
    let html = result.html;
    if (!result.found || result.len < 200) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const frameHtml = await f
          .evaluate(() => {
            const pm =
              document.querySelector('.ProseMirror') ||
              document.querySelector('[contenteditable="true"]');
            return pm ? (pm as HTMLElement).innerHTML : '';
          })
          .catch(() => '');
        if (frameHtml && frameHtml.length > (html?.length || 0)) html = frameHtml;
      }
    }

    if (!html) {
      throw new Error(
        `Could not find article content on this ${source} page. The page type may be unsupported, or the DOM has changed.`
      );
    }

    return { title: result.title, htmlBody: html, sourceType: source };
  } finally {
    await context.close();
    await browser.close();
  }
}

export async function extractFromSurferViaConnector(
  projectId: string,
  url: string,
  runnerEmail: string
) {
  return extractWithConnectorCookies(projectId, url, 'surfer', runnerEmail);
}

export async function extractFromFraseViaConnector(
  projectId: string,
  url: string,
  runnerEmail: string
) {
  return extractWithConnectorCookies(projectId, url, 'frase', runnerEmail);
}

// Newer path — outsource the actual fetch to the user's authenticated browser
// via the WP Publisher Connector extension. Used when server-side replay
// (cookies + localStorage in headless Playwright) gets bot-detected.
async function extractViaExtensionFetch(
  url: string,
  source: 'surfer' | 'frase',
  runnerEmail: string
): Promise<ExtractedContent> {
  const { enqueueFetch } = await import('./fetch-queue');
  const { userKey } = await import('./users');
  const result = await enqueueFetch(url, source, userKey(runnerEmail));
  const html = typeof result?.html === 'string' ? result.html : '';
  const extTitle = typeof result?.title === 'string' ? result.title : '';

  if (!html) {
    throw new Error('Extension returned no HTML for this URL');
  }

  let title = extTitle.trim();
  if (!title) {
    const titleMatch = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').trim();
    title =
      (titleMatch && stripTags(titleMatch[1])) ||
      (titleTag && stripTags(titleTag[1]).split(/[–|-]/)[0].trim()) ||
      '';
  }

  return { title, htmlBody: html, sourceType: source };
}

export async function extractContent(
  projectId: string,
  url: string,
  runnerEmail: string
): Promise<ExtractedContent> {
  const kind = classifyLink(url);
  if (kind === 'gdoc') return extractFromGoogleDoc(url);

  if (kind === 'surfer') {
    // Prefer the new connector-based path (headless, deployable). Fall back to
    // the legacy headful Playwright login if a per-project profile exists.
    const { loadCookies } = await import('./connector');
    const { userKey } = await import('./users');
    if (loadCookies(userKey(runnerEmail), projectId, 'surfer')) {
      return extractFromSurferViaConnector(projectId, url, runnerEmail);
    }
    if (hasProfile(projectId)) return extractFromSurfer(projectId, url);
    throw new Error(
      'No Surfer connection for this user. Install the WP Publisher Connector extension and click "Connect Surfer" on this project page.'
    );
  }

  if (kind === 'frase') {
    // Frase aggressively bot-detects headless Chromium even with full cookie
    // + localStorage replay, so always go through the extension fetch path.
    return extractViaExtensionFetch(url, 'frase', runnerEmail);
  }

  throw new Error(`Don't know how to extract from ${url}`);
}
