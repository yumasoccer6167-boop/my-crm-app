"""営業成績ダッシュボード。組織図の部署ツリーごとに、営業担当の月間目標・累計必要数・実数・達成率を並べ、課・部・事業部の小計・合計を出す。
 - 月間目標：数値分析の目標（営業ごと・月ごとの粗利・台数）
 - 累計必要数：月間目標 × 累計日数 ÷ 総稼働日数を、営業ごとに四捨五入（粗利はP単位）。課・部の小計は、営業ごとの四捨五入後の数の合計
   総稼働日数・累計日数は、画面を開いた人のカレンダーの稼働日設定から数える（今月は今日まで、過ぎた月は月末まで、先の月は0日）
 - 実数：契約情報（契約日がその月の初日〜今日／月末）の粗利・台数・契約数と、営業の「受注」の件数（即決受注＋返事待ち対応の受注）
 - 達成率：実数 ÷ 累計必要数（四捨五入後の数）。月間目標が0なら出さない。累計必要数が0のときは、実数も0なら0.0%、あれば出さない
 - 決アポ・担アポ：その月の架電のうち、結果が「初回訪問時間設定」か「アポ獲得」区分のもので、話した相手が決裁者／決裁者以外のもの（数値分析のテレアポと同じ定義）
 - 商談数：その月の、訪問の内容が「営業」の訪問記録の数。落ち率＝NG（返事待ち対応のNGを含む）÷ 商談数。商談数が0なら出さない
 （営業P残数・台数残数の現進捗＝実数−累計必要数、月末＝実数−月間目標。足し算の元になる数は画面側で出す）
 所属は、組織図の所属（集計の日時点）。営業（一般）は自分の行だけ"""
from datetime import datetime, timedelta

from flask import jsonify, request

from .agenda import month_days
from .common import JST
from .analytics import _month_arg, workday_overrides, workdays
from .context import current_user, db
from .org import _today, assignments_on, department_tree
from .analytics import SCHEDULING_STATUS
from .routes import bp
from .validate import iso_utc

SALES = '営業'
KEYS = ('target_gp', 'target_units', 'need_gp', 'need_units', 'act_gp', 'act_units', 'contracts', 'orders', 'appo_dm', 'appo_staff', 'deals', 'ng')


def _round(x):
    return int(x + 0.5)


def _rate(act, need, target):
    if not target:
        return None
    if not need:
        return 0.0 if not act else None
    return round(act / need * 100, 1)


def _add(a, b):
    return {k: a[k] + b[k] for k in KEYS}


def _row(kind, level, name, vals, **extra):
    return {'kind': kind, 'level': level, 'name': name, **vals, 'rate_gp': _rate(vals['act_gp'], vals['need_gp'], vals['target_gp']),
            'rate_units': _rate(vals['act_units'], vals['need_units'], vals['target_units']),
            'rate_fall': round(vals['ng'] / vals['deals'] * 100, 1) if vals['deals'] else None, **extra}


