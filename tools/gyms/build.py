"""ジムデータ（data/gyms.js）を作る。

入力
  data-src/gyms/gyms.json              … ジム台帳（手で管理。表記ゆれ・旧名・確認済みの基本情報と出典）
  data-src/gyms/wiki-affiliations.json … 選手ごとの所属欄（collect.py が Wikipedia から取得）
  data-src/gyms/wiki-gyms.json         … ジム記事の基本情報（collect.py が取得）
  data-src/gyms/overrides.json         … 所属の手動修正（最優先）
出力
  data/gyms.js … window.GYMS（ジム）と window.AFFIL（選手 → 所属の履歴）

方針
  ・推測で所属を決めない。出典のある記載だけを使い、現所属かどうか判断できないものは「時期不明」として持つ
  ・同じジムは台帳の aliases と表記の正規化（大文字小文字・記号・空白の違いを無視）でまとめる
  ・支部と本部は別のジムとして扱う（台帳で同じジムと書いたものだけまとめる）
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from parse import current_and_history, split_entries  # noqa: E402

SRC = os.path.join(ROOT, "data-src", "gyms")
SRC_LABEL = {"ja": "Wikipedia（日本語版）", "en": "Wikipedia（英語版）", "roster": "名簿データ（data/fighters.js）", "manual": "手動確認"}
NON_GYM = re.compile(r"^(unaffiliated|independent|none|n/a|フリー|フリーランス|無所属|.*(karate|空手|judo|柔道|wrestling|レスリング|boxing club|university|大学|高校|high school)$)", re.I)


def nk(s):
    s = unicodedata.normalize("NFKC", s or "").lower()
    s = re.sub(r"[\s・･\-–_.,'’&/（）()「」]", "", s)
    return s


def load(name, default):
    p = os.path.join(SRC, name)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else default


def roster_teams():
    code = ("const vm=require('vm'),fs=require('fs');const c={window:{}};"
            "vm.runInNewContext(fs.readFileSync(process.argv[1],'utf8'),c);"
            "process.stdout.write(JSON.stringify((c.window.FIGHTERS||[]).map(f=>[f.key,f.team||''])))")
    out = subprocess.run(["node", "-e", code, os.path.join(ROOT, "data", "fighters.js")], capture_output=True, text=True, check=True).stdout
    return {k: t for k, t in json.loads(out) if t}


def build():
    master = load("gyms.json", {"gyms": []})["gyms"]
    wiki = load("wiki-affiliations.json", {})
    wgyms = load("wiki-gyms.json", {})
    over = load("overrides.json", {"fighters": {}}).get("fighters", {})
    gyms, by_key = {}, {}
    for g in master:
        g = {k: v for k, v in g.items() if not k.startswith("_")}
        gyms[g["id"]] = dict(g, auto=False)
        for a in [g["name"], g.get("name_en", "")] + g.get("aliases", []):
            if a:
                by_key[nk(a)] = g["id"]

    def gym_id(name, link_info=None):
        k = nk(name)
        if not k or NON_GYM.match(name.strip()):
            return None
        if k in by_key:
            return by_key[k]
        gid = "g-" + hashlib.sha1(k.encode()).hexdigest()[:8]
        g = {"id": gid, "name": name, "aliases": [name], "auto": True}
        if link_info:
            f = link_info["fields"]
            g.update({"location_text": f.get("location", ""), "country": f.get("country", ""),
                      "established_text": f.get("founded", ""), "representative": f.get("representative") or f.get("founder", ""),
                      "head_coach": f.get("head_coach", ""), "official_website": f.get("website", ""),
                      "sources": [link_info["url"]], "verified_at": None})
            g = {k2: v for k2, v in g.items() if v not in ("", None) or k2 in ("verified_at",)}
        gyms[gid] = g
        by_key[k] = gid
        return gid

    affil = {}
    keys = set(wiki) | set(over)
    rteams = roster_teams()
    keys |= set(rteams)
    for key in sorted(keys):
        if key in over:
            rows = []
            for r in over[key]:
                gid = r["gym"] if r["gym"] in gyms else gym_id(r["gym"])
                if gid:
                    rows.append({"g": gid, "from": r.get("from"), "to": r.get("to"), "cur": r.get("current"),
                                 "src": r.get("source", ""), "via": "manual"})
            if rows:
                affil[key] = rows
            continue
        v = wiki.get(key, {})
        lang = "ja" if (v.get("ja") or {}).get("team") else ("en" if (v.get("en") or {}).get("team") else None)
        rows = []
        if lang:
            for e in current_and_history(split_entries(v[lang]["team"], lang), lang):
                info = wgyms.get(f"{lang}:{e['link']}") if e.get("link") else None
                gid = gym_id(e["name"], info)
                if not gid or any(r["g"] == gid for r in rows):
                    continue
                rows.append({"g": gid, "from": e["from"], "to": e["to"], "cur": e["current"], "src": v[lang]["url"], "via": lang})
            # 日本語版を使った場合も、英語版に同じジムの期間（年）があれば補う
            other = "en" if lang == "ja" else "ja"
            if (v.get(other) or {}).get("team"):
                for e in current_and_history(split_entries(v[other]["team"], other), other):
                    gid = gym_id(e["name"]) if nk(e["name"]) in by_key else None
                    for r in rows:
                        if gid and r["g"] == gid and r["from"] is None and e["from"] is not None:
                            r["from"], r["to"] = e["from"], e["to"]
                            if e["present"]:
                                r["cur"] = True
        elif key in rteams:
            gid = gym_id(rteams[key])
            if gid:
                rows.append({"g": gid, "from": None, "to": None, "cur": True, "src": "", "via": "roster"})
        if rows:
            affil[key] = rows
    used = {r["g"] for rows in affil.values() for r in rows}
    gyms = {k: v for k, v in gyms.items() if k in used}
    return gyms, affil


def write(gyms, affil):
    js = ("/* 自動生成: python3 tools/gyms/build.py （data-src/gyms から作成。直接編集しない） */\n"
          "window.GYM_SOURCES=" + json.dumps(SRC_LABEL, ensure_ascii=False) + ";\n"
          "window.GYMS=" + json.dumps(gyms, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + ";\n"
          "window.AFFIL=" + json.dumps(affil, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + ";\n")
    p = os.path.join(ROOT, "data", "gyms.js")
    old = open(p, encoding="utf-8").read() if os.path.exists(p) else ""
    if js != old:
        open(p, "w", encoding="utf-8").write(js)


if __name__ == "__main__":
    g, a = build()
    write(g, a)
    cur = sum(1 for rows in a.values() if any(r["cur"] for r in rows))
    print(f"ジム {len(g)}（台帳 {sum(1 for x in g.values() if not x.get('auto'))}）・所属情報のある選手 {len(a)}・現所属が分かる選手 {cur}")
