"""マイページ。自分の数字を自分で確かめるためのページ（1ページ：数字の自己認識、2ページ：自己分析）。
1ページ（GET /mypage、PUT /mypage/commit）
 - 今日のコミット：その日にやると決めた数字（定量＝粗利・台数・商談件数）と、ひとことコメント（定性）。営業ごと・日ごと。自分の分だけ入力できる
 - 不足数（shortage）：今月のコミット（＝月間目標）に対する、今月・今週・今日の不足。項目は 粗利・台数・商談件数・時間設定件数・初回訪問件数・スケジューリング数。
   今月＝月間目標 − 今月の実績、今週＝週間目標 − 今週の実績、今日＝（月間目標 − 今日より前の今月の実績）÷ 今日以降の残り稼働日（今日を含む）を切り上げたもの（粗利は万円単位）− 今日の実績。
   0未満は0。月間目標が0（未設定）の項目は null
 - 週間（月〜日）・月間の、目標・実績：粗利・台数・商談数・初回訪問件数・時間設定件数・スケジューリング数。達成率と残数は画面側で出す（実績 ÷ 目標、目標 − 実績で0未満は0）
   週間の目標 ＝ 月間目標 × その週の稼働日数 ÷ その月の稼働日数（週が月をまたぐときは、月ごとに分けて足す）。稼働日は画面を開いた人のカレンダー（なければ平日）
   マネージャー・管理者は、個人（自分）とチーム（自分の所属の部署とその配下の全員。所属がなければ、管理者は全員・マネージャーは自分だけ）の両方
 - 実績の数え方は営業成績ダッシュボードと同じ：粗利・台数＝契約情報（契約日・営業担当）、商談数＝訪問の内容が「営業」の訪問記録、初回訪問件数＝「初回訪問」の訪問記録、
   時間設定件数＝架電の結果がステータス区分「アポ獲得」（時間設定成立）、スケジューリング数＝架電の結果が「初回訪問時間設定」（どちらもテレアポの集計と同じ）
翌週の予定（GET /mypage の next_week、PUT /mypage/next-week）
 - 来週（月〜日）の目標（月間目標 × 来週の稼働日数 ÷ その月の稼働日数）と、予定。実績の表と同じ形で、実績の代わりに予定を出す。
   予定の件数は、カレンダー（agenda.py）の翌週の予定から自動で数える（営業ごと：記録の担当者か施設の担当が自分の予定。チームは、チーム全員の予定）：
     初回訪問件数・スケジューリング数 ＝ 初回訪問予定（架電の結果が「初回訪問時間設定」の記録に付けた訪問日時）
     商談数 ＝ 営業予定（「時間設定」の架電の訪問日時 ＋ 初回訪問の結果「営業時間設定」の営業の日時）
     時間設定件数 ＝ 営業予定のうち、「時間設定」の架電から　　初回訪問時間設定件数 ＝ 営業予定のうち、初回訪問の「営業時間設定」から
   粗利・台数はカレンダーに情報が無いため、自分で入力する（営業ごと・週ごと。チームは全員の合計）
2ページ（GET /mypage/analysis?scope=closed|user）
 - closed＝自己クローズ（契約情報の営業担当が自分）、user＝自己ユーザー（営業担当か台数担当のどちらかが自分）の契約について、商材別・業種別の件数、平均粗利、
   1件あたり粗利、1契約あたり台数（同じ施設・同じ契約日の契約情報は、まとめて1契約と数える）、単月平均粗利・台数（最初の契約の月から今月まで）を返す"""
from datetime import datetime, timedelta
from math import ceil

from flask import jsonify, request

from .agenda import agenda_items, month_days
from .analytics import FIRST, SALES, SCHEDULING_STATUS, _day_bounds, _today, workday_overrides, workdays
from .common import JST, audit
from .context import ApiError, body, current_user, db
from .org import assignments_on, department_tree
from .routes import bp
from .validate import Int, Str, iso_utc, parse

KEYS = ('gross_profit', 'units', 'deals', 'first_visits', 'scheduled', 'scheduling')
NO_INDUSTRY = '未設定'
MAN = 10000     # 粗利は1万円＝1P


def _round(x):
    return int(x + 0.5)


