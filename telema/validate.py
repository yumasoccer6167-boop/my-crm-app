"""入力検証。失敗時は項目名付きの日本語メッセージで 400 を返す（元実装の zod 相当）。"""
import re
from datetime import datetime, timezone

from .context import ApiError

_MISSING = object()


class Invalid(Exception):
    pass


class Field:
    def __init__(self, nullable=False, optional=False, default=_MISSING):
        self.nullable = nullable
        self.optional = optional
        self.default = default

    def parse(self, v):
        if v is None:
            if self.nullable:
                return None
            raise Invalid('値が必要です')
        return self.check(v)

    def check(self, v):
        return v


class Str(Field):
    def __init__(self, max=None, min=0, pattern=None, pattern_msg=None, trim=True, **kw):
        super().__init__(**kw)
        self.max, self.min, self.pattern, self.pattern_msg, self.trim = max, min, pattern, pattern_msg, trim

    def check(self, v):
        if not isinstance(v, str):
            raise Invalid('文字列で入力してください')
        if self.trim:
            v = v.strip()
        if len(v) < self.min:
            raise Invalid('入力してください' if self.min == 1 else f'{self.min}文字以上で入力してください')
        if self.max is not None and len(v) > self.max:
            raise Invalid(f'{self.max}文字以内で入力してください')
        if self.pattern and not re.fullmatch(self.pattern, v):
            raise Invalid(self.pattern_msg or '形式が正しくありません')
        return v


class Email(Str):
    def __init__(self, max=200, **kw):
        super().__init__(max=max, pattern=r'[^@\s]+@[^@\s]+\.[^@\s]+', pattern_msg='メールアドレスの形式が正しくありません', **kw)


class Num(Field):
    def __init__(self, min=None, max=None, integer=False, coerce=False, **kw):
        super().__init__(**kw)
        self.min, self.max, self.integer, self.coerce = min, max, integer, coerce

    def check(self, v):
        if self.coerce and isinstance(v, str):
            try:
                v = float(v) if v.strip() != '' else None
            except ValueError:
                raise Invalid('数値で入力してください')
            if v is None:
                raise Invalid('数値で入力してください')
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise Invalid('数値で入力してください')
        if self.integer:
            if float(v) != int(v):
                raise Invalid('整数で入力してください')
            v = int(v)
        if self.min is not None and v < self.min:
            raise Invalid(f'{self.min}以上で入力してください')
        if self.max is not None and v > self.max:
            raise Invalid(f'{self.max}以下で入力してください')
        return v


def Int(**kw):
    return Num(integer=True, **kw)


class Bool(Field):
    def check(self, v):
        if not isinstance(v, bool):
            raise Invalid('真偽値で入力してください')
        return v


class Enum(Field):
    def __init__(self, values, **kw):
        super().__init__(**kw)
        self.values = list(values)

    def check(self, v):
        if v not in self.values:
            raise Invalid('選択肢にない値です')
        return v


class IsoDatetime(Field):
    """タイムゾーン付きの ISO 8601。UTC の ISO 文字列（…Z）に揃えて返す"""

    def check(self, v):
        if not isinstance(v, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})', v):
            raise Invalid('日時の形式が正しくありません')
        try:
            d = datetime.fromisoformat(v.replace('Z', '+00:00'))
        except ValueError:
            raise Invalid('日時の形式が正しくありません')
        return iso_utc(d)


class IsoDate(Field):
    """暦の日付（YYYY-MM-DD）。契約日のようにタイムゾーンを持たない日付に使う"""

    def check(self, v):
        if not isinstance(v, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', v):
            raise Invalid('日付の形式が正しくありません（YYYY-MM-DD）')
        try:
            datetime.strptime(v, '%Y-%m-%d')
        except ValueError:
            raise Invalid('存在しない日付です')
        return v


class IntList(Field):
    def __init__(self, min_len=0, max_len=None, positive=True, **kw):
        super().__init__(**kw)
        self.min_len, self.max_len, self.positive = min_len, max_len, positive

    def check(self, v):
        if not isinstance(v, list):
            raise Invalid('配列で入力してください')
        if len(v) < self.min_len:
            raise Invalid(f'{self.min_len}件以上指定してください')
        if self.max_len is not None and len(v) > self.max_len:
            raise Invalid(f'{self.max_len}件以内で指定してください')
        for x in v:
            if isinstance(x, bool) or not isinstance(x, int) or (self.positive and x <= 0):
                raise Invalid('正の整数で指定してください')
        return v


def iso_utc(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.') + f'{d.astimezone(timezone.utc).microsecond // 1000:03d}Z'


def now_iso() -> str:
    return iso_utc(datetime.now(timezone.utc))


def parse(schema: dict, data: dict, partial=False):
    """schema の項目だけを検証して返す。partial=True なら全項目省略可（送られた項目だけ返す）"""
    if not isinstance(data, dict):
        data = {}
    out, errors = {}, []
    for key, f in schema.items():
        v = data.get(key, _MISSING)
        if v is _MISSING:
            if f.default is not _MISSING:
                out[key] = f.default
            elif not (partial or f.optional):
                errors.append(f'{key}: 値が必要です')
            continue
        try:
            out[key] = f.parse(v)
        except Invalid as e:
            errors.append(f'{key}: {e}')
    if errors:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（{" / ".join(errors[:3])}）')
    return out


def parse_id(v, what='ID'):
    try:
        i = int(v)
    except (TypeError, ValueError):
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（id: {what}が正しくありません）')
    if i <= 0:
        raise ApiError(400, 'validation_error', f'入力内容に誤りがあります（id: {what}が正しくありません）')
    return i
