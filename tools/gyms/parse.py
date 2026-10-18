"""Wikipedia インフォボックスの所属欄（wikitext）を「ジム名・期間・現所属か」に分解する。"""
import re

FREE = re.compile(r"^(フリー(ランス)?|free(lance)?|independent|none|なし|無所属)$", re.I)


def clean(s):
    s = s or ""
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S | re.I)
    s = re.sub(r"\{\{\s*(efn|efn2|refn|sfn)[^{}]*\}\}", "", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:nowrap|small|lang\|[a-z-]+)\|([^{}]*)\}\}", r"\1", s, flags=re.I)
    s = re.sub(r"\{\{\s*(?:ubl|unbulleted list|plainlist|flatlist)\s*\|(.*?)\}\}", lambda m: "<br>".join(m.group(1).split("|")), s, flags=re.S | re.I)
    s = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"\[https?://\S+\s+([^\]]*)\]", r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"'{2,}", "", s)
    s = s.replace("&nbsp;", " ").replace("&ndash;", "–")
    return s


def _years(t):
    """'(2015–present)' '（2012年 - 2016年）' → (from, to, is_present, rest)"""
    m = re.search(r"[（(]\s*(?:since\s+)?(\d{4})\s*年?\s*(?:[–\-—~〜～]|to)?\s*(present|現在|\d{4})?\s*年?\s*[)）]", t, re.I)
    if not m:
        m2 = re.search(r"[（(]\s*(present|current|現在)\s*[)）]", t, re.I)
        if m2:
            return None, None, True, (t[:m2.start()] + t[m2.end():]).strip()
        m3 = re.search(r"[（(]\s*until\s+(\d{4})\s*[)）]", t, re.I)
        if m3:
            return None, int(m3.group(1)), False, (t[:m3.start()] + t[m3.end():]).strip()
        return None, None, False, t.strip()
    a = int(m.group(1))
    b = m.group(2)
    present = bool(b and not b.isdigit())
    to = int(b) if b and b.isdigit() else (None if present else (None if re.search(r"[–\-—~〜～]|to", m.group(0)) else a))
    return a, to, present, (t[:m.start()] + t[m.end():]).strip()


def split_entries(raw, lang):
    """→ [{'name', 'link', 'from', 'to', 'present', 'order'}]（書かれている順）
    link はその項目に貼られた Wikipedia 記事名（ジム記事の情報取得に使う）"""
    s = re.sub(r"<ref[^>]*/>", "", raw or "")
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S | re.I)
    s = re.sub(r"<br\s*/?>|\n|^\*|\n\*", "<<SEP>>", s, flags=re.I)
    s = re.sub(r"\s*→\s*", "<<SEP>>", s)
    pieces = []
    for gi, chunk in enumerate(s.split("<<SEP>>")):
        # 「A / B」「A, B」は同時に所属（または並記）。[[ ]] の中の / は分けない
        subs = re.split(r"\s*/\s*(?![^\[]*\]\])|,\s+(?![^\[]*\]\])", chunk)
        for sub in subs:
            lk = re.search(r"\[\[([^|\]#]+)", sub)
            c = clean(sub).strip(" ,、/|")
            if c:
                pieces.append((c, lk.group(1).strip() if lk else "", gi))
    out = []
    for i, (p, link, gi) in enumerate(pieces):
        a, b, present, name = _years(p)
        name = re.sub(r"\s*[（(](?:MMA|kickboxing|Kickboxing|Karate|karate|BJJ|wrestling|boxing|formerly|former)[)）]\s*", "", name)
        name = re.sub(r"\s+", " ", name).strip(" -–,、")
        if not name:
            continue
        out.append({"name": name, "link": link, "from": a, "to": b, "present": present, "order": gi})
    return out


def current_and_history(entries, lang):
    """現所属の判定。
    ・期間に present / 現在 がある → それが現所属
    ・日本語版の「→」つなぎ → 最後の項目が現所属（フリーなら現所属なし）
    ・項目が1つだけ → その1つ（期間は不明）
    ・上記以外（複数で期間なし）→ 現所属は特定しない"""
    if not entries:
        return []
    pres = [e for e in entries if e["present"]]
    res = []
    for e in entries:
        e = dict(e)
        if pres:
            e["current"] = e["present"]
        elif lang == "ja" and len({x["order"] for x in entries}) > 1:
            e["current"] = e["order"] == entries[-1]["order"]
        elif len({x["order"] for x in entries}) == 1:
            e["current"] = True
        else:
            e["current"] = None   # 不明
        res.append(e)
    return [e for e in res if not FREE.match(e["name"])] if res else []
