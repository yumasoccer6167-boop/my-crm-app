"""/api/telema/* のルーティングとエラー処理。"""
import traceback

from flask import Blueprint, jsonify

from .context import ApiError, close_db, current_user, rollback_db

bp = Blueprint('telema', __name__, url_prefix='/api/telema')


@bp.errorhandler(ApiError)
def _api_error(e: ApiError):
    rollback_db()
    return jsonify({'error': {'code': e.code, 'message': e.message}}), e.status


@bp.errorhandler(Exception)
def _internal_error(e):
    traceback.print_exc()
    try:
        rollback_db()
    except Exception:
        pass
    from psycopg2 import Error as PgError
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return jsonify({'error': {'code': 'internal_error', 'message': e.description}}), e.code
    message = ('データベースの処理でエラーが発生しました。時間をおいて再度お試しください'
               if isinstance(e, PgError) else 'サーバーでエラーが発生しました')
    return jsonify({'error': {'code': 'internal_error', 'message': message}}), 500


@bp.before_request
def _authenticate():
    from flask import request
    if request.endpoint != 'telema.health':
        current_user()


@bp.teardown_app_request
def _teardown(error=None):
    close_db(error)


@bp.after_request
def _no_cache(resp):
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@bp.get('/health')
def health():
    return jsonify({'ok': True})


# 各機能のルートを登録する（import 時に bp へ追加される）
from . import masters, dashboard, companies, calls, ai_routes, relations, assignees  # noqa: E402,F401


@bp.route('/<path:_rest>', methods=['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])
def _not_found(_rest):
    return jsonify({'error': {'code': 'not_found', 'message': 'APIが見つかりません'}}), 404
