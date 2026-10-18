"""所属ジム情報の収集（Wikipedia 英語版・日本語版の公式APIで、選手記事のインフォボックスを読む）。

  python3 tools/gyms/collect.py            → data-src/gyms/wiki-affiliations.json を更新

・対象は FIGHT BOOK に登録されている全選手（data/fights.js の PEOPLE）
・英語版は「Infobox martial artist」の team 欄、日本語版は「Infobox 格闘家」の 所属 欄
・同姓同名の誤認を防ぐため、記事本文に RIZIN の記述がある記事だけを採用する
・ここで集めるのは「出典付きの候補」。ジムとしての登録・名寄せは data-src/gyms/gyms.json と
  tools/gyms/build.py で行う（推測で所属を決めない）
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_fights as bf  # noqa: E402

UA = "FightBookGyms/1.0 (+https://github.com/fight-book-jp/fight-book-jp.github.io; weekly data check)"
OUT = os.path.join(ROOT, "data-src", "gyms", "wiki-affiliations.json")
OUT_GYMS = os.path.join(ROOT, "data-src", "gyms", "wiki-gyms.json")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse import clean, split_entries  # noqa: E402

GYM_FIELDS = {
    "location": ["location", "headquarters", "hq_location", "city", "所在地", "本部", "本部所在地", "本社所在地", "住所"],
    "country": ["country", "国"],
    "founded": ["founded", "established", "foundation", "formation", "設立", "創立", "創設", "設立年"],
    "founder": ["founder", "founders", "創設者", "設立者", "創始者"],
    "representative": ["key_people", "leader_name", "representative", "代表", "代表者", "代表者名", "会長"],
    "head_coach": ["head_coach", "coach", "headcoach", "指導者", "ヘッドコーチ"],
    "website": ["website", "url", "homepage", "ウェブサイト", "公式サイト", "公式ウェブサイト"],
}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url[:120]}: {last}")


def api(lang, params):
    q = dict(params, format="json", formatversion="2", maxlag="5")
    return get(f"https://{lang}.wikipedia.org/w/api.php?" + urllib.parse.urlencode(q))


def pages(lang, titles, langlinks=False):
    """titles を50件ずつ取得 → {入力タイトル: {title, revid, text, ja}}"""
    out = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        p = {"action": "query", "prop": "revisions" + ("|langlinks" if langlinks else ""), "rvprop": "content|ids",
             "rvslots": "main", "titles": "|".join(chunk), "redirects": "1"}
        if langlinks:
            p.update(lllang="ja", lllimit="max")
        d = api(lang, p)
        q = d.get("query", {})
        back = {}
        for n in q.get("normalized", []):
            back[n["to"]] = n["from"]
        for r in q.get("redirects", []):
            back[r["to"]] = back.get(r["from"], r["from"])
        for pg in q.get("pages", []):
            if pg.get("missing") or not pg.get("revisions"):
                continue
            src = back.get(pg["title"], pg["title"])
            rev = pg["revisions"][0]
            out[src] = {"title": pg["title"], "revid": rev.get("revid"),
                        "text": rev["slots"]["main"].get("content", ""),
                        "ja": (pg.get("langlinks") or [{}])[0].get("title", "")}
        time.sleep(1)
    return out


def infobox_param(text, names):
    """最初のインフォボックスから指定パラメータの値（wikitext のまま）を取り出す"""
    m = (re.search(r"\{\{\s*(?:Infobox martial artist|MMA statsbox\d*|Infobox 格闘家|Infobox kickboxer|Infobox boxer|Infobox professional wrestler)", text, re.I)
         or re.search(r"\{\{\s*Infobox", text, re.I))
    if not m:
        return None
    i, depth, j = m.start(), 0, m.start()
    while j < len(text):
        if text.startswith("{{", j):
            depth += 1; j += 2; continue
        if text.startswith("}}", j):
            depth -= 1; j += 2
            if depth == 0:
                break
            continue
        j += 1
    box = text[i:j]
    # トップレベルの | で分割
    parts, depth, cur, k = [], 0, "", 2
    body = box[2:-2]
    k = 0
    while k < len(body):
        two = body[k:k + 2]
        if two in ("{{", "[["):
            depth += 1; cur += two; k += 2; continue
        if two in ("}}", "]]"):
            depth -= 1; cur += two; k += 2; continue
        if body[k] == "|" and depth == 0:
            parts.append(cur); cur = ""
        else:
            cur += body[k]
        k += 1
    parts.append(cur)
    for p in parts[1:]:
        if "=" not in p:
            continue
        key, val = p.split("=", 1)
        if key.strip().lower() in names:
            return val.strip()
    return None


def gym_infobox(text):
    """ジム記事のインフォボックスから所在地・設立・代表・公式サイトを取り出す（無ければ空）"""
    out = {}
    if infobox_param(text, {"birth_date", "born", "birth", "生年月日"}):
        return out   # 人物記事は除外
    for field, names in GYM_FIELDS.items():
        v = infobox_param(text, set(names))
        if not v:
            continue
        if field == "website":
            m = re.search(r"https?://[^\s|\]}]+", v)
            if not m:
                m2 = re.search(r"\{\{\s*(?:URL|Official URL|公式ウェブサイト)\s*\|\s*([^|}]+)", v, re.I)
                v = ("https://" + m2.group(1).strip().removeprefix("https://").removeprefix("http://")) if m2 else ""
            else:
                v = m.group(0)
        else:
            v = re.sub(r"\s+", " ", re.sub(r"<br\s*/?>", "、", clean(v), flags=re.I)).strip(" 、,")
        if v:
            out[field] = v[:200]
    return out


def collect_gyms(result):
    """選手の所属欄に貼られたジム記事（Wikipedia）を読み、ジムの基本情報を集める"""
    links = {"en": set(), "ja": set()}
    for v in result.values():
        for lang in ("en", "ja"):
            t = (v.get(lang) or {}).get("team")
            if t:
                for e in split_entries(t, lang):
                    if e["link"]:
                        links[lang].add(e["link"])
    gyms = {}
    for lang in ("en", "ja"):
        got = pages(lang, sorted(links[lang]))
        for src, pg in got.items():
            info = gym_infobox(pg["text"])
            if not info:
                continue
            gyms[f"{lang}:{src}"] = {"title": pg["title"], "fields": info,
                                     "url": f"https://{lang}.wikipedia.org/wiki/" + urllib.parse.quote(pg["title"].replace(" ", "_"))}
    return gyms


def collect():
    built = bf.build(ROOT, write=False, verbose=False)
    people = built["people"]
    names_ja = {}
    try:
        import subprocess
        code = ("const vm=require('vm'),fs=require('fs');const c={window:{}};"
                "vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),c);process.stdout.write(JSON.stringify(c.window.NAMES_JA||{}))")
        names_ja = json.loads(subprocess.run(["node", "-e", code, os.path.join(ROOT, "data", "names-ja.js")],
                                             capture_output=True, text=True, check=True).stdout)
    except Exception:  # noqa: BLE001
        pass
    en_names = {v[0]: k for k, v in people.items()}
    en = pages("en", list(en_names), langlinks=True)
    result, ja_titles = {}, {}
    for name, key in en_names.items():
        pg = en.get(name)
        rec = {"name": name}
        if pg and re.search(r"\brizin\b", pg["text"], re.I) and not re.search(r"\{\{\s*(disambiguation|hndis)", pg["text"], re.I):
            team = infobox_param(pg["text"], {"team", "teams"})
            rec["en"] = {"title": pg["title"], "revid": pg["revid"], "team": team,
                         "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(pg["title"].replace(" ", "_"))}
            if pg["ja"]:
                ja_titles[pg["ja"]] = key
        if key not in ja_titles.values():
            jn = names_ja.get(name, "")
            if jn:
                ja_titles.setdefault(jn.replace(" ", "").replace("　", ""), key)
        result[key] = rec
    ja = pages("ja", list(ja_titles))
    for t, key in ja_titles.items():
        pg = ja.get(t)
        if pg and re.search(r"RIZIN|ライジン", pg["text"]) and "曖昧さ回避" not in pg["text"][:3000]:
            team = infobox_param(pg["text"], {"team", "teams", "所属", "チーム", "所属ジム"})
            result[key]["ja"] = {"title": pg["title"], "revid": pg["revid"], "team": team,
                                 "url": "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(pg["title"].replace(" ", "_"))}
    return result


def write_json(path, obj):
    txt = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    old = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    if txt != old:
        open(path, "w", encoding="utf-8").write(txt)


if __name__ == "__main__":
    res = collect()
    write_json(OUT_GYMS, collect_gyms(res))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # 版番号（revid）は記事が編集されるたびに変わるので、差分判定がぶれないよう保存しない
    slim = {k: {kk: ({x: y for x, y in vv.items() if x != "revid"} if isinstance(vv, dict) else vv) for kk, vv in v.items()}
            for k, v in sorted(res.items())}
    txt = json.dumps(slim, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    old = open(OUT, encoding="utf-8").read() if os.path.exists(OUT) else ""
    if txt != old:
        open(OUT, "w", encoding="utf-8").write(txt)
    n_en = sum(1 for v in res.values() if v.get("en", {}).get("team"))
    n_ja = sum(1 for v in res.values() if v.get("ja", {}).get("team"))
    print(f"選手 {len(res)} 人：英語版で所属あり {n_en} 人、日本語版で所属あり {n_ja} 人")
