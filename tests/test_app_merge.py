"""CRM本体の保存（/api/data）のマージ。画面は「変わった分だけ」を送るので、送られなかったものはサーバーの最新を残す。"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.pop('DATABASE_URL', None)
app = pytest.importorskip('app')
merge_payload = app.merge_payload


def test_送られた要素だけ更新し_送られなかった要素と項目はサーバーの最新を残す():
    server = {'customers': [{'id': 1, 'assignedTo': '伊藤'}, {'id': 2, 'assignedTo': ''}], 'records': [{'id': 9, 'flag': '再コール'}], 'products': [{'id': 1, 'name': 'SP'}]}
    # 古い画面が、顧客2だけを編集して送った（顧客1の担当は知らない）
    merged = merge_payload(server, {'customers': [{'id': 2, 'assignedTo': '山田'}]}, {})
    assert merged['customers'] == [{'id': 1, 'assignedTo': '伊藤'}, {'id': 2, 'assignedTo': '山田'}]
    assert merged['records'] == server['records'] and merged['products'] == server['products']


def test_削除は削除したIDだけで_空の配列を送っても他の要素は残る():
    server = {'customers': [{'id': 1}, {'id': 2}, {'id': 3}]}
    merged = merge_payload(server, {'customers': []}, {'customers': [2]})
    assert [c['id'] for c in merged['customers']] == [1, 3]
    assert [c['id'] for c in merge_payload(server, {'customers': []}, {})['customers']] == [1, 2, 3]


def test_ID配列でない項目は送られたときだけ置き換える():
    server = {'reportTemplates': [{'id': 1, 'name': 'A'}], 'goals': {'x': 1}}
    merged = merge_payload(server, {'goals': {'x': 2}}, {})
    assert merged['goals'] == {'x': 2} and merged['reportTemplates'] == server['reportTemplates']


def test_事例管理の事例もIDごとにマージされる():
    server = {'successCases': [{'id': 1, 'headline': 'A'}, {'id': 2, 'headline': 'B'}]}
    merged = merge_payload(server, {'successCases': [{'id': 2, 'headline': 'B2'}, {'id': 3, 'headline': 'C'}]}, {})
    assert merged['successCases'] == [{'id': 1, 'headline': 'A'}, {'id': 2, 'headline': 'B2'}, {'id': 3, 'headline': 'C'}]
    assert [c['id'] for c in merge_payload(server, {'successCases': []}, {'successCases': [1]})['successCases']] == [2]
