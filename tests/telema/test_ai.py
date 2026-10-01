import io
import json
import urllib.error

import pytest
from flask import g

from telema import ai
from telema.context import ApiError

SCHEMA = {'type': 'object', 'properties': {'summary': {'type': 'string'}}, 'required': ['summary']}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def test_Geminiは構造化出力で呼び出し思考トークンも出力として数える(monkeypatch):
    sent = {}

    def fake_urlopen(req, timeout=None):
        sent['url'], sent['headers'], sent['body'] = req.full_url, dict(req.header_items()), json.loads(req.data)
        return FakeResponse(json.dumps({
            'candidates': [{'content': {'parts': [{'text': '{"summary":"担当者不在"}'}]}}],
            'usageMetadata': {'promptTokenCount': 1000, 'candidatesTokenCount': 200, 'thoughtsTokenCount': 300},
        }).encode())

    monkeypatch.setattr(ai.urllib.request, 'urlopen', fake_urlopen)
    data, usage, model = ai.GeminiProvider('KEY', 'gemini-3.8-flash').generate_json('s', 'p', SCHEMA)
    assert data['summary'] == '担当者不在'
    assert usage == (1000, 500)
    assert '/models/gemini-3.8-flash:generateContent' in sent['url']
    assert sent['headers']['X-goog-api-key'] == 'KEY'
    assert sent['body']['generationConfig']['responseMimeType'] == 'application/json'
    assert sent['body']['generationConfig']['responseSchema']['type'] == 'OBJECT'


def test_Geminiの429は再試行可能なエラー(monkeypatch):
    def fake_urlopen(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 429, 'Too Many', {}, io.BytesIO(b'{"error":{"status":"RESOURCE_EXHAUSTED"}}'))

    monkeypatch.setattr(ai.urllib.request, 'urlopen', fake_urlopen)
    with pytest.raises(ai.AIProviderError) as e:
        ai.GeminiProvider('KEY', 'gemini-3.8-flash').generate_json('s', 'p', SCHEMA)
    assert e.value.retryable and '利用上限' in str(e.value)


def test_料金の概算():
    assert ai.estimate_cost_usd('gemini-3.8-flash', 1_000_000, 1_000_000) == pytest.approx(4.5)
    assert ai.estimate_cost_usd('unknown-model', 1_000_000, 0) > 1


class FakeProvider:
    name = 'gemini'
    model = 'gemini-3.8-flash'

    def __init__(self, impl):
        self.impl = impl

    def generate_json(self, *a, **kw):
        return self.impl()


def test_AIServiceは成功も失敗も利用ログに残す(client):
    def fail():
        raise ai.AIProviderError('AIサービスで一時的なエラーが発生しました', True, (100, 0))

    with client.http.application.test_request_context():
        ai.AIService(FakeProvider(lambda: ({'summary': 'x'}, (2000, 1000), 'gemini-3.8-flash'))).generate_json('', '', SCHEMA, {'feature': 'call_analysis'})
        with pytest.raises(ApiError) as e:
            ai.AIService(FakeProvider(fail)).generate_json('', '', SCHEMA, {'feature': 'call_analysis'})
        assert e.value.code == 'ai_error'
        g.pop('telema_db').conn.close()
    logs = client.sql('SELECT status, input_tokens, cost_usd FROM telema_ai_usage_logs ORDER BY id')
    assert [(r['status'], r['input_tokens']) for r in logs] == [('ok', 2000), ('error', 100)]
    assert logs[0]['cost_usd'] == pytest.approx(0.00525)
    assert logs[1]['cost_usd'] == pytest.approx(0.000075)


def test_月間予算を超えたら呼び出さない(client):
    client.sql("INSERT INTO telema_ai_usage_logs (provider, model, feature, cost_usd, status) VALUES ('gemini', 'gemini-3.8-flash', 'call_analysis', 999, 'ok')")
    called = []

    def impl():
        called.append(1)
        raise AssertionError('should not be called')

    try:
        with client.http.application.test_request_context():
            with pytest.raises(ApiError) as e:
                ai.AIService(FakeProvider(impl)).generate_json('', '', SCHEMA, {'feature': 'call_analysis'})
            assert e.value.status == 429
            g.pop('telema_db').conn.close()
        assert called == []
    finally:
        client.sql('DELETE FROM telema_ai_usage_logs WHERE cost_usd = 999')


def test_保存済みの架電をダミーAIで整理でき結果は提案として履歴に保存される(client):
    co = client.api('/companies', {'company_name': 'AIテスト保育園'})[1]
    call = client.api(f'/companies/{co["id"]}/calls', {'raw_note': '担当者不在。15時以降ならつながりやすい。山田さんが担当'})[1]
    status, body = client.api(f'/calls/{call["id"]}/analyze', method='POST')
    assert status == 200
    assert {'call_result': '担当者不在', 'contact_person': '山田', 'best_time_to_call': '15時以降'}.items() <= body['extraction'].items()
    saved = client.api(f'/companies/{co["id"]}/calls')[1][0]
    assert saved['ai_status'] == 'done' and '15時以降' in saved['raw_note']
    # 会社のステータスは勝手に変わらない
    assert client.api(f'/companies/{co["id"]}')[1]['company']['status_id'] is None


def test_AIが失敗しても架電履歴は残りfailedになる(client, monkeypatch):
    co = client.api('/companies', {'company_name': 'AI失敗園'})[1]
    call = client.api(f'/companies/{co["id"]}/calls', {'raw_note': '受付で断られた'})[1]

    def boom(self, *a, **kw):
        raise ai.AIProviderError('AIサービスで一時的なエラーが発生しました', True)

    monkeypatch.setattr(ai.MockProvider, 'generate_json', boom)
    status, body = client.api(f'/calls/{call["id"]}/analyze', method='POST')
    assert status == 502 and body['error']['code'] == 'ai_error'
    saved = client.api(f'/companies/{co["id"]}/calls')[1][0]
    assert saved['ai_status'] == 'failed' and saved['raw_note'] == '受付で断られた'
    assert client.sql("SELECT status FROM telema_ai_usage_logs WHERE call_log_id = %s", (call['id'],)) == [{'status': 'error'}]


def test_利用料はadminだけが見られる(client):
    status, body = client.api('/admin/ai-usage')
    assert status == 200
    assert body['total']['calls'] >= 1
    assert body['by_day'][0]['day']
    client.set_my_role('manager')
    try:
        assert client.api('/admin/ai-usage')[0] == 403
    finally:
        client.set_my_role('admin')
