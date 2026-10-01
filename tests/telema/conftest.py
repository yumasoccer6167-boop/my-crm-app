"""テレマリストのテスト用の土台。

pgserver（PostgreSQL 同梱の pip パッケージ）で一時的な DB を立て、テストファイルごとに新しいデータベースを作る。
CRM本体の app.py をそのまま読み込み、ログイン（/api/login）で得たトークンで /api/telema/* を呼ぶ。

    pip install -r requirements.txt -r requirements-dev.txt
    pytest tests/telema
"""
import itertools
import os
import sys
import tempfile

import psycopg2
import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, ROOT)
os.environ.pop('DATABASE_URL', None)  # app.py の import 時に本番用の接続（sslmode=require）で初期化させない
os.environ.setdefault('TELEMA_ALLOW_MOCK_AI', '1')
os.environ.pop('GEMINI_API_KEY', None)

import app as crm  # noqa: E402
from telema import context, schema  # noqa: E402

_seq = itertools.count(1)
CRM_ROLE = {'admin': 'owner', 'manager': 'mgr', 'sales': 'general'}


@pytest.fixture(scope='session')
def pg():
    import pgserver
    srv = pgserver.get_server(tempfile.mkdtemp(prefix='telema-pg-'), cleanup_mode='stop')
    yield srv
    srv.cleanup()


class Client:
    def __init__(self, http, token, connect, uri):
        self.http = http
        self.token = token
        self.connect = connect
        self.uri = uri

    def api(self, path, body=None, method=None):
        method = method or ('POST' if body is not None else 'GET')
        r = self.http.open(f'/api/telema{path}', method=method, json=body, headers={'Authorization': f'Bearer {self.token}'})
        return r.status_code, r.get_json()

    def sql(self, query, params=()):
        """テスト用に DB を直接読み書きする（RETURNING / SELECT の結果を dict のリストで返す）"""
        conn = self.connect()
        try:
            cur = conn.cursor()
            cur.execute(query, params or None)
            rows = []
            if cur.description:
                cols = [c[0] for c in cur.description]
                rows = [dict(zip(cols, r)) for r in cur.fetchall()]
            conn.commit()
            return rows
        finally:
            conn.close()

    def set_my_role(self, role):
        self.sql("UPDATE users SET role = %s WHERE username = 'owner'", (CRM_ROLE[role],))

    def add_user(self, name, role='sales'):
        return self.sql(
            "INSERT INTO users (username, password_hash, display_name, role) VALUES (%s, 'x', %s, %s) RETURNING id",
            (f'u{next(_seq)}', name, CRM_ROLE[role]))[0]['id']

    def status_id(self, label):
        return self.sql('SELECT id FROM telema_call_statuses WHERE label = %s', (label,))[0]['id']


@pytest.fixture(scope='module')
def client(pg):
    name = f'telema_test_{next(_seq)}'
    pg.psql(f'CREATE DATABASE {name};')
    uri = pg.get_uri(name)

    def connect():
        return psycopg2.connect(uri)

    crm.get_conn = connect  # CRM本体のログイン・ユーザー取得も同じ DB を使う
    context.configure(get_conn=connect, get_current_user=crm.get_current_user)
    crm.init_db()
    schema.migrate(connect)
    http = crm.app.test_client()
    r = http.post('/api/login', json={'username': 'owner', 'password': 'owner1234'})
    assert r.status_code == 200, r.get_json()
    yield Client(http, r.get_json()['token'], connect, uri)
