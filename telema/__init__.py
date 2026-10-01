"""育てるテレマリスト（架電するほど施設情報・担当者・営業履歴が蓄積される営業DB）。

CRM本体（app.py）とは別のテーブル（telema_*）を同じ PostgreSQL に持つ。
ログインとメンバーは CRM 本体の users テーブル・トークンをそのまま使う。

    from telema import register_telema
    register_telema(app, get_conn=get_conn, get_current_user=get_current_user)
"""
from flask import Flask

from . import context
from .routes import bp
from .schema import migrate


def register_telema(app: Flask, get_conn, get_current_user, run_migrations=True):
    context.configure(get_conn=get_conn, get_current_user=get_current_user)
    app.register_blueprint(bp)
    if run_migrations:
        try:
            migrate(get_conn)
        except Exception as e:  # CRM本体の起動は止めない
            print('telema migrate error:', e)
