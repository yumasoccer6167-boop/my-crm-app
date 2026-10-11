"""契約一覧のCSVを、電話番号・住所でテレマリストの施設と照合して、各施設の「契約情報」に追加する（管理者のみ）。

画面（取り込みページ）がCSVを読み、数百行ずつこのAPIへ送る。apply=false は同じ処理を最後に取り消すだけなので、確認の結果と実際の取り込みが食い違わない。
照合のしかた（scripts/telema/import-contracts.ts と同じ）：
 - 電話番号が一致する施設と、住所が一致する施設（表記ゆれを除いた住所の完全一致）を探す。両方に一致すればその施設。電話だけ／住所だけでも候補が1件ならその施設
   （電話だけの一致で、都道府県・市区町村が食い違うものは「要確認」）
 - 候補が複数のときは、会社名と施設名（法人名）が似ているものに絞る。決まらなければ「要確認」。電話と住所がそれぞれ別の施設に一致するときも「要確認」
 - 営業担当は、CRMのメンバー名と一致したときだけ入れる。すでに同じ施設・商材・契約日の契約があるもの、CSV内の重複は追加しない
"""
import re

from flask import jsonify

from .common import audit
from .context import ApiError, body, current_user, db, require_role
from .customer_import import likely_same
from .normalize import normalize_address, normalize_phone, split_prefecture_city
from .routes import bp
from .validate import Bool, Int, Str, parse

ROW = {'line': Int(min=1), 'name': Str(max=300, default=''), 'phone': Str(max=60, default=''), 'address': Str(max=400, default=''),
       'product': Str(max=200, default=''), 'date': Str(max=30, default=''), 'sales': Str(max=100, default='')}
MAX_ROWS = 1000
LIST_LIMIT = 300      # 返す「見つからない」「要確認」の行数の上限（件数は全件を数える）


def _compact(s):
    return re.sub(r'[\s　]', '', s or '')


def to_iso_date(s):
    m = re.match(r'^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$', (s or '').strip())
    if not m:
        return None
    y, mo, d = int(m[1]), int(m[2]), int(m[3])
    try:
        from datetime import date
        date(y, mo, d)
    except ValueError:
        return None
    return f'{y:04d}-{mo:02d}-{d:02d}'


def _same_area(csv_addr, company_addr):
    if not csv_addr or not company_addr:
        return True
    a, b = split_prefecture_city(csv_addr), split_prefecture_city(company_addr)
    return not a[0] or not b[0] or (a[0] == b[0] and (not a[1] or not b[1] or a[1] == b[1]))


class Matcher:
    def __init__(self, d, rows):
        phones, addrs = set(), set()
        for r in rows:
            p, a = normalize_phone(r['phone']), normalize_address(r['address'])
            if p:
                phones.add(p)
            if a:
                addrs.add(a)
        self.by_phone, self.by_addr = {}, {}
        for c in d.all(
                '''SELECT c.id, c.company_name, c.address, c.address_normalized AS address_n, c.phone_normalized AS phone_n, o.name AS org_name,
                          NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') AS alt_n
                     FROM telema_companies c LEFT JOIN telema_organizations o ON o.id = c.organization_id
                    WHERE c.is_active = 1 AND (c.phone_normalized = ANY(%s) OR c.address_normalized = ANY(%s)
                          OR NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') = ANY(%s))''',
                (list(phones), list(addrs), list(phones))):
            for p in (c['phone_n'], normalize_phone(c['alt_n'])):
                if p:
                    self.by_phone.setdefault(p, []).append(c)
            if c['address_n']:
                self.by_addr.setdefault(c['address_n'], []).append(c)
        self.cache = {}

    def match(self, row):
        """戻り値: (status, company, basis_or_note, candidates)  status: ok / unmatched / review"""
        key = (row['name'], row['phone'], row['address'])
        if key in self.cache:
            return self.cache[key]
        self.cache[key] = res = self._match(row)
        return res

    def _match(self, row):
        phone, addr = normalize_phone(row['phone']), normalize_address(row['address'])
        P = self.by_phone.get(phone, []) if phone else []
        A = self.by_addr.get(addr, []) if addr else []
        if P and A:
            cands = [c for c in P if c in A]
            if not cands:
                return 'review', None, '電話番号と住所が別の施設に一致', [*P, *A]
            basis = '電話＋住所'
        elif P:
            cands = [c for c in P if _same_area(row['address'], c['address'])]
            if not cands:
                return 'review', None, '電話番号は一致するが住所の都道府県・市区町村が違う', P
            basis = '電話'
        elif A:
            cands, basis = A, '住所'
        else:
            return 'unmatched', None, None, []
        if len(cands) > 1:
            named = [c for c in cands if likely_same(row['name'], c['company_name']) or likely_same(row['name'], c['org_name'])]
            if len(named) != 1:
                return 'review', None, f'{basis}で{len(cands)}施設に一致し、会社名では1つに決まらない', cands
            cands, basis = named, basis + '＋名称'
        return 'ok', cands[0], basis, cands


