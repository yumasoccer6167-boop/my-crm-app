"""加盟協会の一覧（組織図・加盟施設数・加盟法人数など）。画面は「協会」タブ（マインドマップ表示とリスト表示）。
数えるのは有効な施設すべて（営業を含め、全員が同じ数字を見られる。リストのような「自分の担当・未割当のみ」の制限はしない）。協会に加盟している施設は telema_company_associations で決まる。"""
from collections import Counter

from flask import jsonify

from .common import ASSOCIATION, ASSOCIATION_CHAIR_COLUMN, ASSOCIATION_OFFICER_COLUMN, audit
from .context import ApiError, body, current_user, db, not_found, require_role
from .normalize import PREFECTURES
from .routes import bp
from .validate import Bool, Int, IntList, Str, parse, parse_id

MEMBERS_LIMIT = 2000


def _descendants(children, root_id):
    """協会とその下位の協会すべて（自分を含む）"""
    out, stack = [], [root_id]
    while stack:
        i = stack.pop()
        out.append(i)
        stack.extend(children.get(i, []))
    return out


@bp.get('/association-overview')
def association_overview():
    """協会ごとの加盟施設数・加盟法人数・ユーザー施設数と、協会会長・協会役員。
    数字は、下位の協会（地区単位・各地域の協会）の加盟施設も含む（同じ施設は1回だけ）。own_facility_count はその協会に直接加盟している施設の数。
    都道府県は、協会に指定したものを優先し、なければ加盟施設で一番多い都道府県"""
    d = db()
    assocs = d.all(f'SELECT id, name, is_active, sort_order, parent_id, is_top_level, prefecture AS prefecture_setting FROM {ASSOCIATION.master} ORDER BY sort_order, id')
    links = d.all(
        f'''SELECT ca.{ASSOCIATION.fk} AS association_id, c.id AS company_id, c.organization_id, c.is_user, c.prefecture
              FROM {ASSOCIATION.link} ca JOIN telema_companies c ON c.id = ca.company_id AND c.is_active = 1''')
    own = {}
    for r in links:
        own.setdefault(r['association_id'], []).append(r)
    children = {}
    for a in assocs:
        if a['parent_id'] is not None:
            children.setdefault(a['parent_id'], []).append(a['id'])
    # 協会会長・協会役員の担当者（施設の担当者と、法人に登録した担当者）。同じ人は協会ごとに1回だけ
    people = d.all(
        f'''SELECT DISTINCT ON (ca.{ASSOCIATION.fk}, k.id)
                   ca.{ASSOCIATION.fk} AS association_id, k.id AS contact_id, k.name, k.role,
                   k.is_association_chair, k.is_association_officer, c.id AS company_id, c.company_name
              FROM telema_contacts k
              JOIN telema_companies c ON c.is_active = 1 AND (k.company_id = c.id OR (k.company_id IS NULL AND k.organization_id = c.organization_id))
              JOIN {ASSOCIATION.link} ca ON ca.company_id = c.id
             WHERE k.is_active = 1 AND (k.is_association_chair = 1 OR k.is_association_officer = 1)
             ORDER BY ca.{ASSOCIATION.fk}, k.id, c.id''')
    by_assoc = {}
    for p in people:
        by_assoc.setdefault(p['association_id'], []).append(p)
    items = []
    for a in assocs:
        rows = {}
        for i in _descendants(children, a['id']):
            for r in own.get(i, []):
                rows[r['company_id']] = r
        prefs = Counter(r['prefecture'] for r in rows.values() if r['prefecture'])
        ps = by_assoc.get(a['id'], [])
        items.append({
            **a,
            'facility_count': len(rows),
            'own_facility_count': len(own.get(a['id'], [])),
            'organization_count': len({r['organization_id'] for r in rows.values() if r['organization_id'] is not None}),
            'user_count': sum(1 for r in rows.values() if r['is_user'] == 1),
            'prefecture': a['prefecture_setting'] or (prefs.most_common(1)[0][0] if prefs else None),
            # 会長が先、そのあと役員（同じ人が両方なら会長として出す）
            'chairs': [p for p in ps if p['is_association_chair']],
            'officers': [p for p in ps if p['is_association_officer'] and not p['is_association_chair']],
        })
    active = {a['id'] for a in assocs if a['is_active']}
    every = {}
    for r in links:
        if r['association_id'] in active:
            every[r['company_id']] = r
    totals = {
        'association_count': len(active),
        'facility_count': len(every),
        'organization_count': len({r['organization_id'] for r in every.values() if r['organization_id'] is not None}),
        'user_count': sum(1 for r in every.values() if r['is_user'] == 1),
    }
    return jsonify({'associations': items, 'totals': totals})


STRUCTURE_FIELDS = {'parent_id': Int(min=1, nullable=True), 'prefecture': Str(max=10, nullable=True), 'is_top_level': Bool()}


