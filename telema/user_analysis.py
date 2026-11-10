"""ユーザー分析。「ユーザー」の印が付いた施設を、業種別・地域別（都道府県／市区町村）・接点別（契約情報の課題）で数える。
 - 業種別：登録施設の業種ごとの施設数と、そのうちユーザーの数（未登録は「未設定」）
 - 地域別：都道府県、市区町村（都道府県ごと）の登録施設数とユーザー数（住所が空なら「不明」）
 - 接点別：契約情報で選んだ「課題」（集客・採用・クチコミ対策など。接点＝ニーズ）ごとの施設数と契約数。課題を選んでいない契約は「課題未選択」。
   1つの契約で複数の課題を選べるので、課題ごとの数を足した合計は契約の数より多くなる
シェアの把握用なので、担当に関係なく全体を数える（都道府県別のユーザー割合と同じ）"""
from flask import jsonify

from .context import db
from .routes import bp

NO_INDUSTRY = '未設定'
NO_PLACE = '不明'
NO_ISSUE = '課題未選択'


@bp.get('/user-analysis')
def user_analysis():
    d = db()
    totals = d.first(
        '''SELECT COUNT(*) AS facility_count,
                  COUNT(*) FILTER (WHERE is_user = 1) AS user_facility_count,
                  COUNT(DISTINCT organization_id) AS organization_count,
                  COUNT(DISTINCT organization_id) FILTER (WHERE is_user = 1) AS user_organization_count
             FROM telema_companies WHERE is_active = 1''')
    industries = d.all(
        '''SELECT COALESCE(NULLIF(btrim(industry), ''), %s) AS industry,
                  COUNT(*) AS count, COUNT(*) FILTER (WHERE is_user = 1) AS user_count
             FROM telema_companies WHERE is_active = 1 GROUP BY 1
            ORDER BY (COALESCE(NULLIF(btrim(industry), ''), %s) = %s), count DESC, 1''', (NO_INDUSTRY, NO_INDUSTRY, NO_INDUSTRY))
    prefectures = d.all(
        '''SELECT COALESCE(NULLIF(btrim(prefecture), ''), %s) AS prefecture,
                  COUNT(*) AS total, COUNT(*) FILTER (WHERE is_user = 1) AS users
             FROM telema_companies WHERE is_active = 1 GROUP BY 1''', (NO_PLACE,))
    cities = d.all(
        '''SELECT COALESCE(NULLIF(btrim(prefecture), ''), %s) AS prefecture, COALESCE(NULLIF(btrim(city), ''), %s) AS city,
                  COUNT(*) AS total, COUNT(*) FILTER (WHERE is_user = 1) AS users
             FROM telema_companies WHERE is_active = 1 GROUP BY 1, 2''', (NO_PLACE, NO_PLACE))
    needs = d.all(
        '''SELECT COALESCE(NULLIF(btrim(x.issue), ''), %s) AS issue,
                  COUNT(DISTINCT k.company_id) AS company_count, COUNT(DISTINCT k.id) AS contract_count
             FROM telema_contracts k
             JOIN telema_companies c ON c.id = k.company_id AND c.is_active = 1
            CROSS JOIN LATERAL unnest(CASE WHEN cardinality(k.issues) = 0 THEN ARRAY[NULL::text] ELSE k.issues END) AS x(issue)
            WHERE k.is_active = 1 GROUP BY 1
            ORDER BY (COALESCE(NULLIF(btrim(x.issue), ''), %s) = %s), company_count DESC, contract_count DESC, 1''', (NO_ISSUE, NO_ISSUE, NO_ISSUE))
    contracts = d.first(
        '''SELECT COUNT(*) AS contract_count, COUNT(DISTINCT k.company_id) AS company_count
             FROM telema_contracts k JOIN telema_companies c ON c.id = k.company_id AND c.is_active = 1 WHERE k.is_active = 1''')
    return jsonify({'totals': totals, 'industries': industries, 'prefectures': prefectures, 'cities': cities,
                    'needs': {'items': needs, **contracts}})