@bp.post('/admin/contract-import')
def contract_import():
    require_role('admin')
    b = parse({'apply': Bool(), 'known_keys': Str(max=100000, default='')}, {k: v for k, v in (body() or {}).items() if k != 'rows'})
    raw_rows = (body() or {}).get('rows')
    if not isinstance(raw_rows, list) or not raw_rows or len(raw_rows) > MAX_ROWS:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（rows: 1〜{MAX_ROWS}行で送ってください）')
    rows = [parse(ROW, r) for r in raw_rows]
    user, d = current_user(), db()
    known = set(filter(None, b['known_keys'].split('\n')))     # 前の回で追加する予定になった契約（確認だけのときも、回をまたぐ重複を見分けるため）

    users = {_compact(u['display_name']): u['id'] for u in d.all('SELECT id, display_name FROM users')}
    matcher = Matcher(d, rows)
    have = {(r['company_id'], _compact(r['product_name']), r['contract_date']) for r in d.all(
        'SELECT company_id, product_name, contract_date FROM telema_contracts WHERE is_active = 1 AND company_id = ANY(%s)',
        ([c['id'] for lst in matcher.by_phone.values() for c in lst] + [c['id'] for lst in matcher.by_addr.values() for c in lst],))}
    report = {'rows': len(rows), 'added': 0, 'companies': 0, 'unmatched': 0, 'review': 0, 'existing': 0, 'duplicate': 0, 'no_product': 0, 'bad_date': 0,
              'unmatched_rows': [], 'review_rows': [], 'unknown_sales': {}, 'basis': {}}
    added_keys, company_ids = [], set()
    for r in rows:
        product, date = r['product'].strip(), to_iso_date(r['date'])
        if not product:
            report['no_product'] += 1
            continue
        if not date:
            report['bad_date'] += 1
            continue
        status, company, info, cands = matcher.match(r)
        label = {'line': r['line'], 'name': r['name'], 'phone': r['phone'], 'address': r['address'], 'product': product, 'date': r['date']}
        if status == 'unmatched':
            report['unmatched'] += 1
            if len(report['unmatched_rows']) < LIST_LIMIT:
                report['unmatched_rows'].append(label)
            continue
        if status == 'review':
            report['review'] += 1
            if len(report['review_rows']) < LIST_LIMIT:
                report['review_rows'].append({**label, 'reason': info, 'candidates': [c['company_name'] for c in cands][:5]})
            continue
        key = f'{company["id"]}|{_compact(product)}|{date}'
        if (company['id'], _compact(product), date) in have:
            report['existing'] += 1
            continue
        if key in known:
            report['duplicate'] += 1
            continue
        known.add(key)
        added_keys.append(key)
        sales = _compact(r['sales'])
        uid = users.get(sales) if sales else None
        if sales and uid is None:
            report['unknown_sales'][r['sales']] = report['unknown_sales'].get(r['sales'], 0) + 1
        cid = d.value('INSERT INTO telema_contracts (company_id, product_name, contract_date, assigned_user_id, created_by) VALUES (%s, %s, %s, %s, %s) RETURNING id',
                      (company['id'], product, date, uid, user['id']))
        audit(d, user['id'], 'create', 'contract', cid, None,
              {'company_id': company['id'], 'product_name': product, 'contract_date': date, 'assigned_user_id': uid, 'source': f'契約一覧CSV {r["line"]}行目（{info}）'})
        report['added'] += 1
        report['basis'][info] = report['basis'].get(info, 0) + 1
        company_ids.add(company['id'])
    report['companies'] = len(company_ids)
    if not b['apply']:
        d.conn.rollback()
    return jsonify({**report, 'added_keys': added_keys, 'applied': b['apply']})
