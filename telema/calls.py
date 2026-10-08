"""架電履歴。原文(raw_note)を最優先で保存し、AI解析はこの保存とは独立して後から実行する（AI障害で履歴が失われない）。"""
from flask import jsonify

from .common import audit, can_edit_company
from .companies import load_visible_company
from .context import ApiError, body, current_user, db, forbidden, not_found
from .routes import bp
from .validate import Enum, Int, IsoDatetime, Str, now_iso, parse, parse_id

CALL_BODY = {
    'raw_note': Str(max=5000, trim=False, default=''),
    'called_at': IsoDatetime(optional=True),
    'result_status_id': Int(nullable=True, optional=True),
    'contact_id': Int(nullable=True, optional=True),
    'phone_number': Str(max=30, nullable=True, optional=True),
    # 利用者が画面で明示的に決めた次回予定（AI提案の自動反映ではない）
    'next_call_at': IsoDatetime(nullable=True, optional=True),
    'next_action': Str(max=500, nullable=True, optional=True),
    # どの部署の記録か（営業部・制作部・CS など。ユーザーの施設でタイムラインを部署別に見るため）。省略・null は未分類
    'section_id': Int(nullable=True, optional=True),
    # 記録の種類。省略は架電。訪問（visit）のときは方法（visit＝訪問／zoom）が必須
    'record_type': Enum(['call', 'visit'], default='call'),
    'visit_method': Enum(['visit', 'zoom'], nullable=True, optional=True),
    # 「時間設定」の結果のときの、訪問する日時と事前確認の日時（任意）
    'visit_at': IsoDatetime(nullable=True, optional=True),
    'precheck_at': IsoDatetime(nullable=True, optional=True),
}

_APPOINTMENT_ONLY = {'visit_at': '訪問日時', 'precheck_at': '事前確認日時'}

# 訪問の記録に付けられない項目（架電の結果・次回架電・電話番号は架電のためのもの）
_CALL_ONLY = {'result_status_id': '結果', 'next_call_at': '次回架電', 'next_action': '次回アクション', 'phone_number': '電話番号', **{k: v for k, v in _APPOINTMENT_ONLY.items()}}

CALL_SELECT = '''SELECT cl.*, ct.name AS contact_name, u.display_name AS user_name, s.label AS result_label, s.category AS result_category,
    sec.name AS section_name
  FROM telema_call_logs cl
  LEFT JOIN telema_contacts ct ON ct.id = cl.contact_id
  LEFT JOIN users u ON u.id = cl.user_id
  LEFT JOIN telema_call_statuses s ON s.id = cl.result_status_id
  LEFT JOIN telema_sections sec ON sec.id = cl.section_id'''


def _is_appointment(d, status_id):
    """結果が「時間設定」（ステータス区分 appointment）か"""
    return bool(status_id) and bool(d.first("SELECT 1 FROM telema_call_statuses WHERE id = %s AND category = 'appointment'", (status_id,)))


def _check_section(d, section_id, current_section_id=None):
    """部署は実在するものだけ。無効にした部署を新しく付けることはできない（その記録にすでに付いている部署なら、そのまま残せる）"""
    if section_id is None or section_id == current_section_id:
        return
    sec = d.first('SELECT is_active FROM telema_sections WHERE id = %s', (section_id,))
    if not sec:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（section_id: 部署が見つかりません）')
    if not sec['is_active']:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（section_id: 無効な部署は選べません）')


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

    _check_section(d, b.get('section_id'))
    is_visit = b['record_type'] == 'visit'
    if is_visit:
        if not b.get('visit_method'):
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（visit_method: 訪問かZoomを選んでください）')
        sent = [label for k, label in _CALL_ONLY.items() if b.get(k) is not None]
        if sent:
            raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（訪問の記録には{"・".join(sent)}は付けられません）')
    elif b.get('visit_method') is not None:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（visit_method: 架電の記録には付けられません）')
    elif any(b.get(k) is not None for k in _APPOINTMENT_ONLY) and not _is_appointment(d, b.get('result_status_id')):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（訪問日時・事前確認日時は結果が「時間設定」のときだけ設定できます）')
    called_at = b.get('called_at') or now_iso()
    call_id = d.value(
        '''INSERT INTO telema_call_logs (company_id, contact_id, user_id, called_at, phone_number, result_status_id, raw_note, ai_status, section_id,
                                          record_type, visit_method, visit_at, precheck_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id''',
        (id, b.get('contact_id'), user['id'], called_at, None if is_visit else (b.get('phone_number') or company['phone']), b.get('result_status_id'),
         b['raw_note'], 'pending' if b['raw_note'].strip() and not is_visit else 'skipped', b.get('section_id'),
         b['record_type'], b.get('visit_method'), b.get('visit_at'), b.get('precheck_at')),
    )
    # 履歴を先に確定させる（この後の会社更新で失敗しても架電メモは残す）
    d.commit()
    if is_visit:
        # 訪問は施設の「現在の状態」（ステータス・次回架電・架電件数・最終架電日時・担当）を変えない
        audit(d, user['id'], 'create', 'call_log', call_id, None, {'company_id': id, **b})
        return jsonify(d.first(f'{CALL_SELECT} WHERE cl.id = %s', (call_id,))), 201

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


