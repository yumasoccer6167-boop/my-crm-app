"""CRM本体の顧客リスト（app_state の customers / records）を、テレマリストの施設・架電訪問の履歴・契約情報として取り込む（管理者のみ）。

- 顧客リスト側のデータは変更しない（読むだけ）。取り込んだ顧客・記録は telema_crm_links / telema_crm_record_links に残し、何度実行しても二重に取り込まない
- すでにテレマリストにある施設は、電話番号・住所が同じで、名前も似ているときだけ同じ施設とみなして情報を足す（空欄の補完だけ。既存の値は上書きしない）。
  名前が違えば別施設として作る。候補が複数で決められないものは「要確認」にして取り込まない
- 顧客が多いので、画面から数十〜数百件ずつ繰り返し呼ぶ（after_id で続きから）。apply=false は同じ処理を最後に取り消すだけなので、確認の結果と実際の取り込みが食い違わない
"""
import re
from datetime import datetime

from flask import jsonify

from .calls import _recalc_company_calls
from .common import JST, audit
from .companies import derived_columns
from .context import ApiError, body, current_user, db, require_role
from .normalize import normalize_address, normalize_company_name, normalize_phone, to_half_width
from .routes import bp
from .validate import Bool, Int, parse, iso_utc

BATCH_DEFAULT, BATCH_MAX = 100, 300
LINK_LABEL = '顧客リストの紐づけ'
IMPORT_NOTE = '顧客リストから取り込み'

# CRMの結果フラグ → テレマリストのステータス（なければ付けない。元のフラグはタイムラインのメモに残す）
FLAG_STATUS = {
    '再コール': '再コール', '留守電・不通': '再コール', '不通': '再コール',
    '初回時間設定（代表）': '時間設定成立', '初回時間設定（担当）': '時間設定成立', '時間設定（代表）': '時間設定成立', '時間設定（担当）': '時間設定成立',
    '飛び込み初回時間設定': '時間設定成立', '営業時間設定': '時間設定成立', '当日確認案件': '時間設定成立',
    '10店舗': '10店鋪以上', '資料送り': '見込み', '資料メール送り': '見込み', '長期見込み': '見込み', '返事待ち': '見込み',
    '決裁者アポれず': '決対話アポれず', '廃業': '廃業', '受付拒否': 'アポ禁', '代表接触拒否': 'アポ禁',
    '返事待ちNG': '受注不成立', 'NG': '受注不成立', '営業提案NG': '受注不成立', '受注': '受注成立', 'ユーザー': '受注成立',
}
USER_FLAGS = ('受注', 'ユーザー', '過去受注記録あり')
VISIT_TYPES = ('初回訪問', '営業（代表）', '営業（担当）')


# ---------- 施設名の一致判定（src/telema/shared/normalize.ts の isLikelySameFacility と同じ） ----------
_KANJI = {'一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9'}
_CORP = re.compile(r'^(社会福祉法人|学校法人|宗教法人|株式会社|有限会社|合同会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人)')


def _kanji_num(s):
    return re.sub(r'第([一二三四五六七八九])', lambda m: f'第{_KANJI[m.group(1)]}', s)


def _branch(v):
    return ','.join(sorted(re.findall(r'分園|分室|分校|分院|別館|本園|本館|駐車場|第[0-9]+|[0-9]+号', _kanji_num(normalize_company_name(v)))))


def _key(v):
    s = normalize_company_name(v)
    s = re.sub(r'^(.{2,}?[市町村区])立', '', s, count=1)
    s = re.sub(r'\([^)]*\)', '', s)
    s = re.sub(r'[ヶヵｹ]', 'ケ', s)
    s = re.sub(r'[‘’“”]', '', s)
    s = _kanji_num(s)
    return re.sub(r'^(幼保連携型|幼稚園型|保育所型)?(認定こども園)?(幼保連携型)?', '', s, count=1)


def same_name(a, b):
    if _branch(a) != _branch(b):
        return False
    x, y = _key(a), _key(b)
    return x == y or (min(len(x), len(y)) >= 4 and (x in y or y in x))


