"""重複判定・検索用の正規化（src/telema/shared/normalize.ts と同じ規則）。表示用の値は別に保持し、ここで作る値は比較専用。"""
import re
from urllib.parse import urlparse

PREFECTURES = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県',
    '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県',
    '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県',
    '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
]

_DASHES = '‐－―−ー–—'


def to_half_width(s: str) -> str:
    """全角英数記号→半角、全角スペース→半角、前後空白除去"""
    s = re.sub(r'[！-～]', lambda m: chr(ord(m.group(0)) - 0xFEE0), s)
    s = s.replace('　', ' ')
    s = re.sub(f'[{_DASHES}](?=\\d)|(?<=\\d)[{_DASHES}]', '-', s)
    return s.strip()


def normalize_phone(v):
    """数字のみ。国際表記 +81 は 0 始まりに戻す"""
    if v is None:
        return None
    d = re.sub(r'\D', '', to_half_width(str(v)))
    if d.startswith('81') and len(d) >= 11:
        d = '0' + d[2:]
    # Excelの数値セルで先頭0が落ちたケース（例: 452310290 → 0452310290）
    if len(d) == 9 or (len(d) == 10 and re.match(r'^[5789]0', d)):
        d = '0' + d
    return d if 10 <= len(d) <= 11 else None


def display_phone(v):
    """表示用：ハイフン区切りがあればそのまま、なければ数字を返す"""
    if v is None:
        return None
    s = re.sub(r'[^\d-]', '', to_half_width(str(v)))
    return s or None


def normalize_postal_code(v):
    """7桁文字列。数値セル（3060033.0）や先頭0落ち（600001 → 0600001）にも対応"""
    if v is None or v == '':
        return None
    s = re.sub(r'\.0+$', '', to_half_width(str(v)))
    s = re.sub(r'\D', '', s)
    if len(s) == 6:
        s = '0' + s
    return s if len(s) == 7 else None


CORP_TYPES = [
    '株式会社', '有限会社', '合同会社', '合資会社', '合名会社',
    '社会福祉法人', '学校法人', '医療法人社団', '医療法人財団', '医療法人',
    '一般社団法人', '一般財団法人', '公益社団法人', '公益財団法人',
    '特定非営利活動法人', 'NPO法人', '宗教法人', '社会医療法人',
    '(株)', '(有)', '(合)', '(社福)', '(学)', '(医)', '(一社)', '(一財)', '(特非)',
    '㈱', '㈲',
]


def normalize_company_name(v) -> str:
    """比較用の会社名：法人格・空白・記号を除去し、半角・大文字に揃える"""
    if v is None:
        return ''
    s = to_half_width(str(v)).replace('（', '(').replace('）', ')')
    for t in CORP_TYPES:
        s = s.replace(t, '')
    return re.sub(r"[\s・,.、。'\"`]", '', s).upper()


def normalize_address(v) -> str:
    """比較用の住所：〒・郵便番号・空白を除去、数字の漢数字化はしない（誤爆を避ける）"""
    if v is None:
        return ''
    s = to_half_width(str(v))
    s = re.sub(r'〒?\s*\d{3}-?\d{4}', '', s, count=1)
    s = re.sub(r'[\s,、]', '', s)
    s = re.sub(r'丁目|番地|番|号', '-', s)
    s = re.sub(r'-+', '-', s)
    s = re.sub(r'-$', '', s)
    return s.upper()


NON_COMPANY_DOMAINS = [
    'google.com', 'google.co.jp', 'goo.gl', 'maps.app.goo.gl',
    'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'line.me',
    'ameblo.jp', 'hatena.ne.jp', 'wixsite.com', 'jimdofree.com', 'fc2.com',
]


def extract_domain(v):
    """URLからドメイン（www.除去）。GoogleマップなどのURLは会社ドメインではないので除外"""
    if v is None or v == '':
        return None
    s = to_half_width(str(v)).strip()
    if not re.match(r'^https?://', s, re.I):
        s = 'http://' + s
    try:
        host = (urlparse(s).hostname or '').lower()
    except ValueError:
        return None
    host = re.sub(r'^www\.', '', host)
    if '.' not in host:
        return None
    if any(host == d or host.endswith('.' + d) for d in NON_COMPANY_DOMAINS):
        return None
    return host


def split_prefecture_city(address: str):
    """住所から都道府県・市区町村を取り出す（政令市の区まで含めて city とする）"""
    s = address.strip()
    prefecture = next((p for p in PREFECTURES if s.startswith(p)), None)
    rest = s[len(prefecture):] if prefecture else s
    m = re.match(r'^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])', rest)
    return prefecture, (m.group(1) if m else None)


def escape_like(s: str) -> str:
    """LIKE検索用のエスケープ（PostgreSQL の既定のエスケープ文字 \\ を使う）"""
    return re.sub(r'([\\%_])', r'\\\1', s)
