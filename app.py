import os
import json
from flask import Flask, request, jsonify, send_from_directory
import psycopg2
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

app = Flask(__name__, static_folder='dist', static_url_path='/')

DATABASE_URL = os.environ.get('DATABASE_URL')

# 【重要】本番環境では必ずRenderの環境変数 SECRET_KEY を設定してください。
# 設定しない場合、サーバー再起動のたびにログインし直しが必要になります。
SECRET_KEY = os.environ.get('SECRET_KEY', 'please-change-this-secret-key')
serializer = URLSafeTimedSerializer(SECRET_KEY)
TOKEN_MAX_AGE = 60 * 60 * 24 * 30  # 30日間有効


def get_conn():
    return psycopg2.connect(DATABASE_URL, sslmode='require')


def init_db():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('''
        CREATE TABLE IF NOT EXISTS app_state (
            id INTEGER PRIMARY KEY,
            data JSONB NOT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    ''')
    cur.execute('SELECT 1 FROM app_state WHERE id = 1')
    if cur.fetchone() is None:
        cur.execute('INSERT INTO app_state (id, data) VALUES (1, %s)', (json.dumps({}),))

    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    ''')
    cur.execute('SELECT COUNT(*) FROM users')
    if cur.fetchone()[0] == 0:
        # 初回起動時に、最初のオーナーアカウントを自動作成します。
        # ログイン後、必ずパスワードを変更してください。
        cur.execute(
            'INSERT INTO users (username, password_hash, display_name, role) VALUES (%s, %s, %s, %s)',
            ('owner', generate_password_hash('owner1234'), 'オーナー', 'owner')
        )
    conn.commit()
    cur.close()
    conn.close()


def get_current_user():
    auth = request.headers.get('Authorization', '')
    if not auth.startswith('Bearer '):
        return None
    token = auth[7:]
    try:
        data = serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, username, display_name, role FROM users WHERE id = %s', (data.get('uid'),))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return None
    return {'id': row[0], 'username': row[1], 'displayName': row[2], 'role': row[3]}


def require_owner():
    user = get_current_user()
    if not user:
        return None, (jsonify({'error': 'unauthorized'}), 401)
    if user['role'] != 'owner':
        return None, (jsonify({'error': 'forbidden'}), 403)
    return user, None


# ---------- 認証 ----------
@app.route('/api/login', methods=['POST'])
def login():
    body = request.get_json(force=True) or {}
    username = (body.get('username') or '').strip()
    password = body.get('password') or ''
    if not username or not password:
        return jsonify({'error': 'ユーザー名とパスワードを入力してください'}), 400
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, username, password_hash, display_name, role FROM users WHERE username = %s', (username,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row or not check_password_hash(row[2], password):
        return jsonify({'error': 'ユーザー名またはパスワードが正しくありません'}), 401
    token = serializer.dumps({'uid': row[0]})
    return jsonify({'token': token, 'user': {'id': row[0], 'username': row[1], 'displayName': row[3], 'role': row[4]}})


@app.route('/api/me', methods=['GET'])
def me():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    return jsonify(user)


@app.route('/api/me/password', methods=['PUT'])
def change_own_password():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(force=True) or {}
    new_password = body.get('password') or ''
    if len(new_password) < 4:
        return jsonify({'error': 'パスワードは4文字以上にしてください'}), 400
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('UPDATE users SET password_hash = %s WHERE id = %s', (generate_password_hash(new_password), user['id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


# ---------- メンバー一覧（担当者選択用・ログインしていれば誰でも取得可） ----------
@app.route('/api/members', methods=['GET'])
def list_members():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, display_name, role FROM users ORDER BY id')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([{'id': r[0], 'displayName': r[1], 'role': r[2]} for r in rows])


# ---------- メンバー管理（オーナーのみ） ----------
@app.route('/api/users', methods=['GET'])
def list_users():
    user, err = require_owner()
    if err:
        return err
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, username, display_name, role, created_at FROM users ORDER BY id')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([
        {'id': r[0], 'username': r[1], 'displayName': r[2], 'role': r[3], 'createdAt': r[4].isoformat()}
        for r in rows
    ])


@app.route('/api/users', methods=['POST'])
def create_user():
    user, err = require_owner()
    if err:
        return err
    body = request.get_json(force=True) or {}
    username = (body.get('username') or '').strip()
    password = body.get('password') or ''
    display_name = (body.get('displayName') or username).strip()
    role = body.get('role') if body.get('role') in ('owner', 'member') else 'member'
    if not username or not password:
        return jsonify({'error': 'ユーザー名とパスワードは必須です'}), 400
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT 1 FROM users WHERE username = %s', (username,))
    if cur.fetchone():
        cur.close()
        conn.close()
        return jsonify({'error': 'そのユーザー名はすでに使われています'}), 400
    cur.execute(
        'INSERT INTO users (username, password_hash, display_name, role) VALUES (%s, %s, %s, %s) RETURNING id',
        (username, generate_password_hash(password), display_name, role)
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'id': new_id, 'username': username, 'displayName': display_name, 'role': role})


@app.route('/api/users/<int:uid>', methods=['PUT'])
def update_user(uid):
    user, err = require_owner()
    if err:
        return err
    body = request.get_json(force=True) or {}
    conn = get_conn()
    cur = conn.cursor()
    if body.get('password'):
        cur.execute('UPDATE users SET password_hash = %s WHERE id = %s', (generate_password_hash(body['password']), uid))
    if 'displayName' in body:
        cur.execute('UPDATE users SET display_name = %s WHERE id = %s', (body['displayName'], uid))
    if 'role' in body and body['role'] in ('owner', 'member'):
        cur.execute('UPDATE users SET role = %s WHERE id = %s', (body['role'], uid))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


@app.route('/api/users/<int:uid>', methods=['DELETE'])
def delete_user(uid):
    user, err = require_owner()
    if err:
        return err
    if user['id'] == uid:
        return jsonify({'error': '自分自身のアカウントは削除できません'}), 400
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM users WHERE id = %s', (uid,))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


# ---------- アプリデータ（ログイン必須） ----------
@app.route('/api/data', methods=['GET'])
def get_data():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute('SELECT data FROM app_state WHERE id = 1')
        row = cur.fetchone()
        cur.close()
        conn.close()
        return jsonify(row[0] if row else {})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/data', methods=['POST'])
def save_data():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    try:
        payload = request.get_json(force=True)
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            'UPDATE app_state SET data = %s, updated_at = NOW() WHERE id = 1',
            (json.dumps(payload),)
        )
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != '' and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')


try:
    if DATABASE_URL:
        init_db()
except Exception as e:
    print('DB init error:', e)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)