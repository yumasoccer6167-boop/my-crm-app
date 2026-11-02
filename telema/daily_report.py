"""日報の自動作成。決まったフォーマット（課・チームの1日の報告）の数値を、記録から自動で入れる。
 - 累計稼働：その月の初日〜選んだ日の稼働日の数（カレンダーの稼働日設定。なければ平日）／ 総稼動＝その月の稼働日の数
 - 営業予算：月の目標（粗利P・台数。数値分析の目標）の、対象メンバーの合計
 - 累計必要数：営業予算 × 累計稼働 ÷ 総稼動（四捨五入）
 - 実数：その月の初日〜選んだ日の受注（契約情報の契約日）の粗利P・台数
 - 達成率：実数 ÷ 累計必要数（表示している四捨五入後の数。粗利・台数それぞれ）
 - 累計営業件数／累計受注件数／営業落ち率：その月の初日〜選んだ日の「営業」の訪問記録と返事待ち対応から、訪問・Zoom別（返事待ち対応は元の訪問の方法）
 - 翌アポ：次の稼働日の、初回訪問予定・営業予定（カレンダー）。メンバーごとに時刻と施設を並べる
 対象メンバーは、選んだメンバー（省略は、自分と同じ部署のメンバー。部署がなければ自分だけ）。一般の営業は自分だけ"""
from datetime import datetime, timedelta

from flask import jsonify, request

from .agenda import agenda_items, month_days, parse_day
from .analytics import is_workday, workday_overrides, workdays
from .common import JST
from .context import ApiError, current_user, db
from .routes import bp
from .validate import iso_utc

SALES = '営業'
APPOINTMENT_KINDS = ('first_visit', 'visit')     # 翌アポに数える予定（初回訪問予定・営業予定）


def _p(yen):
    """円 → P（1万円＝1P）。整数ならそのまま、小数は2桁まで"""
    v = yen / 10000
    return str(int(v)) if v == int(v) else f'{v:.2f}'.rstrip('0').rstrip('.')


def _round(x):
    return int(x + 0.5)


def _rate(num, den, digits):
    return f'{(num / den * 100 if den else 0):.{digits}f}%'


def _hm(iso):
    return datetime.fromisoformat(iso.replace('Z', '+00:00')).astimezone(JST).strftime('%H:%M')


def _short(name):
    """日報に載せる名前。姓と名が空白で区切られていれば姓だけ"""
    return (name or '').replace('　', ' ').split(' ')[0]


def _members(d, user, raw):
    """対象メンバーの id（選んだ順）。一般の営業は自分だけ"""
    if user['role'] == 'sales':
        return [user['id']]
    if raw == 'all':
        return [r['id'] for r in d.all('SELECT id FROM users ORDER BY display_name, id')]
    if raw:
        parts = raw.split(',')
        if not all(p.isdigit() for p in parts):
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_ids: 数値のカンマ区切りか all で指定してください）')
        ids = list(dict.fromkeys(int(p) for p in parts))
        found = {r['id'] for r in d.all('SELECT id FROM users WHERE id = ANY(%s)', (ids,))}
        if found != set(ids):
            raise ApiError(400, 'validation_error', '入力内容に誤りがあります（user_ids: ユーザーが見つかりません）')
        return ids
    mine = d.first('SELECT department FROM users WHERE id = %s', (user['id'],))
    if mine and (mine['department'] or '').strip():
        return [r['id'] for r in d.all('SELECT id FROM users WHERE department = %s ORDER BY display_name, id', (mine['department'],))]
    return [user['id']]


