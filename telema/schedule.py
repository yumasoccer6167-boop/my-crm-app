"""マイページの「今日の予定」：訪問予定・訪問前連絡予定・再コールの3つ。自分の分だけ。「対応済み」で表示から消す（まとめても押せる）。
 - 訪問予定／訪問前連絡予定は、結果が「時間設定」の架電記録に付けた 訪問する日時／事前確認日時。対応済みにすると、その記録の done 日時を入れる
 - 再コールは、施設の次回架電予定。対応済みにすると、次回架電（と次回アクション）を空にする。変更前の値は操作ログに残る
今日の予定と、対応しないまま過ぎた予定（期限超過）を出す。"""
from flask import jsonify

from .common import audit, can_edit_company, jst_day_range
from .context import ApiError, body, current_user, db
from .routes import bp
from .validate import Int, Str, now_iso, parse

KINDS = ('visit', 'precheck', 'recall')
LIST_LIMIT = 200


def _mine(call_alias='cl'):
    """自分の予定：自分の担当の施設、または自分が記録した予定"""
    return f'(c.assigned_user_id = %s OR {call_alias}.user_id = %s)'


@bp.get('/schedule/today')
def schedule_today():
    user, d = current_user(), db()
    _, today_end = jst_day_range(0)
    out = {}
    for kind, col, done in (('visit', 'visit_at', 'visit_done_at'), ('precheck', 'precheck_at', 'precheck_done_at')):
        out[kind] = d.all(
            f'''SELECT cl.id, cl.company_id, c.company_name, cl.{col} AS at, cl.raw_note, cl.contact_id, ct.name AS contact_name,
                       c.phone, c.is_user, u.display_name AS user_name
                  FROM telema_call_logs cl
                  JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
                  LEFT JOIN telema_contacts ct ON ct.id = cl.contact_id
                  LEFT JOIN users u ON u.id = cl.user_id
                 WHERE cl.is_active = 1 AND cl.record_type = 'call' AND cl.{col} IS NOT NULL AND cl.{done} IS NULL AND cl.{col} < %s
                   AND {_mine()}
                 ORDER BY cl.{col}, cl.id LIMIT %s''', (today_end, user['id'], user['id'], LIST_LIMIT))
    out['recall'] = d.all(
        '''SELECT c.id AS id, c.id AS company_id, c.company_name, c.next_call_at AS at, c.next_action AS raw_note, c.phone, c.is_user,
                  (SELECT ct.name FROM telema_contacts ct WHERE ct.company_id = c.id AND ct.is_active = 1 AND ct.name IS NOT NULL
                    ORDER BY ct.is_decision_maker DESC, ct.updated_at DESC LIMIT 1) AS contact_name, NULL::text AS user_name
             FROM telema_companies c
            WHERE c.is_active = 1 AND c.next_call_at IS NOT NULL AND c.next_call_at < %s AND c.assigned_user_id = %s
            ORDER BY c.next_call_at, c.id LIMIT %s''', (today_end, user['id'], LIST_LIMIT))
    today_start, _ = jst_day_range(0)
    for items in out.values():
        for it in items:
            it['overdue'] = it['at'] < today_start       # 今日より前の、対応していない予定
    return jsonify(out)


@bp.post('/schedule/done')
def schedule_done():
    """予定を対応済みにする（1件でも、まとめてでも）。編集できない施設の予定は対象外（not_found に数える）"""
    data = body() or {}
    items = data.get('items')
    if not isinstance(items, list) or not items or len(items) > 500:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（items: 1〜500件で送ってください）')
    user, d = current_user(), db()
    done, skipped = 0, 0
    for raw in items:
        it = parse({'kind': Str(max=20), 'id': Int(min=1)}, raw if isinstance(raw, dict) else {})
        if it['kind'] not in KINDS:
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（kind: visit / precheck / recall）')
        if it['kind'] == 'recall':
            c = d.first('SELECT id, assigned_user_id, next_call_at, next_action FROM telema_companies WHERE id = %s AND is_active = 1', (it['id'],))
            if not c or not can_edit_company(user, c['assigned_user_id']) or c['next_call_at'] is None:
                skipped += 1
                continue
            d.run('UPDATE telema_companies SET next_call_at = NULL, next_action = NULL, updated_at = telema_now() WHERE id = %s', (c['id'],))
            audit(d, user['id'], 'update', 'company', c['id'], {'next_call_at': c['next_call_at'], 'next_action': c['next_action']}, {'next_call_at': None, 'next_action': None})
        else:
            col = 'visit_done_at' if it['kind'] == 'visit' else 'precheck_done_at'
            at = 'visit_at' if it['kind'] == 'visit' else 'precheck_at'
            cl = d.first(f'''SELECT cl.id, cl.user_id, cl.{at} AS at, cl.{col} AS done, c.assigned_user_id FROM telema_call_logs cl
                              JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1 WHERE cl.id = %s AND cl.is_active = 1''', (it['id'],))
            if not cl or cl['at'] is None or cl['done'] is not None or not (can_edit_company(user, cl['assigned_user_id']) or cl['user_id'] == user['id']):
                skipped += 1
                continue
            d.run(f'UPDATE telema_call_logs SET {col} = %s, updated_at = telema_now() WHERE id = %s', (now_iso(), cl['id']))
            audit(d, user['id'], 'update', 'call_log', cl['id'], {col: None}, {col: 'done'})
        done += 1
    return jsonify({'done': done, 'skipped': skipped})
