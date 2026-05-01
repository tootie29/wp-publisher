// lib/blocks.ts
// Convert raw HTML (from Google Docs / Surfer / Frase) into Gutenberg
// block-delimited markup so posts open as real blocks instead of one big
// "Classic" block.
//
// Supported blocks: heading, paragraph, list, quote, code, separator, image,
// table, embed (raw HTML fallback for anything we don't recognize).
//
// Images are NOT uploaded to the WP media library here — the original src is
// preserved verbatim. If the source URL expires (e.g. Google Docs inline
// images), images will break. Media upload can be added separately.

import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';

export function htmlToBlocks(html: string): string {
  if (!html || !html.trim()) return '';

  // Wrap in a root element so cheerio can iterate top-level children.
  const $ = cheerio.load(`<div id="__root">${html}</div>`, { decodeEntities: false });
  const root = $('#__root').first();

  flattenInlineWrappers($, root);

  const blocks: string[] = [];
  root.children().each((_, el) => {
    const out = serializeNode($, $(el));
    if (out) blocks.push(out);
  });

  return blocks.filter(Boolean).join('\n\n');
}

/* ---------------- helpers ---------------- */

// Many sources wrap content in <div>/<section>/<article> shells. Unwrap them
// so we serialize the actual block-level children.
function flattenInlineWrappers($: CheerioAPI, root: Cheerio<Element>): void {
  // Walk a few times — wrappers can be nested.
  for (let i = 0; i < 5; i++) {
    const wrappers = root.find('> div, > section, > article').toArray();
    if (wrappers.length === 0) break;
    for (const w of wrappers) {
      $(w).replaceWith($(w).contents());
    }
  }
}

function serializeNode($: CheerioAPI, $el: Cheerio<Element>): string {
  const tag = ($el.prop('tagName') || '').toLowerCase();
  if (!tag) return '';

  switch (tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return headingBlock($el, parseInt(tag.slice(1), 10));

    case 'p': {
      const text = innerHtml($, $el).trim();
      if (!text) return '';
      // Standalone image inside <p> → emit as image block.
      const onlyImg = $el.children().length === 1 && $el.children().first().is('img') && !textOf($el).trim();
      if (onlyImg) {
        const img = $el.children().first();
        return imageBlock(img.attr('src') || '', img.attr('alt') || '');
      }
      return wrap('paragraph', `<p>${text}</p>`);
    }

    case 'ul':
    case 'ol':
      return listBlock($, $el, tag === 'ol');

    case 'blockquote': {
      const inner = innerHtml($, $el).trim();
      if (!inner) return '';
      const wrapped = /<p[\s>]/i.test(inner) ? inner : `<p>${inner}</p>`;
      return wrap('quote', `<blockquote class="wp-block-quote">${wrapped}</blockquote>`);
    }

    case 'pre': {
      const code = $el.find('code').first();
      const text = (code.length ? code.text() : $el.text()) || '';
      const escaped = escapeHtml(text);
      return wrap('code', `<pre class="wp-block-code"><code>${escaped}</code></pre>`);
    }

    case 'hr':
      return '<!-- wp:separator --><hr class="wp-block-separator has-alpha-channel-opacity"/><!-- /wp:separator -->';

    case 'img':
      return imageBlock($el.attr('src') || '', $el.attr('alt') || '');

    case 'figure': {
      const img = $el.find('img').first();
      if (img.length) {
        const cap = $el.find('figcaption').first();
        return imageBlock(img.attr('src') || '', img.attr('alt') || '', cap.text() || '');
      }
      return wrap('html', $.html($el));
    }

    case 'table':
      return wrap('table', `<figure class="wp-block-table">${$.html($el)}</figure>`);

    default: {
      // Unknown block-level → preserve as raw HTML so nothing is lost.
      const html = $.html($el).trim();
      if (!html) return '';
      return wrap('html', html);
    }
  }
}

function headingBlock($el: Cheerio<Element>, level: number): string {
  const safeLevel = Math.min(Math.max(level, 1), 6);
  const inner = $el.html()?.trim() || '';
  if (!inner) return '';
  const attrs = safeLevel === 2 ? '' : ` {"level":${safeLevel}}`;
  return `<!-- wp:heading${attrs} --><h${safeLevel} class="wp-block-heading">${inner}</h${safeLevel}><!-- /wp:heading -->`;
}

function listBlock($: CheerioAPI, $el: Cheerio<Element>, ordered: boolean): string {
  const items: string[] = [];
  $el.children('li').each((_, li) => {
    const $li = $(li);
    const inner = innerHtml($, $li).trim();
    if (!inner) return;
    items.push(`<!-- wp:list-item --><li>${inner}</li><!-- /wp:list-item -->`);
  });
  if (items.length === 0) return '';
  const tag = ordered ? 'ol' : 'ul';
  const attrs = ordered ? ' {"ordered":true}' : '';
  return `<!-- wp:list${attrs} --><${tag} class="wp-block-list">${items.join('')}</${tag}><!-- /wp:list -->`;
}

function imageBlock(src: string, alt: string, caption?: string): string {
  if (!src) return '';
  const altAttr = alt ? ` alt="${escapeAttr(alt)}"` : ' alt=""';
  const captionHtml = caption?.trim()
    ? `<figcaption class="wp-element-caption">${escapeHtml(caption.trim())}</figcaption>`
    : '';
  return `<!-- wp:image --><figure class="wp-block-image"><img src="${escapeAttr(src)}"${altAttr}/>${captionHtml}</figure><!-- /wp:image -->`;
}

function wrap(name: string, inner: string): string {
  return `<!-- wp:${name} -->${inner}<!-- /wp:${name} -->`;
}

function innerHtml($: CheerioAPI, $el: Cheerio<Element>): string {
  return $el.html() || '';
}

function textOf($el: Cheerio<Element>): string {
  return $el.text() || '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