# ---------- 対象の人 ----------
def _team(d, user, today):
    """チームの (名前, ユーザーIDの一覧)。一般（sales）は None。自分の所属の部署とその配下の全員。所属がなければ、管理者は全員・マネージャーは自分だけ"""
    if user['role'] == 'sales':
        return None
    depts = department_tree(d)
    asg = assignments_on(d, today)
    mine = asg.get(user['id'])
    names = {x['id']: x['name'] for x in depts}
    if mine and mine['department_id'] in names:
        children = {}
        for x in depts:
            children.setdefault(x['parent_id'], []).append(x['id'])
        ids, stack = set(), [mine['department_id']]
        while stack:
            cur = stack.pop()
            ids.add(cur)
            stack += children.get(cur, [])
        members = {uid for uid, a in asg.items() if a['department_id'] in ids}
        members.add(user['id'])
        return names[mine['department_id']], sorted(members)
    if user['role'] == 'admin':
        return '全体', [r['id'] for r in d.all('SELECT id FROM users ORDER BY id')]
    return '自分のみ', [user['id']]


# ---------- 実績・目標 ----------
def _actuals(d, ids, day_from, day_to):
    """ids の人たちの、day_from〜day_to（両端を含む日付）の実績。{gross_profit, units, deals, first_visits, scheduled, scheduled_first, scheduled_tele}。
    時間設定件数（scheduled）はテレアポからの時間設定（架電の結果）、初回訪問時間設定件数（scheduled_first）は初回訪問の結果が「営業時間設定」の訪問記録の数。別々の項目として数える"""
    out = {**dict.fromkeys(KEYS, 0), 'scheduled_first': 0}
    if day_to < day_from or not ids:
        return out
    start, end = _day_bounds(day_from, day_to)
    ct = d.first(
        '''SELECT COALESCE(SUM(ct.gross_profit), 0)::bigint AS gp, COALESCE(SUM(ct.units), 0)::bigint AS units
             FROM telema_contracts ct JOIN telema_companies c ON c.id = ct.company_id AND c.is_active = 1
            WHERE ct.is_active = 1 AND ct.assigned_user_id = ANY(%s) AND ct.contract_date::date >= %s AND ct.contract_date::date <= %s''', (ids, day_from, day_to))
    out['gross_profit'], out['units'] = ct['gp'], ct['units']
    v = d.first(
        '''SELECT COUNT(*) FILTER (WHERE vp.name = %s)::int AS deals, COUNT(*) FILTER (WHERE vp.name = %s)::int AS first_visits,
                  COUNT(*) FILTER (WHERE vp.name = %s AND cl.first_result = 'scheduled')::int AS scheduled_first
             FROM telema_call_logs cl JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
            WHERE cl.is_active = 1 AND cl.record_type = 'visit' AND cl.user_id = ANY(%s) AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s''',
        (SALES, FIRST, FIRST, ids, start, end))
    out['deals'], out['first_visits'], out['scheduled_first'] = v['deals'], v['first_visits'], v['scheduled_first']
    t = d.first(
        '''SELECT COUNT(*) FILTER (WHERE s.category = 'appointment')::int AS scheduled, COUNT(*) FILTER (WHERE s.label = %s)::int AS scheduling
             FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
             JOIN telema_call_statuses s ON s.id = cl.result_status_id
            WHERE cl.is_active = 1 AND cl.record_type = 'call' AND cl.user_id = ANY(%s)
              AND cl.called_at::timestamptz >= %s AND cl.called_at::timestamptz < %s''', (SCHEDULING_STATUS, ids, start, end))
    out['scheduled'], out['scheduling'] = t['scheduled'], t['scheduling']
    return out


def _month_targets(d, ids, month):
    """ids の人たちの、その月の目標の合計"""
    row = d.first(
        '''SELECT COALESCE(SUM(gross_profit), 0)::bigint AS gross_profit, COALESCE(SUM(units), 0)::bigint AS units, COALESCE(SUM(deals), 0)::bigint AS deals,
                  COALESCE(SUM(first_visits), 0)::bigint AS first_visits, COALESCE(SUM(scheduled), 0)::bigint AS scheduled,
                  COALESCE(SUM(scheduling), 0)::bigint AS scheduling
             FROM telema_targets WHERE user_id = ANY(%s) AND month = %s''', (ids, month))
    return {k: int(row[k]) for k in KEYS}


