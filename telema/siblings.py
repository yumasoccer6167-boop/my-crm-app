"""姉妹園（同じ法人の施設）を、既存のカルテどうしで連携させる／外す。
施設は法人（telema_organizations）に属し、同じ法人の施設どうしが姉妹園。取り込み時に法人名から自動でまとまるが、表記が違うなどでまとまっていない施設を、カルテから手動で連携できる。
連携は既存のカルテどうしを結ぶだけで、法人名の入力は要らない（どちらにも法人がなければ、名前のない法人としてまとめる。法人名は後から付けられる）。
連携しても施設（カルテ）は別々のまま残り、カルテ上部のボタンで切り替えられる。"""
from flask import jsonify

from .common import audit, can_edit_company
from .companies import load_visible_company
from .context import ApiError, body, current_user, db, forbidden
from .normalize import normalize_company_name
from .routes import bp
from .validate import Bool, Int, Str, parse, parse_id


def _members(d, org_id, exclude_id):
    return d.all(
        '''SELECT c.id, c.company_name, c.is_user, s.label AS status_label FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id
            WHERE c.organization_id = %s AND c.id <> %s AND c.is_active = 1 ORDER BY c.company_name LIMIT 50''', (org_id, exclude_id))


def _count(d, org_id):
    return d.value('SELECT COUNT(*) FROM telema_companies WHERE organization_id = %s AND is_active = 1', (org_id,))


def _set_org(d, user, company_id, before, after):
    d.run('UPDATE telema_companies SET organization_id = %s, updated_at = telema_now() WHERE id = %s', (after, company_id))
    audit(d, user['id'], 'update', 'company_organization', company_id, {'organization_id': before}, {'organization_id': after})


@bp.post('/companies/<id>/siblings')
def add_sibling(id):
    """この施設と相手の施設を、同じ法人にまとめる。相手がすでに別の法人に属しているときは force=true で、相手をこの施設の法人へ移す"""
    id = parse_id(id)
    b = parse({'company_id': Int(min=1), 'organization_name': Str(max=200, nullable=True, optional=True), 'force': Bool(optional=True)}, body())
    user, d = current_user(), db()
    me = load_visible_company(id)
    other = load_visible_company(b['company_id'])
    if me['id'] == other['id']:
        raise ApiError(400, 'validation_error', '同じ施設どうしはまとめられません')
    if not (can_edit_company(user, me['assigned_user_id']) and can_edit_company(user, other['assigned_user_id'])):
        raise forbidden()

    org_id = me['organization_id']
    if org_id is None:
        # 自分に法人がなければ、相手の法人に入る。どちらにも無ければ、入力された法人名で作る
        if other['organization_id'] is not None:
            _set_org(d, user, me['id'], None, other['organization_id'])
            return jsonify({'organization_id': other['organization_id'], 'siblings': _members(d, other['organization_id'], me['id'])})
        name = (b.get('organization_name') or '').strip()
        norm = normalize_company_name(name)
        found = d.first('SELECT id FROM telema_organizations WHERE name_normalized = %s LIMIT 1', (norm,)) if norm else None
        org_id = found['id'] if found else d.value('INSERT INTO telema_organizations (name, name_normalized) VALUES (%s, %s) RETURNING id', (name, norm))
        _set_org(d, user, me['id'], None, org_id)
    if other['organization_id'] == org_id:
        return jsonify({'organization_id': org_id, 'siblings': _members(d, org_id, me['id'])})
    if other['organization_id'] is not None and not b.get('force'):
        old = d.first('SELECT name FROM telema_organizations WHERE id = %s', (other['organization_id'],))
        raise ApiError(409, 'conflict', f'この施設は別の法人「{old["name"]}」（{_count(d, other["organization_id"])}施設）に属しています。この施設の法人へ移しますか？')
    _set_org(d, user, other['id'], other['organization_id'], org_id)
    return jsonify({'organization_id': org_id, 'siblings': _members(d, org_id, me['id'])})


@bp.post('/companies/<id>/leave-organization')
def leave_organization(id):
    """この施設を、いまの法人から外す（姉妹園のまとまりから抜ける。施設・カルテは残る）"""
    id = parse_id(id)
    user, d = current_user(), db()
    company = load_visible_company(id)
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    if company['organization_id'] is not None:
        _set_org(d, user, id, company['organization_id'], None)
    return jsonify({'ok': True})


@bp.post('/companies/<id>/organization-name')
def set_organization_name(id):
    """姉妹園としてまとまっている法人に、法人名を付ける・直す（名前のない法人に後から名前を付けられる）"""
    id = parse_id(id)
    b = parse({'name': Str(min=1, max=200)}, body())
    user, d = current_user(), db()
    company = load_visible_company(id)
    if not can_edit_company(user, company['assigned_user_id']):
        raise forbidden()
    org_id = company['organization_id']
    if org_id is None:
        raise ApiError(400, 'validation_error', '法人が連携されていません（先に姉妹園を連携してください）')
    before = d.first('SELECT name FROM telema_organizations WHERE id = %s', (org_id,))
    d.run('UPDATE telema_organizations SET name = %s, name_normalized = %s, updated_at = telema_now() WHERE id = %s', (b['name'], normalize_company_name(b['name']), org_id))
    audit(d, user['id'], 'update', 'organization', org_id, {'name': before['name']}, {'name': b['name']})
    return jsonify({'organization_id': org_id, 'name': b['name']})
