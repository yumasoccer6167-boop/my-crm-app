"""AI状態・架電メモの整理・AI利用料（管理者）。"""
import re
from datetime import datetime

from flask import jsonify, request

from .ai import AIService, analyze_call, env
from .common import can_edit_company, company_visibility, jst_month_range
from .context import ApiError, current_user, db, dumps, forbidden, not_found, require_role
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
