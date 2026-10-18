"""表記の正規化（Wikipedia の wikitext → data-src/events の1行形式）。

選手名・大会名の表記ゆれ辞書は tools/build_fights.py のものをそのまま再利用する。
"""
import os
import re
import sys
import unicodedata
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_fights as bf  # noqa: E402  （ALIASES / norm_name / norm_event / slug / method_cat を再利用）

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


# ---------- wikitext の掃除 ----------
def strip_wiki(s):
    """リンク・太字・脚注・テンプレート・HTMLを外して素の文字列にする"""
    s = s or ""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>/]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"\{\{efn\|.*?\}\}", "", s, flags=re.S | re.I)
    s = re.sub(r"\{\{(?:nowrap|small)\|(.*?)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{flagicon\|[^}]*\}\}", "", s, flags=re.I)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)                     # 残りのテンプレート
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)   # [[記事|表示]] → 表示
    s = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", s)      # [URL 表示] → 表示
    s = re.sub(r"'{2,}", "", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("&nbsp;", " ").replace("&ndash;", "–").replace("&amp;", "&")
    return re.sub(r"\s+", " ", s).strip()


def flag_of(s):
    m = re.search(r"\{\{flagicon\|([A-Za-z]{2,3})", s or "", re.I)
    return m.group(1).upper() if m else ""


# ---------- 各項目 ----------
def fighter(cell):
    """'{{flagicon|JPN}} [[Naoki Inoue]] (c)' → ('Naoki Inoue', 'JPN')。表記ゆれ辞書で正式名に寄せる"""
    cc = flag_of(cell)
    name = strip_wiki(cell)
    name = re.sub(r"\s*\((?:c|ic|C)\)\s*$", "", name).strip()
    name = unicodedata.normalize("NFC", name)
    name, _ = bf.norm_name(name)
    return name, cc


def weight_class(cell):
    """'Women's Strawweight 52&nbsp;kg' → 'Female Strawweight 52 kg'（既存ファイルの書き方に合わせる）"""
    w = strip_wiki(cell)
    w = re.sub(r"^Women'?s\s+", "Female ", w, flags=re.I)
    w = re.sub(r"\s+", " ", w).strip()
    return w


def method(cell):
    """判定のスコア '(29–28, 29–28, 29–28)' を外す"""
    m = strip_wiki(cell)
    m = re.sub(r"\s*\((?:\d+\s*[–-]\s*\d+(?:,\s*)?)+\)", "", m)
    return m.strip()


def round_(cell):
    r = strip_wiki(cell)
    return r if re.fullmatch(r"\d{1,2}", r) else ""


def time_(cell):
    t = strip_wiki(cell)
    return t if re.fullmatch(r"\d{1,2}:\d{2}", t) else ""


def note(cell):
    return strip_wiki(cell).replace("|", "/")


def result_of(word, meth):
    """'def.' / 'vs.' と決着方法から W / D / NC / ''(未実施) を決める"""
    w = strip_wiki(word).lower().rstrip(".")
    ml = (meth or "").lower()
    if w in ("def", "defeated"):
        return "W"
    if ml.startswith("draw") or w in ("drew", "draw"):
        return "D"
    if ml.startswith("no contest") or ml.startswith("nc") or w == "nc":
        return "NC"
    return ""   # vs. で結果なし＝未実施（予定カード）


def parse_date(s):
    """{{dts|2026|10|03}} / {{dts|2026|Oct|3}} / 'October 3, 2026' → '2026-10-03'"""
    s = s or ""
    m = re.search(r"\{\{\s*dts\s*\|\s*(\d{4})\s*\|\s*([A-Za-z]+|\d{1,2})\s*\|\s*(\d{1,2})", s, re.I)
    if m:
        y, mo, d = m.groups()
        mo = int(mo) if mo.isdigit() else MONTHS.get(mo[:3].lower(), 0)
        return _iso(int(y), mo, int(d))
    m = re.search(r"([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})", s)
    if m:
        return _iso(int(m.group(3)), MONTHS.get(m.group(1)[:3].lower(), 0), int(m.group(2)))
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return _iso(*map(int, m.groups()))
    return ""


def _iso(y, mo, d):
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return ""


def event_name(heading):
    """見出し 'Rizin Landmark 16 in Nagasaki' / 'Super Rizin 5: Naniwa…' → 既存ファイルでの呼び名"""
    e = strip_wiki(heading)
    e = bf.norm_event(e)
    m = re.match(r"^((?:Super Rizin|Rizin Landmark|Rizin) \d+)\s*[:：].*$", e)
    if m:
        e = m.group(1)
    e = re.sub(r"^((?:Super Rizin|Rizin Landmark|Rizin) \d+)\s+in\s+.+$", r"\1", e)
    return e


def event_key(name):
    """大会名の照合用キー（大文字小文字・記号の違いを無視）"""
    return re.sub(r"[^a-z0-9]+", "", event_name(name).lower())


def name_key(n):
    """選手名の照合用キー（アクセント・記号・語順の違いを吸収）"""
    s = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode().lower()
    parts = sorted(re.findall(r"[a-z0-9]+", s))
    return " ".join(parts)


NON_MMA = [(re.compile(r"kick ?boxing|open-?finger|shoot ?boxing", re.I), "KICK"),
           (re.compile(r"\bboxing\b", re.I), "BOX"),
           (re.compile(r"amateur|grappling|exhibition|standing|special rules? bout", re.I), "EXH")]


def card_kind(section_title, note_text=""):
    """カード区分の見出し・メモから競技を判定。MMAなら''、それ以外は既存ファイルの接頭辞（KICK/BOX/EXH）"""
    for text in (section_title or "", note_text or ""):
        for rx, tag in NON_MMA:
            if rx.search(text):
                # "Rizin MMA Special Rules" はMMA
                if tag == "EXH" and re.search(r"\bMMA\b", text) and not re.search(r"standing|grappling|amateur", text, re.I):
                    continue
                return tag
    return ""
