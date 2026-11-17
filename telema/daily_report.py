"""日報の自動作成。決まったフォーマット（課・チームの1日の報告）の数値を、記録から自動で入れる。
 - 累計稼働：その月の初日〜選んだ日の稼働日の数（カレンダーの稼働日設定。なければ平日）／ 総稼動＝その月の稼働日の数
 - 営業予算：月の目標（粗利P・台数。数値分析の目標）の、対象メンバーの合計
 - 累計必要数：営業予算 × 累計稼働 ÷ 総稼動（四捨五入）
 - 実数：その月の初日〜選んだ日の受注（契約情報の契約日）の粗利P・台数
 - 達成率：実数 ÷ 累計必要数（表示している四捨五入後の数。粗利・台数それぞれ）
 - 累計営業件数／累計受注件数／営業落ち率：その月の初日〜選んだ日の「営業」の訪問記録と返事待ち対応から、訪問・Zoom別（返事待ち対応は元の訪問の方法）
 - 翌アポ：次の稼働日の営業予定（カレンダー。初回訪問予定は数えない）。メンバーごとに「時刻 場所 or zoom」を並べる（zoom は予定に入れた方法。訪問は施設の市区町村）
 文面の型（フォーマット）は設定で直せる（{{項目}}の差し込み方式。保存がなければ DEFAULT_TEMPLATE）
 対象メンバーは、選んだメンバー（省略は、組織図で自分と同じ部署（課）のメンバー。組織図に所属がなければ旧ユーザーの部署、それもなければ自分だけ）。一般の営業は自分だけ"""
import re
from datetime import datetime, timedelta

from flask import jsonify, request

from .agenda import agenda_items, month_days, parse_day
from .analytics import is_workday, workday_overrides, workdays
from .common import JST
from .common import audit
from .context import ApiError, body, current_user, db, require_role
from .org import _today, assignments_on, department_of
from .routes import bp
from .validate import Invalid, Str, iso_utc, parse

SALES = '営業'
APPOINTMENT_KINDS = ('visit',)     # 翌アポに数える予定（営業予定だけ。初回訪問予定は数えない）

# 日報の文面の型。{{項目}} の所に数値が入る。使える項目は PLACEHOLDERS（設定の画面にも出る）
DEFAULT_TEMPLATE = """{{見出し}}

累計稼働　{{累計稼働日数}}日目(総稼動{{総稼働日数}}日）
本日受注 　{{本日受注}}
営業予算　{{営業予算}}
累計必要数 {{累計必要数}}
実数 {{実数}}
達成率　{{達成率}}

累計営業件数{{累計営業件数}}件
（訪問{{訪問営業件数}}、zoom{{zoom営業件数}}）
累計受注件数{{累計受注件数}}
（訪問{{訪問受注件数}}、zoom{{zoom受注件数}}）
営業落ち率 {{営業落ち率}}
（訪問 {{訪問営業落ち率}}、zoom {{zoom営業落ち率}}）

翌アポ　{{翌アポ件数}}件
{{翌アポ一覧}}

以上
"""
PLACEHOLDERS = [
    ('見出し', '「11/17_特販二課 最終」のような1行（日付・部署・区分）'),
    ('日付', '選んだ日（11/17）'),
    ('部署', '部署名'),
    ('区分', '区分（最終など）'),
    ('累計稼働日数', 'その月の初日から選んだ日までの稼働日数'),
    ('総稼働日数', 'その月の稼働日数'),
    ('本日受注', '選んだ日の受注（施設名・商材・粗利P/台数）。なければ「なし」'),
    ('営業予算', '月の目標の合計（粗利P/台数）'),
    ('累計必要数', '営業予算 × 累計稼働 ÷ 総稼動（粗利P/台数）'),
    ('実数', '月の初日から選んだ日までの受注（粗利P/台数）'),
    ('達成率', '実数 ÷ 累計必要数（粗利/台数）'),
    ('累計営業件数', '営業の件数（訪問＋Zoom）'),
    ('訪問営業件数', '営業の件数のうち訪問'),
    ('zoom営業件数', '営業の件数のうちZoom'),
    ('累計受注件数', '受注の件数（訪問＋Zoom）'),
    ('訪問受注件数', '受注のうち訪問'),
    ('zoom受注件数', '受注のうちZoom'),
    ('営業落ち率', '営業のNGの割合（全体）'),
    ('訪問営業落ち率', '営業のNGの割合（訪問）'),
    ('zoom営業落ち率', '営業のNGの割合（Zoom）'),
    ('翌アポ件数', '次の稼働日の営業予定の件数（初回訪問予定は数えない）'),
    ('翌アポ一覧', 'メンバーごとの「名前　時刻 場所orzoom」（複数行。場所は施設の市区町村）'),
]
_PLACEHOLDER_RE = re.compile(r'\{\{([^{}\n]*)\}\}')
TEMPLATE_MAX = 5000


