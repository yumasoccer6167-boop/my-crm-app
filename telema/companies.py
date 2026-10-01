"""施設一覧・会社カルテ・先方担当者。"""
from flask import jsonify, request

from .common import audit, can_edit_company, company_visibility, jst_day_range
from .context import ApiError, body, current_user, db, forbidden, not_found, require_role
from .normalize import (display_phone, extract_domain, normalize_address, normalize_company_name,
                        normalize_phone, normalize_postal_code, split_prefecture_city, escape_like)
from .routes import bp
from .validate import Bool, Email, Enum, Int, IntList, IsoDatetime, Num, Str, parse, parse_id

TEMPERATURES = ['unrated', 'low', 'mid', 'high']

# 会社カルテの項目（src/telema/shared/fields.ts の COMPANY_FIELDS と同じ）。情報源（company_field_sources）を記録する対象
COMPANY_FIELDS = [
    'company_name', 'name_kana', 'facility_code', 'corporate_number', 'phone', 'phone_alt', 'website', 'postal_code',
    'address', 'industry', 'employee_count', 'google_rating', 'google_review_count', 'map_url', 'notes',
    'interest', 'pain_point', 'decision_timing', 'budget', 'current_service', 'competitor', 'ng_reason', 'next_action', 'current_note',
]

# ---------- 一覧 ----------
SORTS = {
    'next_call_at': ['c.next_call_at IS NULL', 'c.next_call_at'],
    'last_called_at': ['c.last_called_at IS NULL', 'c.last_called_at'],
    'company_name': ['c.company_name_normalized'],
    'temperature': ["CASE c.temperature WHEN 'high' THEN 3 WHEN 'mid' THEN 2 WHEN 'low' THEN 1 ELSE 0 END"],
    'updated_at': ['c.updated_at'],
    'google_rating': ['c.google_rating IS NULL', 'c.google_rating'],
    'google_review_count': ['c.google_review_count IS NULL', 'c.google_review_count'],
}


def _list_query():
    a = request.args
    q = {}

    def get(name):
        v = a.get(name)
        return None if v is None or v == '' else v

    def num(name, integer=False, lo=None, hi=None):
        v = get(name)
        if v is None:
            return None
        try:
            n = int(v) if integer else float(v)
        except ValueError:
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{name}: 数値で指定してください）')
        if (lo is not None and n < lo) or (hi is not None and n > hi):
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{name}: 範囲外の値です）')
        return n

    q['q'] = (get('q') or '').strip()[:100] or None
    q['status_id'] = num('status_id', True)
    q['category'] = (get('category') or '')[:20] or None
    for k, mx in (('industry', 100), ('prefecture', 10), ('city', 50)):
        q[k] = (get(k) or '')[:mx] or None
    assigned = get('assigned')
    q['assigned'] = assigned if assigned in (None, 'me', 'none') else num('assigned', True)
    q['temperature'] = get('temperature')
    if q['temperature'] is not None and q['temperature'] not in TEMPERATURES:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（temperature: 選択肢にない値です）')
    q['source_id'] = num('source_id', True)
    q['next_call'] = get('next_call')
    if q['next_call'] not in (None, 'today', 'overdue', 'week', 'none'):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（next_call: 選択肢にない値です）')
    q['rating_min'] = num('rating_min', lo=0, hi=5)
    q['reviews_min'] = num('reviews_min', True, lo=0)
    q['sort'] = get('sort') or 'next_call_at'
    if q['sort'] not in SORTS:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（sort: 選択肢にない値です）')
    q['order'] = 'DESC' if get('order') == 'desc' else 'ASC'
    q['page'] = num('page', True, lo=1) or 1
    q['per_page'] = num('per_page', True, lo=1, hi=100) or 50
    # 件数は全件を数えるので、ページ送り等で件数が変わらない場合はクライアントが skip_count=1 で省略する
    q['skip_count'] = get('skip_count') == '1'
    return q


