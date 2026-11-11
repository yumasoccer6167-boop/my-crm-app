"""営業結果管理・初回訪問結果管理・営業成績表。訪問記録（訪問の内容が「営業」「初回訪問」「ユーザー訪問」）を、登録すると自動でそのまま一覧・集計に反映する（別に登録しない）。
 - 営業結果管理：訪問の内容が「営業」の記録と、返事待ち対応の記録（商材・結果・次回日時・受注金額・粗利・台数）
 - 初回訪問結果管理：訪問の内容が「初回訪問」の記録（結果：営業時間設定・見込みなし）。その後に同じ施設で営業の訪問があったか・受注したかも添える
 - 営業成績表：営業担当ごとの、初回訪問・ユーザー訪問・営業の件数と、営業の結果の内訳（返事待ち対応の結果も含む）、受注の金額・粗利・台数
 一般（sales）は自分の記録だけ、マネージャー・管理者は全員分（担当者で絞り込める）"""
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

from .common import JST, jst_month_range
from .context import ApiError, current_user, db
from .routes import bp

KINDS = {'sales': '営業', 'first': '初回訪問'}
RESULTS = ('won', 'waiting', 'ng', 'resales', 'none')
FIRST_RESULTS = ('scheduled', 'no_prospect', 'none')
LIST_LIMIT = 500


def _date_arg(name):
    raw = request.args.get(name)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, '%Y-%m-%d').date()
    except ValueError:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{name}: YYYY-MM-DD で指定してください）')


def _range():
    """期間（JSTの日付）。省略は今月の初日〜今日。記録の日時は UTC の文字列なので、開始日 0 時（JST）〜終了日の翌日 0 時（JST）の前で比べる"""
    today = datetime.now(timezone.utc).astimezone(JST).date()
    date_from = _date_arg('date_from') or datetime.strptime(jst_month_range()[0] + '-01', '%Y-%m-%d').date()
    date_to = _date_arg('date_to') or today
    if date_to < date_from:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（date_to: 期間の終わりは始まり以降にしてください）')
    if (date_to - date_from).days > 366:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（期間は1年以内で指定してください）')
    start = datetime(date_from.year, date_from.month, date_from.day, tzinfo=JST)
    end = datetime(date_to.year, date_to.month, date_to.day, tzinfo=JST) + timedelta(days=1)
    return date_from, date_to, start, end


def _user_filter(user):
    """(条件SQL, パラメータ)。一般は自分だけ。それ以外は user_id 指定があればその人だけ"""
    if user['role'] == 'sales':
        return 'cl.user_id = %s', [user['id']]
    raw = request.args.get('user_id')
    if raw:
        if not raw.isdigit():
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: 数値で指定してください）')
        return 'cl.user_id = %s', [int(raw)]
    return 'TRUE', []


@bp.get('/sales-results')
def sales_results():
    """kind=sales（営業結果管理）または first（初回訪問結果管理）の記録一覧。新しい順。result で結果を絞り込める（none は結果なし）"""
    user = current_user()
    kind = request.args.get('kind') or 'sales'
    if kind not in KINDS:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（kind: sales / first のどちらかを指定してください）')
    result = request.args.get('result')
    if result and result not in (RESULTS if kind == 'sales' else FIRST_RESULTS):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（result の値が正しくありません）')
    date_from, date_to, start, end = _range()
    user_sql, user_params = _user_filter(user)
    # 営業結果管理には、返事待ち対応の記録も入れる（返事待ちのその後の、受注・NG・再営業）
    kind_sql = "(cl.record_type = 'reply' OR (cl.record_type = 'visit' AND vp.name = %s))" if kind == 'sales' else "(cl.record_type = 'visit' AND vp.name = %s)"
    where = ["cl.is_active = 1", kind_sql, 'cl.called_at::timestamptz >= %s', 'cl.called_at::timestamptz < %s', 'c.is_active = 1', user_sql]
    params = [KINDS[kind], start, end, *user_params]
    if result:
        col = 'cl.sales_result' if kind == 'sales' else 'cl.first_result'
        where.append(f'{col} IS NULL' if result == 'none' else f'{col} = %s')
        if result != 'none':
            params.append(result)
    clause = ' AND '.join(where)
    d = db()
    rows = d.all(
        f'''SELECT cl.id, cl.record_type, cl.company_id, c.company_name, cl.called_at, cl.user_id, u.display_name AS user_name, cl.visit_method, cl.raw_note,
                   cl.sales_product, cl.sales_product_monthly, cl.sales_product_term, cl.sales_server_monthly, cl.sales_server_term, cl.sales_cashback,
                   cl.sales_result, cl.sales_followup_at,
                   cl.sales_amount, cl.sales_gross_profit, cl.sales_units, cl.first_result, cl.first_followup_at,
                   (SELECT r.sales_result FROM telema_call_logs r WHERE r.reply_to_id = cl.id AND r.is_active = 1 ORDER BY r.id DESC LIMIT 1) AS replied_result,
                   (SELECT COUNT(*) FROM telema_call_logs n JOIN telema_visit_purposes nv ON nv.id = n.visit_purpose_id AND nv.name = '営業'
                     WHERE n.company_id = cl.company_id AND n.is_active = 1 AND n.record_type = 'visit' AND n.called_at > cl.called_at) AS later_sales_visits,
                   EXISTS (SELECT 1 FROM telema_call_logs n JOIN telema_visit_purposes nv ON nv.id = n.visit_purpose_id AND nv.name = '営業'
                            WHERE n.company_id = cl.company_id AND n.is_active = 1 AND n.record_type = 'visit' AND n.called_at > cl.called_at
                              AND n.sales_result = 'won') AS later_won
              FROM telema_call_logs cl
              LEFT JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
              JOIN telema_companies c ON c.id = cl.company_id
              LEFT JOIN users u ON u.id = cl.user_id
             WHERE {clause}
             ORDER BY cl.called_at DESC, cl.id DESC LIMIT {LIST_LIMIT + 1}''', params)
    truncated = len(rows) > LIST_LIMIT
    return jsonify({'items': rows[:LIST_LIMIT], 'truncated': truncated, 'date_from': date_from.isoformat(), 'date_to': date_to.isoformat()})


