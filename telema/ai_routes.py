"""AI状態・架電メモの整理・施設のAIサマリー・AI利用料（管理者）。"""
import json
import re
from datetime import datetime

from flask import jsonify, request

from .ai import SUMMARY_CALL_LIMIT, AIService, analyze_call, env, summarize_company
from .common import audit, can_edit_company, company_visibility, jst_month_range
from .context import ApiError, body, current_user, db, dumps, forbidden, not_found, require_role
from .routes import bp
from .validate import iso_utc, parse_id


@bp.get('/ai/status')
def ai_status():
    return jsonify({'available': AIService().available})


@bp.post('/calls/<id>/analyze')
def analyze(id):
    """保存済みの架電メモをAIで整理する。
    失敗しても架電履歴は残り、ai_status='failed' として後から再実行できる。
    抽出結果は提案であり、会社カルテ・ステータスには反映しない（反映は利用者が行う）。"""
    id = parse_id(id)
    user = current_user()
    d = db()
    call = d.first('SELECT id, company_id, raw_note, called_at, user_id FROM telema_call_logs WHERE id = %s AND is_active = 1', (id,))
    if not call:
        raise not_found('架電履歴')
    vis_sql, vis_params = company_visibility(user)
    company = d.first(
        f'SELECT c.id, c.company_name, c.assigned_user_id FROM telema_companies c WHERE c.id = %s AND c.is_active = 1 AND {vis_sql}',
        [call['company_id'], *vis_params])
    if not company:
        raise not_found('会社')
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    if not call['raw_note'].strip():
        raise ApiError(400, 'validation_error', 'メモが空のためAIで整理できません')

    history = d.all(
        '''SELECT called_at, ai_summary AS summary, raw_note FROM telema_call_logs
           WHERE company_id = %s AND id <> %s AND is_active = 1 ORDER BY called_at DESC LIMIT 5''', (call['company_id'], id))
    labels = [r['label'] for r in d.all(
        "SELECT label FROM telema_call_statuses WHERE is_active = 1 AND category <> 'not_started' ORDER BY sort_order")]

    try:
        x, model = analyze_call(id, company['id'], user['id'], call['raw_note'], call['called_at'], company['company_name'], history, labels)
    except Exception as e:
        d.run("UPDATE telema_call_logs SET ai_status = 'failed', ai_error = %s, updated_at = telema_now() WHERE id = %s",
              (getattr(e, 'message', None) or str(e), id))
        d.commit()
        raise
    next_at = None
    if x.get('next_call_date'):
        try:
            next_at = iso_utc(datetime.fromisoformat(re.sub(r'Z$', '+00:00', x['next_call_date'])))
        except (ValueError, TypeError):
            next_at = None
    d.run(
        '''UPDATE telema_call_logs SET ai_status = 'done', ai_error = NULL, ai_model = %s, ai_summary = %s, ai_extracted_json = %s,
             ai_next_action = %s, ai_next_call_at = %s, updated_at = telema_now() WHERE id = %s''',
        (model, x.get('summary'), dumps(x), x.get('next_action'), next_at, id),
    )
    return jsonify({'ok': True, 'extraction': x, 'next_call_at': next_at})


# AIサマリーに渡すカルテ項目（項目名は src/telema/shared/fields.ts の表示名）
SUMMARY_KARTE = {
    'interest': '興味', 'pain_point': '課題', 'decision_timing': '導入時期', 'budget': '予算', 'current_service': '現在利用サービス',
    'competitor': '競合', 'ng_reason': 'NG理由', 'next_action': '次回アクション', 'current_note': 'メモ', 'notes': '備考',
}


@bp.post('/companies/<id>/summarize')
def summarize(id):
    """施設全体のAIサマリーを作る（利用者がボタンを押したときだけ）。
    結果は提案（telema_ai_suggestions）として保存し、カルテの summary には利用者が採用したときだけ反映する。前の未決定の提案は superseded にする"""
    id = parse_id(id)
    user = current_user()
    d = db()
    vis_sql, vis_params = company_visibility(user)
    company = d.first(
        f'''SELECT c.*, s.label AS status_label FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id
            WHERE c.id = %s AND c.is_active = 1 AND {vis_sql}''', [id, *vis_params])
    if not company:
        raise not_found('会社')
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    calls = d.all(
        '''SELECT cl.called_at, u.display_name AS user_name, s.label AS result_label, cl.ai_summary AS summary, cl.raw_note
           FROM telema_call_logs cl LEFT JOIN users u ON u.id = cl.user_id LEFT JOIN telema_call_statuses s ON s.id = cl.result_status_id
           WHERE cl.company_id = %s AND cl.is_active = 1 AND (cl.raw_note <> '' OR cl.ai_summary IS NOT NULL)
           ORDER BY cl.called_at DESC, cl.id DESC LIMIT %s''', (id, SUMMARY_CALL_LIMIT))[::-1]
    if not calls:
        raise ApiError(400, 'validation_error', '架電履歴がまだ無いため要約できません')
    contacts = d.all(
        '''SELECT name, role FROM telema_contacts WHERE is_active = 1 AND (company_id = %s OR (company_id IS NULL AND organization_id = %s))
           ORDER BY is_decision_maker DESC, updated_at DESC LIMIT 5''', (id, company['organization_id']))

    x, model = summarize_company(id, user['id'], company['company_name'], company['status_label'], contacts,
                                 {label: company.get(k) for k, label in SUMMARY_KARTE.items()}, calls)
    after = {'summary': x['summary'], 'next_action': x.get('next_action')}
    d.run("UPDATE telema_ai_suggestions SET status = 'superseded' WHERE company_id = %s AND suggestion_type = 'summary' AND status = 'pending'", (id,))
    row = d.first(
        '''INSERT INTO telema_ai_suggestions (company_id, suggestion_type, field, payload_json, model)
           VALUES (%s, 'summary', 'summary', %s, %s) RETURNING id, created_at''',
        (id, dumps({'before': company.get('summary'), 'after': after, 'source': 'call_logs', 'calls': len(calls)}), model))
    return jsonify({'id': row['id'], 'summary': after['summary'], 'next_action': after['next_action'], 'calls': len(calls),
                    'model': model, 'created_at': row['created_at']})