@bp.get('/companies')
def list_companies():
    q = _list_query()
    user = current_user()
    vis_sql, vis_params = company_visibility(user)
    where = ['c.is_active = 1', vis_sql]
    params = list(vis_params)

    if q['q']:
        # search_text（施設名・カナ・住所・電話・法人名・担当者名）の部分一致。電話番号は区切りを除いた数字でも探す
        digits = ''.join(ch for ch in q['q'] if ch.isdigit())
        if len(digits) >= 3 and digits != q['q']:
            where.append('(c.search_text ILIKE %s OR c.search_text ILIKE %s)')
            params += [f'%{escape_like(q["q"])}%', f'%{digits}%']
        else:
            where.append('c.search_text ILIKE %s')
            params.append(f'%{escape_like(q["q"])}%')
    if q['status_id'] is not None:
        where.append('c.status_id = %s')
        params.append(q['status_id'])
    if q['category'] == 'not_started':
        where.append("(c.status_id IS NULL OR s.category = 'not_started')")
    elif q['category']:
        where.append('s.category = %s')
        params.append(q['category'])
    for col in ('industry', 'prefecture', 'city', 'temperature'):
        if q[col]:
            where.append(f'c.{col} = %s')
            params.append(q[col])
    if q['assigned'] == 'me':
        where.append('c.assigned_user_id = %s')
        params.append(user['id'])
    elif q['assigned'] == 'none':
        where.append('c.assigned_user_id IS NULL')
    elif q['assigned'] is not None:
        where.append('c.assigned_user_id = %s')
        params.append(q['assigned'])
    if q['rating_min'] is not None:
        where.append('c.google_rating >= %s')
        params.append(q['rating_min'])
    if q['reviews_min'] is not None:
        where.append('c.google_review_count >= %s')
        params.append(q['reviews_min'])
    if q['source_id'] is not None:
        where.append('c.id IN (SELECT cs.company_id FROM telema_company_sources cs WHERE cs.source_id = %s)')
        params.append(q['source_id'])
    if q['next_call']:
        today_start, today_end = jst_day_range(0)
        if q['next_call'] == 'today':
            where.append('c.next_call_at < %s')
            params.append(today_end)
        elif q['next_call'] == 'overdue':
            where.append('c.next_call_at < %s')
            params.append(today_start)
        elif q['next_call'] == 'week':
            where.append('c.next_call_at < %s')
            params.append(jst_day_range(7)[1])
        else:
            where.append('c.next_call_at IS NULL')

    frm = f'''FROM telema_companies c
      LEFT JOIN telema_call_statuses s ON s.id = c.status_id
      LEFT JOIN telema_organizations o ON o.id = c.organization_id
      LEFT JOIN users u ON u.id = c.assigned_user_id
      WHERE {' AND '.join(where)}'''
    order = ', '.join(p if p.endswith('IS NULL') else f'{p} {q["order"]}' for p in SORTS[q['sort']]) + ', c.id'

    d = db()
    rows = d.all(
        f'''SELECT c.id, c.company_name, o.name AS organization_name, c.phone, c.city, c.industry,
              c.google_rating, c.google_review_count, c.status_id, s.label AS status_label, s.category AS status_category, c.temperature,
              (SELECT ct.name FROM telema_contacts ct WHERE ct.company_id = c.id AND ct.is_active = 1 AND ct.name IS NOT NULL
                 ORDER BY ct.is_decision_maker DESC, ct.updated_at DESC LIMIT 1) AS contact_name,
              c.last_called_at, c.next_call_at, c.call_count, c.assigned_user_id, u.display_name AS assigned_user_name, c.updated_at
            {frm} ORDER BY {order} LIMIT %s OFFSET %s''',
        [*params, q['per_page'], (q['page'] - 1) * q['per_page']],
    )
    total = None if q['skip_count'] else d.value(f'SELECT COUNT(*) {frm}', params)
    return jsonify({'total': total, 'page': q['page'], 'per_page': q['per_page'], 'items': rows})


