// lib/sheets.ts
import { google, sheets_v4 } from 'googleapis';
import { getAuth } from './google';
import type { ContentMode, ProjectConfig, QueueRow } from './types';

function normalizeContentMode(raw: string): ContentMode {
  const v = (raw || '').trim().toLowerCase();
  if (!v) return 'new';
  if (v.includes('refresh') || v.includes('update') || v.includes('rewrite')) return 'refresh';
  return 'new';
}

function sheets(): sheets_v4.Sheets {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// A1 column letter → 0-based index (supports A..ZZ)
function colToIdx(col: string): number {
  let n = 0;
  for (const c of col.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

function range(tab: string, col: string, row: number) {
  return `'${tab}'!${col}${row}`;
}

// Representation of a cell: display text + optional hyperlink URL.
interface CellData {
  text: string;       // display value
  hyperlink?: string; // embedded URL if cell is a hyperlink / HYPERLINK() formula
}

/**
 * Fetch the sheet as a 2D array of CellData.
 * Uses spreadsheets.get with grid data so we get the `hyperlink` attribute
 * for cells that are text-links (like "Link" pointing to a Google Doc).
 */
export async function fetchAllCells(project: ProjectConfig): Promise<CellData[][]> {
  const api = sheets();
  const res = await api.spreadsheets.get({
    spreadsheetId: project.sheet.sheetId,
    includeGridData: true,
    ranges: [`'${project.sheet.tabName}'!A1:Z10000`],
    fields:
      'sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue(stringValue,formulaValue),effectiveValue(stringValue)))))',
  });

  const sheet = res.data.sheets?.[0];
  const data = sheet?.data?.[0];
  const rowData = data?.rowData || [];

  const out: CellData[][] = [];
  for (const r of rowData) {
    const row: CellData[] = [];
    for (const cell of r.values || []) {
      const text = (cell.formattedValue || '').trim();
      // The Sheets API exposes `hyperlink` for cells whose userEnteredValue
      // is a HYPERLINK() formula or a cell formatted as a link.
      let hyperlink = (cell as { hyperlink?: string }).hyperlink;

      // Also try parsing HYPERLINK(...) formulas manually, just in case.
      const formula = cell.userEnteredValue?.formulaValue;
      if (!hyperlink && formula) {
        const m = formula.match(/^=HYPERLINK\(\s*"([^"]+)"/i);
        if (m) hyperlink = m[1];
      }

      row.push({ text, hyperlink: hyperlink || undefined });
    }
    out.push(row);
  }
  return out;
}

// Back-compat: just the text
export async function fetchAllRows(project: ProjectConfig): Promise<string[][]> {
  const cells = await fetchAllCells(project);
  return cells.map((row) => row.map((c) => c.text));
}

function looksLikeUrl(s: string): boolean {
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function fetchQueue(project: ProjectConfig): Promise<QueueRow[]> {
  const rows = await fetchAllCells(project);
  const { columns, headerRow, triggerValue } = project.sheet;

  const idxStatus = colToIdx(columns.status);
  const idxPageType = colToIdx(columns.pageType);
  const idxKW = colToIdx(columns.primaryKeyword);
  const idxLink = colToIdx(columns.contentLink);
  const idxContentType = columns.contentType ? colToIdx(columns.contentType) : -1;
  const idxTargetUrl = columns.targetUrl ? colToIdx(columns.targetUrl) : -1;

  const trigger = triggerValue.trim().toLowerCase();
  const queue: QueueRow[] = [];

  for (let i = headerRow; i < rows.length; i++) {
    const r = rows[i] || [];
    const status = (r[idxStatus]?.text || '').trim();
    if (status.toLowerCase() !== trigger) continue;

    // For the content link, prefer the embedded hyperlink over display text.
    // If the user pasted "Link" into the cell but attached a URL, hyperlink wins.
    // If they pasted a real URL, both fields match and we use either.
    const linkCell = r[idxLink];
    let contentLink = linkCell?.hyperlink?.trim() || '';
    if (!contentLink && linkCell?.text && looksLikeUrl(linkCell.text)) {
      contentLink = linkCell.text.trim();
    }

    // Same hyperlink-vs-text resolution for the target URL column.
    let targetUrl = '';
    if (idxTargetUrl >= 0) {
      const cell = r[idxTargetUrl];
      targetUrl = cell?.hyperlink?.trim() || '';
      if (!targetUrl && cell?.text && looksLikeUrl(cell.text)) {
        targetUrl = cell.text.trim();
      }
    }

    const contentType = idxContentType >= 0 ? (r[idxContentType]?.text || '').trim() : '';

    queue.push({
      projectId: project.id,
      rowIndex: i + 1, // 1-based spreadsheet row
      status,
      pageType: (r[idxPageType]?.text || '').trim(),
      primaryKeyword: (r[idxKW]?.text || '').trim(),
      contentLink,
      contentType,
      contentMode: normalizeContentMode(contentType),
      targetUrl,
    });
  }
  return queue;
}

export async function setRowStatus(
  project: ProjectConfig,
  rowIndex: number,
  value: string
): Promise<void> {
  const api = sheets();
  await api.spreadsheets.values.update({
    spreadsheetId: project.sheet.sheetId,
    range: range(project.sheet.tabName, project.sheet.columns.status, rowIndex),
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

export async function probe(project: ProjectConfig): Promise<{
  ok: boolean;
  tabFound: boolean;
  headerRow?: string[];
  rowCount?: number;
  error?: string;
}> {
  try {
    const rows = await fetchAllRows(project);
    return {
      ok: true,
      tabFound: true,
      headerRow: rows[project.sheet.headerRow - 1],
      rowCount: Math.max(0, rows.length - project.sheet.headerRow),
    };
  } catch (e) {
    return { ok: false, tabFound: false, error: (e as Error).message };
  }
}
