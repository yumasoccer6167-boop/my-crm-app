"""機能をまたいで使う小さな部品（操作ログ・閲覧範囲・JSTの日付計算）。"""
from datetime import datetime, timedelta, timezone

from .context import dumps
from .validate import iso_utc

JST = timezone(timedelta(hours=9))


# 契約情報の取得（営業担当の表示名つき）。会社詳細と契約APIで共有する
CONTRACT_SELECT = '''SELECT ct.*, u.display_name AS assigned_user_name
  FROM telema_contracts ct LEFT JOIN users u ON u.id = ct.assigned_user_id'''


def audit(db, user_id, action, entity_type, entity_id, before=None, after=None):
    """操作ログ。本体の更新と同じトランザクションで書く"""
    db.run(
        'INSERT INTO telema_audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) VALUES (%s, %s, %s, %s, %s, %s)',
        (user_id, action, entity_type, entity_id, None if before is None else dumps(before), None if after is None else dumps(after)),
    )


def company_visibility(user, alias='c'):
    """会社の閲覧範囲。sales は「自分の担当」と「未割当（共有プール）」のみ。manager / admin は全件"""
    if user['role'] == 'sales':
        return f'({alias}.assigned_user_id = %s OR {alias}.assigned_user_id IS NULL)', [user['id']]
    return '1 = 1', []


def can_edit_company(user, assigned_user_id):
    return user['role'] != 'sales' or assigned_user_id is None or assigned_user_id == user['id']


def jst_day_range(days_ahead=0, now=None):
    """JSTの「今日」の開始・終了（UTCのISO文字列）。days_ahead で翌日以降にずらせる"""
    now = now or datetime.now(timezone.utc)
    j = now.astimezone(JST)
    start = datetime(j.year, j.month, j.day, tzinfo=JST) + timedelta(days=days_ahead)
    return iso_utc(start), iso_utc(start + timedelta(days=1))


def jst_month_range(month=None, now=None):
    """JSTの月（YYYY-MM、省略時は今月）の開始・終了（UTCのISO文字列）"""
    now = now or datetime.now(timezone.utc)
    m = month or now.astimezone(JST).strftime('%Y-%m')
    y, mo = int(m[:4]), int(m[5:7])
    start = datetime(y, mo, 1, tzinfo=JST)
    end = datetime(y + (mo == 12), mo % 12 + 1, 1, tzinfo=JST)
    return m, iso_utc(start), iso_utc(end)
