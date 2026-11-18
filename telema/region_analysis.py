"""地域分析。都道府県・市区町村（と業種）で絞り込んで、次の3つを見る。担当に関係なく全体の数（無効な施設・削除した契約は含めない）。
 - 業種別の事業所数：絞り込んだ地域にある登録施設を、業種ごとに数える（例：日立市で絞ると、日立市内の私学助成の幼稚園・施設給付型の幼稚園…）
 - 地域別の営業活動：期間内の架電数・時間設定件数（結果が時間設定成立の区分）・初回訪問・営業（訪問記録の内容）・受注（契約情報の契約日）・粗利・台数
 - 地域別のリスト状況：登録施設数・架電済み（架電が1件以上）・未架電・ユーザー数と、その率。未開拓エリアを探す
地域の行は、都道府県を選ぶまでは都道府県ごと、選んだら市区町村ごと。業種が空の施設は「未設定」、都道府県・市区町村が空の施設は「不明」"""
from datetime import datetime, timedelta

from flask import jsonify, request

from .agenda import parse_day
from .common import JST
from .context import ApiError, db
from .routes import bp
from .validate import iso_utc

NO_INDUSTRY = '未設定'
NO_PLACE = '不明'
FIRST_PURPOSE = '初回訪問'
SALES_PURPOSE = '営業'

_IND = "COALESCE(NULLIF(btrim(c.industry), ''), %s)"
_PREF = "COALESCE(NULLIF(btrim(c.prefecture), ''), %s)"
_CITY = "COALESCE(NULLIF(btrim(c.city), ''), %s)"


def _month_start(day):
    return day.replace(day=1)


def _bounds(day_from, day_to):
    start = iso_utc(datetime(day_from.year, day_from.month, day_from.day, tzinfo=JST))
    end = iso_utc(datetime(day_to.year, day_to.month, day_to.day, tzinfo=JST) + timedelta(days=1))
    return start, end


@bp.get('/region-analysis')
def region_analysis():
    d = db()
    today = datetime.now(JST).date()
    day_from = parse_day(request.args.get('from') or _month_start(today).isoformat(), 'from')
    day_to = parse_day(request.args.get('to') or today.isoformat(), 'to')
    if day_from > day_to:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（from: 開始日は終了日より前にしてください）')
    start, end = _bounds(day_from, day_to)
    pref = (request.args.get('prefecture') or '').strip() or None
    city = (request.args.get('city') or '').strip() or None
    industry = (request.args.get('industry') or '').strip() or None
    if city and not pref:
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（city: 市区町村を選ぶときは都道府県も選んでください）')

    # 地域の条件（業種の絞り込みあり／なし）。c は telema_companies
    area_sql, area_p = 'c.is_active = 1', []
    if pref:
        area_sql += f' AND {_PREF} = %s'
        area_p += [NO_PLACE, pref]
    if city:
        area_sql += f' AND {_CITY} = %s'
        area_p += [NO_PLACE, city]
    full_sql, full_p = area_sql, list(area_p)
    if industry:
        full_sql += f' AND {_IND} = %s'
        full_p += [NO_INDUSTRY, industry]
    level = _CITY if pref else _PREF                    # 行の単位。都道府県を選んだら市区町村ごと

    # 選択肢：都道府県は全体、市区町村は選んだ都道府県の中。業種は絞り込んだ地域の中（業種の絞り込みは外して数える）
    prefectures = d.all(f'SELECT {_PREF} AS name, COUNT(*)::int AS total FROM telema_companies c WHERE c.is_active = 1 GROUP BY 1 ORDER BY 1', (NO_PLACE,))
    cities = d.all(f'SELECT {_CITY} AS name, COUNT(*)::int AS total FROM telema_companies c WHERE c.is_active = 1 AND {_PREF} = %s GROUP BY 1 ORDER BY 1', (NO_PLACE, NO_PLACE, pref)) if pref else []
    industries = d.all(
        f'''SELECT {_IND} AS industry, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE c.call_count > 0)::int AS called, COUNT(*) FILTER (WHERE c.is_user = 1)::int AS users
              FROM telema_companies c WHERE {area_sql} GROUP BY 1 ORDER BY total DESC, 1''', (NO_INDUSTRY, *area_p))

    # 地域ごとの行。リスト状況（登録施設）→ 営業活動（架電・訪問）→ 受注（契約）の順に合わせる
    rows = {}
    for r in d.all(
            f'''SELECT {level} AS area, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE c.call_count > 0)::int AS called, COUNT(*) FILTER (WHERE c.is_user = 1)::int AS users
                  FROM telema_companies c WHERE {full_sql} GROUP BY 1''', (NO_PLACE, *full_p)):
        rows[r['area']] = {**r, 'calls': 0, 'scheduled': 0, 'first_visits': 0, 'sales': 0, 'contracts': 0, 'gross_profit': 0, 'units': 0}
    for r in d.all(
            f'''SELECT {level} AS area,
                       COUNT(*) FILTER (WHERE cl.record_type = 'call')::int AS calls,
                       COUNT(*) FILTER (WHERE cl.record_type = 'call' AND st.category = 'appointment')::int AS scheduled,
                       COUNT(*) FILTER (WHERE cl.record_type = 'visit' AND vp.name = %s)::int AS first_visits,
                       COUNT(*) FILTER (WHERE cl.record_type = 'visit' AND vp.name = %s)::int AS sales
                  FROM telema_call_logs cl JOIN telema_companies c ON c.id = cl.company_id
                  LEFT JOIN telema_call_statuses st ON st.id = cl.result_status_id LEFT JOIN telema_visit_purposes vp ON vp.id = cl.visit_purpose_id
                 WHERE cl.is_active = 1 AND cl.called_at >= %s AND cl.called_at < %s AND {full_sql} GROUP BY 1''',
            (NO_PLACE, FIRST_PURPOSE, SALES_PURPOSE, start, end, *full_p)):
        if r['area'] in rows:
            rows[r['area']].update({k: r[k] for k in ('calls', 'scheduled', 'first_visits', 'sales')})
    for r in d.all(
            f'''SELECT {level} AS area, COUNT(*)::int AS contracts, COALESCE(SUM(k.gross_profit), 0)::bigint AS gross_profit, COALESCE(SUM(k.units), 0)::int AS units
                  FROM telema_contracts k JOIN telema_companies c ON c.id = k.company_id
                 WHERE k.is_active = 1 AND k.contract_date::date >= %s AND k.contract_date::date <= %s AND {full_sql} GROUP BY 1''',
            (NO_PLACE, day_from, day_to, *full_p)):
        if r['area'] in rows:
            rows[r['area']].update({k: r[k] for k in ('contracts', 'gross_profit', 'units')})
    areas = sorted(rows.values(), key=lambda a: (-a['total'], a['area']))
    return jsonify({
        'from': day_from.isoformat(), 'to': day_to.isoformat(), 'level': 'city' if pref else 'prefecture',
        'filters': {'prefecture': pref, 'city': city, 'industry': industry},
        'options': {'prefectures': prefectures, 'cities': cities},
        'industries': industries, 'areas': areas,
        'totals': {k: sum(a[k] for a in areas) for k in ('total', 'called', 'users', 'calls', 'scheduled', 'first_visits', 'sales', 'contracts', 'gross_profit', 'units')},
    })
