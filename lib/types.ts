// lib/types.ts

export type PageTypeRoute = 'post' | 'page';

export interface ProjectConfig {
  id: string;                    // folder-safe slug, e.g. "forte-law"
  name: string;                  // display name, e.g. "Forte Law Firm"
  wordpress: {
    baseUrl: string;             // https://www.fortelawgroup.com
    username: string;
    appPassword: string;         // WP Application Password
  };
  sheet: {
    sheetId: string;             // Google Sheets file ID
    tabName: string;             // e.g. "Content Calendar"
    columns: {
      status: string;            // 'A'
      pageType: string;          // 'D'
      primaryKeyword: string;    // 'H'
      contentLink: string;       // 'L'
      // Optional. When present, lets the publisher distinguish new posts from
      // refreshes of existing posts. If absent, every row is treated as new.
      contentType?: string;      // e.g. 'M' — values: "New Content" | "Content Refresh"
      targetUrl?: string;        // e.g. 'N' — required for refresh rows: the existing WP post/page URL to overwrite
    };
    headerRow: number;           // usually 1, data starts on headerRow + 1
    triggerValue: string;        // 'In-progress' (case-insensitive match)
    completedValue: string;      // 'Content Live'
  };
  // How each "Page Type" value routes in WP.
  // Keys are lowercase; missing keys default to 'page'.
  pageTypeRouting: Record<string, PageTypeRoute>;
  // Default post status on publish; 'draft' keeps it safe
  publishStatus: 'draft' | 'publish' | 'pending';
  enabled: boolean;
}

export type ContentMode = 'new' | 'refresh';

export interface QueueRow {
  projectId: string;
  rowIndex: number;              // 1-based spreadsheet row
  status: string;
  pageType: string;
  primaryKeyword: string;
  contentLink: string;
  contentType: string;           // raw cell value (for display/logging)
  contentMode: ContentMode;      // normalized — 'new' or 'refresh'
  targetUrl: string;             // existing WP URL when contentMode === 'refresh'
}

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
  ts: string;
  projectId: string;
  rowIndex?: number;
  level: LogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export interface ExtractedContent {
  title: string;
  htmlBody: string;              // WP-ready HTML
  sourceType: 'gdoc' | 'frase' | 'surfer' | 'unknown';
}
