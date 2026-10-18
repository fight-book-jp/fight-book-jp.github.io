"""外部データの取得と解析（更新検知）。

取得元と方針（詳細は tools/sync/sources.json）
  - Wikipedia「YYYY in Rizin Fighting Federation」 … MediaWiki 公式APIで wikitext を取得し、試合結果を解析（自動取得）
  - RIZIN公式 jp.rizinff.com                       … 公開サイトマップの新着・更新URLのみ検知（本文は取得しない）
  - Wikidata                                         … profiles.py で使用
  - Sherdog / Tapology / 選手SNS                     … 利用規約・API の都合で自動取得しない
すべての通信は fetch 関数を差し替えられるようにし、テストでは外部に出ない。
"""
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from normalize import (card_kind, event_name, fighter, method, note, parse_date,
                       result_of, round_, strip_wiki, time_, weight_class)

UA = "FightBookSync/1.0 (+https://github.com/fight-book-jp/fight-book-jp.github.io; weekly data check)"


class FetchError(Exception):
    pass


def http_get(url, timeout=30, retries=2):
    """GET（User-Agent 明示、失敗時は少し待って再試行）"""
    last = None
    for i in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise FetchError(f"{url}: {last}")


# ---------------- Wikipedia ----------------
def wiki_api_url(year):
    q = urllib.parse.urlencode({"action": "parse", "page": f"{year} in Rizin Fighting Federation",
                                "prop": "wikitext|revid", "format": "json", "formatversion": "2",
                                "redirects": "1", "maxlag": "5"})
    return "https://en.wikipedia.org/w/api.php?" + q


def wiki_page_url(year):
    return f"https://en.wikipedia.org/wiki/{year}_in_Rizin_Fighting_Federation"


def fetch_wiki_year(year, fetch=http_get):
    data = json.loads(fetch(wiki_api_url(year)))
    if "error" in data:
        raise FetchError(f"wikipedia {year}: {data['error'].get('info', data['error'])}")
    p = data["parse"]
    return {"year": year, "revid": p.get("revid"), "wikitext": p["wikitext"], "url": wiki_page_url(year)}


def _sections(text):
    """'==見出し==' 単位に分割（=== 以下は中に含める）"""
    out, cur, buf = [], None, []
    for line in text.split("\n"):
        m = re.match(r"^==\s*([^=].*?)\s*==\s*$", line)
        if m:
            if cur is not None:
                out.append((cur, "\n".join(buf)))
            cur, buf = m.group(1), []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        out.append((cur, "\n".join(buf)))
    return out


def _template_args(body):
    """{{MMAevent bout|a|b|...}} の中身を、入れ子の {{ }} [[ ]] を壊さずに | で分割"""
    args, depth, cur, i = [], 0, "", 0
    while i < len(body):
        two = body[i:i + 2]
        if two in ("{{", "[["):
            depth += 1; cur += two; i += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; cur += two; i += 2; continue
        c = body[i]
        if c == "|" and depth == 0:
            args.append(cur); cur = ""
        else:
            cur += c
        i += 1
    args.append(cur)
    return [a.strip() for a in args]


def _templates(text, names):
    """text 中の {{名前|...}} を入れ子を考慮して順に取り出す → [(名前, 引数リスト)]"""
    out, i = [], 0
    while True:
        i = text.find("{{", i)
        if i < 0:
            return out
        depth, j = 0, i
        while j < len(text):
            if text.startswith("{{", j):
                depth += 1; j += 2; continue
            if text.startswith("}}", j):
                depth -= 1; j += 2
                if depth == 0:
                    break
                continue
            j += 1
        inner = text[i + 2:j - 2]
        args = _template_args(inner)
        nm = args[0].strip() if args else ""
        if nm in names:
            out.append((nm, args[1:]))
        i = j


