# Fixtures

`InterNACHI_Residential_-2026-09-19.xls`

- Template: InterNACHI Residential (a Spectora starter template, loaded from Spectora's
  template library into a free trial account).
- Exported on 2026-09-19 with Export to spreadsheet, then Export HTML Text.
- Committed exactly as downloaded, so anyone can test against the same bytes.
- Spectora names the file `.xls`, but it is an Office Open XML (`.xlsx`) file inside.
- Contains no customer information.

`oracle/*.cells.json`

- Every non-empty cell of the export, read by openpyxl, an implementation independent from
  the importer's reader. Regenerate with `python3 scripts/make-oracle.py <file>`.
