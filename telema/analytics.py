"""数値分析。営業の目標に対する今週・今日のペースと、期間の実績（訪問・受注・単価・テレアポ）。
 - 目標：営業ごと・月ごとの粗利・台数（telema_targets）。管理者は誰の分も、それ以外は自分の分を設定できる
 - ペース：月の目標 − 今月の受注（契約情報の契約日・営業担当ごとの粗利・台数）＝月の残。月の残を、残りの稼働日で割って、今週の残り稼働日の分を「今週の必要粗利・台数」とする。
   必要な訪問件数は、直近90日の「1訪問あたりの粗利」（初回訪問・ユーザー訪問・営業の訪問件数と契約の粗利から）で割り戻す。稼働日はカレンダーの稼働日設定（なければ平日の月〜金）
 - 実績：期間内の訪問・営業の結果・受注（契約情報）・受注単価・商材別の平均粗利（テレアポ（架電）の集計は teleappt.py）
 営業（一般）は自分の分だけ、マネージャー・管理者は全員分（担当者で絞り込める）"""
from datetime import datetime, timedelta, timezone
from math import ceil

from flask import jsonify, request

from .common import JST, audit, jst_month_range
from .context import ApiError, body, current_user, db, forbidden
from .routes import bp
from .validate import Int, parse

PACE_WINDOW_DAYS = 90
FIRST, USER_VISIT, SALES = '初回訪問', 'ユーザー訪問', '営業'
SCHEDULING_STATUS = '初回訪問時間設定'     # 架電の結果フラグ。この結果の架電の数が、テレアポのスケジューリング数


# ---------- 稼働日 ----------
def is_workday(day, overrides=None):
    """稼働日か。カレンダーで日ごとに設定した稼働日／休み（overrides＝{日付: True/False}）があればそれ、なければ平日（月〜金）"""
    if overrides and day in overrides:
        return overrides[day]
    return day.weekday() < 5


def workdays(start, end, overrides=None):
    """start〜end（両端を含む）の稼働日の日数"""
    n, d = 0, start
    while d <= end:
        n += is_workday(d, overrides)
        d += timedelta(days=1)
    return n


def workday_overrides(d, user_id, start, end):
    """営業 user_id がカレンダーで設定した、start〜end（日付）の稼働日／休みの上書き。{date: bool}"""
    rows = d.all('SELECT day, is_workday FROM telema_workdays WHERE user_id = %s AND day >= %s AND day <= %s', (user_id, start.isoformat(), end.isoformat()))
    return {datetime.strptime(r['day'], '%Y-%m-%d').date(): bool(r['is_workday']) for r in rows}


def _today():
    return datetime.now(timezone.utc).astimezone(JST).date()


def _month_arg():
    raw = request.args.get('month')
    if not raw:
        return jst_month_range()[0]
    if len(raw) != 7 or raw[4] != '-' or not (raw[:4] + raw[5:]).isdigit() or not 1 <= int(raw[5:]) <= 12:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（month: YYYY-MM で指定してください）')
    return raw


def _date_arg(name):
    raw = request.args.get(name)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, '%Y-%m-%d').date()
    except ValueError:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{name}: YYYY-MM-DD で指定してください）')


def _target_user(user, default_all=False):
    """対象の営業。一般は自分だけ。それ以外は user_id の指定（省略は自分。default_all なら全員）。all は全員（None を返す）"""
    raw = request.args.get('user_id')
    if user['role'] == 'sales':
        return user['id']
    if not raw:
        return None if default_all else user['id']
    if raw == 'all':
        return None
    if not raw.isdigit():
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: 数値か all で指定してください）')
    return int(raw)


def _day_bounds(day_from, day_to):
    start = datetime(day_from.year, day_from.month, day_from.day, tzinfo=JST)
    return start, datetime(day_to.year, day_to.month, day_to.day, tzinfo=JST) + timedelta(days=1)


# ---------- 目標 ----------
@bp.get('/targets')
def list_targets():
    """月の目標。管理者は有効な全メンバー分、それ以外は自分の分だけ"""
    user, d = current_user(), db()
    month = _month_arg()
    who = 'TRUE' if user['role'] == 'admin' else 'u.id = %s'
    rows = d.all(
        f'''SELECT u.id AS user_id, u.display_name AS user_name, t.gross_profit, t.units
              FROM users u LEFT JOIN telema_targets t ON t.user_id = u.id AND t.month = %s
             WHERE {who} ORDER BY u.id''', [month, *([] if user['role'] == 'admin' else [user['id']])])
    return jsonify({'month': month, 'items': rows})


