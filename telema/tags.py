"""施設に複数付けられるラベル（加盟協会・リスト種類）のAPI。
マスタ（設定画面で管理者が追加・名称変更・無効化）／施設ごとの付け外し／一括割り振りを、種類ごと（common.TAG_KINDS）に同じ形で作る。"""
from flask import jsonify

from .common import TAG_KINDS, TagKind, audit, can_edit_company
from .companies import load_visible_company
from .context import ApiError, body, current_user, db, forbidden, not_found, require_role
from .routes import bp
from .validate import Bool, Enum, Int, IntList, Str, parse, parse_id

MASTER_BODY = {
    'name': Str(min=1, max=100),
    'sort_order': Int(optional=True),
    'is_active': Bool(optional=True),
}


def register(kind: TagKind):
    ids_key, id_key = f'{kind.key}_ids', f'{kind.key}_id'
    label, master, link, fk = kind.label, kind.master, kind.link, kind.fk
    audit_master, audit_link = kind.key, f'company_{kind.slug.replace("-", "_")}'

    # ---- マスタ ----
    def list_master():
        return jsonify(db().all(f'SELECT * FROM {master} ORDER BY sort_order, id'))

    def create_master():
        require_role('admin')
        b = parse(MASTER_BODY, body())
        d = db()
        if d.first(f'SELECT 1 FROM {master} WHERE name = %s', (b['name'],)):
            raise ApiError(409, 'conflict', f'{label}「{b["name"]}」は既にあります')
        row = d.first(
            f'''INSERT INTO {master} (name, sort_order)
                VALUES (%s, COALESCE(%s, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM {master}))) RETURNING *''',
            (b['name'], b.get('sort_order')),
        )
        audit(d, current_user()['id'], 'create', audit_master, row['id'], None, row)
        return jsonify(row), 201

    def update_master(id):
        require_role('admin')
        id = parse_id(id)
        b = parse(MASTER_BODY, body(), partial=True)
        d = db()
        before = d.first(f'SELECT * FROM {master} WHERE id = %s', (id,))
        if not before:
            raise not_found(label)
        if 'name' in b and b['name'] != before['name'] and d.first(f'SELECT 1 FROM {master} WHERE name = %s', (b['name'],)):
            raise ApiError(409, 'conflict', f'{label}「{b["name"]}」は既にあります')
        row = d.first(
            f'''UPDATE {master} SET name = COALESCE(%s, name), sort_order = COALESCE(%s, sort_order),
                  is_active = COALESCE(%s, is_active), updated_at = telema_now() WHERE id = %s RETURNING *''',
            (b.get('name'), b.get('sort_order'), None if b.get('is_active') is None else int(b['is_active']), id),
        )
        audit(d, current_user()['id'], 'update', audit_master, id, before, row)
        return jsonify(row)

    # ---- 施設ごと ----
    def set_for_company(id):
        """施設のラベルを、送られた一覧に置き換える。無効にしたものでも、すでに付いているものは外すまで残る
        （新しく付けられるのは有効なものだけ）"""
        id = parse_id(id)
        b = parse({ids_key: IntList(max_len=100)}, body())
        ids = list(dict.fromkeys(b[ids_key]))
        user = current_user()
        company = load_visible_company(id)
        if not can_edit_company(user, company['assigned_user_id']):
            raise forbidden()
        d = db()
        found = {r['id']: r for r in d.all(f'SELECT id, is_active FROM {master} WHERE id = ANY(%s)', (ids,))}
        if len(found) != len(ids):
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{ids_key}: {label}が見つかりません）')
        before = [r['id'] for r in d.all(kind.of_company, (id,))]
        if any(not found[i]['is_active'] and i not in before for i in ids):
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{ids_key}: 無効な{label}は追加できません）')
        d.run(f'DELETE FROM {link} WHERE company_id = %s AND NOT ({fk} = ANY(%s))', (id, ids))
        for tag_id in ids:
            d.run(f'INSERT INTO {link} (company_id, {fk}) VALUES (%s, %s) ON CONFLICT DO NOTHING', (id, tag_id))
        d.run('UPDATE telema_companies SET updated_at = telema_now() WHERE id = %s', (id,))
        after = d.all(kind.of_company, (id,))
        audit(d, user['id'], 'update', audit_link, id, {ids_key: before}, {ids_key: [r['id'] for r in after]})
        return jsonify(after)

    def bulk():
        """一括割り振り（営業担当の一括割当と同じく manager / admin のみ）。
        mode: add＝今のラベルに追加 / remove＝そのラベルだけ外す / replace＝そのラベルだけにする（id=null なら全部外す）"""
        require_role('manager', 'admin')
        b = parse({
            'company_ids': IntList(min_len=1, max_len=500),
            id_key: Int(min=1, nullable=True),
            'mode': Enum(['add', 'remove', 'replace']),
        }, body())
        mode, target = b['mode'], b[id_key]
        if target is None and mode != 'replace':
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{id_key}: {label}を指定してください）')
        user = current_user()
        d = db()
        if target is not None:
            tag = d.first(f'SELECT id, is_active FROM {master} WHERE id = %s', (target,))
            if not tag:
                raise not_found(label)
            if mode != 'remove' and not tag['is_active']:
                raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{id_key}: 無効な{label}は割り当てられません）')

        ids = list(dict.fromkeys(b['company_ids']))
        companies = [r['id'] for r in d.all('SELECT id FROM telema_companies WHERE is_active = 1 AND id = ANY(%s)', (ids,))]
        current = {}
        for r in d.all(f'SELECT company_id, {fk} AS tag_id FROM {link} WHERE company_id = ANY(%s)', (companies,)):
            current.setdefault(r['company_id'], set()).add(r['tag_id'])

        updated = 0
        for cid in companies:
            before = current.get(cid, set())
            if mode == 'add':
                after = before | {target}
            elif mode == 'remove':
                after = before - {target}
            else:
                after = {target} if target is not None else set()
            if after == before:
                continue
            removed, added = sorted(before - after), sorted(after - before)
            if removed:
                d.run(f'DELETE FROM {link} WHERE company_id = %s AND {fk} = ANY(%s)', (cid, removed))
            for tag_id in added:
                d.run(f'INSERT INTO {link} (company_id, {fk}) VALUES (%s, %s) ON CONFLICT DO NOTHING', (cid, tag_id))
            d.run('UPDATE telema_companies SET updated_at = telema_now() WHERE id = %s', (cid,))
            audit(d, user['id'], 'update', audit_link, cid, {ids_key: sorted(before)}, {ids_key: sorted(after)})
            updated += 1
        return jsonify({'updated': updated, 'unchanged': len(companies) - updated, 'not_found': len(ids) - len(companies)})

    k = kind.key
    bp.add_url_rule(f'/{kind.slug}', f'{k}_master_list', list_master, methods=['GET'])
    bp.add_url_rule(f'/{kind.slug}', f'{k}_master_create', create_master, methods=['POST'])
    bp.add_url_rule(f'/{kind.slug}/<id>', f'{k}_master_update', update_master, methods=['PATCH'])
    bp.add_url_rule(f'/companies/<id>/{kind.slug}', f'{k}_set_for_company', set_for_company, methods=['PATCH'])
    bp.add_url_rule(f'/companies/bulk-{kind.slug}', f'{k}_bulk', bulk, methods=['POST'])


for _kind in TAG_KINDS:
    register(_kind)
