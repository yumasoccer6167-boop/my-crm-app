"""リクエスト単位の DB 接続・ログインユーザー・エラー。"""
import json
from decimal import Decimal

from flask import g, request
from psycopg2.extras import RealDictCursor

_get_conn = None
_get_current_user = None


def configure(get_conn, get_current_user):
    global _get_conn, _get_current_user
    _get_conn = get_conn
    _get_current_user = get_current_user


# ---------- エラー ----------
class ApiError(Exception):
    """利用者に見せるメッセージを持つAPIエラー。{error:{code,message}} で返す"""

    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def not_found(what='データ'):
    return ApiError(404, 'not_found', f'{what}が見つかりません')


def forbidden():
    return ApiError(403, 'forbidden', 'この操作を行う権限がありません')


# ---------- DB ----------
def _plain(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


class Db:
    """1リクエスト1接続・1トランザクション。レスポンス時に commit、例外時は rollback する"""

    def __init__(self, conn):
        self.conn = conn

    def _exec(self, sql, params):
        cur = self.conn.cursor(cursor_factory=RealDictCursor)
        cur.execute(sql, (params if isinstance(params, dict) else tuple(params)) if params else None)
        return cur

    def all(self, sql, params=()):
        cur = self._exec(sql, params)
        rows = [{k: _plain(v) for k, v in r.items()} for r in cur.fetchall()]
        cur.close()
        return rows

    def first(self, sql, params=()):
        cur = self._exec(sql, params)
        row = cur.fetchone()
        cur.close()
        return {k: _plain(v) for k, v in row.items()} if row else None

    def value(self, sql, params=()):
        row = self.first(sql, params)
        return next(iter(row.values())) if row else None

    def run(self, sql, params=()):
        cur = self._exec(sql, params)
        n = cur.rowcount
        cur.close()
        return n

    def commit(self):
        self.conn.commit()


def db() -> Db:
    if 'telema_db' not in g:
        g.telema_db = Db(_get_conn())
    return g.telema_db


def rollback_db():
    """エラー応答の前に、そのリクエストで未確定の書き込みを取り消す"""
    d = g.get('telema_db')
    if d is not None:
        d.conn.rollback()


def close_db(error=None):
    d = g.pop('telema_db', None)
    if d is None:
        return
    try:
        if error is None:
            d.conn.commit()
        else:
            d.conn.rollback()
    finally:
        d.conn.close()


# ---------- ユーザー ----------
# CRM本体のロール → テレマリストのロール（admin: 設定変更・全件 / manager: 全件 / sales: 自分の担当と未割当のみ）
ROLE_MAP = {
    'owner': 'admin',
    'executive': 'manager',
    'emgr': 'manager',
    'mgr': 'manager',
    'smgr': 'manager',
    'general': 'sales',
    'member': 'sales',
}


def telema_role(crm_role):
    return ROLE_MAP.get(crm_role or '', 'sales')


def current_user():
    """CRM本体のトークンでログイン中のユーザー。{id, name, email, role}"""
    if 'telema_user' in g:
        return g.telema_user
    u = _get_current_user()
    if not u:
        raise ApiError(401, 'unauthenticated', 'ログインが必要です')
    g.telema_user = {'id': u['id'], 'name': u.get('displayName') or u.get('username'), 'email': None, 'role': telema_role(u.get('role'))}
    return g.telema_user


def require_role(*roles):
    if current_user()['role'] not in roles:
        raise forbidden()


# ---------- 入出力 ----------
def body():
    data = request.get_json(silent=True)
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ApiError(400, 'validation_error', '入力内容に誤りがあります（入力: JSONオブジェクトで送ってください）')
    return data


def dumps(v):
    return json.dumps(v, ensure_ascii=False, default=str)
