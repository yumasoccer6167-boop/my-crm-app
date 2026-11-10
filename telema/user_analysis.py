"""ユーザー分析。「ユーザー」にチェックが入った施設（is_user = 1）と、その契約情報を、画面で掛け合わせて分析できる形で返す。
 - 施設：業種（未登録は「未設定」）、都道府県・市区町村（空なら「不明」）、法人
 - 契約：商材、課題（接点＝ニーズ。選んでいない契約は issues が空）、受注金額・粗利・台数
絞り込み（業種・都道府県・市区町村・商材・接点の複数選択）と集計・クロス集計は、画面側で行う。
シェアの把握用なので、担当に関係なく全体を返す（無効な施設・削除した契約は含めない）"""
from flask import jsonify

from .context import db
from .routes import bp

NO_INDUSTRY = '未設定'
NO_PLACE = '不明'


@bp.get('/user-analysis')
def user_analysis():
    d = db()
    facilities = d.all(
        '''SELECT id, COALESCE(NULLIF(btrim(industry), ''), %s) AS industry,
                  COALESCE(NULLIF(btrim(prefecture), ''), %s) AS prefecture,
                  COALESCE(NULLIF(btrim(city), ''), %s) AS city, organization_id
             FROM telema_companies WHERE is_active = 1 AND is_user = 1 ORDER BY id''', (NO_INDUSTRY, NO_PLACE, NO_PLACE))
    contracts = d.all(
        '''SELECT k.company_id, k.product_name AS product, k.issues, k.amount, k.gross_profit, k.units
             FROM telema_contracts k JOIN telema_companies c ON c.id = k.company_id AND c.is_active = 1 AND c.is_user = 1
            WHERE k.is_active = 1 ORDER BY k.id''')
    for k in contracts:
        k['issues'] = [i.strip() for i in (k['issues'] or []) if i and i.strip()]
    return jsonify({'facilities': facilities, 'contracts': contracts})
