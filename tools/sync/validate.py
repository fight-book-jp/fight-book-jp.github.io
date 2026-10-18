"""データ検証。週次バッチの前後と、data-src を変更したときに実行する。

  python3 tools/sync/validate.py          … 問題があれば終了コード1（エラー）を返す

エラー（停止）
  - 大会ファイルの行形式・日付形式の誤り
  - 同一試合の二重登録（同じ日付・同じ両選手）
  - 勝敗と決着方法の矛盾（W なのに Draw、D なのに KO など）
  - 存在しない選手キーの参照（試合・プロフィール・SNS）
  - SNS の URL がそのサービスのものではない
警告（停止しない）
  - 同じ両選手の試合が3日以内に2つ（日付ずれの重複の可能性）
  - 自動採番で '-2' が付いた選手キー（同姓同名の別人の可能性）
"""
import glob
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from normalize import ROOT, bf, name_key  # noqa: E402

SNS_HOST = {"x": ("x.com", "twitter.com"), "instagram": ("instagram.com",), "youtube": ("youtube.com",),
            "tiktok": ("tiktok.com",)}
NON_MMA = ("KICK", "BOX", "EXH")


def _text(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _iso_ok(s):
    try:
        return date.fromisoformat(s).isoformat() == s
    except Exception:  # noqa: BLE001
        return False


def check_events(root):
    errs, warns = [], []
    seen = {}
    for path in sorted(glob.glob(os.path.join(root, "data-src", "events", "*.txt"))):
        rel = os.path.relpath(path, root)
        for n, line in enumerate(_text(path).split("\n"), 1):
            line = line.rstrip("\n")
            if not line.strip() or line.startswith(("Event|", "TOTAL", "MISSING", "#")):
                continue
            p = line.split("|")
            if len(p) < 6 or len(p) > 10:
                errs.append(f"{rel}:{n} 列の数が不正（{len(p)}列）"); continue
            p = (p + [""] * 10)[:10]
            ev, dt, wc, a, b, res, meth, rnd, tm, _note = [x.strip() for x in p]
            if not _iso_ok(dt):
                errs.append(f"{rel}:{n} 日付が YYYY-MM-DD ではない: {dt!r}")
            if not ev or not a or not b:
                errs.append(f"{rel}:{n} 大会名・選手名が空")
            if wc.upper().startswith(NON_MMA) or "/" in a or "/" in b:
                continue
            if res not in ("W", "D", "NC"):
                errs.append(f"{rel}:{n} 結果は W / D / NC のいずれか: {res!r}"); continue
            ml = meth.lower()
            if res == "W" and (ml.startswith("draw") or ml.startswith("no contest") or ml.startswith("nc")):
                errs.append(f"{rel}:{n} 勝敗と決着方法が矛盾（W なのに {meth}）")
            if res == "D" and meth and not ml.startswith("draw"):
                errs.append(f"{rel}:{n} 勝敗と決着方法が矛盾（D なのに {meth}）")
            if res == "NC" and meth and not (ml.startswith("nc") or "no contest" in ml or "overturned" in ml):
                warns.append(f"{rel}:{n} NC の決着方法が NC / No Contest ではない: {meth}")
            if rnd and not re.fullmatch(r"[1-5]", rnd):
                errs.append(f"{rel}:{n} ラウンドが不正: {rnd!r}")
            if tm and not re.fullmatch(r"\d{1,2}:[0-5]\d", tm):
                errs.append(f"{rel}:{n} 時間が不正: {tm!r}")
            an, _ = bf.norm_name(a)
            bn, _ = bf.norm_name(b)
            pk = frozenset((name_key(an), name_key(bn)))
            for (d2, pk2), where in seen.items():
                if pk2 == pk and _iso_ok(dt) and _iso_ok(d2):
                    gap = abs(date.fromisoformat(dt).toordinal() - date.fromisoformat(d2).toordinal())
                    if gap == 0:
                        errs.append(f"{rel}:{n} 同一試合の二重登録（{where} と同じ）: {an} vs {bn} {dt}")
                    elif gap <= 3:
                        warns.append(f"{rel}:{n} 3日以内に同じ組み合わせ（{where}）: {an} vs {bn}")
            seen[(dt, pk)] = f"{rel}:{n}"
    return errs, warns


def js_keys(root):
    """data/fighters.js の key と、data/profiles.js の CATCHPHRASE / SNS_EXTRA のキー・URL"""
    fighters = re.findall(r'\{\s*key:"([^"]+)"', _text(os.path.join(root, "data", "fighters.js")))
    prof = os.path.join(root, "data", "profiles.js")
    catch, sns = [], []
    if os.path.exists(prof):
        t = _text(prof)
        cb = re.search(r"window\.CATCHPHRASE\s*=\s*\{(.*?)\n\};", t, re.S)
        sb = re.search(r"window\.SNS_EXTRA\s*=\s*\{(.*?)\n\};", t, re.S)
        if cb:
            catch = re.findall(r'^\s*"([^"]+)"\s*:', cb.group(1), re.M)
        if sb:
            for k, body in re.findall(r'^\s*"([^"]+)"\s*:\s*\{(.*?)\}\s*,?\s*$', sb.group(1), re.M):
                for plat, url in re.findall(r'(\w+)\s*:\s*"([^"]*)"', body):
                    sns.append((k, plat, url))
    return fighters, catch, sns


def check_built(root, built):
    errs, warns = [], []
    people = built["people"]
    names = {}
    for k, v in people.items():
        if v[0] in names:
            errs.append(f"同じ選手名に2つのキー: {v[0]} → {names[v[0]]}, {k}")
        names[v[0]] = k
        if re.search(r"-2$", k):
            warns.append(f"自動採番のキー（同姓同名の可能性）: {k} = {v[0]}")
    for r in built["fights"]:
        for k in (r[2], r[3]):
            if k not in people:
                errs.append(f"試合が存在しない選手キーを参照: {k}（{r[0]} {r[1]}）")
    fighters, catch, sns = js_keys(root)
    if len(set(fighters)) != len(fighters):
        errs.append("data/fighters.js の key が重複しています")
    for k in fighters:
        if k not in people:
            warns.append(f"名簿の選手に試合データがない: {k}")
    for k in catch:
        if k not in people:
            errs.append(f"profiles.js CATCHPHRASE が存在しない選手キーを参照: {k}")
    for k, plat, url in sns:
        if k not in people:
            errs.append(f"profiles.js SNS_EXTRA が存在しない選手キーを参照: {k}")
        hosts = SNS_HOST.get(plat)
        if not url.startswith("https://"):
            errs.append(f"SNS の URL が https ではない: {k} {plat} {url}")
        elif hosts and not any(re.match(rf"https://(?:www\.|m\.)?{re.escape(h)}/", url) for h in hosts):
            errs.append(f"SNS の URL が {plat} のものではない: {k} {url}")
    return errs, warns


def validate(root=ROOT):
    e1, w1 = check_events(root)
    built = bf.build(root, write=False, verbose=False)
    e2, w2 = check_built(root, built)
    return e1 + e2, w1 + w2, built


if __name__ == "__main__":
    errs, warns, _ = validate()
    for w in warns:
        print("WARN ", w)
    for e in errs:
        print("ERROR", e)
    print(f"検証: エラー {len(errs)} 件 / 警告 {len(warns)} 件")
    sys.exit(1 if errs else 0)
