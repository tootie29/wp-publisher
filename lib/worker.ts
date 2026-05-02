// lib/worker.ts
import { listProjects } from './projects';
import { fetchQueue, setRowStatus } from './sheets';
import { extractContent } from './extract';
import { createDraft, findPostByTitle, findPostByUrl, postExists, resolveRoute, updatePost } from './wordpress';
import { htmlToBlocks } from './blocks';
import { log } from './logger';
import { getProcessedRecord, hasProcessed, markProcessed, removeProcessed } from './state';
import { getLiveState, updateLiveState } from './live-state';
import type { ProjectConfig, QueueRow } from './types';

export async function processRow(project: ProjectConfig, row: QueueRow, runnerEmail: string) {
  const { rowIndex } = row;

  if (hasProcessed(project.id, rowIndex)) {
    // Verify the WP post still exists. If it was deleted in WordPress (and
    // the row is back to "In-Progress" in the sheet), the user clearly wants
    // it republished — drop the stale history record so we reprocess.
    const prev = getProcessedRecord(project.id, rowIndex);
    if (prev) {
      const stillExists = await postExists(project, prev.route, prev.wpId);
      if (stillExists) {
        log(project.id, 'info', `Row ${rowIndex} already processed, skipping.`, {}, rowIndex);
        return { skipped: true };
      }
      removeProcessed(project.id, rowIndex);
      log(
        project.id,
        'warn',
        `Row ${rowIndex} was previously published as ${prev.route} ${prev.wpId} but that ${prev.route} no longer exists in WordPress. Republishing.`,
        { wpId: prev.wpId, route: prev.route },
        rowIndex
      );
    }
  }

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
  // 1. The article's own <h1> wins — that's the canonical title written by
  //    whoever drafted the content.
  // 2. Fall back to the sheet's Primary Keyword column if no usable H1 was
  //    found (or if the extractor only returned a SaaS brand name).
  // 3. Last resort: 'Untitled'. We never trust the source's <title> tag
  //    (Frase / Surfer set that to their brand name).
  const extractedClean = (extracted.title || '').trim();
  const looksGeneric =
    !extractedClean ||
    extractedClean === 'Untitled' ||
    /^(frase|surfer|surfer seo|app\.frase\.io|app\.surferseo\.com)$/i.test(extractedClean);
  const title =
    (!looksGeneric ? extractedClean : '') ||
    (row.primaryKeyword || '').trim() ||
    'Untitled';

  const isRefresh = row.contentMode === 'refresh';

  if (isRefresh && !row.targetUrl && !row.primaryKeyword) {
    log(project.id, 'error',
      `Row ${rowIndex} marked "Content Refresh" but has no Target URL and no Primary Keyword to match against. ` +
      `Add either a target URL or a keyword that matches the existing post's title.`,
      {}, rowIndex);
    return { error: 'Refresh row missing both target URL and keyword' };
  }

  updateLiveState({
    running: true, projectId: project.id, rowIndex,
    phase: 'publishing',
    message: isRefresh
      ? `Refreshing existing ${route} in WordPress: "${title}"`
      : `Creating ${route} in WordPress: "${title}"`,
  });

  log(project.id, 'info',
    isRefresh
      ? `Refreshing existing WP ${route} from ${row.targetUrl}: "${title}"`
      : `Publishing to WP as ${route}: "${title}"`,
    { route, sourceType: extracted.sourceType, mode: row.contentMode },
    rowIndex
  );

  const gutenberg = htmlToBlocks(extracted.htmlBody);

  let wp;
  try {
    if (isRefresh) {
      // Try to locate the existing post: explicit Target URL first, then
      // by title (Primary Keyword). If nothing matches, fall back to
      // creating a NEW draft using the project's page-type routing
      // (Blog → post, Cluster/Resource/etc → page).
      let found = null as Awaited<ReturnType<typeof findPostByUrl>>;
      if (row.targetUrl) {
        found = await findPostByUrl(project, row.targetUrl);
      } else {
        const lookupTitle = row.primaryKeyword || extracted.title;
        if (lookupTitle) {
          found = await findPostByTitle(project, lookupTitle);
        }
      }

      if (found) {
        log(project.id, 'info',
          `Matched existing ${found.type} ${found.id} for refresh: ${found.link}`,
          { wpId: found.id }, rowIndex
        );
        wp = await updatePost(project, found.type, found.id, gutenberg, title);
      } else {
        log(project.id, 'warn',
          `No existing WP ${route} found for "${title}" — creating a NEW ${route} draft instead.`,
          { route, lookupTitle: row.primaryKeyword || extracted.title, targetUrl: row.targetUrl || null },
          rowIndex
        );
        wp = await createDraft(project, route, title, gutenberg);
      }
    } else {
      wp = await createDraft(project, route, title, gutenberg);
    }
  } catch (e) {
    log(project.id, 'error',
      isRefresh
        ? `WP refresh failed: ${(e as Error).message}`
        : `WP publish failed: ${(e as Error).message}`,
      {}, rowIndex
    );
    return { error: (e as Error).message };
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

  markProcessed({
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
  const projects = listProjects();
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
