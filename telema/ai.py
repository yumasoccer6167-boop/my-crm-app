"""AI（架電メモの整理）。プロバイダーの選択・利用量の記録・月間予算の上限チェックをまとめる。

環境変数:
  GEMINI_API_KEY                  Gemini の APIキー（未設定ならAI機能は使えない。架電メモの保存はできる）
  TELEMA_AI_PROVIDER              gemini（既定）/ mock（ダミー。開発用）
  TELEMA_AI_MODEL                 既定 gemini-3.8-flash
  TELEMA_AI_MONTHLY_BUDGET_USD    月間のAI利用上限（USD）。既定 10、0 で無制限
  TELEMA_USD_JPY                  管理画面での円換算レート（概算表示用）。既定 150
  TELEMA_ALLOW_MOCK_AI            "1" のときキー未設定ならダミーAIで動かす（ローカル開発用）
"""
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

from .common import JST
from .context import ApiError, db
from .validate import iso_utc


def env(name, default=''):
    return os.environ.get(name, default)


# ---------- 料金 ----------
# USD / 100万トークン。公式料金表（2026-09-30 確認: https://ai.google.dev/gemini-api/docs/pricing）の
# 有料枠・プロンプト20万トークン以下の単価。料金改定時はここを更新する
PRICES = {
    'gemini-3.8-flash': (0.75, 3.75),
    'gemini-3.7-flash': (0.75, 3.75),
    'gemini-3.6-flash': (0.75, 3.75),
    'gemini-3.5-flash': (1.5, 9.0),
    'gemini-3.5-flash-lite': (0.3, 2.5),
    'gemini-3.1-flash-lite': (0.25, 1.5),
    'mock': (0, 0),
}
FALLBACK = (2.0, 12.0)  # 料金表にないモデルは高めの単価で見積もる（過小表示を避ける）


def estimate_cost_usd(model, input_tokens, output_tokens):
    p_in, p_out = PRICES.get(model, FALLBACK)
    return (input_tokens * p_in + output_tokens * p_out) / 1_000_000


# ---------- プロバイダー ----------
class AIProviderError(Exception):
    def __init__(self, message, retryable, usage=None):
        super().__init__(message)
        self.retryable = retryable
        self.usage = usage or (0, 0)


def _gemini_schema(s):
    """Gemini の responseSchema は型名を大文字で受け付ける（OpenAPI サブセット）"""
    out = {'type': s['type'].upper()}
    for k in ('description', 'enum', 'required'):
        if s.get(k):
            out[k] = s[k]
    if s.get('nullable'):
        out['nullable'] = True
    if s.get('properties'):
        out['properties'] = {k: _gemini_schema(v) for k, v in s['properties'].items()}
    if s.get('items'):
        out['items'] = _gemini_schema(s['items'])
    return out


class GeminiProvider:
    name = 'gemini'

    def __init__(self, api_key, model):
        self.api_key = api_key
        self.model = model

    def generate_json(self, system, prompt, schema, max_output_tokens=2048):
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{urllib.request.quote(self.model)}:generateContent'
        payload = json.dumps({
            'systemInstruction': {'parts': [{'text': system}]},
            'contents': [{'role': 'user', 'parts': [{'text': prompt}]}],
            'generationConfig': {
                'responseMimeType': 'application/json',
                'responseSchema': _gemini_schema(schema),
                'maxOutputTokens': max_output_tokens,
                'temperature': 0.2,
            },
        }).encode()
        req = urllib.request.Request(url, data=payload, method='POST',
                                     headers={'content-type': 'application/json', 'x-goog-api-key': self.api_key})
        status = 200
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                raw = res.read()
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read()
        except Exception:
            raise AIProviderError('AIサービスに接続できませんでした', True)
        try:
            body = json.loads(raw or b'{}')
        except ValueError:
            body = {}
        meta = body.get('usageMetadata') or {}
        # 思考トークンも出力として課金される
        usage = (meta.get('promptTokenCount') or 0, (meta.get('candidatesTokenCount') or 0) + (meta.get('thoughtsTokenCount') or 0))
        if status >= 400:
            if status == 429:
                msg = 'AIの利用上限に達しました。しばらく待ってから再実行してください'
            elif status in (400, 403):
                msg = f'AIの設定に問題があります（{(body.get("error") or {}).get("status") or status}）。管理者に連絡してください'
            else:
                msg = 'AIサービスで一時的なエラーが発生しました'
            raise AIProviderError(msg, status == 429 or status >= 500, usage)
        if (body.get('promptFeedback') or {}).get('blockReason'):
            raise AIProviderError('AIが内容を処理できませんでした（安全フィルタ）', False, usage)
        cand = (body.get('candidates') or [{}])[0]
        text = ''.join(p.get('text', '') for p in ((cand.get('content') or {}).get('parts') or []))
        try:
            return json.loads(text), usage, self.model
        except ValueError:
            reason = cand.get('finishReason')
            raise AIProviderError('AIの出力が長すぎて途中で切れました' if reason == 'MAX_TOKENS' else 'AIの応答を読み取れませんでした', True, usage)