def _week_targets(d, ids, week_from, week_to, over):
    """週の目標。月間目標 × その週の稼働日数 ÷ その月の稼働日数（月をまたぐ週は月ごとに足す）。粗利は万円単位、そのほかは件数に四捨五入"""
    total = dict.fromkeys(KEYS, 0.0)
    cur = week_from.replace(day=1)
    while cur <= week_to:
        month = cur.strftime('%Y-%m')
        first, last = month_days(month)
        lo, hi = max(first, week_from), min(last, week_to)
        month_wd = workdays(first, last, over)
        share = workdays(lo, hi, over) / month_wd if month_wd else 0
        if share:
            for k, v in _month_targets(d, ids, month).items():
                total[k] += v * share
        cur = (last + timedelta(days=1))
    return {k: (_round(v / MAN) * MAN if k == 'gross_profit' else _round(v)) for k, v in total.items()}


def _pair(target, actual):
    # scheduled_first：初回訪問時間設定件数（目標は持たない）。時間設定昇華率＝初回訪問時間設定件数 ÷ 初回訪問件数（画面で出す）
    return {**{k: {'target': target[k], 'actual': actual[k]} for k in KEYS}, 'scheduled_first': actual['scheduled_first']}


# 不足数に出す項目（この順）
SHORT_KEYS = ('gross_profit', 'units', 'deals', 'scheduled', 'first_visits', 'scheduling')


# ---------- 翌週の予定 ----------
PLAN_KEYS = ('gross_profit', 'units')       # 自分で入れる予定（カレンダーから出せない項目）
PLAN_BODY = {
    'gross_profit': Int(min=0, nullable=True, optional=True),       # 円
    'units': Int(min=0, nullable=True, optional=True),
}


def _next_week(today):
    start = today - timedelta(days=today.weekday()) + timedelta(days=7)
    return start, start + timedelta(days=6)


def _plans(d, ids, week_start, week_end):
    """ids の人たちの、その週の予定。粗利・台数は入れた予定の合計（未入力は0）、そのほかの件数はカレンダーの予定から数える"""
    cols = ', '.join(f'COALESCE(SUM({k}), 0)::bigint AS {k}' for k in PLAN_KEYS)
    row = d.first(f'SELECT {cols} FROM telema_week_plans WHERE user_id = ANY(%s) AND week_start = %s', (ids, week_start.isoformat()))
    out = {k: int(row[k]) for k in PLAN_KEYS}
    start = iso_utc(datetime(week_start.year, week_start.month, week_start.day, tzinfo=JST))
    end = iso_utc(datetime(week_end.year, week_end.month, week_end.day, tzinfo=JST) + timedelta(days=1))
    items = agenda_items(d, None, start, end, ids=ids)
    first_visit = sum(1 for i in items if i['kind'] == 'first_visit')
    visit = [i for i in items if i['kind'] == 'visit']
    out.update({
        'first_visits': first_visit, 'scheduling': first_visit,
        'deals': len(visit),
        'scheduled': sum(1 for i in visit if i['detail'] == '時間設定'),
        'scheduled_first': sum(1 for i in visit if i['detail'] == '営業時間設定'),
    })
    return out


def _own_plan(d, user_id, week_start):
    """自分の予定。未入力の項目は None（入れていない）"""
    row = d.first(f'SELECT {", ".join(PLAN_KEYS)} FROM telema_week_plans WHERE user_id = %s AND week_start = %s', (user_id, week_start.isoformat()))
    return {k: (row[k] if row else None) for k in PLAN_KEYS}


