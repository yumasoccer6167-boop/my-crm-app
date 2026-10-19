"""機能をまたいで使う小さな部品（操作ログ・閲覧範囲・JSTの日付計算）。"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from .context import dumps
from .validate import iso_utc

JST = timezone(timedelta(hours=9))


# 契約情報の取得（営業担当の表示名つき）。会社詳細と契約APIで共有する
# 施設一覧に出す契約件数（有効な契約情報）。ユーザーなのに契約情報が未登録の施設を一覧で見分けるのに使う
CONTRACT_COUNT_COLUMN = '(SELECT COUNT(*) FROM telema_contracts k WHERE k.company_id = c.id AND k.is_active = 1) AS contract_count'

# 施設一覧に出す「協会会長がいる施設」の印（施設または法人の有効な担当者に、協会会長がいる）。一覧で王冠マークを出すのに使う
ASSOCIATION_CHAIR_COLUMN = (
    'EXISTS (SELECT 1 FROM telema_contacts kc WHERE kc.is_active = 1 AND kc.is_association_chair = 1 '
    'AND (kc.company_id = c.id OR (kc.company_id IS NULL AND kc.organization_id = c.organization_id))) AS has_association_chair'
)

# 同じく「協会役員がいる施設」の印。銀の王冠で出す
ASSOCIATION_OFFICER_COLUMN = (
    'EXISTS (SELECT 1 FROM telema_contacts ko WHERE ko.is_active = 1 AND ko.is_association_officer = 1 '
    'AND (ko.company_id = c.id OR (ko.company_id IS NULL AND ko.organization_id = c.organization_id))) AS has_association_officer'
)

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
# 訪問の内容（ユーザー訪問・初回訪問・営業）。訪問の記録ごとに1つ付ける（架電履歴の列 visit_purpose_id）
VISIT_PURPOSE = MasterKind(key='visit_purpose', slug='visit-purposes', label='訪問の内容', master='telema_visit_purposes')
MASTER_KINDS = (*TAG_KINDS, SECTION, VISIT_PURPOSE)


def audit(db, user_id, action, entity_type, entity_id, before=None, after=None):
    """操作ログ。本体の更新と同じトランザクションで書く"""
    db.run(
        'INSERT INTO telema_audit_logs (user_id, action, entity_type, entity_id, before_json, after_json) VALUES (%s, %s, %s, %s, %s, %s)',
        (user_id, action, entity_type, entity_id, None if before is None else dumps(before), None if after is None else dumps(after)),
    )


# リストを担当者に割り振ったときに自動で付けるステータス。アプリの設定・管理で登録したものを名前で探す（無いときは、ステータスは変えない）
LIST_ASSIGN_STATUS_LABEL = '未アプローチ'


def record_list_assign(d, user, company_id, before_user_id, target_user_id, set_status=True):
    """リストの担当者への割り振り（担当者が付いた・別の担当者に替わった）を記録する。タイムラインに「リスト割り振り」として出る。
    set_status なら、ステータスを「未アプローチ」にする。ただし、すでに進んでいる施設（ステータスが「未対応」の区分以外）は、そのままにする。
    担当者を外したとき（target が None）は何もしない"""
    if target_user_id is None or target_user_id == before_user_id:
        return
    status_id = d.value('SELECT id FROM telema_call_statuses WHERE label = %s', (LIST_ASSIGN_STATUS_LABEL,)) if set_status else None
    if status_id is not None and not d.value(
            "SELECT 1 FROM telema_companies c LEFT JOIN telema_call_statuses s ON s.id = c.status_id WHERE c.id = %s AND (c.status_id IS NULL OR s.category = 'not_started')", (company_id,)):
        status_id = None       # すでに進んでいる施設は、ステータスを変えない
    if status_id is not None:
        d.run('UPDATE telema_companies SET status_id = %s, updated_at = telema_now() WHERE id = %s', (status_id, company_id))
    audit(d, user['id'], 'list_assign', 'company', company_id, {'assigned_user_id': before_user_id}, {'assigned_user_id': target_user_id, 'status_id': status_id})


def company_visibility(user, alias='c'):
    """会社の閲覧（検索・詳細・一覧）の範囲。sales は「自分の担当」「未割当（共有プール）」に加えて、ユーザー（導入済み）の施設は誰の担当でも見られる。
    manager / admin は全件。見られても編集できるかは can_edit_company（ユーザーでも他の人の担当なら、sales は閲覧のみ）"""
    if user['role'] == 'sales':
        return f'({alias}.assigned_user_id = %s OR {alias}.assigned_user_id IS NULL OR {alias}.is_user = 1)', [user['id']]
    return '1 = 1', []


def company_workload(user, alias='c'):
    """自分が営業として動く範囲（今日やること・件数・訪問ルートの対象）。sales は「自分の担当」と「未割当」のみ。manager / admin は全件"""
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
