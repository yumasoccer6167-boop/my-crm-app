"""マイルール（マイページの3ページ目）。自分で決めたルールを、フラグ・ルールの内容・期待できる成果の一覧で残す。自分の分だけ見られ、自分の分だけ直せる。
フラグは今は4つ（テレアポ・商談・稼働・営業マン像）。増やすときは RULE_FLAGS に足す（画面の選択肢・絞り込みはここから出る）。
 - GET  /my-rules                  … { flags, items }。フラグの並び順 → 登録の順
 - POST /my-rules                  … 追加
 - PATCH /my-rules/<id>            … 直す（送った項目だけ）
 - POST /my-rules/<id>/deactivate  … 削除（無効にして、画面から外す）"""
from flask import jsonify

from .common import audit
from .context import body, current_user, db, not_found
from .routes import bp
from .validate import Enum, Str, parse, parse_id

RULE_FLAGS = ['テレアポ', '商談', '稼働', '営業マン像']

RULE_BODY = {
    'flag': Enum(RULE_FLAGS),
    'rule': Str(min=1, max=2000, trim=True),
    'outcome': Str(max=2000, nullable=True, optional=True),
}
_COLS = 'id, flag, rule, outcome, created_at, updated_at'


def _own(d, user, rule_id):
    row = d.first(f'SELECT {_COLS} FROM telema_my_rules WHERE id = %s AND user_id = %s AND is_active = 1', (rule_id, user['id']))
    if not row:
        raise not_found('マイルール')
    return row


@bp.get('/my-rules')
def list_my_rules():
    user, d = current_user(), db()
    rows = d.all(f'SELECT {_COLS} FROM telema_my_rules WHERE user_id = %s AND is_active = 1', (user['id'],))
    order = {f: i for i, f in enumerate(RULE_FLAGS)}
    rows.sort(key=lambda r: (order.get(r['flag'], len(order)), r['id']))
    return jsonify({'flags': RULE_FLAGS, 'items': rows})


@bp.post('/my-rules')
def create_my_rule():
    user, d = current_user(), db()
    b = parse(RULE_BODY, body())
    outcome = (b.get('outcome') or '').strip() or None
    row = d.first(f'INSERT INTO telema_my_rules (user_id, flag, rule, outcome) VALUES (%s, %s, %s, %s) RETURNING {_COLS}', (user['id'], b['flag'], b['rule'], outcome))
    audit(d, user['id'], 'create', 'my_rule', row['id'], None, {'flag': b['flag'], 'rule': b['rule'], 'outcome': outcome})
    return jsonify(row), 201


@bp.patch('/my-rules/<id>')
def update_my_rule(id):
    user, d = current_user(), db()
    rule_id = parse_id(id)
    b = parse(RULE_BODY, body(), partial=True)
    before = _own(d, user, rule_id)
    if 'outcome' in b:
        b['outcome'] = (b['outcome'] or '').strip() or None
    changes = {k: v for k, v in b.items() if before[k] != v}
    if not changes:
        return jsonify(before)
    row = d.first(f'UPDATE telema_my_rules SET {", ".join(f"{k} = %s" for k in changes)}, updated_at = telema_now() WHERE id = %s RETURNING {_COLS}', (*changes.values(), rule_id))
    audit(d, user['id'], 'update', 'my_rule', rule_id, {k: before[k] for k in changes}, changes)
    return jsonify(row)


@bp.post('/my-rules/<id>/deactivate')
def deactivate_my_rule(id):
    user, d = current_user(), db()
    rule_id = parse_id(id)
    before = _own(d, user, rule_id)
    d.run('UPDATE telema_my_rules SET is_active = 0, updated_at = telema_now() WHERE id = %s', (rule_id,))
    audit(d, user['id'], 'deactivate', 'my_rule', rule_id, before)
    return jsonify({'ok': True})