@bp.get('/sales-board')
def sales_board():
    user, d = current_user(), db()
    month = _month_arg()
    first, last = month_days(month)
    today = _today()
    cutoff = None if today < first else min(today, last)
    over = workday_overrides(d, user['id'], first, last)
    total = workdays(first, last, over)
    elapsed = workdays(first, cutoff, over) if cutoff else 0
    share = elapsed / total if total else 0
    asof = cutoff or today

    people = d.all('SELECT id, display_name FROM users ORDER BY display_name, id')
    if user['role'] == 'sales':
        people = [p for p in people if p['id'] == user['id']]
    vals = {p['id']: dict.fromkeys(KEYS, 0) for p in people}
    for r in d.all('SELECT user_id, gross_profit, units FROM telema_targets WHERE month = %s', (month,)):
        if r['user_id'] in vals:
            v = vals[r['user_id']]
            v['target_gp'], v['target_units'] = r['gross_profit'], r['units']
            v['need_gp'] = _round(r['gross_profit'] / 10000 * share) * 10000
            v['need_units'] = _round(r['units'] * share)
    if cutoff:
        start = iso_utc(datetime(first.year, first.month, first.day, tzinfo=JST))
        for r in d.all(
                '''SELECT ct.assigned_user_id AS uid, COALESCE(SUM(ct.gross_profit), 0)::bigint AS gp, COALESCE(SUM(ct.units), 0)::bigint AS units, COUNT(*)::int AS n
                     FROM telema_contracts ct JOIN telema_companies c ON c.id = ct.company_id AND c.is_active = 1
                    WHERE ct.is_active = 1 AND ct.contract_date::date >= %s AND ct.contract_date::date <= %s GROUP BY 1''', (first, cutoff)):
            if r['uid'] in vals:
                vals[r['uid']].update(act_gp=r['gp'], act_units=r['units'], contracts=r['n'])
        end = iso_utc(datetime(cutoff.year, cutoff.month, cutoff.day, tzinfo=JST) + timedelta(days=1))
        for r in d.all(
                '''SELECT cl.user_id AS uid, COUNT(*)::int AS n
                     FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
                     LEFT JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
                    WHERE cl.is_active = 1 AND cl.sales_result = 'won' AND (cl.record_type = 'reply' OR (cl.record_type = 'visit' AND vp.name = %s))
                      AND cl.called_at >= %s AND cl.called_at < %s GROUP BY 1''', (SALES, start, end)):
            if r['uid'] in vals:
                vals[r['uid']]['orders'] = r['n']
        # 商談数（営業の訪問記録）と、NG（返事待ち対応のNGを含む）
        for r in d.all(
                '''SELECT cl.user_id AS uid, COUNT(*) FILTER (WHERE cl.record_type = 'visit')::int AS deals,
                          COUNT(*) FILTER (WHERE cl.sales_result = 'ng')::int AS ng
                     FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
                     LEFT JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
                    WHERE cl.is_active = 1 AND (cl.record_type = 'reply' OR (cl.record_type = 'visit' AND vp.name = %s))
                      AND cl.called_at >= %s AND cl.called_at < %s GROUP BY 1''', (SALES, start, end)):
            if r['uid'] in vals:
                vals[r['uid']].update(deals=r['deals'], ng=r['ng'])
        # 決アポ・担アポ（テレアポの架電）
        for r in d.all(
                '''SELECT cl.user_id AS uid, COUNT(*) FILTER (WHERE k.is_decision_maker = 1)::int AS dm,
                          COUNT(*) FILTER (WHERE COALESCE(k.is_decision_maker, 0) <> 1)::int AS staff
                     FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id AND c.is_active = 1
                     JOIN telema_contacts k ON k.id = cl.contact_id JOIN telema_call_statuses s ON s.id = cl.result_status_id
                    WHERE cl.is_active = 1 AND cl.record_type = 'call' AND (s.label = %s OR s.category = 'appointment')
                      AND cl.called_at >= %s AND cl.called_at < %s GROUP BY 1''', (SCHEDULING_STATUS, start, end)):
            if r['uid'] in vals:
                vals[r['uid']].update(appo_dm=r['dm'], appo_staff=r['staff'])

    # 所属ごとのメンバー
    depts = department_tree(d)
    known = {x['id'] for x in depts}
    children = {}
    for x in depts:
        children.setdefault(x['parent_id'], []).append(x)
    asg = assignments_on(d, asof)
    members = {}
    unassigned = []
    for p in people:
        a = asg.get(p['id'])
        if a and a['department_id'] in known:
            members.setdefault(a['department_id'], []).append(p)
        else:
            unassigned.append(p)
    unassigned = [p for p in unassigned if any(vals[p['id']].values())]      # 所属のない人は、目標か実績があるときだけ載せる

    roots = children.get(None, [])
    rows_by_root = []

    def walk(dept, depth):
        """部署の行（メンバー → 配下の部署 → 小計）を作る。メンバーが1人もいない部署は載せない。(行のリスト, 合計) を返す"""
        rows, tot, n = [], dict.fromkeys(KEYS, 0), 0
        for p in members.get(dept['id'], []):
            rows.append(_row('member', 'member', p['display_name'], vals[p['id']], user_id=p['id'], depth=depth + 1))
            tot, n = _add(tot, vals[p['id']]), n + 1
        for c in children.get(dept['id'], []):
            sub = walk(c, depth + 1)
            if sub:
                rows += sub[0]
                tot, n = _add(tot, sub[1]), n + 1
        if not n:
            return None
        rows.append(_row('dept', depth, dept['name'], tot, department_id=dept['id'], depth=depth))
        return rows, tot

    parts = []
    for r in roots:
        w = walk(r, 0)
        if w:
            parts.append(w)
    if unassigned:
        rows, tot = [], dict.fromkeys(KEYS, 0)
        for p in unassigned:
            rows.append(_row('member', 'member', p['display_name'], vals[p['id']], user_id=p['id'], depth=1))
            tot = _add(tot, vals[p['id']])
        rows.append(_row('dept', 0, '未所属', tot, department_id=None, depth=0))
        parts.append((rows, tot))

    grand = len(parts) > 1
    offset = 1 if grand else 0
    out = []
    for rows, _ in parts:
        for r in rows:
            if r['kind'] == 'dept':
                lvl = r['level'] + offset
                r['level'] = 'total' if lvl == 0 else 'group' if lvl == 1 else 'unit'
                if r['level'] == 'total':
                    r['name'] += ' 合計'
            r['depth'] += offset
            out.append(r)
    if grand:
        tot = dict.fromkeys(KEYS, 0)
        for _, t in parts:
            tot = _add(tot, t)
        out.append(_row('dept', 'total', '全体 合計', tot, depth=0))
    return jsonify({'month': month, 'workdays_total': total, 'workdays_elapsed': elapsed, 'rows': out})