def _corp_only(v):
    n = re.sub(r'[\s　]', '', to_half_width(str(v or ''))).replace('（', '(')
    rest = re.sub(r'学園$', '', _CORP.sub('', n))
    return bool(_CORP.match(n)) and '(' not in n and not re.search(r'(園|保育|幼稚|こども|子ども|ナーサリー|キッズ|ルーム|スクール)', rest)


def likely_same(a, b):
    if not a or not b:
        return False
    if same_name(a, b):
        return True
    inner = lambda v: re.findall(r'\(([^)]+)\)', normalize_company_name(v))   # noqa: E731
    if any(same_name(x, b) for x in inner(a)) or any(same_name(a, x) for x in inner(b)):
        return True
    return _corp_only(a) or _corp_only(b)


# ---------- 入力の整え ----------
def _s(v):
    return str(v).strip() if v is not None else ''


def _int(v):
    try:
        return int(float(_s(v).replace(',', '')))
    except ValueError:
        return None


def _float(v):
    try:
        f = float(_s(v))
    except ValueError:
        return None
    return f if 0 <= f <= 5 else None


def split_associations(v):
    return [x.strip() for x in re.split(r'[、,]', _s(v)) if x.strip()]


def to_utc(date, time):
    """CRMの日付（YYYY-MM-DD）と時刻（HH:MM）は日本時間。時刻がなければ 12:00"""
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})$', _s(date))
    if not m:
        return None
    t = re.match(r'^(\d{1,2}):(\d{2})', _s(time))
    try:
        return iso_utc(datetime(int(m[1]), int(m[2]), int(m[3]), int(t[1]) if t else 12, int(t[2]) if t else 0, tzinfo=JST))
    except ValueError:
        return None


def load_crm():
    data = db().value('SELECT data FROM app_state WHERE id = 1') or {}
    customers = [c for c in (data.get('customers') or []) if isinstance(c, dict) and isinstance(c.get('id'), int)]
    records = [r for r in (data.get('records') or []) if isinstance(r, dict) and isinstance(r.get('id'), int)]
    customers.sort(key=lambda c: c['id'])
    return customers, records


@bp.get('/admin/customer-import')
def customer_import_summary():
    require_role('admin')
    d = db()
    customers, records = load_crm()
    done = {r['crm_customer_id'] for r in d.all('SELECT crm_customer_id FROM telema_crm_links')}
    done_rec = {r['crm_record_id'] for r in d.all('SELECT crm_record_id FROM telema_crm_record_links')}
    ids = {c['id'] for c in customers}
    return jsonify({
        'customers': len(customers), 'imported_customers': len([c for c in customers if c['id'] in done]),
        'records': len([r for r in records if r.get('customerId') in ids]), 'imported_records': len([r for r in records if r['id'] in done_rec]),
    })


