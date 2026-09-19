export type CommentType = 'info' | 'limit' | 'defect';
export type Severity = 'info' | 'warning' | 'error';

/**
 * Where a problem comes from. This is the distinction the brief asks for:
 *  - missing_from_export:     the Spectora export simply does not contain it
 *  - unsupported_by_importer: the export contains it, this importer does not carry it across
 *  - normalized:              carried across, but changed in form (always reported, never silent)
 *  - invalid_input:           a row or value we could not accept
 */
export type IssueOrigin =
  | 'missing_from_export'
  | 'unsupported_by_importer'
  | 'normalized'
  | 'invalid_input';

export interface ImportIssue {
  severity: Severity;
  origin: IssueOrigin;
  code: string;
  message: string;
  /** 1-based spreadsheet row number, when the issue belongs to one row */
  row?: number;
  section?: string;
  item?: string;
  comment?: string;
  detail?: Record<string, unknown>;
}

export interface ParsedComment {
  name: string;
  type: CommentType;
  /** 0-based position inside the item (stable sort on source Order, then file order) */
  position: number;
  sourceRow: number;
  sourceOrder: number | null;
  /** Comment Text exactly as found in the cell. Never edited after import. */
  bodyRaw: string | null;
  /** Sanitized HTML. This is the editable copy. */
  bodyHtml: string | null;
  answerType: string | null;
  options: string[];
  unitOptions: string[];
  category: -1 | 0 | 1 | null;
  recommendation: string | null;
  defaultValue: string | null;
  /** Everything else in the row that has no first-class field. Nothing is discarded. */
  extra: Record<string, unknown>;
}

export interface ParsedItem {
  name: string;
  position: number;
  comments: ParsedComment[];
}

export interface ParsedSection {
  name: string;
  position: number;
  items: ParsedItem[];
}

export interface ParsedTemplate {
  name: string;
  sourceFormat: 'spectora_html_text_spreadsheet';
  sourceFilename: string;
  sourceSha256: string;
  sections: ParsedSection[];
}

export interface ImportCounts {
  dataRows: number;
  rowsImported: number;
  rowsSkipped: number;
  rowsBlank: number;
  sections: number;
  items: number;
  comments: number;
  byType: Record<CommentType, number>;
  commentsWithHtml: number;
  commentsWithEmptyText: number;
  linksInSource: number;
  linksImported: number;
}

export interface Reconciliation {
  /** imported + skipped + blank == data rows in the sheet */
  rowsBalanced: boolean;
  /** comments counted by walking the finished tree == rows imported */
  structureBalanced: boolean;
  /** visible text of every comment is identical before and after sanitizing */
  textPreserved: boolean;
  /** every link in the source is present in the imported HTML (unless blocked and reported) */
  linksPreserved: boolean;
  checkedComments: number;
  ok: boolean;
}

export interface ImportReport {
  counts: ImportCounts;
  reconciliation: Reconciliation;
  issues: ImportIssue[];
  /** Things this export format cannot tell us, so nobody mistakes silence for success. */
  exportLimitations: string[];
}

export interface ParseResult {
  template: ParsedTemplate;
  report: ImportReport;
}
