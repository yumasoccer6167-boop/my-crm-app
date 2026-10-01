from telema.normalize import (extract_domain, normalize_company_name, normalize_phone, normalize_postal_code,
                              split_prefecture_city)


def test_電話番号():
    assert normalize_phone('0280-22-1717') == '0280221717'
    assert normalize_phone('０４５－２３１－０２９０') == '0452310290'
    assert normalize_phone(452310290) == '0452310290'  # 数値セルで先頭0落ち
    assert normalize_phone('+81 90-1234-5678') == '09012345678'
    assert normalize_phone('内線のみ') is None


def test_郵便番号():
    assert normalize_postal_code('3060033.0') == '3060033'
    assert normalize_postal_code(600001) == '0600001'
    assert normalize_postal_code('〒232-0002') == '2320002'


def test_会社名から法人格を除いて比較():
    assert normalize_company_name('社会福祉法人せんだんの木会') == normalize_company_name('せんだんの木会')
    assert normalize_company_name('株式会社ＡＢＣ') == normalize_company_name('(株)abc')


def test_GoogleマップのURLは会社ドメインにしない():
    assert extract_domain('https://www.google.co.jp/maps/place/xxx') is None
    assert extract_domain('http://y-renge.com/') == 'y-renge.com'


def test_市区町村():
    assert split_prefecture_city('神奈川県横浜市南区三春台19') == ('神奈川県', '横浜市南区')
    assert split_prefecture_city('茨城県古河市中央町3-10-62') == ('茨城県', '古河市')