# ---------- 1ページ ----------
@bp.get('/mypage')
def mypage():
    user, d = current_user(), db()
    today = _today()
    month = today.strftime('%Y-%m')
    first, last = month_days(month)
    week_from = today - timedelta(days=today.weekday())
    week_to = week_from + timedelta(days=6)
    next_from, next_to = _next_week(today)
    over = workday_overrides(d, user['id'], min(first, week_from), max(last, week_to, month_days(next_to.strftime('%Y-%m'))[1]))
    me = [user['id']]
    team = _team(d, user, today)

    target = _month_targets(d, me, month)
    before = _actuals(d, me, first, today - timedelta(days=1))
    done = _actuals(d, me, today, today)
    left_days = workdays(today, last, over)

    def block(ids, day_from, day_to, targets):
        return _pair(targets, _actuals(d, ids, day_from, day_to))

    week = {'from': week_from.isoformat(), 'to': week_to.isoformat(), 'personal': block(me, week_from, week_to, _week_targets(d, me, week_from, week_to, over))}
    mon = {'month': month, 'personal': block(me, first, today, target)}

    # 不足数：今月のコミット（＝月間目標）に対して、今月・今週・今日の不足
    #  今月＝月間目標 − 今月の実績、今週＝週間目標 − 今週の実績、今日＝（月間目標 − 今日より前の今月の実績）÷ 残り稼働日 − 今日の実績。0未満は0。月間目標が未設定の項目は null
    shortage = {}
    for k in SHORT_KEYS:
        if not target[k]:
            shortage[k] = None
            continue
        mp, wp = mon['personal'][k], week['personal'][k]
        remaining = max(0, target[k] - before[k])
        per = remaining / left_days if left_days else remaining
        need = ceil(per / MAN) * MAN if k == 'gross_profit' else ceil(per)
        shortage[k] = {
            'month': {'target': mp['target'], 'actual': mp['actual'], 'short': max(0, mp['target'] - mp['actual'])},
            'week': {'target': wp['target'], 'actual': wp['actual'], 'short': max(0, wp['target'] - wp['actual'])},
            'today': {'need': need, 'done': done[k], 'short': max(0, need - done[k])},
        }
    if team:
        week['team'] = block(team[1], week_from, week_to, _week_targets(d, team[1], week_from, week_to, over))
        mon['team'] = block(team[1], first, today, _month_targets(d, team[1], month))

    # 翌週の予定：実績の代わりに、入れた予定を出す
    def plan_block(ids):
        return _pair(_week_targets(d, ids, next_from, next_to, over), _plans(d, ids, next_from, next_to))

    own_plan = _own_plan(d, user['id'], next_from)
    nxt = {'from': next_from.isoformat(), 'to': next_to.isoformat(), 'personal': plan_block(me), 'plan': own_plan}
    if team:
        nxt['team'] = plan_block(team[1])

    commit = d.first('SELECT commit_gp, commit_units, commit_deals, comment, updated_at FROM telema_daily_commits WHERE user_id = %s AND day = %s', (user['id'], today.isoformat()))
    return jsonify({
        'today': today.isoformat(), 'role': user['role'], 'team_name': team[0] if team else None, 'team_size': len(team[1]) if team else None,
        'commit': commit, 'today_workday': workdays(today, today, over) == 1, 'workdays_left': left_days,
        'shortage': shortage, 'week': week, 'month': mon, 'next_week': nxt,
    })


@bp.put('/mypage/next-week')
def put_next_week():
    """来週の予定のうち、カレンダーから出せない粗利・台数を保存する（自分の分だけ。送らなかった項目は今のまま。空にするときは null）。そのほかの件数はカレンダーから自動で数える"""
    user, d = current_user(), db()
    b = parse(PLAN_BODY, body())
    week_start = _next_week(_today())[0]
    before = _own_plan(d, user['id'], week_start)
    merged = {**before, **b}
    d.run(
        f"""INSERT INTO telema_week_plans (user_id, week_start, {', '.join(PLAN_KEYS)}) VALUES (%s, %s, {', '.join(['%s'] * len(PLAN_KEYS))})
            ON CONFLICT (user_id, week_start) DO UPDATE SET {', '.join(f'{k} = EXCLUDED.{k}' for k in PLAN_KEYS)}, updated_at = telema_now()""",
        (user['id'], week_start.isoformat(), *(merged[k] for k in PLAN_KEYS)))
    audit(d, user['id'], 'update', 'week_plan', user['id'], {'week_start': week_start.isoformat(), **before}, {'week_start': week_start.isoformat(), **merged})
    return jsonify({'week_start': week_start.isoformat(), 'plan': merged})


COMMIT_BODY = {
    'commit_gp': Int(min=0, nullable=True, optional=True),
    'commit_units': Int(min=0, nullable=True, optional=True),
    'commit_deals': Int(min=0, nullable=True, optional=True),
    'comment': Str(max=1000, nullable=True, optional=True),
}


@bp.put('/mypage/commit')
def put_commit():
    """今日のコミットを保存する（自分の分だけ。送らなかった項目は今の値のまま。空にするときは null か空文字）"""
    user, d = current_user(), db()
    b = parse(COMMIT_BODY, body())
    day = _today().isoformat()
    before = d.first('SELECT commit_gp, commit_units, commit_deals, comment FROM telema_daily_commits WHERE user_id = %s AND day = %s', (user['id'], day))
    merged = {**(before or dict.fromkeys(COMMIT_BODY)), **b}
    merged['comment'] = merged['comment'] or None
    d.run(
        '''INSERT INTO telema_daily_commits (user_id, day, commit_gp, commit_units, commit_deals, comment) VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT (user_id, day) DO UPDATE SET commit_gp = EXCLUDED.commit_gp, commit_units = EXCLUDED.commit_units, commit_deals = EXCLUDED.commit_deals,
             comment = EXCLUDED.comment, updated_at = telema_now()''',
        (user['id'], day, merged['commit_gp'], merged['commit_units'], merged['commit_deals'], merged['comment']))
    audit(d, user['id'], 'update', 'daily_commit', user['id'], before, {'day': day, **merged})
    return jsonify({'day': day, **merged})