def _update_structure(d, id, b):
    """協会1件の組織図での位置を更新する（b は検証済みの項目）。変えた後の行を返す"""
    before = d.first(f'SELECT * FROM {ASSOCIATION.master} WHERE id = %s', (id,))
    if not before:
        raise not_found('加盟協会')
    if b.get('prefecture') is not None and b['prefecture'] not in PREFECTURES:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（prefecture: 都道府県名で指定してください）')
    if b.get('parent_id') is not None:
        pid = b['parent_id']
        if pid == id:
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（parent_id: 自分自身は親にできません：{before["name"]}）')
        # 親をたどって自分に戻ってくる（自分の下位の協会を親にする）ことはできない
        seen, cur = set(), pid
        while cur is not None:
            row = d.first(f'SELECT id, parent_id FROM {ASSOCIATION.master} WHERE id = %s', (cur,))
            if not row:
                raise ApiError(400, 'validation_error', '入力内容に誤りがあります（parent_id: 親の協会が見つかりません）')
            if row['id'] == id or row['id'] in seen:
                raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（parent_id: 下位の協会は親にできません：{before["name"]}）')
            seen.add(row['id'])
            cur = row['parent_id']
    sets = {k: b[k] for k in ('parent_id', 'prefecture', 'is_top_level') if k in b}
    # 最上位の組織は親も都道府県も持たない。親を選んだら最上位ではなくなる
    if sets.get('is_top_level'):
        if b.get('parent_id') is not None:
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（parent_id: 最上位の組織には親を指定できません）')
        sets.update({'parent_id': None, 'prefecture': None, 'is_top_level': 1})
    elif b.get('parent_id') is not None:
        sets['is_top_level'] = 0
    elif 'is_top_level' in sets:
        sets['is_top_level'] = 0
    if not sets:
        return before
    row = d.first(f'UPDATE {ASSOCIATION.master} SET {", ".join(f"{k} = %s" for k in sets)}, updated_at = telema_now() WHERE id = %s RETURNING *', [*sets.values(), id])
    audit(d, current_user()['id'], 'update', 'association_structure', id, {k: before[k] for k in sets}, sets)
    return row


@bp.patch('/associations/<id>/structure')
def set_association_structure(id):
    """協会の組織図での位置を決める（管理者のみ）。parent_id＝親の協会（null なら都道府県の協会）、prefecture＝都道府県の協会が入る都道府県（地区はここから決まる）、
    is_top_level＝組織図の最上位の組織（全日本私立幼稚園連合会と同じ位置。親・都道府県は持たない。複数登録できる）"""
    require_role('admin')
    id = parse_id(id)
    b = parse(STRUCTURE_FIELDS, body(), partial=True)
    return jsonify(_update_structure(db(), id, b))


@bp.post('/association-structure/bulk')
def set_association_structure_bulk():
    """複数の協会の組織図での位置を、まとめて同じ内容にする（管理者のみ）。項目は1件ずつの変更（/associations/<id>/structure）と同じ。
    1件でも入れられない協会（下位の協会を親にするなど）があれば、全件とも変更しない"""
    require_role('admin')
    raw = body()
    b = parse({'association_ids': IntList(min_len=1, max_len=500), **STRUCTURE_FIELDS}, raw, partial=True)
    if 'association_ids' not in b:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（association_ids: 必須です）')
    ids = list(dict.fromkeys(b.pop('association_ids')))
    if not b:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（変更する項目を指定してください）')
    d = db()
    for i in ids:
        _update_structure(d, i, b)
    return jsonify({'updated': len(ids)})


@bp.get('/association-overview/<id>/members')
def association_members(id):
    """協会に加盟している施設（法人でまとめて表示するための一覧）。協会会長・役員がいる施設には印が付く"""
    id = parse_id(id)
    d = db()
    assoc = d.first(f'SELECT id, name FROM {ASSOCIATION.master} WHERE id = %s', (id,))
    if not assoc:
        raise not_found('加盟協会')
    rows = d.all(
        f'''SELECT c.id, c.company_name, c.organization_id, o.name AS organization_name, c.is_user, c.is_headquarters, c.prefecture, c.city,
                   s.label AS status_label, s.category AS status_category, {ASSOCIATION_CHAIR_COLUMN}, {ASSOCIATION_OFFICER_COLUMN}
              FROM {ASSOCIATION.link} ca
              JOIN telema_companies c ON c.id = ca.company_id AND c.is_active = 1
              LEFT JOIN telema_organizations o ON o.id = c.organization_id
              LEFT JOIN telema_call_statuses s ON s.id = c.status_id
             WHERE ca.{ASSOCIATION.fk} = %s
             ORDER BY o.name NULLS LAST, c.organization_id NULLS LAST, c.is_headquarters DESC, c.company_name
             LIMIT %s''', [id, MEMBERS_LIMIT + 1])
    return jsonify({'association': assoc, 'truncated': len(rows) > MEMBERS_LIMIT, 'facilities': rows[:MEMBERS_LIMIT]})
