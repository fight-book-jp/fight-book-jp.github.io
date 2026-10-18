"""プロフィール・SNS の差分検知（Wikidata を参考情報として使用）。

方針
  - Wikidata（CC0・公式API）は誰でも編集できる情報で、選手本人の公式情報ではない。
    → 差分は「要確認の候補」として出すだけで、data/fighters.js・data/profiles.js は自動では書き換えない。
  - SNS は「アカウントが存在する」「Wikidata に載っている」だけでは本人と断定しない。
    本人確認したものだけを data-src/sync/inbox/sns.json に書くと取り込まれる（inbox.py）。
  - 同姓同名の誤認を防ぐため、Wikidata の項目は「説明文が格闘家で、候補が1件だけ」のときだけ採用する。
    決められない選手は sources.json の wikidataPins に Q番号を書いて固定できる。
  - 変更履歴・情報源・最初に確認した日を data-src/sync/profile-sources.json に記録する。
"""
import json
import os
import re
import subprocess
import urllib.parse

from discover import http_get
from normalize import ROOT

WD_API = "https://www.wikidata.org/w/api.php?"
FIGHTER_DESC = re.compile(r"mixed martial|\bMMA\b|kick ?boxer|martial artist|wrestler|judoka|\bboxer\b|fighter|格闘|総合", re.I)
FIELDS = {  # Wikidata プロパティ → 項目名
    "P569": "born", "P2048": "height", "P2067": "weight", "P27": "country",
    "P2002": "x", "P2003": "instagram", "P2397": "youtube", "P7085": "tiktok", "P856": "site",
}
COUNTRY_SAME = {"アメリカ合衆国": "アメリカ", "イギリス（英国）": "イギリス"}
SNS = ("x", "instagram", "youtube", "tiktok", "site")
LABEL = {"born": "生年月日", "height": "身長", "weight": "体重", "country": "国籍", "x": "X", "instagram": "Instagram",
         "youtube": "YouTube", "tiktok": "TikTok", "site": "公式サイト"}


def load_js_data(root=ROOT):
    """data/fighters.js・data/profiles.js・data/social.json を読む（Node で評価して JSON にする）"""
    code = ("const vm=require('vm'),fs=require('fs');const c={window:{}};"
            "for(const f of ['fighters','profiles']){const p=process.argv[1]+'/data/'+f+'.js';if(fs.existsSync(p))vm.runInNewContext(fs.readFileSync(p,'utf8'),c);}"
            "process.stdout.write(JSON.stringify({fighters:c.window.FIGHTERS||[],sns:c.window.SNS_EXTRA||{}}))")
    out = subprocess.run(["node", "-e", code, root], capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    sp = os.path.join(root, "data", "social.json")
    data["social"] = json.load(open(sp, encoding="utf-8")).get("fighters", {}) if os.path.exists(sp) else {}
    return data


# ---------- 既存値の正規化 ----------
def norm_born(s):
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s or "")
    return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}" if m else ""


def norm_height(s):
    m = re.search(r"(\d{3})", s or "")
    return m.group(1) if m else ""


def sns_id(platform, url):
    u = (url or "").strip()
    if not u:
        return ""
    if platform == "x":
        m = re.search(r"(?:twitter|x)\.com/@?([A-Za-z0-9_]+)", u)
        return m.group(1).lower() if m else u.lower()
    if platform == "instagram":
        m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", u)
        return m.group(1).lower().rstrip(".") if m else u.lower()
    if platform == "tiktok":
        m = re.search(r"tiktok\.com/@([A-Za-z0-9_.]+)", u)
        return m.group(1).lower() if m else u.lstrip("@").lower()
    if platform == "youtube":
        m = re.search(r"(UC[\w-]{22})", u)
        return m.group(1) if m else u
    if platform == "site":
        return re.sub(r"^https?://(www\.)?", "", u).rstrip("/").lower()
    return u


def sns_url(platform, ident):
    return {"x": f"https://x.com/{ident}", "instagram": f"https://www.instagram.com/{ident}/",
            "youtube": f"https://www.youtube.com/channel/{ident}", "tiktok": f"https://www.tiktok.com/@{ident}",
            "site": ident if ident.startswith("http") else f"https://{ident}"}[platform]


# ---------- Wikidata ----------
def wd_get(params, fetch=http_get, tries=3):
    """Wikidata API。サーバー混雑（maxlag）のときは待って再試行し、それでもだめならエラーにする"""
    import time
    params = dict(params, format="json", maxlag="10")
    for i in range(tries):
        r = json.loads(fetch(WD_API + urllib.parse.urlencode(params)))
        err = r.get("error") if isinstance(r, dict) else None
        if not err:
            return r
        if err.get("code") != "maxlag" or i == tries - 1:
            raise RuntimeError(f"wikidata API error: {err.get('code')} {err.get('info', '')[:120]}")
        time.sleep(5 * (i + 1))
    return {}


def resolve(name, fetch=http_get):
    """名前で検索し、説明文が格闘家の候補が1件だけなら Q番号を返す → (qid or None, 候補リスト)"""
    if not name:
        return None, []
    r = wd_get({"action": "wbsearchentities", "search": name, "language": "en", "limit": "10", "type": "item"}, fetch)
    cands = [s for s in r.get("search", []) if FIGHTER_DESC.search(s.get("description", "") or "")
             and (s.get("label", "").lower() == name.lower() or s.get("match", {}).get("type") == "alias")]
    if len(cands) == 1:
        return cands[0]["id"], cands
    return None, cands


def _claim(entity, prop):
    for c in entity.get("claims", {}).get(prop, []):
        if c.get("rank") == "deprecated":
            continue
        dv = c.get("mainsnak", {}).get("datavalue")
        if dv:
            return dv
    return None


