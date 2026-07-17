// lib/worker.ts
import { listProjects } from './projects';
import { fetchQueue, setRowStatus } from './sheets';
import { extractContent } from './extract';
import { createDraft, findPostByTitle, findPostByUrl, getLatestPostDate, postExists, resolveRoute, resolveTerms, supportsTerms, updatePost, updateYoastMeta, type PostTerms } from './wordpress';
import { htmlToBlocks } from './blocks';
import { uploadAndRewriteImages } from './media';
import { log } from './logger';
import { getProcessedRecord, hasProcessed, latestScheduledBlogDate, markProcessed, removeProcessed } from './state';
import { getLiveState, updateLiveState } from './live-state';
import type { ProjectConfig, QueueRow } from './types';

export async function processRow(project: ProjectConfig, row: QueueRow, runnerEmail: string) {
  const { rowIndex } = row;

  // Cheapest checks first — skip rows with no/invalid content link immediately,
  // before any DB or WordPress calls, so the worker never lingers on them and
  // moves straight to the next row.
  if (!row.contentLink) {
    log(project.id, 'warn', `Row ${rowIndex} missing content link, skipping.`, {}, rowIndex);
    return { skipped: true, reason: 'no-content-link' };
  }

  // Verify it's actually a URL. Sometimes cells contain text like "Link"
  // with the real URL hidden as a hyperlink — the sheets layer should have
  // surfaced that, but if the display value leaked through we bail out cleanly.
  let validUrl = false;
  try {
    const u = new URL(row.contentLink);
    validUrl = u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    validUrl = false;
  }
  if (!validUrl) {
    log(project.id, 'warn',
      `Row ${rowIndex}: content link is not a URL ("${row.contentLink}"). ` +
      `The cell probably has a hyperlink hidden behind display text — check column ${project.sheet.columns.contentLink} in the sheet.`,
      { link: row.contentLink }, rowIndex
    );
    return { skipped: true, reason: 'invalid-url' };
  }

  if (await hasProcessed(project.id, rowIndex)) {
    // Verify the WP post still exists. If it was deleted in WordPress (and
    // the row is back to "In-Progress" in the sheet), the user clearly wants
    // it republished — drop the stale history record so we reprocess.
    const prev = await getProcessedRecord(project.id, rowIndex);
    if (prev) {
      const stillExists = await postExists(project, prev.route, prev.wpId);
      if (stillExists) {
        log(project.id, 'info', `Row ${rowIndex} already processed, skipping.`, {}, rowIndex);
        return { skipped: true };
      }
      await removeProcessed(project.id, rowIndex);
      log(
        project.id,
        'warn',
        `Row ${rowIndex} was previously published as ${prev.route} ${prev.wpId} but that ${prev.route} no longer exists in WordPress. Republishing.`,
        { wpId: prev.wpId, route: prev.route },
        rowIndex
      );
    }
  }

  updateLiveState({
    running: true, projectId: project.id, rowIndex,
    phase: 'extracting',
    message: `Extracting "${row.primaryKeyword}" from content doc`,
  });

  log(project.id, 'info', `Extracting content from ${row.contentLink}`, {
    pageType: row.pageType,
    keyword: row.primaryKeyword,
  }, rowIndex);

  let extracted;
  try {
    extracted = await extractContent(project.id, row.contentLink, runnerEmail);
  } catch (e) {
    log(project.id, 'error', `Extraction failed: ${(e as Error).message}`, {
      link: row.contentLink,
    }, rowIndex);
    return { error: (e as Error).message };
  }

  const route = resolveRoute(project, row.pageType);
  // Title resolution:
  // 1. The sheet's Primary Keyword column wins — that's the title we want on
  //    the published post/page.
  // 2. Fall back to the article's own <h1> only when the Keyword cell is empty
  //    (and the extractor returned something usable, not a SaaS brand name).
  // 3. Last resort: 'Untitled'. We never trust the source's <title> tag
  //    (Frase / Surfer set that to their brand name).
  // Note: the <h1> is still stripped from the body by the extractor regardless,
  // so WordPress (which renders post_title as the page <h1>) never shows it twice.
  const extractedClean = (extracted.title || '').trim();
  const looksGeneric =
    !extractedClean ||
    extractedClean === 'Untitled' ||
    /^(frase|surfer|surfer seo|app\.frase\.io|app\.surferseo\.com)$/i.test(extractedClean);
  const title =
    (row.primaryKeyword || '').trim() ||
    (!looksGeneric ? extractedClean : '') ||
    'Untitled';

  // Always try to find an existing post first to avoid duplicates. Use the
  // explicit Target URL when provided; otherwise match by Primary Keyword
  // (the row's title). Only create a new draft if neither lookup hits.
  // The Content Type column is now informational only — every row is an
  // upsert.
  let found: Awaited<ReturnType<typeof findPostByUrl>> = null;
  if (row.targetUrl) {
    found = await findPostByUrl(project, row.targetUrl);
  }
  if (!found && row.primaryKeyword) {
    found = await findPostByTitle(project, row.primaryKeyword);
  }

  updateLiveState({
    running: true, projectId: project.id, rowIndex,
    phase: 'publishing',
    message: found
      ? `Updating existing ${found.type} in WordPress: "${title}"`
      : `Creating ${route} in WordPress: "${title}"`,
  });

  log(project.id, 'info',
    found
      ? `Matched existing ${found.type} ${found.id} — updating: ${found.link}`
      : `No existing match for "${title}" — creating new ${route}`,
    { route, sourceType: extracted.sourceType, mode: row.contentMode, wpId: found?.id ?? null, lookupTitle: row.primaryKeyword || null, targetUrl: row.targetUrl || null },
    rowIndex
  );

  // Pull images down to the WP media library and rewrite their src (also lifts
  // images out of headings/text into real image blocks). Best-effort per image:
  // any that can't be fetched/uploaded keep their original URL. For Surfer/Frase
  // sources, session-gated images fall back to fetching via the extension.
  const withMedia = await uploadAndRewriteImages(project, extracted.htmlBody, {
    rowIndex,
    source:
      extracted.sourceType === 'surfer' || extracted.sourceType === 'frase'
        ? extracted.sourceType
        : undefined,
    runnerEmail,
  });

  const gutenberg = htmlToBlocks(withMedia);

  // Blog spacing — only when creating a NEW blog (post route). Each blog must
  // land at least `blogIntervalDays` after the previous blog's slot. The
  // previous slot is the newest of: the WP site's publish/future posts, and the
  // slots we've already assigned to our own blog drafts (which aren't visible in
  // the WP query because they're still drafts). We record this blog's effective
  // slot too, so the chain keeps spacing even from a cold start / within a batch.
  // The date is stamped on the post; its status is left as publishStatus.
  let scheduledForIso: string | undefined;
  let createDateGmt: string | undefined;
  // Fall back to 7 days when the project doesn't specify a positive interval.
  const intervalDays =
    project.blogIntervalDays && project.blogIntervalDays > 0 ? project.blogIntervalDays : 7;
  if (!found && route === 'post') {
    const [wpLatest, ourLatest] = await Promise.all([
      getLatestPostDate(project),
      latestScheduledBlogDate(project.id),
    ]);
    const prevMs = Math.max(wpLatest?.getTime() ?? 0, ourLatest?.getTime() ?? 0);
    const now = Date.now();
    // First blog ever → publish now and set the baseline. Otherwise the next
    // slot is interval after the previous, but never earlier than now.
    const effectiveMs =
      prevMs === 0 ? now : Math.max(prevMs + intervalDays * 86_400_000, now);
    scheduledForIso = new Date(effectiveMs).toISOString();

    // Only stamp a WP date when we're pushing the post into the future (small
    // skew guard so "publish now" rows don't get a needless future date).
    if (effectiveMs > now + 60_000) {
      createDateGmt = new Date(effectiveMs).toISOString().slice(0, 19); // UTC, no ms/Z
      log(project.id, 'info',
        `Spacing blog post — previous blog slot ${new Date(prevMs).toISOString()}; ` +
        `scheduling this one for ${scheduledForIso} (>= ${intervalDays}d apart).`,
        { slot: scheduledForIso, intervalDays }, rowIndex);
    }
  }

  // Per-row categories/tags from the sheet. WordPress only accepts term ids, so
  // names are resolved (and created when new) first. Whether this route has
  // taxonomies at all is a per-site fact — core gives them to posts only, but
  // our mu-plugin registers them for pages too — so ask the site rather than
  // assume. Best-effort: unresolvable terms warn and are dropped rather than
  // failing a row whose content is otherwise fine.
  const effectiveRoute = found ? found.type : route;
  const terms: PostTerms = {};
  const hasSheetTerms = row.categories.length > 0 || row.tags.length > 0;
  const routeTakesTerms = hasSheetTerms ? await supportsTerms(project, effectiveRoute) : false;
  if (routeTakesTerms) {
    for (const taxonomy of ['categories', 'tags'] as const) {
      const names = row[taxonomy];
      if (!names.length) continue;
      const { ids, created, failed } = await resolveTerms(project, taxonomy, names);
      terms[taxonomy] = ids;
      if (created.length) {
        log(project.id, 'info', `Created new ${taxonomy} in WordPress: ${created.join(', ')}`, { created }, rowIndex);
      }
      for (const f of failed) {
        log(project.id, 'warn', `Could not resolve ${taxonomy} "${f.name}": ${f.error}. Skipping that term.`, { term: f.name }, rowIndex);
      }
    }
    log(project.id, 'info', 'Assigning taxonomy terms', {
      route: effectiveRoute,
      categories: row.categories,
      tags: row.tags,
      categoryIds: terms.categories ?? [],
      tagIds: terms.tags ?? [],
    }, rowIndex);
  } else if (hasSheetTerms) {
    log(project.id, 'warn',
      `Row ${rowIndex} has categories/tags but this site's ${effectiveRoute}s have no categories or tags registered, so they were ignored. ` +
      `Install/update the wp-publisher-yoast-rest mu-plugin to enable them on ${effectiveRoute}s.`,
      { categories: row.categories, tags: row.tags, route: effectiveRoute }, rowIndex
    );
  }

  let wp;
  try {
    wp = found
      ? await updatePost(project, found.type, found.id, gutenberg, title, terms)
      : await createDraft(project, route, title, gutenberg, createDateGmt, terms);
  } catch (e) {
    log(project.id, 'error',
      found
        ? `WP update failed: ${(e as Error).message}`
        : `WP publish failed: ${(e as Error).message}`,
      {}, rowIndex
    );
    return { error: (e as Error).message };
  }

  // Apply SEO meta to the post's Yoast fields:
  //   - SEO Title / Meta Description from the content doc's label lines
  //   - Focus keyphrase from the sheet's Primary Keyword column
  // Best-effort: the post is already published, so a meta failure (e.g. the
  // mu-plugin isn't installed) warns but doesn't fail the row.
  const focusKeyphrase = (row.primaryKeyword || '').trim();
  if (extracted.metaTitle || extracted.metaDescription || focusKeyphrase) {
    try {
      const applied = await updateYoastMeta(project, effectiveRoute, wp.id, {
        metaTitle: extracted.metaTitle,
        metaDescription: extracted.metaDescription,
        keyword: focusKeyphrase || undefined,
      });
      log(project.id, 'success', 'Set Yoast SEO meta from content doc', {
        wpId: wp.id,
        metaTitle: applied.metaTitle,
        metaDescription: applied.metaDescription,
        keyword: applied.keyword,
      }, rowIndex);
    } catch (e) {
      log(project.id, 'warn',
        `Published OK but failed to set Yoast SEO meta: ${(e as Error).message}. ` +
        `Make sure the wp-publisher-yoast-rest mu-plugin is installed on this site.`,
        { wpId: wp.id }, rowIndex
      );
    }
  }

  updateLiveState({
    running: true, projectId: project.id, rowIndex,
    phase: 'writeback',
    message: `Marking row ${rowIndex} as "${project.sheet.completedValue}"`,
  });

  // Mark sheet row as complete
  let sheetWritebackOk = true;
  try {
    await setRowStatus(project, rowIndex, project.sheet.completedValue);
  } catch (e) {
    sheetWritebackOk = false;
    log(project.id, 'error',
      `WP post created (id=${wp.id}) but failed to update sheet: ${(e as Error).message}`,
      { wpId: wp.id, editLink: wp.editLink }, rowIndex
    );
    // still mark processed locally so we don't double-publish
  }

  await markProcessed({
    projectId: project.id,
    rowIndex,
    wpId: wp.id,
    wpLink: wp.link,
    editLink: wp.editLink,
    sourceLink: row.contentLink,
    processedAt: new Date().toISOString(),
    title,
    pageType: row.pageType,
    route,
    primaryKeyword: row.primaryKeyword,
    status: sheetWritebackOk ? 'success' : 'partial',
    scheduledFor: scheduledForIso,
  });

  log(project.id, 'success', `Published: ${title}`, {
    wpId: wp.id,
    editLink: wp.editLink,
    route,
  }, rowIndex);

  return { success: true, wpId: wp.id, editLink: wp.editLink };
}

