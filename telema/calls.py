"""架電履歴。原文(raw_note)を最優先で保存し、AI解析はこの保存とは独立して後から実行する（AI障害で履歴が失われない）。"""
from flask import jsonify

from .common import audit, can_edit_company
from .companies import load_visible_company
from .context import body, current_user, db, forbidden, not_found
from .routes import bp
from .validate import Int, IsoDatetime, Str, now_iso, parse, parse_id

CALL_BODY = {
    'raw_note': Str(max=5000, trim=False, default=''),
    'called_at': IsoDatetime(optional=True),
    'result_status_id': Int(nullable=True, optional=True),
    'contact_id': Int(nullable=True, optional=True),
    'phone_number': Str(max=30, nullable=True, optional=True),
    # 利用者が画面で明示的に決めた次回予定（AI提案の自動反映ではない）
    'next_call_at': IsoDatetime(nullable=True, optional=True),
    'next_action': Str(max=500, nullable=True, optional=True),
}

CALL_SELECT = '''SELECT cl.*, ct.name AS contact_name, u.display_name AS user_name, s.label AS result_label, s.category AS result_category
  FROM telema_call_logs cl
  LEFT JOIN telema_contacts ct ON ct.id = cl.contact_id
  LEFT JOIN users u ON u.id = cl.user_id
  LEFT JOIN telema_call_statuses s ON s.id = cl.result_status_id'''


@bp.get('/companies/<id>/calls')
def list_calls(id):
    id = parse_id(id)
    load_visible_company(id)
    return jsonify(db().all(f'{CALL_SELECT} WHERE cl.company_id = %s AND cl.is_active = 1 ORDER BY cl.called_at DESC, cl.id DESC', (id,)))


@bp.post('/companies/<id>/calls')
def create_call(id):
    id = parse_id(id)
    b = parse(CALL_BODY, body())
    user = current_user()
    d = db()
    company = load_visible_company(id)
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()

    called_at = b.get('called_at') or now_iso()
    call_id = d.value(
        '''INSERT INTO telema_call_logs (company_id, contact_id, user_id, called_at, phone_number, result_status_id, raw_note, ai_status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
        (id, b.get('contact_id'), user['id'], called_at, b.get('phone_number') or company['phone'], b.get('result_status_id'),
         b['raw_note'], 'pending' if b['raw_note'].strip() else 'skipped'),
    )
    # 履歴を先に確定させる（この後の会社更新で失敗しても架電メモは残す）
    d.commit()

    # 会社の「現在の状態」を更新（利用者が入力した値のみ）
    sets = [
        'last_called_at = CASE WHEN last_called_at IS NULL OR last_called_at < %s THEN %s ELSE last_called_at END',
        'call_count = call_count + 1',
        'updated_at = telema_now()',
    ]
    params = [called_at, called_at]
    for key, col in (('result_status_id', 'status_id'), ('next_call_at', 'next_call_at'), ('next_action', 'next_action')):
        if key in b:
            sets.append(f'{col} = %s')
            params.append(b[key])
    # 担当未割当の会社に sales が架電したら自分の担当にする
    if user['role'] == 'sales' and company['assigned_user_id'] is None:
        sets.append('assigned_user_id = %s')
        params.append(user['id'])
    d.run(f'UPDATE telema_companies SET {", ".join(sets)} WHERE id = %s', [*params, id])
    audit(d, user['id'], 'create', 'call_log', call_id, None, {'company_id': id, **b})

    return jsonify(d.first(f'{CALL_SELECT} WHERE cl.id = %s', (call_id,))), 201


@bp.post('/calls/<id>/deactivate')
def deactivate_call(id):
    """架電履歴は削除せず無効化する"""
    id = parse_id(id)
    user = current_user()
    d = db()
    call = d.first('SELECT * FROM telema_call_logs WHERE id = %s AND is_active = 1', (id,))
    if not call:
        raise not_found('架電履歴')
    load_visible_company(call['company_id'])
    if user['role'] == 'sales' and call['user_id'] != user['id']:
        raise forbidden()
    d.run('UPDATE telema_call_logs SET is_active = 0, updated_at = telema_now() WHERE id = %s', (id,))
    # 件数・最終架電日時を有効な履歴から再計算
    d.run(
        '''UPDATE telema_companies SET call_count = (SELECT COUNT(*) FROM telema_call_logs WHERE company_id = %(cid)s AND is_active = 1),
             last_called_at = (SELECT MAX(called_at) FROM telema_call_logs WHERE company_id = %(cid)s AND is_active = 1),
             updated_at = telema_now() WHERE id = %(cid)s''',
        {'cid': call['company_id']},
    )
    audit(d, user['id'], 'deactivate', 'call_log', id, call)
    return jsonify({'ok': True})
