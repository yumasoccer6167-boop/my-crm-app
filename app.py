import os
import json
from flask import Flask, request, jsonify, send_from_directory
import psycopg2

app = Flask(__name__, static_folder='dist', static_url_path='/')

DATABASE_URL = os.environ.get('DATABASE_URL')


def get_conn():
    # RenderのPostgreSQLはSSL接続が必要です
    return psycopg2.connect(DATABASE_URL, sslmode='require')


def init_db():
    """初回起動時にテーブルが無ければ作成する"""
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
    conn.commit()
    cur.close()
    conn.close()


@app.route('/api/data', methods=['GET'])
def get_data():
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


# アプリ起動時にテーブルを準備しておく
try:
    if DATABASE_URL:
        init_db()
except Exception as e:
    print('DB init error:', e)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)