@bp.put('/targets/<int:user_id>/<month>')
def put_target(user_id, month):
    user, d = current_user(), db()
    if len(month) != 7 or month[4] != '-' or not (month[:4] + month[5:]).isdigit() or not 1 <= int(month[5:]) <= 12:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（month: YYYY-MM で指定してください）')
    if user['role'] != 'admin' and user_id != user['id']:
        raise forbidden()
    if not d.first('SELECT 1 FROM users WHERE id = %s', (user_id,)):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: ユーザーが見つかりません）')
    b = parse({'gross_profit': Int(min=0), 'units': Int(min=0)}, body())
    before = d.first('SELECT gross_profit, units FROM telema_targets WHERE user_id = %s AND month = %s', (user_id, month))
    d.run(
        '''INSERT INTO telema_targets (user_id, month, gross_profit, units, updated_by) VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (user_id, month) DO UPDATE SET gross_profit = EXCLUDED.gross_profit, units = EXCLUDED.units, updated_by = EXCLUDED.updated_by, updated_at = telema_now()''',
        (user_id, month, b['gross_profit'], b['units'], user['id']))
    audit(d, user['id'], 'update', 'target', user_id, before, {'month': month, **b})
    return jsonify({'user_id': user_id, 'month': month, **b})


# ---------- ペース（今週の残・必要訪問件数・今日の必要件数） ----------
def _ratio(num, den):
    return None if not den else num / den


