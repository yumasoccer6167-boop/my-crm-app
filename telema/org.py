"""組織図。部署のツリー（事業部 > 部 > 課 など、何階層でも）と、メンバーの所属（異動の履歴つき）。
 - 部署の追加・名前の変更・付け替え・並べ替え・削除は管理者。見るのは全員
 - 所属は異動日（effective_date）つきの記録。異動日以前で一番新しい記録が、その日の所属（department_id が null は所属なし）。異動は、新しい記録を足す
 - 今の所属の部署名は、CRM本体のユーザーの「部署」（users.department）にも写す（旧画面の絞り込み用）"""
from datetime import datetime

from flask import jsonify, request

from .agenda import parse_day
from .common import JST, audit
from .context import ApiError, body, current_user, db, not_found, require_role
from .routes import bp
from .validate import Int, IsoDate, Str, parse, parse_id

DEPARTMENT_BODY = {'name': Str(min=1, max=50), 'parent_id': Int(nullable=True, optional=True), 'sort_order': Int(optional=True)}


def _today():
    return datetime.now(JST).date()


def assignments_on(d, day):
    """day（日付）時点の各ユーザーの所属。{user_id: {'department_id', 'since', 'note'}}（所属の記録がないユーザーは含まない）"""
    rows = d.all(
        '''SELECT DISTINCT ON (user_id) user_id, department_id, effective_date AS since, note
             FROM telema_org_assignments WHERE effective_date <= %s ORDER BY user_id, effective_date DESC, id DESC''', (day.isoformat(),))
    return {r['user_id']: r for r in rows}


def department_of(d, user_id, day=None):
    """user_id の day（省略は今日）時点の所属の部署 {id, name}。所属なし・部署が無効になっていれば None"""
    a = d.first(
        '''SELECT department_id FROM telema_org_assignments WHERE user_id = %s AND effective_date <= %s
            ORDER BY effective_date DESC, id DESC LIMIT 1''', (user_id, (day or _today()).isoformat()))
    if not a or a['department_id'] is None:
        return None
    return d.first('SELECT id, name FROM telema_departments WHERE id = %s AND is_active = 1', (a['department_id'],))


def department_tree(d):
    """有効な部署を、兄弟順（sort_order, id）に並べて返す"""
    return d.all('SELECT id, name, parent_id, sort_order FROM telema_departments WHERE is_active = 1 ORDER BY sort_order, id')


def _sync_user_department(d, user_id):
    """今の所属の部署名を、CRM本体のユーザーの部署に写す"""
    dept = department_of(d, user_id)
    d.run('UPDATE users SET department = %s WHERE id = %s', (dept['name'] if dept else None, user_id))


def _load(d, id):
    row = d.first('SELECT * FROM telema_departments WHERE id = %s AND is_active = 1', (id,))
    if not row:
        raise not_found('部署')
    return row


def _check_parent(d, parent_id, self_id=None):
    if parent_id is None:
        return
    _load(d, parent_id)
    # 自分の配下には付け替えられない（輪になる）
    cur = parent_id
    while cur is not None:
        if cur == self_id:
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（parent_id: 自分の配下の部署には移せません）')
        cur = d.value('SELECT parent_id FROM telema_departments WHERE id = %s', (cur,))


def _check_name(d, name, parent_id, self_id=None):
    if d.first('SELECT 1 FROM telema_departments WHERE is_active = 1 AND name = %s AND parent_id IS NOT DISTINCT FROM %s AND id <> COALESCE(%s, 0)', (name, parent_id, self_id)):
        raise ApiError(409, 'conflict', f'同じ階層に「{name}」が既にあります')


@bp.get('/org')
def get_org():
    d = db()
    day = parse_day(request.args.get('date') or _today().isoformat(), 'date')
    asof = assignments_on(d, day)
    valid = {r['id'] for r in department_tree(d)}
    members = []
    for u in d.all('SELECT id, display_name, role FROM users ORDER BY display_name, id'):
        a = asof.get(u['id'])
        dept = a['department_id'] if a and a['department_id'] in valid else None
        members.append({'user_id': u['id'], 'name': u['display_name'], 'department_id': dept, 'since': a['since'] if a else None})
    return jsonify({'date': day.isoformat(), 'departments': department_tree(d), 'members': members})