def unknown_placeholders(text):
    known = {k for k, _ in PLACEHOLDERS}
    return [k for k in dict.fromkeys(m.strip() for m in _PLACEHOLDER_RE.findall(text)) if k not in known]


def render_template(text, values):
    return _PLACEHOLDER_RE.sub(lambda m: values.get(m.group(1).strip(), m.group(0)), text)


def saved_template(d):
    row = d.first('SELECT body FROM telema_daily_report_template WHERE id = 1')
    return row['body'] if row else None


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


def _place(plan, places):
    """翌アポの場所。zoom の予定は「zoom」、訪問の予定は施設の市区町村（なければ都道府県）。どちらもなければ「場所未設定」"""
    if plan.get('method') == 'zoom':
        return 'zoom'
    c = places.get(plan['company_id']) or {}
    return (c.get('city') or '').strip() or (c.get('prefecture') or '').strip() or '場所未設定'


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
    dept = department_of(d, user['id'])
    if dept:
        asg = assignments_on(d, _today())
        same = {u for u, a in asg.items() if a['department_id'] == dept['id']}
        return [r['id'] for r in d.all('SELECT id FROM users WHERE id = ANY(%s) ORDER BY display_name, id', (list(same),))]
    mine = d.first('SELECT department FROM users WHERE id = %s', (user['id'],))
    if mine and (mine['department'] or '').strip():
        return [r['id'] for r in d.all('SELECT id FROM users WHERE department = %s ORDER BY display_name, id', (mine['department'],))]
    return [user['id']]


def build_report(d, uids, day, base_uid, dept=None, label='最終'):
    members = d.all('SELECT id, display_name, department FROM users WHERE id = ANY(%s)', (uids,))
    order = {u: i for i, u in enumerate(uids)}
    members.sort(key=lambda m: order[m['id']])
    if dept is None:
        # 見出しの部署名：メンバーの組織図の所属（その日時点）。なければ旧ユーザーの部署。一番多い名前
        depts = [n for n in ((department_of(d, m['id'], day) or {}).get('name') or (m['department'] or '').strip() for m in members) if n]
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

    # 翌アポ（次の稼働日の営業予定）。2週間先まで稼働日がなければ翌日
    nxt = next((day + timedelta(days=i) for i in range(1, 15) if is_workday(day + timedelta(days=i), over)), day + timedelta(days=1))
    nstart = iso_utc(datetime(nxt.year, nxt.month, nxt.day, tzinfo=JST))
    nend = iso_utc(datetime(nxt.year, nxt.month, nxt.day, tzinfo=JST) + timedelta(days=1))
    plan_lines, plan_count = [], 0
    member_plans = [(m, [p for p in agenda_items(d, m['id'], nstart, nend) if p['kind'] in APPOINTMENT_KINDS]) for m in members]
    places = {r['id']: r for r in d.all('SELECT id, city, prefecture FROM telema_companies WHERE id = ANY(%s)', ([p['company_id'] for _, ps in member_plans for p in ps],))}
    for m, plans in member_plans:
        plan_count += len(plans)
        plan_lines.append(f'{_short(m["display_name"])}　' + ('、'.join(f'{_hm(p["at"])} {_place(p, places)}' for p in plans) if plans else 'なし'))

    orders = '、'.join(f'{c["company_name"]} {c["product_name"]} {_p(c["gross_profit"] or 0)}P/{c["units"] or 0}台' for c in today_orders) or 'なし'
    heading = f'{day.month}/{day.day}' + (f'_{dept}' if dept else '') + (f' {label}' if label else '')
    values = {
        '見出し': heading, '日付': f'{day.month}/{day.day}', '部署': dept or '', '区分': label or '',
        '累計稼働日数': str(elapsed), '総稼働日数': str(total), '本日受注': orders,
        '営業予算': f'{_p(tg["gp"])}P/{tg["units"]}台' if tg['n'] else '未設定',
        '累計必要数': f'{_round(need_gp)}P/{_round(need_units)}台',
        '実数': f'{_p(act_gp)}P/{act_units}台',
        '達成率': f'{_rate(act_gp / 10000, _round(need_gp), 1)}/{_rate(act_units, _round(need_units), 1)}',
        '累計営業件数': str(n_all), '訪問営業件数': str(v['n']), 'zoom営業件数': str(z['n']),
        '累計受注件数': str(won_all), '訪問受注件数': str(v['won']), 'zoom受注件数': str(z['won']),
        '営業落ち率': _rate(ng_all, n_all, 0), '訪問営業落ち率': _rate(v['ng'], v['n'], 0), 'zoom営業落ち率': _rate(z['ng'], z['n'], 0),
        '翌アポ件数': str(plan_count), '翌アポ一覧': '\n'.join(plan_lines),
    }
    text = render_template(saved_template(d) or DEFAULT_TEMPLATE, values)
    return {'date': day.isoformat(), 'user_ids': uids, 'members': [{'id': m['id'], 'name': m['display_name']} for m in members], 'department': dept,
            'next_workday': nxt.isoformat(), 'plans': plan_count, 'text': text}