class MockProvider:
    """APIキーなしで画面とデータの流れを確認するためのダミー（ローカル開発・テスト用）。本番では使わない"""
    name = 'mock'
    model = 'mock'

    def generate_json(self, system, prompt, schema, max_output_tokens=2048):
        # 施設のAIサマリー：架電履歴の件数と最新の1件を並べるだけ
        h = re.search(r'【架電履歴（古い順）】\n([\s\S]*)$', prompt)
        if h:
            lines = h.group(1).strip().split('\n')
            return {'summary': f'（ダミーAI）架電{len(lines)}件。最新：{lines[-1][2:80]}', 'next_action': '再架電'}, (0, 0), self.model
        m = re.search(r'【今回の架電メモ】\n([\s\S]*?)(\n【|$)', prompt)
        note = m.group(1).strip() if m else ''
        absent = bool(re.search(r'不在|いない|外出', note))
        person = re.search(r'([一-龠ぁ-んァ-ン]{1,4})(さん|様)', note)
        best = re.search(r'(\d{1,2})時以降', note)
        data = {
            'call_result': '担当者不在' if absent else '接触',
            'contact_person': person.group(1) if person else None,
            'contact_role': None,
            'interest_level': 'high' if re.search(r'興味|関心', note) else 'unknown',
            'pain_point': None,
            'current_service': None,
            'decision_maker': None,
            'decision_timing': None,
            'budget': None,
            'objection': '不要と言われた' if re.search(r'不要|結構|NG', note) else None,
            'best_time_to_call': best.group(0) if best else None,
            'next_action': '再架電' if absent else 'フォロー',
            'next_call_date': None,
            'suggested_status': '再コール' if absent else None,
            'summary': f'（ダミーAI）{note[:60]}',
        }
        return data, (0, 0), self.model


def create_provider():
    provider = env('TELEMA_AI_PROVIDER', 'gemini')
    if provider == 'mock':
        return MockProvider()
    if provider == 'gemini':
        if env('GEMINI_API_KEY'):
            return GeminiProvider(env('GEMINI_API_KEY'), env('TELEMA_AI_MODEL', 'gemini-3.8-flash'))
        return MockProvider() if env('TELEMA_ALLOW_MOCK_AI') == '1' else None
    return None


def month_start_utc(now=None):
    j = (now or datetime.now(timezone.utc)).astimezone(JST)
    return iso_utc(datetime(j.year, j.month, 1, tzinfo=JST))


class AIService:
    """機能側（架電メモ整理など）はこのクラスだけを使う"""

    def __init__(self, provider=None):
        self.provider = provider if provider is not None else create_provider()

    @property
    def available(self):
        return self.provider is not None

    def month_cost_usd(self):
        return db().value('SELECT COALESCE(SUM(cost_usd), 0) FROM telema_ai_usage_logs WHERE created_at >= %s', (month_start_utc(),)) or 0

    def generate_json(self, system, prompt, schema, ctx, max_output_tokens=2048):
        if not self.provider:
            raise ApiError(503, 'ai_error', 'AIが設定されていません（管理者がAPIキーを登録する必要があります）')
        budget = float(env('TELEMA_AI_MONTHLY_BUDGET_USD', '10') or 0)
        if budget > 0 and self.month_cost_usd() >= budget:
            raise ApiError(429, 'ai_error', '今月のAI利用予算の上限に達しました。管理者に連絡してください')
        started = time.time()
        try:
            data, usage, model = self.provider.generate_json(system, prompt, schema, max_output_tokens)
        except Exception as e:
            usage = e.usage if isinstance(e, AIProviderError) else (0, 0)
            self._log(ctx, usage, 'error', str(e), started)
            raise ApiError(502, 'ai_error', str(e))
        self._log(ctx, usage, 'ok', None, started)
        return data, model

    def _log(self, ctx, usage, status, error, started):
        p = self.provider
        d = db()
        d.run(
            '''INSERT INTO telema_ai_usage_logs (provider, model, feature, user_id, company_id, call_log_id, input_tokens, output_tokens, cost_usd, status, error, latency_ms)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)''',
            (p.name, p.model, ctx['feature'], ctx.get('user_id'), ctx.get('company_id'), ctx.get('call_log_id'),
             usage[0], usage[1], estimate_cost_usd(p.model, usage[0], usage[1]), status, error, int((time.time() - started) * 1000)),
        )
        # 失敗してエラー応答（rollback）になっても利用量の記録は残す
        d.commit()


# ---------- 架電メモの整理 ----------
def _str(description):
    return {'type': 'string', 'nullable': True, 'description': description}


