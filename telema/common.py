"""機能をまたいで使う小さな部品（操作ログ・閲覧範囲・JSTの日付計算）。"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .context import dumps
from .validate import iso_utc

JST = timezone(timedelta(hours=9))


# 契約情報の取得（営業担当の表示名つき）。会社詳細と契約APIで共有する
CONTRACT_SELECT = '''SELECT ct.*, u.display_name AS assigned_user_name
  FROM telema_contracts ct LEFT JOIN users u ON u.id = ct.assigned_user_id'''


@dataclass(frozen=True)
class MasterKind:
    """設定画面で管理者が追加・名称変更・有効/無効を切り替えるマスタ（名前の一覧）。実際の処理は tags.py"""
    key: str      # 監査ログ・APIの項目名の元
    slug: str     # URL（/associations, /sections …）
    label: str    # 画面に出す名前（エラーメッセージ用）
    master: str   # マスタのテーブル


@dataclass(frozen=True)
class TagKind(MasterKind):
    """施設に複数付けられるラベルの種類（加盟協会・リスト種類）。API・一覧の列・絞り込みの名前はすべてここから決まる"""
    field: str    # 施設詳細・一覧の項目名（詳細は {id,name,is_active} の配列、一覧は名前の配列）
    link: str     # 施設との紐付けテーブル
    fk: str       # 紐付けテーブルのマスタ側の列

    @property
    def of_company(self):
        """施設に付いているラベル（マスタ順）。無効にしたものでも付いている間は返す"""
        return (f'SELECT m.id, m.name, m.is_active FROM {self.link} l JOIN {self.master} m ON m.id = l.{self.fk} '
                'WHERE l.company_id = %s ORDER BY m.sort_order, m.id')

    @property
    def names_column(self):
        """一覧の1行に載せるラベルの名前（マスタ順の配列）。施設一覧とダッシュボードで同じ列を返す"""
        return (f"COALESCE((SELECT json_agg(m.name ORDER BY m.sort_order, m.id) FROM {self.link} l JOIN {self.master} m ON m.id = l.{self.fk} "
                f"WHERE l.company_id = c.id), '[]'::json) AS {self.field}")


ASSOCIATION = TagKind(key='association', slug='associations', label='加盟協会', master='telema_associations',
                      field='associations', link='telema_company_associations', fk='association_id')
LIST_TYPE = TagKind(key='list_type', slug='list-types', label='リスト種類', master='telema_list_types',
                    field='list_types', link='telema_company_list_types', fk='list_type_id')
TAG_KINDS = (ASSOCIATION, LIST_TYPE)

# 部署（営業部・制作部・CS など）。タイムラインの記録ごとに1つ付ける（施設への紐付けではなく、架電履歴の列 section_id）
SECTION = MasterKind(key='section', slug='sections', label='部署', master='telema_sections')
MASTER_KINDS = (*TAG_KINDS, SECTION)


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