# ---------- 2ページ ----------
def _avg(total, n):
    return None if not n else total / n


@bp.get('/mypage/analysis')
def mypage_analysis():
    user, d = current_user(), db()
    scope = request.args.get('scope') or 'closed'
    if scope not in ('closed', 'user'):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（scope: closed / user のどちらかを指定してください）')
    who = 'ct.assigned_user_id = %s' if scope == 'closed' else '(ct.assigned_user_id = %s OR ct.units_user_id = %s)'
    rows = d.all(
        f'''SELECT ct.company_id, ct.product_name AS product, ct.contract_date, ct.gross_profit, ct.units,
                   COALESCE(NULLIF(btrim(c.industry), ''), %s) AS industry
              FROM telema_contracts ct JOIN telema_companies c ON c.id = ct.company_id AND c.is_active = 1
             WHERE ct.is_active = 1 AND {who} ORDER BY ct.contract_date, ct.id''', (NO_INDUSTRY, *([user['id']] * (1 if scope == 'closed' else 2))))

    products, industries, months = {}, {}, {}
    deals = {}      # 同じ施設・同じ契約日は1契約
    gp_sum = gp_n = 0
    units_sum = 0
    for r in rows:
        p = products.setdefault(r['product'], {'name': r['product'], 'orders': 0, 'gross_profit': 0, 'gp_n': 0})
        p['orders'] += 1
        if r['gross_profit'] is not None:
            p['gross_profit'] += r['gross_profit']
            p['gp_n'] += 1
            gp_sum += r['gross_profit']
            gp_n += 1
        industries[r['industry']] = industries.get(r['industry'], 0) + 1
        m = months.setdefault(r['contract_date'][:7], {'month': r['contract_date'][:7], 'orders': 0, 'gross_profit': 0, 'units': 0})
        m['orders'] += 1
        m['gross_profit'] += r['gross_profit'] or 0
        m['units'] += r['units'] or 0
        units_sum += r['units'] or 0
        key = (r['company_id'], r['contract_date'])
        got = deals.get(key)      # その契約の台数（まだ1件も入っていなければ None）
        deals[key] = got if r['units'] is None else (got or 0) + r['units']
    for p in products.values():
        p['avg_gross_profit'] = _avg(p['gross_profit'], p['gp_n'])
        del p['gp_n']

    # 台数が入っている契約だけで割る（台数が未入力の契約は、平均を下げないよう外す）
    deal_units = [v for v in deals.values() if v is not None]
    # 単月平均：最初の契約の月から今月まで（契約のない月も1か月として数える）
    cur = _today().strftime('%Y-%m')
    first_month = rows[0]['contract_date'][:7] if rows else None
    n_months = 0
    series = []
    if first_month:
        y, mo = int(first_month[:4]), int(first_month[5:])
        ey, em = int(cur[:4]), int(cur[5:])
        while (y, mo) <= (ey, em):
            key = f'{y:04d}-{mo:02d}'
            series.append(months.get(key) or {'month': key, 'orders': 0, 'gross_profit': 0, 'units': 0})
            y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
        # 今月より先の契約日（予定）があれば、その月も含める
        series += [months[k] for k in sorted(months) if k > cur]
        n_months = len(series)

    return jsonify({
        'scope': scope,
        'summary': {
            'orders': len(rows), 'deals': len(deals), 'gross_profit': gp_sum, 'units': units_sum, 'months': n_months,
            'avg_gross_profit': _avg(gp_sum, gp_n),
            'units_per_deal': _avg(sum(deal_units), len(deal_units)),
            'monthly_gross_profit': _avg(gp_sum, n_months),
            'monthly_units': _avg(units_sum, n_months),
        },
        'products': sorted(products.values(), key=lambda p: (-p['orders'], p['name'])),
        'industries': [{'name': k, 'orders': v} for k, v in sorted(industries.items(), key=lambda kv: (-kv[1], kv[0]))],
        'months': series,
    })