@bp.get('/analytics/pace')
def analytics_pace():
    user, d = current_user(), db()
    uid = _target_user(user)
    if uid is None:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_id: ペースは営業を1人選んでください）')
    today = _today()
    month = today.strftime('%Y-%m')
    month_start = today.replace(day=1)
    month_end = (month_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    week_end = min(today + timedelta(days=6 - today.weekday()), month_end)
    target = d.first('SELECT gross_profit, units FROM telema_targets WHERE user_id = %s AND month = %s', (uid, month))
    got = d.first(
        '''SELECT COALESCE(SUM(gross_profit), 0)::bigint AS gross_profit, COALESCE(SUM(units), 0)::bigint AS units
             FROM telema_contracts WHERE is_active = 1 AND assigned_user_id = %s AND contract_date::date >= %s AND contract_date::date <= %s''',
        (uid, month_start, today))
    over = workday_overrides(d, uid, today, month_end)
    month_days, week_days = workdays(today, month_end, over), workdays(today, week_end, over)

    # 直近90日の、1訪問あたりの粗利・台数（必要な訪問件数に直す元）
    since = today - timedelta(days=PACE_WINDOW_DAYS)
    start, end = _day_bounds(since, today)
    visits = d.value(
        '''SELECT COUNT(*) FROM telema_call_logs cl JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
            WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND cl.user_id = %s AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s
              AND vp.name IN (%s, %s, %s)''', (uid, start, end, FIRST, USER_VISIT, SALES))
    won = d.first(
        '''SELECT COALESCE(SUM(gross_profit), 0)::bigint AS gross_profit, COALESCE(SUM(units), 0)::bigint AS units
             FROM telema_contracts WHERE is_active = 1 AND assigned_user_id = %s AND contract_date::date >= %s AND contract_date::date <= %s''', (uid, since, today))
    gp_per_visit, units_per_visit = _ratio(won['gross_profit'], visits), _ratio(won['units'], visits)
    done_today = d.value(
        '''SELECT COUNT(*) FROM telema_call_logs cl JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
            WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND cl.user_id = %s AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s
              AND vp.name IN (%s, %s, %s)''', (uid, *_day_bounds(today, today), FIRST, USER_VISIT, SALES))

    out = {
        'user_id': uid, 'month': month, 'today': today.isoformat(), 'target': target,
        'month_actual': got, 'month_workdays_left': month_days, 'week_workdays_left': week_days,
        'week_end': week_end.isoformat(), 'visits_done_today': done_today,
        'basis': {'days': PACE_WINDOW_DAYS, 'visits': visits, 'gross_profit': won['gross_profit'], 'units': won['units'],
                  'gross_profit_per_visit': gp_per_visit, 'units_per_visit': units_per_visit},
        'month_remaining': None, 'week_need': None, 'week_visits_need': None, 'today_visits_need': None, 'today_visits_left': None,
    }
    if target:
        rem = {'gross_profit': max(0, target['gross_profit'] - got['gross_profit']), 'units': max(0, target['units'] - got['units'])}
        out['month_remaining'] = rem
        # 月の残を、残りの稼働日で割って今週の残り稼働日の分。残り稼働日がない（月末の休み）ときは、残りをそのまま今週の分とする
        share = (week_days / month_days) if month_days else 1
        week_need = {k: ceil(v * share) for k, v in rem.items()}
        out['week_need'] = week_need
        if gp_per_visit:
            visits_need = ceil(week_need['gross_profit'] / gp_per_visit)
            out['week_visits_need'] = visits_need
            out['today_visits_need'] = ceil(visits_need / week_days) if week_days else visits_need
            out['today_visits_left'] = max(0, out['today_visits_need'] - done_today)
    return jsonify(out)


# ---------- 期間の実績 ----------
def actuals(d, uid, date_from, date_to):
    """期間（日付）の実績。uid が None なら全員分。数値分析と、日報の元になる"""
    start, end = _day_bounds(date_from, date_to)
    who_call, who_contract = ('TRUE', []) if uid is None else ('cl.user_id = %s', [uid])
    who_ct = 'TRUE' if uid is None else 'ct.assigned_user_id = %s'

    v = d.first(
        f'''SELECT COUNT(*) FILTER (WHERE vp.name = %s)::int AS first_visits, COUNT(*) FILTER (WHERE vp.name = %s)::int AS user_visits,
                   COUNT(*) FILTER (WHERE vp.name = %s)::int AS sales_visits,
                   COUNT(*) FILTER (WHERE vp.name = %s AND cl.sales_result = 'won')::int AS won, COUNT(*) FILTER (WHERE vp.name = %s AND cl.sales_result = 'waiting')::int AS waiting,
                   COUNT(*) FILTER (WHERE vp.name = %s AND cl.sales_result = 'ng')::int AS ng, COUNT(*) FILTER (WHERE vp.name = %s AND cl.sales_result = 'resales')::int AS resales,
                   COUNT(*) FILTER (WHERE vp.name = %s AND cl.first_result = 'scheduled')::int AS first_scheduled,
                   COUNT(*) FILTER (WHERE vp.name = %s AND cl.first_result = 'no_prospect')::int AS first_no_prospect
              FROM telema_call_logs cl JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
             WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s AND {who_call}''',
        [FIRST, USER_VISIT, SALES, SALES, SALES, SALES, SALES, FIRST, FIRST, start, end, *who_contract])
    # 返事待ち対応（営業で返事待ちにした訪問への、その後の受注・NG・再営業）
    reply = d.first(
        f'''SELECT COUNT(*) FILTER (WHERE cl.sales_result = 'won')::int AS reply_won, COUNT(*) FILTER (WHERE cl.sales_result = 'ng')::int AS reply_ng,
                   COUNT(*) FILTER (WHERE cl.sales_result = 'resales')::int AS reply_resales
              FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
             WHERE cl.is_active = 1 AND cl.record_type = 'reply' AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s AND {who_call}''',
        [start, end, *who_contract])
    v.update(reply)

    ct = d.first(
        f'''SELECT COUNT(*)::int AS orders, COALESCE(SUM(ct.amount), 0)::bigint AS amount, COALESCE(SUM(ct.gross_profit), 0)::bigint AS gross_profit,
                   COALESCE(SUM(ct.units), 0)::bigint AS units,
                   COALESCE(SUM(ct.amount) FILTER (WHERE ct.units > 0), 0)::bigint AS amount_with_units,
                   COALESCE(SUM(ct.units) FILTER (WHERE ct.amount IS NOT NULL), 0)::bigint AS units_with_amount,
                   COUNT(DISTINCT COALESCE('o' || c.organization_id, 'c' || c.id)) FILTER (WHERE ct.amount IS NOT NULL)::int AS corporations,
                   COALESCE(SUM(ct.amount) FILTER (WHERE ct.amount IS NOT NULL), 0)::bigint AS amount_known
              FROM telema_contracts ct JOIN telema_companies c ON c.id = ct.company_id AND c.is_active = 1
             WHERE ct.is_active = 1 AND ct.contract_date::date >= %s AND ct.contract_date::date <= %s AND {who_ct}''',
        [date_from, date_to, *([] if uid is None else [uid])])
    products = d.all(
        f'''SELECT ct.product_name, COUNT(*)::int AS orders, COALESCE(SUM(ct.units), 0)::bigint AS units,
                   COALESCE(SUM(ct.gross_profit), 0)::bigint AS gross_profit,
                   AVG(ct.gross_profit)::float8 AS avg_gross_profit, AVG(ct.amount)::float8 AS avg_amount
              FROM telema_contracts ct JOIN telema_companies c ON c.id = ct.company_id AND c.is_active = 1
             WHERE ct.is_active = 1 AND ct.contract_date::date >= %s AND ct.contract_date::date <= %s AND {who_ct}
             GROUP BY ct.product_name ORDER BY gross_profit DESC, ct.product_name''',
        [date_from, date_to, *([] if uid is None else [uid])])

    return {
        'user_id': uid, 'date_from': date_from.isoformat(), 'date_to': date_to.isoformat(),
        # 営業落ち率＝NG ÷ 営業件数（返事待ち対応でのNGも含む）
        'visits': {**v, 'fall_rate': _ratio(v['ng'] + v['reply_ng'], v['sales_visits'])},
        'orders': {
            **ct,
            'unit_price': _ratio(ct['amount_with_units'], ct['units_with_amount']),
            'corporation_price': _ratio(ct['amount_known'], ct['corporations']),
        },
        'products': products,
    }


@bp.get('/analytics')
def analytics():
    user, d = current_user(), db()
    uid = _target_user(user, default_all=True)
    today = _today()
    date_from = _date_arg('date_from') or datetime.strptime(jst_month_range()[0] + '-01', '%Y-%m-%d').date()
    date_to = _date_arg('date_to') or today
    if date_to < date_from:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（date_to: 期間の終わりは始まり以降にしてください）')
    if (date_to - date_from).days > 366:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（期間は1年以内で指定してください）')
    return jsonify(actuals(d, uid, date_from, date_to))