@bp.get('/sales-scorecard')
def sales_scorecard():
    """営業担当ごとの成績表。期間内の訪問記録から、初回訪問・ユーザー訪問・営業の件数、営業の結果の内訳、受注の金額・粗利・台数を数える"""
    user = current_user()
    date_from, date_to, start, end = _range()
    user_sql, user_params = _user_filter(user)
    rows = db().all(
        f'''SELECT cl.user_id, COALESCE(u.display_name, '未設定') AS user_name,
                   COUNT(*) FILTER (WHERE vp.name = '初回訪問')::int AS first_visits,
                   COUNT(*) FILTER (WHERE vp.name = 'ユーザー訪問')::int AS user_visits,
                   COUNT(*) FILTER (WHERE vp.name = '営業')::int AS sales_visits,
                   COUNT(*) FILTER (WHERE vp.name = '初回訪問' AND cl.first_result = 'scheduled')::int AS first_scheduled,
                   COUNT(*) FILTER (WHERE vp.name = '初回訪問' AND cl.first_result = 'no_prospect')::int AS first_no_prospect,
                   COUNT(*) FILTER (WHERE cl.record_type = 'visit' AND vp.name = '営業' AND cl.sales_result = 'won')::int AS won,
                   COUNT(*) FILTER (WHERE cl.record_type = 'reply' AND cl.sales_result = 'won')::int AS reply_won,
                   COUNT(*) FILTER (WHERE cl.record_type = 'reply' AND cl.sales_result = 'ng')::int AS reply_ng,
                   COUNT(*) FILTER (WHERE cl.record_type = 'reply' AND cl.sales_result = 'resales')::int AS reply_resales,
                   COUNT(*) FILTER (WHERE cl.record_type = 'visit' AND vp.name = '営業' AND cl.sales_result = 'waiting')::int AS waiting,
                   COUNT(*) FILTER (WHERE cl.record_type = 'visit' AND vp.name = '営業' AND cl.sales_result = 'ng')::int AS ng,
                   COUNT(*) FILTER (WHERE cl.record_type = 'visit' AND vp.name = '営業' AND cl.sales_result = 'resales')::int AS resales,
                   COALESCE(SUM(cl.sales_amount) FILTER (WHERE cl.sales_result = 'won'), 0)::bigint AS amount,
                   COALESCE(SUM(cl.sales_gross_profit) FILTER (WHERE cl.sales_result = 'won'), 0)::bigint AS gross_profit,
                   COALESCE(SUM(cl.sales_units) FILTER (WHERE cl.sales_result = 'won'), 0)::bigint AS units
              FROM telema_call_logs cl
              LEFT JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
              JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
              LEFT JOIN users u ON u.id = cl.user_id
             WHERE cl.is_active = 1 AND cl.record_type IN ('visit', 'reply') AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s AND {user_sql}
             GROUP BY cl.user_id, u.display_name ORDER BY gross_profit DESC, won DESC, user_name''', [start, end, *user_params])
    return jsonify({'items': rows, 'date_from': date_from.isoformat(), 'date_to': date_to.isoformat()})