export async function runProject(project: ProjectConfig, runnerEmail?: string) {
  if (!project.enabled) {
    log(project.id, 'info', 'Project disabled, skipping.');
    return;
  }
  // For scheduled runs (no runnerEmail given), fall back to the project's
  // owner — that's whose Surfer/Frase session we should use for fetches.
  const effectiveRunner = runnerEmail || project.ownerEmail || '';
  updateLiveState({
    running: true, projectId: project.id, rowIndex: null,
    phase: 'polling',
    message: `Polling ${project.name} sheet for In-Progress rows`,
  });
  log(project.id, 'info', 'Polling sheet for In-Progress rows...');
  let queue: QueueRow[];
  try {
    queue = await fetchQueue(project);
  } catch (e) {
    log(project.id, 'error', `Failed to fetch queue: ${(e as Error).message}`);
    return;
  }
  log(project.id, 'info', `Queue size: ${queue.length}`);
  for (const row of queue) {
    if (getLiveState().cancelRequested) {
      log(project.id, 'warn', `Stop requested — halting before row ${row.rowIndex}.`);
      break;
    }
    await processRow(project, row, effectiveRunner);
  }
}

export async function runAll() {
  // Clear any leftover cancel flag from a previous run.
  updateLiveState({ cancelRequested: false });
  const projects = await listProjects();
  for (const p of projects) {
    if (getLiveState().cancelRequested) break;
    // Scheduled (auto-poll) run — use the project's own owner as the runner.
    await runProject(p, p.ownerEmail);
  }
  updateLiveState({
    running: false, projectId: null, rowIndex: null,
    phase: 'idle', message: 'Idle',
    cancelRequested: false,
  });
}
