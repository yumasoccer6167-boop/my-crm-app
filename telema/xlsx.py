"""Excel（.xlsx）ファイルを作る最小の書き出し。標準ライブラリだけで動く（見出し行の太字・色、1行目の固定、絞り込みボタン、列の幅つき）。
すべてのセルは文字列として書く（電話番号の先頭の 0 が消えないように）。"""
import re
import zipfile
from io import BytesIO
from xml.sax.saxutils import escape

_BAD = re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f]')       # XML に書けない制御文字


def _col(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def _cell(ref, v, style=0):
    t = _BAD.sub('', '' if v is None else str(v))
    s = f' s="{style}"' if style else ''
    if t == '':
        return f'<c r="{ref}"{s}/>'
    return f'<c r="{ref}" t="inlineStr"{s}><is><t xml:space="preserve">{escape(t)}</t></is></c>'


def _width(values):
    """列の幅（文字数）。全角は2文字ぶんで数える。8〜60の範囲"""
    w = max((sum(2 if ord(ch) > 0x2E80 else 1 for ch in str(v or '')) for v in values), default=8)
    return min(60, max(8, w + 2))


def build_xlsx(sheet_name, header, rows):
    """header: 見出しの一覧、rows: 行（値の一覧）の一覧。bytes を返す"""
    n = len(header)
    widths = [_width([header[i], *(r[i] for r in rows[:2000])]) for i in range(n)]
    cols = ''.join(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    body = ['<row r="1">' + ''.join(_cell(f'{_col(i)}1', h, 1) for i, h in enumerate(header)) + '</row>']
    for ri, r in enumerate(rows, start=2):
        body.append(f'<row r="{ri}">' + ''.join(_cell(f'{_col(i)}{ri}', v) for i, v in enumerate(r)) + '</row>')
    last = f'{_col(n - 1)}{len(rows) + 1}'
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f'<cols>{cols}</cols><sheetData>{"".join(body)}</sheetData><autoFilter ref="A1:{last}"/></worksheet>')
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Meiryo UI"/></font><font><b/><sz val="11"/><name val="Meiryo UI"/></font></fonts>'
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE0E7FF"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>')
    name = escape(sheet_name, {'"': '&quot;'})
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{name}" sheetId="1" r:id="rId1"/></sheets>'
        f'<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'{name}\'!$A$1:${_col(n - 1)}${len(rows) + 1}</definedName></definedNames></workbook>')
    files = {
        '[Content_Types].xml': (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
        '_rels/.rels': (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
        'xl/workbook.xml': workbook,
        'xl/_rels/workbook.xml.rels': (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
        'xl/styles.xml': styles,
        'xl/worksheets/sheet1.xml': sheet,
    }
    out = BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for path, data in files.items():
            z.writestr(path, data)
    return out.getvalue()
