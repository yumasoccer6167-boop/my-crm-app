"""同じ市（区町村）のユーザー（導入済みの施設）。カルテで、近くのユーザーを自動で一覧にする。理事長名・園長名・法人名・園名を出す。"""
import re

from flask import jsonify

from .common import company_visibility
from .companies import load_visible_company
from .context import current_user, db
from .routes import bp
from .validate import parse_id

NEARBY_LIMIT = 100

# 政令指定都市は、区ではなく市の単位でそろえる（相模原市緑区と相模原市中央区は、どちらも「相模原市」）。東京23区など、市のない区はそのまま
CITY_KEY_SQL = r"COALESCE(substring(c.city from '^(.+?市).+区$'), c.city)"


def city_key(city):
    m = re.match(r'^(.+?市).+区$', city or '')
    return m.group(1) if m else city


def _contact_name(role_like):
    """施設（または施設の法人）に登録された、役職に role_like を含む担当者の名前（施設の担当者を優先、決裁者・更新が新しい順）"""
    return f'''(SELECT ct.name FROM telema_contacts ct
                 WHERE ct.is_active = 1 AND ct.name IS NOT NULL AND ct.role LIKE '%%{role_like}%%'
                   AND (ct.company_id = c.id OR (ct.company_id IS NULL AND ct.organization_id = c.organization_id))
                 ORDER BY ct.company_id IS NULL, ct.is_decision_maker DESC, ct.updated_at DESC LIMIT 1)'''


@bp.get('/companies/<id>/nearby-users')
def nearby_users(id):
    """この施設と同じ都道府県・市区町村（政令指定都市は市の単位）にある、ユーザーの施設（この施設自身は除く）。見える範囲だけ"""
    id = parse_id(id)
    me = load_visible_company(id)
    if not me['city']:
        return jsonify({'prefecture': me['prefecture'], 'city': None, 'total': 0, 'items': []})
    city = city_key(me['city'])
    vis_sql, vis_params = company_visibility(current_user())
    where = f'''c.is_active = 1 AND c.is_user = 1 AND c.id <> %s AND {CITY_KEY_SQL} = %s AND c.prefecture IS NOT DISTINCT FROM %s AND {vis_sql}'''
    params = [id, city, me['prefecture'], *vis_params]
    d = db()
    total = d.value(f'SELECT COUNT(*) FROM telema_companies c WHERE {where}', params)
    items = d.all(
        f'''SELECT c.id, c.company_name, c.city, o.name AS organization_name, c.address,
                   COALESCE({_contact_name('理事長')}, CASE WHEN o.representative_title LIKE '%%理事長%%' THEN o.representative_name END) AS chairman_name,
                   {_contact_name('園長')} AS principal_name
              FROM telema_companies c LEFT JOIN telema_organizations o ON o.id = c.organization_id
             WHERE {where} ORDER BY c.company_name_normalized, c.id LIMIT %s''', [*params, NEARBY_LIMIT])
    return jsonify({'prefecture': me['prefecture'], 'city': city, 'total': total, 'items': items})
