#!/usr/bin/env python3
"""Excel の1シートを {file, sheet, headers, rows} のJSONにする（scripts/telema/import-excel.ts の入力）。
使い方: python3 scripts/telema/xlsx-to-json.py 入力.xlsx 出力.json [シート名]"""
import datetime, json, sys
import openpyxl

def cell(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y/%m/%d")
    return str(v)

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
ws = wb[sys.argv[3]] if len(sys.argv) > 3 else wb.worksheets[0]
rows = [[cell(c) for c in r] for r in ws.iter_rows(values_only=True)]
rows = [r for r in rows if any(x != "" for x in r)]
json.dump({"file": src.split("/")[-1], "sheet": ws.title, "headers": rows[0], "rows": rows[1:]}, open(out, "w"), ensure_ascii=False)
print(f"{ws.title}: {len(rows) - 1} rows")