@bp.get('/companies/facets')
def company_facets():
    """絞り込み候補（業種・市区町村）"""
    vis_sql, vis_params = company_visibility(current_user())
    d = db()
    industries = d.all(
        f'''SELECT c.industry AS value, COUNT(*) AS n FROM telema_companies c WHERE c.is_active = 1 AND c.industry IS NOT NULL AND {vis_sql}
            GROUP BY c.industry ORDER BY n DESC LIMIT 100''', vis_params)
    cities = d.all(
        f'''SELECT c.city AS value, COUNT(*) AS n FROM telema_companies c WHERE c.is_active = 1 AND c.city IS NOT NULL AND {vis_sql}
            GROUP BY c.city ORDER BY n DESC LIMIT 200''', vis_params)
    return jsonify({'industries': industries, 'cities': cities})


# ---------- 編集 ----------
def _text(mx):
    return Str(max=mx, nullable=True)


COMPANY_PATCH = {
    'company_name': Str(min=1, max=200),
    'name_kana': _text(200),
    'facility_code': _text(50),
    'corporate_number': Str(pattern=r'\d{13}', pattern_msg='法人番号は13桁の数字です', nullable=True),
    'phone': _text(30),
    'phone_alt': _text(30),
    'website': _text(500),
    'postal_code': _text(10),
    'address': _text(300),
    'industry': _text(100),
    'employee_count': Int(min=0, nullable=True),
    'google_rating': Num(min=0, max=5, nullable=True),
    'google_review_count': Int(min=0, nullable=True),
    'map_url': _text(1000),
    'notes': _text(2000),
    'interest': _text(500),
    'pain_point': _text(500),
    'decision_timing': _text(100),
    'budget': _text(100),
    'current_service': _text(200),
    'competitor': _text(200),
    'ng_reason': _text(500),
    'next_action': _text(500),
    'current_note': _text(2000),
    # カルテ項目以外の営業状態（利用者が明示的に設定するもの）
    'status_id': Int(nullable=True),
    'temperature': Enum(TEMPERATURES),
    'next_call_at': IsoDatetime(nullable=True),
    'assigned_user_id': Int(nullable=True),
}


def derived_columns(v):
    """入力値から正規化列を作る"""
    d = {}
    if 'company_name' in v:
        d['company_name_normalized'] = normalize_company_name(v['company_name'])
    if 'phone' in v:
        d['phone'] = display_phone(v['phone'])
        d['phone_normalized'] = normalize_phone(v['phone'])
    if 'website' in v:
        d['website_domain'] = extract_domain(v['website'])
    if 'postal_code' in v:
        d['postal_code'] = normalize_postal_code(v['postal_code'])
    if 'address' in v:
        a = v['address'] or ''
        d['address_normalized'] = normalize_address(a) or None
        d['prefecture'], d['city'] = split_prefecture_city(a)
    return d


def load_visible_company(company_id):
    vis_sql, vis_params = company_visibility(current_user())
    company = db().first(f'SELECT c.* FROM telema_companies c WHERE c.id = %s AND c.is_active = 1 AND {vis_sql}', [company_id, *vis_params])
    if not company:
        raise not_found('会社')
    company.pop('search_text', None)
    return company