def extract(entity, country_labels):
    vals = {}
    for prop, field in FIELDS.items():
        dv = _claim(entity, prop)
        if not dv:
            continue
        v = dv["value"]
        if field == "born" and isinstance(v, dict) and v.get("precision", 0) >= 11:
            vals[field] = v["time"][1:11]
        elif field in ("height", "weight") and isinstance(v, dict):
            amt, unit = float(v["amount"]), v.get("unit", "")
            if field == "height":
                cm = amt * 100 if unit.endswith("/Q11573") else amt if unit.endswith("/Q174728") else None
                if cm:
                    vals[field] = str(round(cm))
            else:
                if unit.endswith("/Q11570"):
                    vals[field] = str(round(amt, 1)).rstrip("0").rstrip(".")
        elif field == "country" and isinstance(v, dict):
            vals[field] = country_labels.get(v.get("id"), v.get("id"))
        elif isinstance(v, str):
            vals[field] = sns_id(field, v) if field != "youtube" else v
    return vals


def fetch_entities(qids, fetch=http_get):
    ents = {}
    q = sorted(set(qids))
    for i in range(0, len(q), 50):
        r = wd_get({"action": "wbgetentities", "ids": "|".join(q[i:i + 50]), "props": "claims|labels|descriptions",
                    "languages": "ja|en"}, fetch)
        ents.update(r.get("entities", {}))
    return ents


def check_profiles(people, js, state, pins, today, fetch=http_get, limit=None):
    """→ (candidates, unresolved, errors)。state（profile-sources.json の中身）はこの関数内で更新する"""
    fighters = {f["key"]: f for f in js["fighters"]}
    targets = sorted(set(fighters) | set(js["sns"]))
    if limit:
        targets = targets[:limit]
    st = state.setdefault("fighters", {})
    hist = state.setdefault("history", [])
    unresolved, errors = [], []
    for k in targets:
        e = st.setdefault(k, {})
        if k in pins:
            e["wikidata"], e["resolvedBy"] = pins[k], "pin"
        if e.get("wikidata"):
            continue
        names = [people.get(k, [""])[0], (fighters.get(k) or {}).get("en", "")]
        try:
            qid, cands = None, []
            for n in dict.fromkeys(x for x in names if x):
                qid, cands = resolve(n, fetch)
                if qid:
                    break
            if qid:
                e["wikidata"], e["resolvedBy"] = qid, "search"
            else:
                e.setdefault("wikidata", None)
                unresolved.append({"key": k, "name": names[0], "candidates": [c["id"] + " " + c.get("description", "") for c in cands]})
        except Exception as ex:  # noqa: BLE001
            errors.append(f"wikidata search {k}: {ex}")
    qids = {st[k]["wikidata"]: k for k in targets if st.get(k, {}).get("wikidata")}
    if not qids:
        return [], unresolved, errors
    try:
        ents = fetch_entities(list(qids), fetch)
        cq = {(_claim(en, "P27") or {}).get("value", {}).get("id") for en in ents.values()} - {None}
        clab = {}
        if cq:
            for q, en in fetch_entities(list(cq), fetch).items():
                lab = en.get("labels", {})
                clab[q] = (lab.get("ja") or lab.get("en") or {}).get("value", q)
    except Exception as ex:  # noqa: BLE001
        return [], unresolved, errors + [f"wikidata entities: {ex}"]
    cands = []
    for qid, k in sorted(qids.items(), key=lambda x: x[1]):
        ent = ents.get(qid)
        if not ent or "missing" in ent:
            errors.append(f"wikidata {qid}（{k}）が見つからない"); continue
        vals = extract(ent, clab)
        rec = st[k].setdefault("values", {})
        for f, v in vals.items():
            old = rec.get(f, {}).get("value")
            if old != v:
                if old is not None:
                    hist.append({"date": today, "key": k, "field": f, "from": old, "to": v, "source": f"wikidata:{qid}"})
                rec[f] = {"value": v, "since": today, "source": f"https://www.wikidata.org/wiki/{qid}"}
        f0 = fighters.get(k, {})
        cur = {"born": norm_born(f0.get("born", "")), "height": norm_height(f0.get("height", "")),
               "country": f0.get("country", "")}
        sns_cur = dict(f0.get("sns", {}) or {})
        sns_cur.update(js["sns"].get(k, {}))
        for p in SNS:
            cur[p] = sns_id(p, sns_cur.get(p, ""))
        if not cur["youtube"].startswith("UC"):
            ch = ((js["social"].get(k) or {}).get("youtube") or {}).get("channel", {}).get("id", "")
            if ch:
                cur["youtube"] = ch
        for f, v in vals.items():
            if f == "weight" or (f in ("born", "height", "country") and k not in fighters):
                continue        # 名簿外の選手はプロフィール欄が無いので SNS のみ
            c = cur.get(f, "")
            if c == v or (f == "country" and c and (v in c or c in v or COUNTRY_SAME.get(v) == c)):
                continue
            kind = ("sns_new" if not c else "sns_change") if f in SNS else ("profile_fill" if not c else "profile_change")
            cands.append({"id": _rid(k, f, v), "type": kind, "key": k, "field": LABEL[f], "ours": c,
                          "source_value": sns_url(f, v) if f in SNS else v,
                          "source": f"https://www.wikidata.org/wiki/{qid}",
                          "note": "本人確認が必要（Wikidataは非公式情報）" if f in SNS else "公式情報での確認が必要（Wikidataは非公式情報）"})
    return cands, unresolved, errors


def _rid(*p):
    import hashlib
    return hashlib.sha1("|".join(map(str, p)).encode()).hexdigest()[:12]
