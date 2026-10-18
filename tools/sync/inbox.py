"""承認済みデータの取り込み（自動取得できない情報源の代替手段）。

data-src/sync/inbox/events.txt
    RIZIN公式などで管理者が確認した試合結果を、大会ファイルと同じ形式で1行ずつ書く。
    週次バッチが形式チェック・重複チェックをして data-src/events/<年>.txt に移し、ここから消す。
    問題のある行はここに残し、レポートに理由を出す。

data-src/sync/inbox/sns.json
    本人確認済みの SNS を書く：
      [{"key":"kyoji-horiguchi","platform":"x","url":"https://x.com/...",
        "verified":true,"evidence":"本人の公式サイトからリンクされている https://..."}]
    verified が true で evidence（確認の根拠）があるものだけ data/profiles.js の SNS_EXTRA に反映する。
"""
import json
import os
import re
from datetime import date

from normalize import bf, name_key
from validate import SNS_HOST

HEADER = ("# 承認済みの試合結果をここに1行ずつ書くと、週次バッチが data-src/events/<年>.txt に取り込みます。\n"
          "# 形式: 大会名|YYYY-MM-DD|階級|国コード 勝者|国コード 敗者|W(またはD/NC)|決着方法|R|時間|メモ\n"
          "# 例（実在しない例なので取り込まれません。# で始まる行は無視されます）:\n"
          "# Rizin 99|2099-01-01|Featherweight|JPN Taro Example|JPN Jiro Example|W|Decision (unanimous)|3|5:00|\n")


def _pair(a, b):
    return frozenset((name_key(bf.norm_name(a)[0]), name_key(bf.norm_name(b)[0])))


def import_events(root, built, today):
    path = os.path.join(root, "data-src", "sync", "inbox", "events.txt")
    res = {"imported": [], "rejected": [], "duplicates": []}
    if not os.path.exists(path):
        return res
    keep, add = [], {}
    existing = [(x["date"], frozenset((name_key(x["a"]), name_key(x["b"])))) for x in built["bouts"]]
    for n, raw in enumerate(open(path, encoding="utf-8"), 1):
        line = raw.rstrip("\n")
        if not line.strip() or line.startswith("#"):
            continue
        p = line.split("|")
        why = ""
        if not (6 <= len(p) <= 10):
            why = "列の数が不正"
        else:
            p = [x.strip() for x in (p + [""] * 10)[:10]]
            try:
                d = date.fromisoformat(p[1])
                if d.isoformat() != p[1] or p[1] > today:
                    why = "日付が不正、または未来の日付"
            except ValueError:
                why = "日付が YYYY-MM-DD ではない"
            if not why and p[5] not in ("W", "D", "NC"):
                why = "結果は W / D / NC"
            if not why and (not p[0] or not p[3] or not p[4]):
                why = "大会名・選手名が空"
        if why:
            res["rejected"].append({"line": n, "text": line, "reason": why}); keep.append(line); continue
        pk = _pair(p[3], p[4])
        o = date.fromisoformat(p[1]).toordinal()
        if any(pk == q and abs(date.fromisoformat(d2).toordinal() - o) <= 3 for d2, q in existing if d2):
            res["duplicates"].append({"line": n, "text": line}); continue
        existing.append((p[1], pk))
        add.setdefault(p[1][:4], []).append("|".join(p))
        res["imported"].append({"line": n, "text": line})
    for y, lines in add.items():
        append_event_lines(root, y, lines)
    if res["imported"] or res["duplicates"]:
        open(path, "w", encoding="utf-8").write(HEADER + "".join(l + "\n" for l in keep))
    return res


def append_event_lines(root, year, lines):
    path = os.path.join(root, "data-src", "events", f"{year}.txt")
    cur = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    if cur and not cur.endswith("\n"):
        cur += "\n"
    open(path, "w", encoding="utf-8").write(cur + "".join(l + "\n" for l in lines))


# ---------- SNS ----------
def render_sns_block(sns):
    order = ("youtube", "x", "instagram", "tiktok", "site")
    rows = []
    for k in sorted(sns):
        items = sorted(sns[k].items(), key=lambda kv: (order.index(kv[0]) if kv[0] in order else 9, kv[0]))
        rows.append(f'  {json.dumps(k)}:{{ ' + ", ".join(f"{p}:{json.dumps(u)}" for p, u in items) + " },")
    return "window.SNS_EXTRA = {\n" + "\n".join(rows) + "\n};"


def import_sns(root, people, current_sns, state, today):
    path = os.path.join(root, "data-src", "sync", "inbox", "sns.json")
    res = {"applied": [], "pending": [], "rejected": []}
    if not os.path.exists(path):
        return res
    try:
        items = json.load(open(path, encoding="utf-8"))
        assert isinstance(items, list)
    except Exception as e:  # noqa: BLE001
        res["rejected"].append({"item": None, "reason": f"sns.json を読めません: {e}"})
        return res
    sns = {k: dict(v) for k, v in current_sns.items()}
    keep = []
    for it in items:
        k, plat, url = it.get("key"), it.get("platform"), (it.get("url") or "").strip()
        if k not in people:
            res["rejected"].append({"item": it, "reason": "存在しない選手キー"}); keep.append(it); continue
        hosts = SNS_HOST.get(plat, ()) if plat != "site" else ("",)
        if plat not in ("x", "instagram", "youtube", "tiktok", "site") or not url.startswith("https://") or \
                (plat != "site" and not any(re.match(rf"https://(?:www\.|m\.)?{re.escape(h)}/", url) for h in hosts)):
            res["rejected"].append({"item": it, "reason": "platform または URL が不正"}); keep.append(it); continue
        if it.get("verified") is not True or not str(it.get("evidence", "")).strip():
            res["pending"].append({"item": it, "reason": "本人確認（verified=true と evidence）が未記入"}); keep.append(it); continue
        old = sns.get(k, {}).get(plat)
        if old != url:
            sns.setdefault(k, {})[plat] = url
            state.setdefault("history", []).append({"date": today, "key": k, "field": plat, "from": old, "to": url,
                                                    "source": "manual-approved", "evidence": it["evidence"]})
        res["applied"].append(it)
    if res["applied"]:
        pp = os.path.join(root, "data", "profiles.js")
        t = open(pp, encoding="utf-8").read()
        t2 = re.sub(r"window\.SNS_EXTRA\s*=\s*\{.*?\n\};", lambda m: render_sns_block(sns), t, flags=re.S)
        open(pp, "w", encoding="utf-8").write(t2)
        json.dump(keep, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        open(path, "a", encoding="utf-8").write("\n")
    return res
