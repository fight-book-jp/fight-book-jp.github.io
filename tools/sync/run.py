"""週次データ更新バッチ（GitHub Actions の weekly-update.yml から実行）。

  python3 tools/sync/run.py --out sync-out

処理
  1. 既存データを検証（問題があればここで停止）
  2. 承認済みデータ（data-src/sync/inbox/）を取り込み
  3. Wikipedia から今年・前年の大会結果を取得 → 既存データと照合
     ・既存に無い大会で曖昧な点が無いもの → data-src/events/<年>.txt に追記
     ・訂正・補完・選手名の照合が曖昧なもの → 要確認リスト（data-src/sync/review.json）へ
  4. RIZIN公式サイトマップの新着URLを検知（手動確認用）
  5. Wikidata とプロフィール・SNS を照合（要確認リストへ。自動反映しない）
  6. 変更があれば既存の tools/build_fights.py で data/fights.js を再生成し、もう一度検証
     検証に失敗したら変更をすべて元に戻して終了（本番データは変えない）
  7. レポート（Markdown・JSON）を出力
変更の有無は git diff で判断し、PR の作成はワークフロー側で行う。
"""
import argparse
import glob
import json
import os
import sys
import traceback
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import diff as D  # noqa: E402
import discover  # noqa: E402
import inbox  # noqa: E402
import profiles as P  # noqa: E402
import report  # noqa: E402
from normalize import ROOT, bf  # noqa: E402
from validate import validate  # noqa: E402

JST = timezone(timedelta(hours=9))


def _read(p):
    return open(p, encoding="utf-8").read() if os.path.exists(p) else None


class Backup:
    """変更するかもしれないファイルの元の内容を保存し、失敗時に戻す"""

    def __init__(self, root):
        pats = ["data-src/events/*.txt", "data/fights.js", "data/profiles.js", "data-src/sync/*.json",
                "data-src/sync/inbox/*"]
        self.files = {p: _read(p) for pat in pats for p in glob.glob(os.path.join(root, pat))}
        self.root = root

    def restore(self):
        for p, c in self.files.items():
            if c is not None:
                open(p, "w", encoding="utf-8").write(c)
        for pat in ["data-src/events/*.txt", "data-src/sync/*.json"]:
            for p in glob.glob(os.path.join(self.root, pat)):
                if p not in self.files:
                    os.remove(p)


