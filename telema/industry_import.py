"""施設類型のCSVを、電話番号でテレマリストの施設と照合して、基本情報の「業種・施設類型」に施設類型を入れる（管理者のみ）。

画面（取り込みページ）がCSVを読み、数百行ずつこのAPIへ送る。apply=false は同じ処理を最後に取り消すだけなので、確認の結果と実際の取り込みが食い違わない。
 - 照合は電話番号（ハイフン・全角などを除いた数字。予備の電話番号も見る）。電話番号が空・読めない行は入れない
 - 同じ電話番号の施設が複数あるとき、CSVの中で同じ電話番号に別の施設類型の行があるとき（conflict）は、施設名が似ている施設に絞れた場合だけ入れる。絞れなければ「要確認」
 - すでに業種が入っている施設は、既定では変えない（overwrite=true のときだけ上書き）。同じ値なら何もしない
 - 「業種・施設類型」は自由入力の欄なので、CSVの施設類型をそのまま入れる
"""
from flask import jsonify

from .common import audit
from .context import ApiError, body, current_user, db, require_role
from .customer_import import likely_same
from .normalize import normalize_phone
from .routes import bp
from .validate import Bool, Int, Str, parse

ROW = {'line': Int(min=1), 'name': Str(max=300, default=''), 'phone': Str(max=60, default=''),
       'facility_type': Str(max=100, default=''), 'conflict': Bool(default=False)}
MAX_ROWS = 1000
LIST_LIMIT = 300


def _match(by_phone, row):
    """戻り値: (status, company, reason, candidates)  status: ok / unmatched / review"""
    cands = by_phone.get(normalize_phone(row['phone']), [])
    if not cands:
        return 'unmatched', None, None, []
    if len(cands) > 1 or row['conflict']:
        named = [c for c in cands if likely_same(row['name'], c['company_name']) or likely_same(row['name'], c['org_name'])]
        if len(named) != 1:
            why = 'CSV内の同じ電話番号に別の施設類型の行があり' if row['conflict'] else f'{len(cands)}施設に一致し'
            return 'review', None, f'{why}、施設名では1つに決まらない', cands
        return 'ok', named[0], None, named
    return 'ok', cands[0], None, cands


@bp.post('/admin/industry-import')
def industry_import():
    require_role('admin')
    raw = body() or {}
    b = parse({'apply': Bool(), 'overwrite': Bool(default=False), 'known_keys': Str(max=200000, default='')}, {k: v for k, v in raw.items() if k != 'rows'})
    raw_rows = raw.get('rows')
    if not isinstance(raw_rows, list) or not raw_rows or len(raw_rows) > MAX_ROWS:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（rows: 1〜{MAX_ROWS}行で送ってください）')
    rows = [parse(ROW, r) for r in raw_rows]
    user, d = current_user(), db()
    # 前の回までに「この施設にこの施設類型を入れる」と決まったもの（施設ID\t施設類型）。回をまたぐ重複・食い違いを見分ける
    targeted = dict(line.split('\t', 1) for line in b['known_keys'].split('\n') if '\t' in line)

    phones = {p for p in (normalize_phone(r['phone']) for r in rows) if p}
    by_phone = {}
    for c in d.all(
            '''SELECT c.id, c.company_name, c.industry, o.name AS org_name, c.phone_normalized AS phone_n,
                      NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') AS alt_n
                 FROM telema_companies c LEFT JOIN telema_organizations o ON o.id = c.organization_id
                WHERE c.is_active = 1 AND (c.phone_normalized = ANY(%s) OR NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') = ANY(%s))''',
            (list(phones), list(phones))):
        for p in {c['phone_n'], normalize_phone(c['alt_n'])} - {None}:
            by_phone.setdefault(p, []).append(c)

    rep = {'rows': len(rows), 'filled': 0, 'overwritten': 0, 'same': 0, 'kept': 0, 'unmatched': 0, 'review': 0, 'duplicate': 0, 'no_phone': 0, 'no_type': 0,
           'types': {}, 'unmatched_rows': [], 'review_rows': [], 'kept_rows': []}
    new_targets = []
    for r in rows:
        ftype = r['facility_type'].strip()
        label = {'line': r['line'], 'name': r['name'], 'phone': r['phone'], 'facility_type': ftype}
        if not ftype:
            rep['no_type'] += 1
            continue
        if not normalize_phone(r['phone']):
            rep['no_phone'] += 1
            continue
        status, company, why, cands = _match(by_phone, r)
        if status == 'unmatched':
            rep['unmatched'] += 1
            if len(rep['unmatched_rows']) < LIST_LIMIT:
                rep['unmatched_rows'].append(label)
            continue
        if status == 'review':
            rep['review'] += 1
            if len(rep['review_rows']) < LIST_LIMIT:
                rep['review_rows'].append({**label, 'reason': why, 'candidates': [c['company_name'] for c in cands][:5]})
            continue
        cid = str(company['id'])
        if cid in targeted:
            if targeted[cid] == ftype:
                rep['duplicate'] += 1
            else:
                rep['review'] += 1
                if len(rep['review_rows']) < LIST_LIMIT:
                    rep['review_rows'].append({**label, 'reason': f'同じ施設に別の施設類型「{targeted[cid]}」を入れる行があり決められない', 'candidates': [company['company_name']]})
            continue
        targeted[cid] = ftype
        new_targets.append(f'{cid}\t{ftype}')
        current = (company['industry'] or '').strip()
        if current == ftype:
            rep['same'] += 1
            continue
        if current and not b['overwrite']:
            rep['kept'] += 1
            if len(rep['kept_rows']) < LIST_LIMIT:
                rep['kept_rows'].append({**label, 'company_name': company['company_name'], 'current': current})
            continue
        d.run('UPDATE telema_companies SET industry = %s, updated_at = telema_now() WHERE id = %s', (ftype, company['id']))
        audit(d, user['id'], 'update', 'company', company['id'], {'industry': company['industry']},
              {'industry': ftype, 'source': f'施設類型CSV {r["line"]}行目（電話番号）'})
        rep['overwritten' if current else 'filled'] += 1
        rep['types'][ftype] = rep['types'].get(ftype, 0) + 1
    if not b['apply']:
        d.conn.rollback()
    return jsonify({**rep, 'new_keys': new_targets, 'applied': b['apply']})
