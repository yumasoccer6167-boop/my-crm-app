import os
import json
from flask import Flask, request, jsonify, send_from_directory
import gspread
from oauth2client.service_account import ServiceAccountCredentials

# サーバーとReact画面を繋ぐ設定
app = Flask(__name__, static_folder='dist', static_url_path='/')

# スプレッドシートにアクセスするための設定
scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']

def get_gspread_client():
    creds_json = os.environ.get('GOOGLE_CREDENTIALS_JSON')
    if not creds_json:
        return None
    try:
        creds_dict = json.loads(creds_json)
        creds = ServiceAccountCredentials.from_json_keyfile_dict(creds_dict, scope)
        return gspread.authorize(creds)
    except Exception as e:
        print("認証エラー:", e)
        return None

SHEET_ID = os.environ.get('SPREADSHEET_ID')

@app.route('/api/sync', methods=['GET', 'POST'])
def sync_data():
    client = get_gspread_client()
    if not client or not SHEET_ID:
        return jsonify({'error': 'サーバーの認証設定がされていません'}), 500

    try:
        sheet = client.open_by_key(SHEET_ID)
    except Exception as e:
        return jsonify({'error': f'スプレッドシートを開けません: {str(e)}'}), 500

    if request.method == 'GET':
        try:
            try:
                ws_customers = sheet.worksheet("顧客リスト")
            except gspread.exceptions.WorksheetNotFound:
                ws_customers = sheet.add_worksheet(title="顧客リスト", rows="1000", cols="20")
            
            try:
                ws_records = sheet.worksheet("活動履歴")
            except gspread.exceptions.WorksheetNotFound:
                ws_records = sheet.add_worksheet(title="活動履歴", rows="1000", cols="20")

            customers = ws_customers.get_all_records()
            records = ws_records.get_all_records()
            
            return jsonify({'customers': customers, 'records': records})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    if request.method == 'POST':
        data = request.json
        try:
            if 'customers' in data and len(data['customers']) > 0:
                ws_customers = sheet.worksheet("顧客リスト")
                ws_customers.clear()
                keys = list(data['customers'][0].keys())
                ws_customers.append_row(keys)
                values = [[str(c.get(k, '')) for k in keys] for c in data['customers']]
                ws_customers.append_rows(values)

            if 'records' in data and len(data['records']) > 0:
                ws_records = sheet.worksheet("活動履歴")
                ws_records.clear()
                r_keys = list(data['records'][0].keys())
                ws_records.append_row(r_keys)
                r_values = [[str(r.get(k, '')) for k in r_keys] for r in data['records']]
                ws_records.append_rows(r_values)

            return jsonify({'status': 'success'})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)