def _bout(cells, section, cc_override=None):
    """セル8つ [階級, 選手A, def./vs., 選手B, 決着, R, 時間, メモ] → dict（結果が無ければ None）"""
    cells = (cells + [""] * 8)[:8]
    wc_raw, a_raw, word, b_raw, meth_raw, rnd, tm, nt = cells
    meth = method(meth_raw)
    res = result_of(word, meth)
    if not res:
        return None
    a, ca = fighter(a_raw)
    b, cb = fighter(b_raw)
    if not a or not b:
        return None
    nt_s = note(nt)
    wc = weight_class(wc_raw)
    kind = card_kind(f"{section} {wc}", nt_s)
    if kind:
        wc = re.sub(r"\s*\((?:kick ?boxing|boxing|grappling|exhibition)[^)]*\)", "", wc, flags=re.I).strip()
    return {"section": strip_wiki(section), "kind": kind, "wc": wc,
            "a": a, "ca": ca, "b": b, "cb": cb, "res": res, "method": meth,
            "round": round_(rnd), "time": time_(tm), "note": nt_s}


def parse_results(block):
    """Results セクションを解析（MMAevent テンプレート形式と wikitable 形式の両方に対応）"""
    bouts = []
    card = ""
    if "{{MMAevent bout" in block:
        for name, args in _templates(block, ("MMAevent card", "MMAevent bout")):
            if name == "MMAevent card":
                card = args[0] if args else ""
                continue
            b = _bout(args, card)
            if b:
                bouts.append(b)
        return bouts
    # wikitable 形式：'|-' で行を区切り、'!' 行はカード区分の見出し
    for row in re.split(r"\n\|-[^\n]*", block):
        lines = [l for l in row.strip().split("\n") if l.strip()]
        if not lines:
            continue
        if lines[0].startswith("!"):
            head = strip_wiki(lines[0].split("|")[-1])
            if head and head.lower() not in ("weight class", "notes"):
                card = head
            continue
        cells = []
        for l in lines:
            if not l.startswith("|") or l.startswith("|}") or l.startswith("{|"):
                continue
            c = l[1:]
            c = re.sub(r"^\s*(?:align|style|rowspan|colspan)=[^|]*\|", "", c)
            cells.append(c)
        if len(cells) >= 5:
            b = _bout(cells, card)
            if b:
                bouts.append(b)
    return bouts


def parse_year(text, year=None):
    """年別ページの wikitext → 大会のリスト [{name, heading, date, bouts:[...] }]"""
    events = []
    for heading, body in _sections(text):
        if not re.search(r"\b(Rizin|RIZIN)\b", heading) or re.search(r"Grand Prix|tournament|List of", heading, re.I):
            continue
        info = re.search(r"\|\s*date\s*=([^\n]*)", body)
        dt = parse_date(info.group(1)) if info else ""
        res = re.search(r"===\s*Results\s*===(.*?)(?:\n===?[^=]|\Z)", body, re.S)
        if not res:
            continue
        bouts = parse_results(res.group(1))
        if not dt:
            dt = parse_date(body[:2000])
        events.append({"name": event_name(heading), "heading": strip_wiki(heading), "date": dt, "bouts": bouts})
    if year:
        events = [e for e in events if e["date"].startswith(str(year))]
    return events


# ---------------- RIZIN公式（サイトマップのみ） ----------------
def rizin_recent_urls(fetch=http_get, now=None, days=8, index_url="https://jp.rizinff.com/sitemap-index.xml", max_maps=2):
    """公開サイトマップから、直近 days 日に追加・更新された記事URLを返す（本文は取得しない）"""
    now = now or datetime.now(timezone.utc)
    idx = fetch(index_url)
    maps = re.findall(r"<loc>(https://jp\.rizinff\.com/sitemap-contents-(\d+)\.xml)</loc>", idx)
    maps = [u for u, _n in sorted(maps, key=lambda x: -int(x[1]))][:max_maps]
    since = now - timedelta(days=days)
    out = []
    for u in maps:
        xml = fetch(u)
        for loc, lm in re.findall(r"<url><loc>([^<]+)</loc><lastmod>([^<]+)</lastmod>", xml):
            try:
                t = datetime.fromisoformat(lm)
            except ValueError:
                continue
            if t >= since:
                out.append({"url": loc, "lastmod": lm})
    out.sort(key=lambda x: x["lastmod"], reverse=True)
    return out