@bp.get('/companies/<id>')
def get_company(id):
    id = parse_id(id)
    company = load_visible_company(id)
    d = db()
    org_id = company['organization_id']
    return jsonify({
        'company': company,
        'organization': d.first('SELECT * FROM telema_organizations WHERE id = %s', (org_id,)) if org_id else None,
        'contacts': d.all(
            '''SELECT * FROM telema_contacts WHERE is_active = 1 AND (company_id = %s OR (company_id IS NULL AND organization_id = %s))
               ORDER BY is_decision_maker DESC, updated_at DESC''', (id, org_id)),
        'sources': d.all(
            '''SELECT cs.id, cs.source_id, cs.source_row, cs.created_at, ls.name, ls.source_type, ij.file_name
               FROM telema_company_sources cs LEFT JOIN telema_list_sources ls ON ls.id = cs.source_id
               LEFT JOIN telema_import_jobs ij ON ij.id = cs.import_job_id
               WHERE cs.company_id = %s ORDER BY cs.created_at''', (id,)),
        'field_sources': d.all('SELECT field, source, source_ref, confidence, updated_at FROM telema_company_field_sources WHERE company_id = %s', (id,)),
        'siblings': d.all(
            '''SELECT c.id, c.company_name, s.label AS status_label FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id
               WHERE c.organization_id = %s AND c.id <> %s AND c.is_active = 1 ORDER BY c.company_name LIMIT 50''', (org_id, id)) if org_id else [],
        'pending_suggestions': d.value("SELECT COUNT(*) FROM telema_ai_suggestions WHERE company_id = %s AND status = 'pending'", (id,)),
    })


def _company_out(row):
    row.pop('search_text', None)
    return row