@bp.post('/ai-suggestions/<id>/decide')
def decide_suggestion(id):
    """AIの提案を採用（approve、修正して採用も可）または破棄（reject）する。いまは summary のみ"""
    id = parse_id(id)
    b = body()
    action = b.get('action')
    edited = b.get('summary')
    if action not in ('approve', 'reject') or (edited is not None and (not isinstance(edited, str) or not edited.strip() or len(edited) > 3000)):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（action: approve / reject、summary: 1〜3000文字）')
    user = current_user()
    d = db()
    sug = d.first("SELECT * FROM telema_ai_suggestions WHERE id = %s AND suggestion_type = 'summary'", (id,))
    if not sug:
        raise not_found('AIの提案')
    vis_sql, vis_params = company_visibility(user)
    company = d.first(
        f'SELECT c.id, c.summary, c.assigned_user_id FROM telema_companies c WHERE c.id = %s AND c.is_active = 1 AND {vis_sql}',
        [sug['company_id'], *vis_params])
    if not company:
        raise not_found('会社')
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    if sug['status'] != 'pending':
        raise ApiError(409, 'conflict', 'この提案はすでに処理されています')

    if action == 'reject':
        d.run("UPDATE telema_ai_suggestions SET status = 'rejected', approved_by = %s, approved_at = telema_now() WHERE id = %s", (user['id'], id))
        return jsonify({'ok': True, 'summary': company['summary']})
    payload = sug['payload_json']
    after = (json.loads(payload) if isinstance(payload, str) else payload)['after']
    proposed = f"{after['summary']}\n\n推奨アクション：{after['next_action']}" if after.get('next_action') else after['summary']
    text = edited.strip() if edited is not None else proposed
    d.run(
        '''UPDATE telema_ai_suggestions SET status = %s, decided_payload_json = %s, approved_by = %s, approved_at = telema_now() WHERE id = %s''',
        ('modified' if text != proposed else 'approved', dumps({'summary': text}), user['id'], id))
    d.run('UPDATE telema_companies SET summary = %s, updated_at = telema_now() WHERE id = %s', (text, company['id']))
    audit(d, user['id'], 'update', 'company', company['id'], {'summary': company['summary']}, {'summary': text, 'ai_suggestion_id': id})
    return jsonify({'ok': True, 'summary': text})


def _month_arg():
    m = request.args.get('month')
    if m is not None and not re.fullmatch(r'\d{4}-\d{2}', m):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（month: YYYY-MM で指定してください）')
    return m


@bp.get('/admin/ai-usage')
def ai_usage():
    require_role('admin')
    month, start, end = jst_month_range(_month_arg())
    d = db()
    rng = 'created_at >= %s AND created_at < %s'
    p = (start, end)
    jst_day = "to_char(created_at::timestamptz AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD')"
    return jsonify({
        'month': month,
        'usd_jpy': float(env('TELEMA_USD_JPY', '150') or 150),
        'budget_usd': float(env('TELEMA_AI_MONTHLY_BUDGET_USD', '10') or 0),
        'provider': env('TELEMA_AI_PROVIDER', 'gemini'),
        'model': env('TELEMA_AI_MODEL', 'gemini-3.8-flash'),
        'total': d.first(
            f'''SELECT COUNT(*) AS calls, COUNT(*) FILTER (WHERE status = 'error') AS errors, COALESCE(SUM(input_tokens), 0) AS input_tokens,
                  COALESCE(SUM(output_tokens), 0) AS output_tokens, COALESCE(SUM(cost_usd), 0) AS cost_usd FROM telema_ai_usage_logs WHERE {rng}''', p),
        'by_day': d.all(
            f'SELECT {jst_day} AS day, COUNT(*) AS calls, SUM(cost_usd) AS cost_usd FROM telema_ai_usage_logs WHERE {rng} GROUP BY 1 ORDER BY 1', p),
        'by_feature': d.all(
            f'SELECT feature, COUNT(*) AS calls, SUM(cost_usd) AS cost_usd FROM telema_ai_usage_logs WHERE {rng} GROUP BY feature ORDER BY cost_usd DESC', p),
        'by_user': d.all(
            '''SELECT COALESCE(u.display_name, '（不明）') AS name, COUNT(*) AS calls, SUM(l.cost_usd) AS cost_usd
               FROM telema_ai_usage_logs l LEFT JOIN users u ON u.id = l.user_id
               WHERE l.created_at >= %s AND l.created_at < %s GROUP BY l.user_id, u.display_name ORDER BY cost_usd DESC''', p),
        'by_model': d.all(
            f'''SELECT provider, model, COUNT(*) AS calls, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd
                FROM telema_ai_usage_logs WHERE {rng} GROUP BY provider, model''', p),
        'recent_errors': d.all(
            f"SELECT created_at, feature, error FROM telema_ai_usage_logs WHERE {rng} AND status = 'error' ORDER BY created_at DESC LIMIT 10", p),
    })