@bp.post('/org/departments')
def create_department():
    require_role('admin')
    b = parse(DEPARTMENT_BODY, body())
    d = db()
    _check_parent(d, b.get('parent_id'))
    _check_name(d, b['name'], b.get('parent_id'))
    row = d.first(
        '''INSERT INTO telema_departments (name, parent_id, sort_order)
           VALUES (%s, %s, COALESCE(%s, (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM telema_departments WHERE parent_id IS NOT DISTINCT FROM %s))) RETURNING id, name, parent_id, sort_order''',
        (b['name'], b.get('parent_id'), b.get('sort_order'), b.get('parent_id')))
    audit(d, current_user()['id'], 'create', 'department', row['id'], None, row)
    return jsonify(row), 201


@bp.patch('/org/departments/<id>')
def update_department(id):
    require_role('admin')
    id = parse_id(id)
    b = parse(DEPARTMENT_BODY, body(), partial=True)
    d = db()
    before = _load(d, id)
    parent = b['parent_id'] if 'parent_id' in b else before['parent_id']
    name = b.get('name', before['name'])
    _check_parent(d, parent, id)
    _check_name(d, name, parent, id)
    row = d.first('UPDATE telema_departments SET name = %s, parent_id = %s, sort_order = COALESCE(%s, sort_order), updated_at = telema_now() WHERE id = %s RETURNING id, name, parent_id, sort_order',
                  (name, parent, b.get('sort_order'), id))
    for u in d.all('SELECT DISTINCT user_id FROM telema_org_assignments WHERE department_id = %s', (id,)):
        _sync_user_department(d, u['user_id'])
    audit(d, current_user()['id'], 'update', 'department', id, before, row)
    return jsonify(row)


@bp.delete('/org/departments/<id>')
def delete_department(id):
    """部署をなくす（履歴は残すので、実際は無効にする）。下に部署がある・今のメンバーがいる部署は消せない"""
    require_role('admin')
    id = parse_id(id)
    d = db()
    before = _load(d, id)
    if d.first('SELECT 1 FROM telema_departments WHERE parent_id = %s AND is_active = 1', (id,)):
        raise ApiError(409, 'conflict', 'この部署の下に部署があるため、削除できません')
    if any(a['department_id'] == id for a in assignments_on(d, _today()).values()):
        raise ApiError(409, 'conflict', 'この部署に所属しているメンバーがいるため、削除できません。先に異動させてください')
    d.run('UPDATE telema_departments SET is_active = 0, updated_at = telema_now() WHERE id = %s', (id,))
    audit(d, current_user()['id'], 'delete', 'department', id, before, None)
    return jsonify({'id': id})


@bp.post('/org/assignments')
def create_assignment():
    """異動（所属の変更）を登録する。department_id が null は所属なし。異動日は省略すると今日"""
    require_role('admin')
    b = parse({'user_id': Int(), 'department_id': Int(nullable=True), 'effective_date': IsoDate(optional=True), 'note': Str(max=200, nullable=True, optional=True)}, body())
    d = db()
    if not d.first('SELECT 1 FROM users WHERE id = %s', (b['user_id'],)):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: ユーザーが見つかりません）')
    if b['department_id'] is not None:
        _load(d, b['department_id'])
    day = b.get('effective_date') or _today().isoformat()
    row = d.first(
        '''INSERT INTO telema_org_assignments (user_id, department_id, effective_date, note, created_by) VALUES (%s, %s, %s, %s, %s)
           RETURNING id, user_id, department_id, effective_date, note''', (b['user_id'], b['department_id'], day, b.get('note') or None, current_user()['id']))
    _sync_user_department(d, b['user_id'])
    audit(d, current_user()['id'], 'create', 'org_assignment', row['id'], None, row)
    return jsonify(row), 201


@bp.get('/org/history')
def org_history():
    """メンバーの所属の履歴（新しい順）。管理者・マネージャーは誰の分も、一般は自分の分だけ"""
    user, d = current_user(), db()
    raw = request.args.get('user_id')
    uid = user['id'] if user['role'] == 'sales' or not raw else (int(raw) if raw.isdigit() else None)
    if uid is None:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: 数値で指定してください）')
    rows = d.all(
        '''SELECT a.id, a.department_id, dp.name AS department_name, a.effective_date, a.note
             FROM telema_org_assignments a LEFT JOIN telema_departments dp ON dp.id = a.department_id
            WHERE a.user_id = %s ORDER BY a.effective_date DESC, a.id DESC''', (uid,))
    return jsonify({'user_id': uid, 'items': rows})