class Importer:
    def __init__(self, d, user, customers, records):
        self.d, self.user = d, user
        self.customers = customers
        self.by_id = {c['id']: c for c in customers}
        self.records_by_customer = {}
        for r in records:
            self.records_by_customer.setdefault(r.get('customerId'), []).append(r)
        # 紐づけ（法人被りなど）は双方向のつながりとして扱う
        self.neighbors = {}
        for c in customers:
            for o in c.get('linkedCustomerIds') or []:
                if o in self.by_id and o != c['id']:
                    self.neighbors.setdefault(c['id'], set()).add(o)
                    self.neighbors.setdefault(o, set()).add(c['id'])
        self.links = {r['crm_customer_id']: r['company_id'] for r in d.all('SELECT crm_customer_id, company_id FROM telema_crm_links')}
        self.users = {re.sub(r'\s', '', u['display_name']): u['id'] for u in d.all('SELECT id, display_name FROM users')}
        self.statuses = {s['label']: s['id'] for s in d.all('SELECT id, label FROM telema_call_statuses')}
        self.assoc = {a['name']: a for a in d.all('SELECT id, name, is_active FROM telema_associations')}
        self.report = {'processed': 0, 'created': 0, 'merged': 0, 'review': [], 'calls': 0, 'visits': 0, 'contracts': 0,
                       'skipped_records': 0, 'relations': 0, 'unknown_assignees': {}}
        self.pool = []          # このバッチで探す既存施設
        self.by_phone, self.by_addr = {}, {}

    # ----- 既存施設の探索 -----
    def load_candidates(self, batch):
        phones, addrs = set(), set()
        for c in batch:
            for k in ('tel', 'mobile', 'headquartersTel'):
                p = normalize_phone(c.get(k))
                if p:
                    phones.add(p)
            a = normalize_address(c.get('address'))
            if a:
                addrs.add(a)
        rows = self.d.all(
            '''SELECT c.id, c.company_name, o.name AS org_name, c.phone_normalized AS phone_n, c.address_normalized AS address_n,
                      NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') AS alt_n
                 FROM telema_companies c LEFT JOIN telema_organizations o ON o.id = c.organization_id
                WHERE c.is_active = 1 AND (c.phone_normalized = ANY(%s) OR c.address_normalized = ANY(%s)
                       OR NULLIF(regexp_replace(COALESCE(c.phone_alt, ''), '\\D', '', 'g'), '') = ANY(%s))''',
            (list(phones), list(addrs), list(phones)))
        for r in rows:
            self.add_pool(r)

    def add_pool(self, r):
        self.pool.append(r)
        for p in (r['phone_n'], normalize_phone(r['alt_n'])):
            if p:
                self.by_phone.setdefault(p, []).append(r)
        if r['address_n']:
            self.by_addr.setdefault(r['address_n'], []).append(r)

    def find(self, c):
        """電話・住所のどちらかが同じで、名前も似ている既存施設。戻り値: (施設 or None, 要確認の理由 or None, 候補)"""
        cands = []
        for k in ('tel', 'mobile', 'headquartersTel'):
            p = normalize_phone(c.get(k))
            for r in self.by_phone.get(p, []) if p else []:
                if r not in cands:
                    cands.append(r)
        a = normalize_address(c.get('address'))
        for r in self.by_addr.get(a, []) if a else []:
            if r not in cands:
                cands.append(r)
        en, gk = _s(c.get('enName')), _s(c.get('gakuenName'))
        named = [r for r in cands if any(likely_same(n, r['company_name']) or likely_same(n, r['org_name']) for n in (en, gk) if n)]
        if len(named) == 1:
            return named[0], None, cands
        if len(named) > 1:
            return None, f'電話・住所が同じで名前も似ている施設が{len(named)}件ある', named
        return None, None, cands

    # ----- 取り込み -----
    def assignee_id(self, name):
        name = _s(name)
        if not name:
            return None
        uid = self.users.get(re.sub(r'\s', '', name))
        if uid is None:
            self.report['unknown_assignees'][name] = self.report['unknown_assignees'].get(name, 0) + 1
        return uid

    def association_ids(self, names):
        out = []
        for n in names:
            a = self.assoc.get(n)
            if a is None:
                row = self.d.first('INSERT INTO telema_associations (name, sort_order) VALUES (%s, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM telema_associations)) RETURNING id, name, is_active', (n,))
                a = self.assoc[n] = row
            if a['is_active']:
                out.append(a['id'])
        return out

    def org_id(self, name):
        name = _s(name)
        if not name:
            return None
        norm = normalize_company_name(name)
        found = self.d.first('SELECT id FROM telema_organizations WHERE name_normalized = %s LIMIT 1', (norm,))
        return found['id'] if found else self.d.value('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (name, norm))

    def notes_of(self, c):
        lines = [IMPORT_NOTE]
        for label, key in (('Instagram', 'instagram'), ('Googleビジネス', 'gbpLink'), ('採用サイト', 'recruitSiteLink'), ('HP制作会社', 'hpVendor')):
            if _s(c.get(key)):
                lines.append(f'{label}: {_s(c.get(key))}')
        if c.get('rejected'):
            lines.append('顧客リストで「拒否」マークあり')
        return '\n'.join(lines)

    def is_user(self, c):
        return any(r.get('flag') in USER_FLAGS for r in self.records_by_customer.get(c['id'], []))

    def create_company(self, c):
        name = _s(c.get('enName')) or _s(c.get('gakuenName'))
        alt = _s(c.get('mobile')) or _s(c.get('headquartersTel'))
        values = {
            'company_name': name, 'name_kana': _s(c.get('enNameKana')) or None, 'phone': _s(c.get('tel')) or None, 'phone_alt': alt or None,
            'website': _s(c.get('hpLink')) or None, 'address': _s(c.get('address')) or None, 'industry': _s(c.get('industry')) or None,
            'google_rating': _float(c.get('reviewScore')), 'google_review_count': _int(c.get('reviewCount')),
            'notes': self.notes_of(c), 'is_user': int(self.is_user(c)),
        }
        row = {**values, **derived_columns({k: v for k, v in values.items() if k in ('company_name', 'phone', 'website', 'address')}),
               'organization_id': self.org_id(c.get('gakuenName')) if _s(c.get('enName')) else None,
               'assigned_user_id': self.assignee_id(c.get('assignedTo'))}
        cols = list(row)
        co = self.d.first(f'INSERT INTO telema_companies ({", ".join(cols)}) VALUES ({", ".join(["%s"] * len(cols))}) RETURNING id, company_name',
                          [row[k] for k in cols])
        self.add_pool({'id': co['id'], 'company_name': co['company_name'], 'org_name': _s(c.get('gakuenName')) or None,
                       'phone_n': normalize_phone(c.get('tel')), 'address_n': normalize_address(c.get('address')) or None,
                       'alt_n': re.sub(r'\D', '', alt) or None})
        return co['id']

    def merge_company(self, company_id, c):
        """既存の施設は、空欄だけを補う（既存の値は上書きしない）"""
        cur = self.d.first('SELECT * FROM telema_companies WHERE id = %s', (company_id,))
        alt = _s(c.get('mobile')) or _s(c.get('headquartersTel'))
        want = {
            'name_kana': _s(c.get('enNameKana')) or None, 'phone': _s(c.get('tel')) or None, 'phone_alt': alt or None,
            'website': _s(c.get('hpLink')) or None, 'address': _s(c.get('address')) or None, 'industry': _s(c.get('industry')) or None,
            'google_rating': _float(c.get('reviewScore')), 'google_review_count': _int(c.get('reviewCount')),
        }
        fill = {k: v for k, v in want.items() if v is not None and cur.get(k) in (None, '')}
        fill.update(derived_columns({k: v for k, v in fill.items() if k in ('phone', 'website', 'address')}))
        if self.is_user(c) and not cur['is_user']:
            fill['is_user'] = 1
        if cur['assigned_user_id'] is None:
            uid = self.assignee_id(c.get('assignedTo'))
            if uid is not None:
                fill['assigned_user_id'] = uid
        if cur['organization_id'] is None and _s(c.get('enName')) and _s(c.get('gakuenName')):
            fill['organization_id'] = self.org_id(c.get('gakuenName'))
        extra = self.notes_of(c)
        fill['notes'] = f'{cur["notes"]}\n\n{extra}' if cur.get('notes') else extra
        self.d.run(f'UPDATE telema_companies SET {", ".join(f"{k} = %s" for k in fill)}, updated_at = telema_now() WHERE id = %s', [*fill.values(), company_id])

    def add_contacts(self, company_id, c):
        have = {_s(r['name']) for r in self.d.all('SELECT name FROM telema_contacts WHERE company_id = %s AND is_active = 1', (company_id,))}
        email = _s(c.get('email'))
        for name, kana, role, dm in ((_s(c.get('chairman')), _s(c.get('chairmanKana')), '理事長', 1), (_s(c.get('principal')), _s(c.get('principalKana')), '園長', 0)):
            if not name or name in have:
                continue
            # メールは園長に付ける（園長がいなければ理事長）
            mail_to = '園長' if _s(c.get('principal')) else '理事長'
            self.d.run('INSERT INTO telema_contacts (company_id, name, role, email, is_decision_maker, source, notes) VALUES (%s, %s, %s, %s, %s, %s, %s)',
                       (company_id, name, role, email or None if role == mail_to else None, dm, 'csv', kana or None))
            have.add(name)

    def add_associations(self, company_id, c):
        for aid in self.association_ids(split_associations(c.get('associationType'))):
            self.d.run('INSERT INTO telema_company_associations (company_id, association_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (company_id, aid))

    def add_records(self, company_id, c):
        d = self.d
        done = {r['crm_record_id'] for r in d.all('SELECT crm_record_id FROM telema_crm_record_links WHERE crm_record_id = ANY(%s)',
                                                   ([r['id'] for r in self.records_by_customer.get(c['id'], [])],))}
        company = d.first('SELECT phone FROM telema_companies WHERE id = %s', (company_id,))
        have_contract = {(r['product_name'].replace(' ', ''), r['contract_date']) for r in
                         d.all('SELECT product_name, contract_date FROM telema_contracts WHERE company_id = %s AND is_active = 1', (company_id,))}
        recalls = []
        for r in sorted(self.records_by_customer.get(c['id'], []), key=lambda r: (_s(r.get('date')), _s(r.get('time')), r['id'])):
            if r['id'] in done:
                continue
            at = to_utc(r.get('date'), r.get('time'))
            if at is None:
                self.report['skipped_records'] += 1
                d.run("INSERT INTO telema_crm_record_links (crm_record_id, kind) VALUES (%s, 'skipped')", (r['id'],))
                continue
            typ, flag, memo = _s(r.get('type')), _s(r.get('flag')), _s(r.get('memo'))
            uid = self.assignee_id(r.get('assignedTo'))
            note = '\n'.join(x for x in [f'［顧客リストから：{typ}{"／" + flag if flag else ""}］', memo,
                                        f'録音リンク: {_s(r.get("voiceLink"))}' if _s(r.get('voiceLink')) else '',
                                        f'録音メモ: {_s(r.get("voiceMemo"))}' if _s(r.get('voiceMemo')) else ''] if x)
            kind, target = 'call', None
            if flag == '受注' or typ == '受注登録':
                product = _s(r.get('productName'))
                if product and (product.replace(' ', ''), _s(r.get('date'))) not in have_contract:
                    target = d.value('INSERT INTO telema_contracts (company_id, product_name, contract_date, assigned_user_id) VALUES (%s, %s, %s, %s) RETURNING id',
                                     (company_id, product, _s(r.get('date')), uid))
                    have_contract.add((product.replace(' ', ''), _s(r.get('date'))))
                    self.report['contracts'] += 1
                    kind = 'contract'
                if kind == 'contract' and not memo:
                    d.run('INSERT INTO telema_crm_record_links (crm_record_id, kind, target_id) VALUES (%s, %s, %s)', (r['id'], kind, target))
                    continue
            if typ in VISIT_TYPES:
                target = d.value('''INSERT INTO telema_call_logs (company_id, user_id, called_at, raw_note, ai_status, input_method, record_type, visit_method)
                                    VALUES (%s, %s, %s, %s, 'skipped', 'import', 'visit', 'visit') RETURNING id''', (company_id, uid, at, note))
                kind = 'visit'
                self.report['visits'] += 1
            else:
                status = self.statuses.get(FLAG_STATUS.get(flag, ''))
                target = d.value('''INSERT INTO telema_call_logs (company_id, user_id, called_at, phone_number, result_status_id, raw_note, ai_status, input_method, record_type)
                                    VALUES (%s, %s, %s, %s, %s, %s, 'skipped', 'import', 'call') RETURNING id''',
                                 (company_id, uid, at, company['phone'], status, note))
                self.report['calls'] += 1
                if flag == '再コール' and not r.get('recallDone') and _s(r.get('scheduledDate')):
                    recalls.append(to_utc(r.get('scheduledDate'), r.get('scheduledTime')))
            d.run('INSERT INTO telema_crm_record_links (crm_record_id, kind, target_id) VALUES (%s, %s, %s)', (r['id'], kind, target))
        self.finish_company(company_id, [x for x in recalls if x])

    def finish_company(self, company_id, recalls):
        """件数・最終架電日時を数え直し、ステータス・次回架電が空の施設は、取り込んだ履歴から決める（入っている値は変えない）"""
        d = self.d
        _recalc_company_calls(d, company_id)
        co = d.first('SELECT status_id, next_call_at FROM telema_companies WHERE id = %s', (company_id,))
        sets, params = [], []
        if co['status_id'] is None:
            sid = d.value("""SELECT result_status_id FROM telema_call_logs WHERE company_id = %s AND is_active = 1 AND record_type = 'call'
                             AND result_status_id IS NOT NULL ORDER BY called_at DESC, id DESC LIMIT 1""", (company_id,))
            if sid:
                sets.append('status_id = %s'); params.append(sid)
        if co['next_call_at'] is None and recalls:
            sets.append('next_call_at = %s'); params.append(min(recalls))
        if sets:
            d.run(f'UPDATE telema_companies SET {", ".join(sets)} WHERE id = %s', [*params, company_id])

    def add_relations(self, c):
        mine = self.links.get(c['id'])
        for o in self.neighbors.get(c['id'], ()):
            other = self.links.get(o)
            if not mine or not other or mine == other:
                continue
            a, b = sorted((mine, other))
            if self.d.first('SELECT 1 FROM telema_company_relations WHERE company_a_id = %s AND company_b_id = %s AND is_active = 1', (a, b)):
                continue
            self.d.run('INSERT INTO telema_company_relations (company_a_id, company_b_id, label, created_by) VALUES (%s, %s, %s, %s)', (a, b, LINK_LABEL, self.user['id']))
            self.report['relations'] += 1

    def run_one(self, c):
        if c['id'] in self.links:
            # 取り込み済みの顧客：その後に顧客リストへ増えた記録だけを足す
            self.add_records(self.links[c['id']], c)
            self.report['processed'] += 1
            return
        name = _s(c.get('enName')) or _s(c.get('gakuenName'))
        if not name:
            self.report['review'].append({'crm_id': c['id'], 'name': '（名前なし）', 'reason': '園名・法人名がない', 'candidates': []})
            return
        existing, reason, cands = self.find(c)
        if reason:
            self.report['review'].append({'crm_id': c['id'], 'name': name, 'reason': reason, 'candidates': [{'id': r['id'], 'name': r['company_name']} for r in cands][:5]})
            return
        if existing:
            company_id = existing['id']
            self.merge_company(company_id, c)
            self.report['merged'] += 1
        else:
            company_id = self.create_company(c)
            self.report['created'] += 1
        self.d.run('INSERT INTO telema_crm_links (crm_customer_id, company_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (c['id'], company_id))
        self.links[c['id']] = company_id
        self.add_contacts(company_id, c)
        self.add_associations(company_id, c)
        self.add_records(company_id, c)
        self.add_relations(c)
        self.report['processed'] += 1


@bp.post('/admin/customer-import')
def customer_import():
    require_role('admin')
    b = parse({'apply': Bool(), 'after_id': Int(nullable=True, optional=True), 'limit': Int(min=1, max=BATCH_MAX, optional=True)}, body())
    user, d = current_user(), db()
    customers, records = load_crm()
    imp = Importer(d, user, customers, records)
    after = b.get('after_id') or 0
    done_rec = {r['crm_record_id'] for r in d.all('SELECT crm_record_id FROM telema_crm_record_links')}
    has_new = lambda c: any(r['id'] not in done_rec for r in imp.records_by_customer.get(c['id'], []))   # noqa: E731
    # まだ取り込んでいない顧客と、取り込み済みでも新しい記録が増えた顧客
    pending = [c for c in customers if c['id'] > after and (c['id'] not in imp.links or has_new(c))]
    batch = pending[:b.get('limit') or BATCH_DEFAULT]
    imp.load_candidates(batch)
    for c in batch:
        imp.run_one(c)
    last_id = batch[-1]['id'] if batch else after
    if b['apply']:
        audit(d, user['id'], 'import', 'customer_import', None, None, {k: v for k, v in imp.report.items() if k not in ('review', 'unknown_assignees')})
    else:
        d.conn.rollback()      # 確認だけ：同じ処理を最後に取り消す
    return jsonify({**imp.report, 'next_after_id': last_id, 'done': len(pending) <= len(batch), 'remaining': max(0, len(pending) - len(batch)), 'applied': b['apply']})
