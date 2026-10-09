import os
import json
from flask import Flask, request, jsonify, send_from_directory
import psycopg2
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

app = Flask(__name__, static_folder='dist', static_url_path='/')

DATABASE_URL = os.environ.get('DATABASE_URL')

# 【重要】本番環境では必ずRenderの環境変数 SECRET_KEY を設定してください。
SECRET_KEY = os.environ.get('SECRET_KEY', 'please-change-this-secret-key')
serializer = URLSafeTimedSerializer(SECRET_KEY)
TOKEN_MAX_AGE = 60 * 60 * 24 * 30  # 30日間有効

# ---------- Googleカレンダー連携（サービスアカウント方式） ----------
GOOGLE_CALENDAR_ID = os.environ.get('GOOGLE_CALENDAR_ID')
GOOGLE_CALENDAR_CREDENTIALS_JSON = os.environ.get('GOOGLE_CALENDAR_CREDENTIALS_JSON')

# IDを持つ配列データ（レコード単位でマージするキー）。
# これらは「丸ごと上書き」ではなく、IDごとに追加・更新・削除を反映する。
ID_LIST_KEYS = [
    'customers', 'records', 'products', 'activityTypes', 'associationTypes',
    'dailyReportLogs', 'caseStudies', 'knowledgeArticles', 'knowledgeTags',
    'departments', 'industryTypes', 'successCases',
]
# 保持するバックアップ世代数
BACKUP_KEEP = 50