@bp.post('/companies')
def create_company():
    raw = body()
    b = parse({**COMPANY_PATCH, 'organization_name': Str(max=200, optional=True)}, raw, partial=True)
    if 'company_name' not in b:
        parse({'company_name': COMPANY_PATCH['company_name']}, raw)
    organization_name = b.pop('organization_name', None)
    user = current_user()
    d = db()
    organization_id = None
    if organization_name:
        norm = normalize_company_name(organization_name)
        found = d.first('SELECT id FROM telema_organizations WHERE name_normalized = %s LIMIT 1', (norm,))
        organization_id = found['id'] if found else d.value(
            'INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (organization_name, norm))
    values = {
        **b,
        **derived_columns(b),
        'organization_id': organization_id,
        'assigned_user_id': b.get('assigned_user_id') if b.get('assigned_user_id') is not None else (user['id'] if user['role'] == 'sales' else None),
    }
    cols = list(values)
    row = d.first(
        f'INSERT INTO telema_companies ({", ".join(cols)}) VALUES ({", ".join(["%s"] * len(cols))}) RETURNING *',
        [values[k] for k in cols],
    )
    for f in (k for k in b if k in COMPANY_FIELDS and b[k] is not None):
        d.run("INSERT INTO telema_company_field_sources (company_id, field, source, updated_by) VALUES (%s, %s, 'manual', %s)", (row['id'], f, user['id']))
    row = _company_out(row)
    audit(d, user['id'], 'create', 'company', row['id'], None, row)
    return jsonify(row), 201


@bp.post('/companies/bulk-assign')
def bulk_assign():
    """営業担当の一括割当（manager/admin のみ）。assigned_user_id = null で割当を外す"""
    require_role('manager', 'admin')
    b = parse({'company_ids': IntList(min_len=1, max_len=500), 'assigned_user_id': Int(min=1, nullable=True)}, body())
    user = current_user()
    d = db()
    target_user = b['assigned_user_id']
    if target_user is not None and not d.first('SELECT id FROM users WHERE id = %s', (target_user,)):
        raise not_found('営業担当')
    ids = list(dict.fromkeys(b['company_ids']))
    before = d.all('SELECT id, assigned_user_id FROM telema_companies WHERE is_active = 1 AND id = ANY(%s)', (ids,))
    changed = [r for r in before if r['assigned_user_id'] != target_user]
    for r in changed:
        d.run('UPDATE telema_companies SET assigned_user_id = %s, updated_at = telema_now() WHERE id = %s', (target_user, r['id']))
        audit(d, user['id'], 'assign', 'company', r['id'], {'assigned_user_id': r['assigned_user_id']}, {'assigned_user_id': target_user})
    return jsonify({'updated': len(changed), 'unchanged': len(before) - len(changed), 'not_found': len(ids) - len(before)})


@bp.patch('/companies/<id>')
def update_company(id):
    id = parse_id(id)
    b = parse(COMPANY_PATCH, body(), partial=True)
    user = current_user()
    before = load_visible_company(id)
    if not can_edit_company(user, before['assigned_user_id']):
        raise forbidden()
    if 'assigned_user_id' in b and user['role'] == 'sales' and b['assigned_user_id'] not in (user['id'], None):
        raise ApiError(403, 'forbidden', '担当営業の変更は自分自身への割当のみ可能です')
    values = {**b, **derived_columns(b)}
    cols = list(values)
    if not cols:
        return jsonify(before)
    d = db()
    changed_fields = [k for k in b if k in COMPANY_FIELDS and before.get(k) != values[k]]
    row = d.first(
        f'UPDATE telema_companies SET {", ".join(f"{k} = %s" for k in cols)}, updated_at = telema_now() WHERE id = %s RETURNING *',
        [*[values[k] for k in cols], id],
    )
    for f in changed_fields:
        d.run(
            '''INSERT INTO telema_company_field_sources (company_id, field, source, source_ref, confidence, updated_by, updated_at)
               VALUES (%s, %s, 'manual', NULL, NULL, %s, telema_now())
               ON CONFLICT (company_id, field) DO UPDATE SET source = 'manual', source_ref = NULL, confidence = NULL,
                 updated_by = excluded.updated_by, updated_at = excluded.updated_at''',
            (id, f, user['id']),
        )
    audit(d, user['id'], 'update', 'company', id, {k: before.get(k) for k in cols}, values)
    return jsonify(_company_out(row))


# ---------- 先方担当者 ----------
CONTACT_BODY = {
    'name': _text(100),
    'department': _text(100),
    'role': _text(100),
    'phone': _text(30),
    'email': Email(nullable=True),
    'is_decision_maker': Bool(),
    'notes': _text(1000),
}


@bp.post('/companies/<id>/contacts')
def create_contact(id):
    id = parse_id(id)
    b = parse(CONTACT_BODY, body(), partial=True)
    user = current_user()
    company = load_visible_company(id)
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    d = db()
    row = d.first(
        '''INSERT INTO telema_contacts (company_id, organization_id, name, department, role, phone, email, is_decision_maker, notes, source)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'manual') RETURNING *''',
        (id, company['organization_id'], b.get('name'), b.get('department'), b.get('role'), b.get('phone'), b.get('email'),
         int(bool(b.get('is_decision_maker'))), b.get('notes')),
    )
    audit(d, user['id'], 'create', 'contact', row['id'], None, row)
    return jsonify(row), 201


@bp.patch('/contacts/<id>')
def update_contact(id):
    id = parse_id(id)
    b = parse({**CONTACT_BODY, 'is_active': Bool()}, body(), partial=True)
    user = current_user()
    d = db()
    before = d.first('SELECT * FROM telema_contacts WHERE id = %s', (id,))
    if not before:
        raise not_found('担当者')
    if before['company_id']:
        company = load_visible_company(before['company_id'])
        if not can_edit_company(user, company['assigned_user_id']):
            raise forbidden()
    elif user['role'] == 'sales':
        raise forbidden()
    values = dict(b)
    if 'is_decision_maker' in b:
        values['is_decision_maker'] = int(b['is_decision_maker'])
    if 'is_active' in b:
        values['is_active'] = int(b['is_active'])
    cols = list(values)
    if not cols:
        return jsonify(before)
    # 手で直した担当者は手入力扱いにする
    row = d.first(
        f'''UPDATE telema_contacts SET {", ".join(f"{k} = %s" for k in cols)}, source = 'manual', confidence = NULL,
              updated_at = telema_now() WHERE id = %s RETURNING *''',
        [*[values[k] for k in cols], id],
    )
    audit(d, user['id'], 'deactivate' if b.get('is_active') is False else 'update', 'contact', id, before, row)
    return jsonify(row)
