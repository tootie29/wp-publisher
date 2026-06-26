// lib/media.ts
// Downloads images referenced in extracted content, uploads them to the
// project's WordPress media library, and rewrites the <img src> to the
// WP-hosted copy. Also normalizes images that the source (notably Frase)
// embedded inside a heading or alongside text — those would otherwise be
// folded into a text block — by lifting them out into standalone image blocks.
//
// Runs in the worker (where the project's WP credentials are available),
// after extraction and before htmlToBlocks().
import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';
import { uploadMedia } from './wordpress';
import { log } from './logger';
import type { ProjectConfig } from './types';

const FETCH_TIMEOUT_MS = 20_000;

function safeHost(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

function filenameFromUrl(url: string, contentType: string): string {
  let name = 'image';
  try {
    const u = new URL(url);
    const seg = u.pathname.split('/').filter(Boolean).pop() || '';
    name = decodeURIComponent(seg) || 'image';
  } catch {
    // data: URLs and the like — keep the default.
  }
  name = name.split('?')[0];
  name = name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'image';
  const ext = (contentType.split('/')[1] || '')
    .toLowerCase()
    .replace('jpeg', 'jpg')
    .replace('svg+xml', 'svg')
    .replace(/[^a-z0-9]/g, '');
  if (!/\.[a-zA-Z0-9]{2,5}$/.test(name) && ext) name = `${name}.${ext}`;
  return name.slice(0, 120);
}

interface FetchedImage {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
}

// Fallback: ask the extension to fetch the image from the user's authenticated
// browser session (Surfer/Frase serve some images only to the logged-in tab).
async function fetchImageViaExtension(
  src: string,
  source: 'surfer' | 'frase',
  runnerEmail: string
): Promise<FetchedImage | null> {
  const { enqueueImageFetch } = await import('./fetch-queue');
  const { userKey } = await import('./users');
  const res = await enqueueImageFetch(src, source, userKey(runnerEmail));
  if (!res?.dataBase64) return null;
  const bytes = new Uint8Array(Buffer.from(res.dataBase64, 'base64'));
  if (!bytes.length) return null;
  const contentType = res.contentType?.startsWith('image/') ? res.contentType : 'image/jpeg';
  return { bytes, contentType, filename: filenameFromUrl(src, contentType) };
}

async function fetchImageBytes(src: string): Promise<FetchedImage | null> {
  // Inline data URI — decode directly, no network call.
  if (src.startsWith('data:')) {
    const m = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) return null;
    const contentType = (m[1] || 'image/png').trim();
    if (!contentType.startsWith('image/')) return null;
    const isBase64 = !!m[2];
    const bytes = isBase64
      ? new Uint8Array(Buffer.from(m[3], 'base64'))
      : new Uint8Array(Buffer.from(decodeURIComponent(m[3]), 'utf8'));
    if (!bytes.length) return null;
    return { bytes, contentType, filename: filenameFromUrl('inline', contentType) };
  }

  if (!/^https?:\/\//i.test(src)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
    if (!contentType.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return null;
    return { bytes, contentType, filename: filenameFromUrl(src, contentType) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Lift <img>s out of headings and out of paragraphs/blocks that also carry
// text, turning each into a standalone <figure> so htmlToBlocks emits a real
// image block. A bare <p><img></p> (no text) is left alone — blocks.ts already
// handles that — and an existing <figure> is left untouched.
function liftImagesOut($: CheerioAPI, root: Cheerio<AnyNode>): void {
  root.find('img').each((_, el) => {
    const $img = $(el);

    // Find the top-level block this image currently lives in (direct child of root).
    let $block: Cheerio<AnyNode> = $img;
    while ($block.parent().length && !$block.parent().is(root)) {
      $block = $block.parent();
    }
    if (!$block.length || $block.is(root)) return; // already top-level

    const blockTag = ($block.prop('tagName') || '').toLowerCase();
    if (blockTag === 'figure') return; // proper image container already

    // Text content of the block excluding the image(s).
    const textOnly = $block.clone().find('img').remove().end().text().replace(/\s+/g, ' ').trim();
    const isHeading = /^h[1-6]$/.test(blockTag);
    const isStandaloneP = blockTag === 'p' && !textOnly;
    if (isStandaloneP) return; // blocks.ts handles <p><img></p>

    if (isHeading || textOnly) {
      const $fig = $('<figure></figure>').append($img.clone());
      $block.after($fig);
      $img.remove();
    }
  });
}

export interface ImageRewriteOpts {
  rowIndex?: number;
  // When the content came from Surfer/Frase, these enable the extension
  // fallback for images the server can't download directly.
  source?: 'surfer' | 'frase';
  runnerEmail?: string;
}

export async function uploadAndRewriteImages(
  project: ProjectConfig,
  html: string,
  opts: ImageRewriteOpts = {}
): Promise<string> {
  if (!html || !html.includes('<img')) return html;
  const { rowIndex, source, runnerEmail } = opts;

  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $('#__root').first();

  // 1. Structural fix first, so lifted images get uploaded in the same pass.
  liftImagesOut($, root);

  // 2. Upload each unique source once, then rewrite every <img> that used it.
  const wpHost = safeHost(project.wordpress.baseUrl);
  const cache = new Map<string, string | null>(); // original src -> WP url (null = failed)

  for (const el of root.find('img').toArray()) {
    const $img = $(el);
    const src = ($img.attr('src') || '').trim();
    if (!src) {
      $img.remove();
      continue;
    }
    // Already hosted on the target site — nothing to do.
    if (wpHost && safeHost(src) === wpHost) continue;

    if (!cache.has(src)) {
      // Try a direct server-side download first.
      let fetched = await fetchImageBytes(src);

      // Fall back to the extension for session-gated images (http(s) only —
      // data: URIs always decode directly).
      if (!fetched && source && runnerEmail && /^https?:\/\//i.test(src)) {
        try {
          fetched = await fetchImageViaExtension(src, source, runnerEmail);
          if (fetched) {
            log(project.id, 'info', 'Fetched image via extension fallback',
              { src: src.slice(0, 140) }, rowIndex);
          }
        } catch (e) {
          log(project.id, 'warn',
            `Extension image fallback failed: ${(e as Error).message}`,
            { src: src.slice(0, 140) }, rowIndex);
        }
      }

      if (!fetched) {
        cache.set(src, null);
        log(project.id, 'warn',
          `Could not fetch image — leaving the original URL in place: ${src.slice(0, 140)}`,
          {}, rowIndex);
      } else {
        try {
          const up = await uploadMedia(project, fetched.bytes, fetched.filename, fetched.contentType);
          cache.set(src, up.sourceUrl);
          log(project.id, 'info', 'Uploaded image to WordPress media library',
            { from: src.slice(0, 140), to: up.sourceUrl, mediaId: up.id }, rowIndex);
        } catch (e) {
          cache.set(src, null);
          log(project.id, 'warn',
            `Image upload failed — leaving the original URL in place: ${(e as Error).message}`,
            { src: src.slice(0, 140) }, rowIndex);
        }
      }
    }

    const newSrc = cache.get(src);
    if (newSrc) {
      $img.attr('src', newSrc);
      // Drop responsive attributes that still point at the original CDN.
      $img.removeAttr('srcset');
      $img.removeAttr('sizes');
    }
  }

  return root.html() || html;
}