def get_calendar_service():
    if not GOOGLE_CALENDAR_ID or not GOOGLE_CALENDAR_CREDENTIALS_JSON:
        return None
    try:
        info = json.loads(GOOGLE_CALENDAR_CREDENTIALS_JSON)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=['https://www.googleapis.com/auth/calendar']
        )
        return build('calendar', 'v3', credentials=creds, cache_discovery=False)
    except Exception as e:
        print('Googleカレンダー認証エラー:', e)
        return None


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

    # 自動バックアップ（保存のたびに直前のデータを退避する履歴テーブル）
    cur.execute('''
        CREATE TABLE IF NOT EXISTS app_state_backups (
            id SERIAL PRIMARY KEY,
            data JSONB NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            note TEXT
        )
    ''')

    cur.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'general',
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    ''')
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS photo TEXT")
    cur.execute('SELECT COUNT(*) FROM users')
    if cur.fetchone()[0] == 0:
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
    cur.execute('SELECT id, username, display_name, role, department, photo FROM users WHERE id = %s', (data.get('uid'),))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return None
    return {'id': row[0], 'username': row[1], 'displayName': row[2], 'role': row[3], 'department': row[4], 'photo': row[5]}


def require_owner():
    user = get_current_user()
    if not user:
        return None, (jsonify({'error': 'unauthorized'}), 401)
    if user['role'] != 'owner':
        return None, (jsonify({'error': 'forbidden'}), 403)
    return user, None


def merge_id_list(base_list, incoming_list, deleted_ids):
    """IDを持つ配列を、IDごとにマージする。
    - incoming にあるIDは、その内容で追加・更新（送ってきた端末の変更を採用）
    - incoming に無いIDは、base（サーバー最新）の内容を残す（他人の変更を消さない）
    - deleted_ids にあるIDは結果から取り除く（削除を反映）
    """
    base_list = base_list if isinstance(base_list, list) else []
    incoming_list = incoming_list if isinstance(incoming_list, list) else []
    deleted = set(deleted_ids or [])

    merged = {}
    order = []
    for item in base_list:
        if not isinstance(item, dict) or 'id' not in item:
            continue
        merged[item['id']] = item
        order.append(item['id'])
    for item in incoming_list:
        if not isinstance(item, dict) or 'id' not in item:
            continue
        if item['id'] not in merged:
            order.append(item['id'])
        merged[item['id']] = item
    result = []
    for _id in order:
        if _id in deleted:
            continue
        result.append(merged[_id])
    return result


def merge_payload(base, incoming, deleted_map):
    base = base if isinstance(base, dict) else {}
    incoming = incoming if isinstance(incoming, dict) else {}
    deleted_map = deleted_map or {}

    result = dict(base)
    for key, value in incoming.items():
        if key in ID_LIST_KEYS:
            result[key] = merge_id_list(base.get(key), value, deleted_map.get(key))
        else:
            result[key] = value
    return result


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
    cur.execute('SELECT id, username, password_hash, display_name, role, department, photo FROM users WHERE username = %s', (username,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row or not check_password_hash(row[2], password):
        return jsonify({'error': 'ユーザー名またはパスワードが正しくありません'}), 401
    token = serializer.dumps({'uid': row[0]})
    return jsonify({'token': token, 'user': {'id': row[0], 'username': row[1], 'displayName': row[3], 'role': row[4], 'department': row[5], 'photo': row[6]}})


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


@app.route('/api/me/name', methods=['PUT'])
def change_own_name():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(force=True) or {}
    display_name = (body.get('displayName') or '').strip()
    if not display_name:
        return jsonify({'error': '表示名を入力してください'}), 400
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('UPDATE users SET display_name = %s WHERE id = %s', (display_name, user['id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


@app.route('/api/me/photo', methods=['PUT'])
def change_own_photo():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    body = request.get_json(force=True) or {}
    photo = body.get('photo', '')
    if photo and len(photo) > 900000:
        return jsonify({'error': '画像のサイズが大きすぎます。もっと小さい画像を選んでください。'}), 400
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('UPDATE users SET photo = %s WHERE id = %s', (photo or None, user['id']))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success'})


# ---------- メンバー一覧 ----------
@app.route('/api/members', methods=['GET'])
def list_members():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, display_name, role, department, photo FROM users ORDER BY id')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([
        {'id': r[0], 'displayName': r[1], 'role': r[2], 'department': r[3], 'photo': r[4]}
        for r in rows
    ])


# ---------- メンバー管理（オーナーのみ） ----------
@app.route('/api/users', methods=['GET'])
def list_users():
    user, err = require_owner()
    if err:
        return err
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, username, display_name, role, department, photo, created_at FROM users ORDER BY id')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([
        {'id': r[0], 'username': r[1], 'displayName': r[2], 'role': r[3], 'department': r[4], 'photo': r[5], 'createdAt': r[6].isoformat()}
        for r in rows
    ])


VALID_ROLES = ('owner', 'executive', 'emgr', 'mgr', 'smgr', 'general')


@app.route('/api/users', methods=['POST'])
def create_user():
    user, err = require_owner()
    if err:
        return err
    body = request.get_json(force=True) or {}
    username = (body.get('username') or '').strip()
    password = body.get('password') or ''
    display_name = (body.get('displayName') or username).strip()
    department = body.get('department') or None
    photo = body.get('photo') or None
    role = body.get('role') if body.get('role') in VALID_ROLES else 'general'
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
        'INSERT INTO users (username, password_hash, display_name, role, department, photo) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
        (username, generate_password_hash(password), display_name, role, department, photo)
    )
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'id': new_id, 'username': username, 'displayName': display_name, 'role': role, 'department': department})


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
    if 'role' in body and body['role'] in VALID_ROLES:
        cur.execute('UPDATE users SET role = %s WHERE id = %s', (body['role'], uid))
    if 'department' in body:
        cur.execute('UPDATE users SET department = %s WHERE id = %s', (body['department'] or None, uid))
    if 'photo' in body:
        photo = body.get('photo') or None
        if photo and len(photo) > 900000:
            cur.close(); conn.close()
            return jsonify({'error': '画像のサイズが大きすぎます。もっと小さい画像を選んでください。'}), 400
        cur.execute('UPDATE users SET photo = %s WHERE id = %s', (photo, uid))
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


# ---------- Googleカレンダー連携API ----------
@app.route('/api/calendar/status', methods=['GET'])
def calendar_status():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    return jsonify({'configured': get_calendar_service() is not None})


@app.route('/api/calendar/event', methods=['POST'])
def create_calendar_event():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    service = get_calendar_service()
    if not service:
        return jsonify({'error': 'not_configured'}), 400

    body = request.get_json(force=True) or {}
    date = body.get('date')
    time = body.get('time') or '09:00'
    title = body.get('title') or '予定'
    description = body.get('description') or ''
    if not date:
        return jsonify({'error': '日付が必要です'}), 400

    try:
        h, m = map(int, time.split(':'))
    except Exception:
        h, m = 9, 0
    start_dt = f'{date}T{h:02d}:{m:02d}:00'
    end_h = (h + 1) % 24
    end_dt = f'{date}T{end_h:02d}:{m:02d}:00'

    event = {
        'summary': title,
        'description': description,
        'start': {'dateTime': start_dt, 'timeZone': 'Asia/Tokyo'},
        'end': {'dateTime': end_dt, 'timeZone': 'Asia/Tokyo'},
    }
    try:
        created = service.events().insert(calendarId=GOOGLE_CALENDAR_ID, body=event).execute()
        return jsonify({'eventId': created.get('id'), 'htmlLink': created.get('htmlLink')})
    except HttpError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/calendar/event/<event_id>', methods=['DELETE'])
def delete_calendar_event(event_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'unauthorized'}), 401
    service = get_calendar_service()
    if not service:
        return jsonify({'error': 'not_configured'}), 400
    try:
        service.events().delete(calendarId=GOOGLE_CALENDAR_ID, eventId=event_id).execute()
        return jsonify({'status': 'success'})
    except HttpError as e:
        return jsonify({'error': str(e)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


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
        body = request.get_json(force=True) or {}
        # 新フロント: { data: {...}, deleted: { customers:[id...], ... } }
        # 旧フロント: データを直接送る形（後方互換）
        if isinstance(body, dict) and 'data' in body:
            incoming = body.get('data') or {}
            deleted_map = body.get('deleted') or {}
        else:
            incoming = body
            deleted_map = {}

        conn = get_conn()
        cur = conn.cursor()

        # 同時に保存されても、片方の変更が消えないよう行をロックして順番に処理する
        cur.execute('SELECT data FROM app_state WHERE id = 1 FOR UPDATE')
        row = cur.fetchone()
        current = row[0] if row and row[0] else {}

        # 直前のデータをバックアップ（履歴）に退避
        try:
            cur.execute(
                'INSERT INTO app_state_backups (data, note) VALUES (%s, %s)',
                (json.dumps(current), 'save by ' + str(user.get('displayName', '')))
            )
            cur.execute(
                'DELETE FROM app_state_backups WHERE id NOT IN '
                '(SELECT id FROM app_state_backups ORDER BY id DESC LIMIT %s)',
                (BACKUP_KEEP,)
            )
        except Exception as be:
            print('backup error:', be)

        merged = merge_payload(current, incoming, deleted_map)
        cur.execute(
            'UPDATE app_state SET data = %s, updated_at = NOW() WHERE id = 1',
            (json.dumps(merged),)
        )
        conn.commit()
        cur.close()
        conn.close()
        return jsonify({'status': 'success', 'data': merged})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------- バックアップ履歴（オーナーのみ） ----------
@app.route('/api/backups', methods=['GET'])
def list_backups():
    user, err = require_owner()
    if err:
        return err
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT id, created_at, note FROM app_state_backups ORDER BY id DESC LIMIT 50')
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return jsonify([
        {'id': r[0], 'createdAt': r[1].isoformat(), 'note': r[2]}
        for r in rows
    ])


@app.route('/api/backups/<int:backup_id>', methods=['GET'])
def get_backup(backup_id):
    user, err = require_owner()
    if err:
        return err
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT data FROM app_state_backups WHERE id = %s', (backup_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        return jsonify({'error': 'not_found'}), 404
    return jsonify(row[0])


@app.route('/api/backups/<int:backup_id>/restore', methods=['POST'])
def restore_backup(backup_id):
    user, err = require_owner()
    if err:
        return err
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('SELECT data FROM app_state_backups WHERE id = %s', (backup_id,))
    row = cur.fetchone()
    if not row:
        cur.close(); conn.close()
        return jsonify({'error': 'not_found'}), 404
    target = row[0]
    cur.execute('SELECT data FROM app_state WHERE id = 1')
    cur_row = cur.fetchone()
    if cur_row and cur_row[0]:
        cur.execute(
            'INSERT INTO app_state_backups (data, note) VALUES (%s, %s)',
            (json.dumps(cur_row[0]), 'before restore #' + str(backup_id))
        )
    cur.execute('UPDATE app_state SET data = %s, updated_at = NOW() WHERE id = 1', (json.dumps(target),))
    conn.commit()
    cur.close()
    conn.close()
    return jsonify({'status': 'success', 'data': target})


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

# ---------- 育てるテレマリスト（/api/telema/*、テーブルは telema_*） ----------
from telema import register_telema  # noqa: E402
register_telema(app, get_conn=get_conn, get_current_user=get_current_user, run_migrations=bool(DATABASE_URL))


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)