def build_report(d, uids, day, base_uid, dept=None, label='最終'):
    members = d.all('SELECT id, display_name, department FROM users WHERE id = ANY(%s)', (uids,))
    order = {u: i for i, u in enumerate(uids)}
    members.sort(key=lambda m: order[m['id']])
    if dept is None:
        depts = [(m['department'] or '').strip() for m in members if (m['department'] or '').strip()]
        dept = max(set(depts), key=depts.count) if depts else ''

    month_start = day.replace(day=1)
    first, last = month_days(day.strftime('%Y-%m'))
    over = workday_overrides(d, base_uid, month_start, last + timedelta(days=15))
    elapsed, total = workdays(month_start, day, over), workdays(first, last, over)
    start = iso_utc(datetime(month_start.year, month_start.month, month_start.day, tzinfo=JST))
    end = iso_utc(datetime(day.year, day.month, day.day, tzinfo=JST) + timedelta(days=1))

    # 営業予算（月の目標の合計）と、必要数・実数・達成率
    tg = d.first('SELECT COALESCE(SUM(gross_profit), 0)::bigint AS gp, COALESCE(SUM(units), 0)::bigint AS units, COUNT(*)::int AS n FROM telema_targets WHERE user_id = ANY(%s) AND month = %s',
                 (uids, day.strftime('%Y-%m')))
    share = elapsed / total if total else 0
    need_gp, need_units = tg['gp'] / 10000 * share, tg['units'] * share
    contracts = d.all(
        '''SELECT c.company_name, ct.product_name, ct.gross_profit, ct.units, ct.contract_date::date AS day
             FROM telema_contracts ct JOIN telema_companies c ON c.id = ct.company_id AND c.is_active = 1
            WHERE ct.is_active = 1 AND ct.assigned_user_id = ANY(%s) AND ct.contract_date::date >= %s AND ct.contract_date::date <= %s
            ORDER BY ct.contract_date, ct.id''', (uids, month_start, day))
    act_gp, act_units = sum(c['gross_profit'] or 0 for c in contracts), sum(c['units'] or 0 for c in contracts)
    today_orders = [c for c in contracts if c['day'] == day]

    # 営業の件数・受注・NG（訪問／Zoom別）。返事待ち対応は、元の訪問の方法に数える
    cnt = {m: {'n': 0, 'won': 0, 'ng': 0} for m in ('visit', 'zoom')}
    for r in d.all(
            '''SELECT COALESCE(cl.visit_method, 'visit') AS m, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE cl.sales_result = 'won')::int AS won,
                      COUNT(*) FILTER (WHERE cl.sales_result = 'ng')::int AS ng
                 FROM telema_call_logs cl JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
                WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND vp.name = %s AND cl.user_id = ANY(%s) AND cl.called_at >= %s AND cl.called_at < %s
                GROUP BY 1''', (SALES, uids, start, end)):
        for k in ('n', 'won', 'ng'):
            cnt[r['m']][k] += r[k]
    for r in d.all(
            '''SELECT COALESCE(o.visit_method, 'visit') AS m, COUNT(*) FILTER (WHERE cl.sales_result = 'won')::int AS won, COUNT(*) FILTER (WHERE cl.sales_result = 'ng')::int AS ng
                 FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1 LEFT JOIN telema_call_logs o ON o.id = cl.reply_to_id
                WHERE cl.is_active = 1 AND cl.record_type = 'reply' AND cl.user_id = ANY(%s) AND cl.called_at >= %s AND cl.called_at < %s
                GROUP BY 1''', (uids, start, end)):
        cnt[r['m']]['won'] += r['won']
        cnt[r['m']]['ng'] += r['ng']
    v, z = cnt['visit'], cnt['zoom']
    n_all, won_all, ng_all = v['n'] + z['n'], v['won'] + z['won'], v['ng'] + z['ng']

    # 翌アポ（次の稼働日の、初回訪問予定・営業予定）。2週間先まで稼働日がなければ翌日
    nxt = next((day + timedelta(days=i) for i in range(1, 15) if is_workday(day + timedelta(days=i), over)), day + timedelta(days=1))
    nstart = iso_utc(datetime(nxt.year, nxt.month, nxt.day, tzinfo=JST))
    nend = iso_utc(datetime(nxt.year, nxt.month, nxt.day, tzinfo=JST) + timedelta(days=1))
    plan_lines, plan_count = [], 0
    for m in members:
        plans = [p for p in agenda_items(d, m['id'], nstart, nend) if p['kind'] in APPOINTMENT_KINDS]
        plan_count += len(plans)
        plan_lines.append(f'{_short(m["display_name"])}　' + ('、'.join(f'{_hm(p["at"])} {p["company_name"]}' for p in plans) if plans else 'なし'))

    orders = '、'.join(f'{c["company_name"]} {c["product_name"]} {_p(c["gross_profit"] or 0)}P/{c["units"] or 0}台' for c in today_orders) or 'なし'
    lines = [
        f'{day.month}/{day.day}' + (f'_{dept}' if dept else '') + (f' {label}' if label else ''), '',
        f'累計稼働　{elapsed}日目(総稼動{total}日）',
        f'本日受注 　{orders}',
        '営業予算　' + (f'{_p(tg["gp"])}P/{tg["units"]}台' if tg['n'] else '未設定'),
        f'累計必要数 {_round(need_gp)}P/{_round(need_units)}台',
        f'実数 {_p(act_gp)}P/{act_units}台',
        f'達成率　{_rate(act_gp / 10000, _round(need_gp), 1)}/{_rate(act_units, _round(need_units), 1)}', '',
        f'累計営業件数{n_all}件', f'（訪問{v["n"]}、zoom{z["n"]}）',
        f'累計受注件数{won_all}', f'（訪問{v["won"]}、zoom{z["won"]}）',
        f'営業落ち率 {_rate(ng_all, n_all, 0)}', f'（訪問 {_rate(v["ng"], v["n"], 0)}、zoom {_rate(z["ng"], z["n"], 0)}）', '',
        f'翌アポ　{plan_count}件', *plan_lines, '', '以上',
    ]
    return {'date': day.isoformat(), 'user_ids': uids, 'members': [{'id': m['id'], 'name': m['display_name']} for m in members], 'department': dept,
            'next_workday': nxt.isoformat(), 'plans': plan_count, 'text': '\n'.join(lines) + '\n'}


@bp.get('/daily-report')
def daily_report():
    user, d = current_user(), db()
    uids = _members(d, user, request.args.get('user_ids'))
    day = parse_day(request.args.get('date') or datetime.now(JST).strftime('%Y-%m-%d'), 'date')
    dept, label = request.args.get('dept'), request.args.get('label', '最終')
    if len(label) > 20 or (dept is not None and len(dept) > 50):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（dept・label: 長すぎます）')
    return jsonify(build_report(d, uids, day, user['id'] if user['id'] in uids else uids[0], dept, label))
