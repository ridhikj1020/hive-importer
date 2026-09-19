"""
Independent oracle for the importer's spreadsheet reader.

Reads the Spectora export with openpyxl (a different implementation from src/lib/importer/readXlsx.ts)
and writes every non-empty cell as text. tests/oracle.test.ts requires the two readers to agree on
every cell. Run again only if the fixture changes:

    pip install openpyxl
    python3 scripts/make-oracle.py fixtures/InterNACHI_Residential_-2026-09-19.xls
"""
import json, shutil, sys, tempfile, os
import openpyxl

src = sys.argv[1]
# Spectora names OOXML files ".xls"; openpyxl insists on the real extension, so read a copy.
tmp = os.path.join(tempfile.mkdtemp(), "copy.xlsx")
shutil.copyfile(src, tmp)
ws = openpyxl.load_workbook(tmp).active

cells = {}
for row in ws.iter_rows():
    for c in row:
        if c.value is not None and str(c.value) != "":
            cells[c.coordinate] = str(c.value)

out = os.path.join("fixtures", "oracle", os.path.basename(src) + ".cells.json")
with open(out, "w", encoding="utf-8") as f:
    json.dump({"source": os.path.basename(src), "reader": "openpyxl " + openpyxl.__version__, "cells": cells}, f, ensure_ascii=False, separators=(",", ":"))
print(f"{len(cells)} non-empty cells -> {out}")