@bp.get('/daily-report')
def daily_report():
    user, d = current_user(), db()
    uids = _members(d, user, request.args.get('user_ids'))
    day = parse_day(request.args.get('date') or datetime.now(JST).strftime('%Y-%m-%d'), 'date')
    dept, label = request.args.get('dept'), request.args.get('label', '最終')
    if len(label) > 20 or (dept is not None and len(dept) > 50):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（dept・label: 長すぎます）')
    return jsonify(build_report(d, uids, day, user['id'] if user['id'] in uids else uids[0], dept, label))


def _template_payload(d):
    saved = saved_template(d)
    return {'body': saved if saved is not None else DEFAULT_TEMPLATE, 'default': DEFAULT_TEMPLATE, 'is_default': saved is None,
            'placeholders': [{'key': k, 'description': v} for k, v in PLACEHOLDERS]}


@bp.get('/daily-report/template')
def get_report_template():
    """日報の文面の型。保存がなければ標準のもの"""
    current_user()
    return jsonify(_template_payload(db()))


@bp.put('/daily-report/template')
def put_report_template():
    """日報の文面の型を保存する（マネージャー以上）。使えない {{項目}} があれば保存しない"""
    require_role('admin', 'manager')
    user, d = current_user(), db()
    b = parse({'body': Str(min=1, max=TEMPLATE_MAX)}, body())
    bad = unknown_placeholders(b['body'])
    if bad:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（使えない項目: ' + '、'.join('{{' + k + '}}' for k in bad) + '）')
    before = saved_template(d)
    d.run("""INSERT INTO telema_daily_report_template (id, body, updated_by, updated_at) VALUES (1, %s, %s, telema_now())
             ON CONFLICT (id) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at""", (b['body'], user['id']))
    audit(d, user['id'], 'update', 'daily_report_template', 1, {'body': before}, {'body': b['body']})
    return jsonify(_template_payload(d))


@bp.delete('/daily-report/template')
def reset_report_template():
    """標準の文面に戻す（マネージャー以上）"""
    require_role('admin', 'manager')
    user, d = current_user(), db()
    before = saved_template(d)
    if before is not None:
        d.run('DELETE FROM telema_daily_report_template WHERE id = 1')
        audit(d, user['id'], 'delete', 'daily_report_template', 1, {'body': before}, None)
    return jsonify(_template_payload(d))