def load_json(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return default


def dump_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n"
    if _read(path) != txt:
        open(path, "w", encoding="utf-8").write(txt)


def years_of(mode, today):
    y = int(today[:4])
    return [y - 1, y] if mode == "current+previous" else [y]


def run(root=ROOT, out="sync-out", fetch=discover.http_get, now=None, profiles_enabled=True):
    now = now or datetime.now(JST)
    today = now.astimezone(JST).date().isoformat()
    started = now.astimezone(JST).isoformat(timespec="seconds")
    cfg = load_json(os.path.join(root, "tools", "sync", "sources.json"), {})
    sync_dir = os.path.join(root, "data-src", "sync")
    ignore = set(load_json(os.path.join(sync_dir, "ignore.json"), []))
    R = {"started": started, "status": "成功", "errors": [], "warnings": [], "sources": [], "added_events": [],
         "inbox_events": {}, "inbox_sns": {}, "diff": {}, "rizin_recent": [], "profile": {}, "review": [],
         "watch": cfg.get("watchUrls", [])}
    bk = Backup(root)
    try:
        errs, warns, built = validate(root)
        R["warnings"] += warns
        if errs:
            R["status"] = "失敗"
            R["errors"] += ["既存データの検証エラー: " + e for e in errs]
            return finish(R, out, root, changed=False)

        # ---- 承認済みデータ ----
        R["inbox_events"] = inbox.import_events(root, built, today)
        if R["inbox_events"]["imported"]:
            built = bf.build(root, write=False, verbose=False)

        # ---- Wikipedia ----
        allsrc, merged = [], {k: [] for k in ("new_events", "corrections", "fills", "missing_bouts", "duplicates",
                                               "source_only_ours", "fighters_new", "fighters_review")}
        for y in years_of(cfg.get("years", "current+previous"), today):
            src = {"name": f"Wikipedia {y} in Rizin Fighting Federation", "url": discover.wiki_page_url(y),
                   "fetched": datetime.now(JST).isoformat(timespec="seconds")}
            try:
                page = discover.fetch_wiki_year(y, fetch)
                evs = discover.parse_year(page["wikitext"], y)
                src.update(status="取得成功", detail=f"版 {page['revid']}・大会 {len(evs)} 件")
                r = D.compare(evs, built, today, page["url"])
                for k in merged:
                    merged[k] += r[k]
            except Exception as e:  # noqa: BLE001
                src.update(status="取得失敗", detail=str(e)[:300])
                R["errors"].append(f"{src['name']}: {e}")
            R["sources"].append(src)
        R["diff"] = merged
        add_by_year = {}
        for ev in merged["new_events"]:
            if ev["safe"] and ev["id"] not in ignore:
                add_by_year.setdefault(ev["date"][:4], []).extend(ev["lines"])
                R["added_events"].append(ev)
        for y, lines in sorted(add_by_year.items()):
            inbox.append_event_lines(root, y, lines)

        # ---- RIZIN公式（URL検知のみ） ----
        src = {"name": "RIZIN公式 サイトマップ", "url": "https://jp.rizinff.com/sitemap-index.xml",
               "fetched": datetime.now(JST).isoformat(timespec="seconds")}
        try:
            R["rizin_recent"] = discover.rizin_recent_urls(fetch, now.astimezone(timezone.utc), cfg.get("rizinRecentDays", 8))
            src.update(status="取得成功（URLのみ）", detail=f"直近{cfg.get('rizinRecentDays', 8)}日の新着・更新 {len(R['rizin_recent'])} 件")
        except Exception as e:  # noqa: BLE001
            src.update(status="取得失敗", detail=str(e)[:300])
            R["errors"].append(f"RIZIN公式サイトマップ: {e}")
        R["sources"].append(src)

        # ---- プロフィール・SNS ----
        state_path = os.path.join(sync_dir, "profile-sources.json")
        state = load_json(state_path, {"fighters": {}, "history": []})
        if profiles_enabled:
            src = {"name": "Wikidata", "url": "https://www.wikidata.org/", "fetched": datetime.now(JST).isoformat(timespec="seconds")}
            try:
                js = P.load_js_data(root)
                cands, unres, perr = P.check_profiles(built["people"], js, state, cfg.get("wikidataPins", {}), today, fetch)
                R["profile"] = {"candidates": cands, "unresolved": unres}
                src.update(status="取得成功" if not perr else "一部失敗", detail=f"候補 {len(cands)} 件・Q番号未確定 {len(unres)} 人")
                R["errors"] += perr
                R["inbox_sns"] = inbox.import_sns(root, built["people"], js["sns"], state, today)
            except Exception as e:  # noqa: BLE001
                src.update(status="取得失敗", detail=str(e)[:300])
                R["errors"].append(f"Wikidata: {e}")
            R["sources"].append(src)
        dump_json(state_path, state)

        # ---- 要確認リスト（内容が同じなら書き換えない＝PRも作られない） ----
        rv = []
        for ev in merged["new_events"]:
            if not ev["safe"]:
                rv.append({"id": ev["id"], "type": "新規大会（要確認）", "event": ev["name"], "date": ev["date"],
                           "detail": " / ".join(ev["reasons"]), "lines": ev["lines"], "source": ev["source"]})
        for c in merged["corrections"]:
            rv.append({"id": c["id"], "type": "試合結果の訂正候補", "event": c["event"], "date": c["date"],
                       "detail": f"{c['bout']}：{c['field']} 既存「{c['ours']}」→ 外部「{c['source']}」", "source": c["url"]})
        for c in merged["fills"]:
            rv.append({"id": c["id"], "type": "空欄の補完候補", "event": c["event"], "date": c["date"],
                       "detail": f"{c['bout']}：{c['field']} 「{c['source']}」", "source": c["url"]})
        for c in merged["missing_bouts"]:
            rv.append({"id": c["id"], "type": "既存大会に未登録の試合", "event": c["event"], "date": c["date"],
                       "detail": c["line"], "source": c["url"]})
        for c in merged["fighters_review"]:
            rv.append({"id": c["id"], "type": "選手名の照合（要確認）", "event": c["event"], "date": c["date"],
                       "detail": f"{c['name']}（{c['status']}）≒ {', '.join(c['candidates'])}"})
        for c in R["profile"].get("candidates", []):
            rv.append({"id": c["id"], "type": {"sns_new": "SNS 新規候補", "sns_change": "SNS 変更候補",
                                                "profile_fill": "プロフィール補完候補", "profile_change": "プロフィール変更候補"}[c["type"]],
                       "key": c["key"], "detail": f"{c['field']}：既存「{c['ours'] or '（なし）'}」→ 候補「{c['source_value']}」　{c['note']}",
                       "source": c["source"]})
        uniq = {}
        for x in rv:
            if x["id"] not in ignore:
                uniq[x["id"]] = x
        R["review"] = sorted(uniq.values(), key=lambda x: (x["type"], x.get("date", ""), x.get("event", ""), x.get("key", ""), x["detail"]))
        dump_json(os.path.join(sync_dir, "review.json"), R["review"])

        # ---- 再生成と事後検証 ----
        if add_by_year or R["inbox_events"].get("imported"):
            bf.build(root, write=True, verbose=False)
        errs2, _w, _b = validate(root)
        if errs2:
            bk.restore()
            R["status"] = "失敗"
            R["errors"] += ["反映後の検証エラーのため変更を取り消しました: " + e for e in errs2]
            R["added_events"] = []
            return finish(R, out, root, changed=False)
        if R["errors"]:
            R["status"] = "一部失敗"
        elif R["review"]:
            R["status"] = "要確認"
        return finish(R, out, root, changed=None)
    except Exception as e:  # noqa: BLE001
        bk.restore()
        R["status"] = "失敗"
        R["errors"].append(f"予期しないエラーのため変更を取り消しました: {e}")
        R["errors"].append(traceback.format_exc()[-1500:])
        return finish(R, out, root, changed=False)


def finish(R, out, root, changed):
    R["finished"] = datetime.now(JST).isoformat(timespec="seconds")
    os.makedirs(out, exist_ok=True)
    md = report.render(R)
    open(os.path.join(out, "report.md"), "w", encoding="utf-8").write(md)
    json.dump(report.summary(R), open(os.path.join(out, "summary.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8").write(md + "\n")
    print(md[:3000])
    return 1 if R["status"] == "失敗" else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="sync-out")
    ap.add_argument("--root", default=ROOT)
    ap.add_argument("--no-profiles", action="store_true")
    a = ap.parse_args()
    sys.exit(run(a.root, a.out, profiles_enabled=not a.no_profiles))