CALL_PATCH = {
    'raw_note': Str(max=5000, trim=False),
    'called_at': IsoDatetime(),
    'result_status_id': Int(nullable=True),
    'contact_id': Int(nullable=True),
    'section_id': Int(nullable=True),
    'visit_method': Enum(['visit', 'zoom']),
    'visit_at': IsoDatetime(nullable=True),
    'precheck_at': IsoDatetime(nullable=True),
}

# メモを直したら、古いメモから作ったAI整理は内容と食い違うので消して再整理できる状態に戻す
_AI_RESET = ('ai_error', 'ai_model', 'ai_summary', 'ai_extracted_json', 'ai_next_action', 'ai_next_call_at')


def _recalc_company_calls(d, company_id):
    """件数・最終架電日時を有効な架電履歴から再計算（無効化・日時の修正で使う。訪問は数えない）"""
    d.run(
        '''UPDATE telema_companies SET call_count = (SELECT COUNT(*) FROM telema_call_logs WHERE company_id = %(cid)s AND is_active = 1 AND record_type = 'call'),
             last_called_at = (SELECT MAX(called_at) FROM telema_call_logs WHERE company_id = %(cid)s AND is_active = 1 AND record_type = 'call'),
             updated_at = telema_now() WHERE id = %(cid)s''',
        {'cid': company_id},
    )


@bp.patch('/calls/<id>')
def update_call(id):
    """過去の架電履歴を直す（日時・結果・話した相手・メモ・部署・訪問日時・事前確認日時）。無効化と同じく、sales は自分の架電だけ直せる。
    会社の現在の状態（ステータス・次回架電など）は、直した履歴に合わせて勝手に書き換えない（最終架電日時と件数だけ再計算する）"""
    id = parse_id(id)
    b = parse(CALL_PATCH, body(), partial=True)
    user = current_user()
    d = db()
    call = d.first('SELECT * FROM telema_call_logs WHERE id = %s AND is_active = 1', (id,))
    if not call:
        raise not_found('架電履歴')
    company = load_visible_company(call['company_id'])
    if user['role'] == 'sales' and call['user_id'] != user['id']:
        raise forbidden()

    if b.get('result_status_id') is not None and not d.first('SELECT 1 FROM telema_call_statuses WHERE id = %s', (b['result_status_id'],)):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（result_status_id: ステータスが見つかりません）')
    if b.get('contact_id') is not None and not d.first(
            'SELECT 1 FROM telema_contacts WHERE id = %s AND is_active = 1 AND (company_id = %s OR (company_id IS NULL AND organization_id = %s))',
            (b['contact_id'], company['id'], company['organization_id'])):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（contact_id: この施設の担当者ではありません）')
    if 'section_id' in b:
        _check_section(d, b['section_id'], call['section_id'])
    # 記録の種類は変えられない。方法（訪問／Zoom）は訪問だけ、結果は架電だけ
    if call['record_type'] == 'visit' and b.get('result_status_id') is not None:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（訪問の記録には結果は付けられません）')
    if call['record_type'] == 'call' and 'visit_method' in b:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（visit_method: 架電の記録には付けられません）')

    # 訪問日時・事前確認日時は結果が「時間設定」のときだけ。結果を時間設定以外に直したら、付いていた日時は外す
    final_status = b['result_status_id'] if 'result_status_id' in b else call['result_status_id']
    if call['record_type'] == 'call' and not _is_appointment(d, final_status):
        if any(b.get(k) is not None for k in _APPOINTMENT_ONLY):
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（訪問日時・事前確認日時は結果が「時間設定」のときだけ設定できます）')
        b.update({k: None for k in _APPOINTMENT_ONLY if call[k] is not None})
    elif call['record_type'] == 'visit' and any(b.get(k) is not None for k in _APPOINTMENT_ONLY):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（訪問の記録には付けられません）')

    changes = {k: v for k, v in b.items() if call[k] != v}
    if not changes:
        return jsonify(d.first(f'{CALL_SELECT} WHERE cl.id = %s', (id,)))

    sets = dict(changes)
    if 'raw_note' in changes:
        sets['ai_status'] = 'pending' if changes['raw_note'].strip() else 'skipped'
        sets.update({k: None for k in _AI_RESET})
    d.run(
        f'UPDATE telema_call_logs SET {", ".join(f"{k} = %s" for k in sets)}, updated_at = telema_now() WHERE id = %s',
        [*sets.values(), id],
    )
    if 'called_at' in changes and call['record_type'] == 'call':
        _recalc_company_calls(d, call['company_id'])
    audit(d, user['id'], 'update', 'call_log', id, {k: call[k] for k in changes}, changes)
    return jsonify(d.first(f'{CALL_SELECT} WHERE cl.id = %s', (id,)))


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
    if call['record_type'] == 'call':
        _recalc_company_calls(d, call['company_id'])
    audit(d, user['id'], 'deactivate', 'call_log', id, call)
    return jsonify({'ok': True})
