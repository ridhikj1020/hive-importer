export type ImportErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'LEGACY_XLS_UNSUPPORTED'
  | 'NOT_A_SPREADSHEET'
  | 'CORRUPT_SPREADSHEET'
  | 'NO_WORKSHEET'
  | 'MISSING_REQUIRED_COLUMNS'
  | 'NO_DATA_ROWS'
  | 'TOO_MANY_ROWS';

/**
 * A whole-file failure. Nothing is imported and nothing is written to the database.
 * `hint` is written for the inspector, not the developer.
 */
export class ImportError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
    public readonly hint?: string,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ImportError';
  }
}