def call_schema(status_labels):
    return {
        'type': 'object',
        'properties': {
            'call_result': _str('今回の架電の結果を短く（例: 担当者不在、受付接触、担当者と会話）'),
            'contact_person': _str('話した／判明した先方担当者の氏名。メモに無ければ null'),
            'contact_role': _str('その人の役職（園長、主任、事務長など）'),
            'interest_level': {'type': 'string', 'enum': ['high', 'mid', 'low', 'unknown'], 'description': '興味度。根拠が無ければ unknown'},
            'pain_point': _str('先方の課題'),
            'current_service': _str('現在利用しているサービス・業者'),
            'decision_maker': _str('決裁者に関する情報'),
            'decision_timing': _str('導入・検討時期'),
            'budget': _str('予算に関する情報'),
            'objection': _str('断り文句・懸念点'),
            'best_time_to_call': _str('つながりやすい時間帯（例: 15時以降、午前中）'),
            'next_action': _str('次にやるべきこと（営業担当者への提案）'),
            'next_call_date': _str('次回架電の推奨日時。ISO 8601、JST（+09:00）で。根拠が無ければ null'),
            'suggested_status': {'type': 'string', 'nullable': True, 'enum': status_labels, 'description': 'ステータス候補。自信が無ければ null'},
            'summary': {'type': 'string', 'description': '今回の架電の要約（1〜2文、です・ます調不要）'},
        },
        'required': ['call_result', 'interest_level', 'summary'],
    }


SYSTEM = '''あなたは保育施設・幼稚園向けテレマーケティングの記録係です。
営業担当者が電話の後に書いた自由記述のメモを、指定されたJSONに整理します。
- メモに書かれていないことは推測せず null にする（氏名・予算・時期などを作らない）
- 日付の相対表現（来週、明日、月末など）は、架電日時を基準に具体的な日時に直す
- 「15時以降ならつながりやすい」など時間の情報は best_time_to_call に入れ、次回日時の提案にも反映する
- 出力は日本語'''


def _jst(iso):
    d = datetime.fromisoformat(iso.replace('Z', '+00:00'))
    return d.astimezone(JST).strftime('%Y-%m-%d %H:%M')


def analyze_call(call_log_id, company_id, user_id, raw_note, called_at, company_name, history, status_labels):
    lines = '\n'.join(f'- {_jst(h["called_at"])}: {(h["summary"] or h["raw_note"])[:200]}' for h in history[:5])
    prompt = f'''【施設名】{company_name}
【架電日時（JST）】{_jst(called_at)}
【過去の架電（新しい順・参考）】
{lines or "なし"}
【今回の架電メモ】
{raw_note}'''
    return AIService().generate_json(
        SYSTEM, prompt, call_schema(status_labels),
        {'feature': 'call_analysis', 'user_id': user_id, 'company_id': company_id, 'call_log_id': call_log_id},
        max_output_tokens=1500,
    )


# ---------- 施設のAIサマリー ----------
SUMMARY_SCHEMA = {
    'type': 'object',
    'properties': {
        'summary': {'type': 'string', 'description': 'この施設の現在の状況の要約（3〜5文。経緯・先方の反応・決裁者や時期など分かっていること）'},
        'next_action': _str('営業担当者が次にやるべきこと（1文）。根拠が無ければ null'),
    },
    'required': ['summary'],
}

SUMMARY_SYSTEM = '''あなたは保育施設・幼稚園向けテレマーケティングの営業記録を読み、施設ごとの「現在の状況」をまとめる担当です。
- 架電履歴（古い順）と会社カルテの情報だけを根拠にする。書かれていないこと（氏名・予算・時期など）は作らない
- 最新の架電の内容を重視し、古い情報と食い違う場合は新しい方を採る
- 営業担当者が電話をかける前に10秒で読める長さにする
- 出力は日本語'''

# 要約に渡す架電は新しい方から最大この件数（古い順に並べ直して渡す）
SUMMARY_CALL_LIMIT = 30


def summarize_company(company_id, user_id, company_name, status, contacts, karte, calls):
    """施設全体のAIサマリー（架電履歴をまとめた現在の状況と、次にやること）"""
    karte_lines = '\n'.join(f'- {k}：{v}' for k, v in karte.items() if v)
    contact_lines = '\n'.join(f'- {c["name"]}' + (f'（{c["role"]}）' if c.get('role') else '') for c in contacts if c.get('name'))
    call_lines = '\n'.join(
        f'- {_jst(h["called_at"])}' + (f' {h["user_name"]}' if h.get('user_name') else '') + (f' [{h["result_label"]}]' if h.get('result_label') else '')
        + f'：{(h["raw_note"] or h["summary"] or "")[:300]}'
        for h in calls)
    prompt = f'''【施設名】{company_name}
【現在のステータス】{status or "未設定"}
【先方担当者】
{contact_lines or "なし"}
【会社カルテ】
{karte_lines or "なし"}
【架電履歴（古い順）】
{call_lines}'''
    return AIService().generate_json(
        SUMMARY_SYSTEM, prompt, SUMMARY_SCHEMA, {'feature': 'company_summary', 'user_id': user_id, 'company_id': company_id},
        max_output_tokens=1200,
    )
