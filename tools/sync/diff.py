"""外部データ（Wikipedia の大会結果）と既存データ（data-src/events）の照合・分類。

分類
  new_events       … 既存に無い大会。曖昧な点が無ければ「自動追加可」、あれば「要確認」
  corrections      … 既存試合と結果・決着方法・R・時間・日付が食い違う → 訂正候補（自動では直さない）
  fills            … 既存試合で空欄の R・時間が外部データにある → 補完候補（自動では直さない）
  missing_bouts    … 既存大会に登録されていない試合 → 追加候補（要確認）
  duplicates       … 別名・別日付で既に登録済みの試合 → 除外
  source_only_ours … 既存にあって外部データに無い試合 → 参考
試合の照合キー：大会識別子（正規化した大会名）＋日付（±3日）＋両選手（表記ゆれ吸収）
"""
import hashlib
from datetime import date

from match_fighters import FighterIndex, new_key
from normalize import bf, event_key, name_key

FEMALE_WORDS = ("female", "women")


def rid(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def d2o(s):
    try:
        return date.fromisoformat(s).toordinal()
    except Exception:  # noqa: BLE001
        return 0


def pair(a, b):
    return frozenset((name_key(a), name_key(b)))


def existing_index(built):
    """build_fights.build() の結果から、大会ファイル由来の試合（wc あり）を大会ごとにまとめる"""
    events = {}
    for x in built["bouts"]:
        if not x["wc"]:
            continue
        k = (event_key(x["event"]), x["date"])
        events.setdefault(k, {"name": x["event"], "date": x["date"], "bouts": []})["bouts"].append(x)
    return events


def find_event(ev, ex_events):
    ek, o = event_key(ev["name"]), d2o(ev["date"])
    for (k, d), e in ex_events.items():
        if k == ek and abs(d2o(d) - o) <= 3:
            return e
    # 大会名が違っても、同じ日付で試合の半分以上が一致すれば同一大会
    ps = {pair(b["a"], b["b"]) for b in ev["bouts"] if not b["kind"]}
    for (k, d), e in ex_events.items():
        if abs(d2o(d) - o) <= 1 and ps:
            eps = {pair(b["a"], b["b"]) for b in e["bouts"]}
            if len(ps & eps) >= max(1, len(ps) // 2):
                return e
    return None


def find_bout_anywhere(b, dt, built):
    p, o = pair(b["a"], b["b"]), d2o(dt)
    for x in built["bouts"]:
        if pair(x["a"], x["b"]) == p and abs(d2o(x["date"]) - o) <= 3:
            return x
    return None


def _line(ev_name, dt, b, idx):
    """data-src/events の1行（既存形式：大会|日付|階級|国 勝者|国 敗者|結果|決着|R|時間|メモ）"""
    ca = b["ca"] or idx.country(b["a"])
    cb = b["cb"] or idx.country(b["b"])
    wc = (b["kind"] + " " if b["kind"] else "") + b["wc"]
    a = (ca + " " if ca else "") + b["a"]
    bb = (cb + " " if cb else "") + b["b"]
    return "|".join([ev_name, dt, wc, a, bb, b["res"], b["method"], b["round"], b["time"], b["note"]])


def compare(src_events, built, today, source_url=""):
    idx = FighterIndex(built["people"])
    ex_events = existing_index(built)
    out = {"new_events": [], "corrections": [], "fills": [], "missing_bouts": [], "duplicates": [],
           "source_only_ours": [], "fighters_new": [], "fighters_review": []}
    seen_new_fighters = {}
    for ev in src_events:
        mma = [b for b in ev["bouts"] if not b["kind"]]
        if not ev["date"] or not mma:
            continue
        if d2o(ev["date"]) >= d2o(today):          # 当日・未来の大会は結果が確定していない可能性があるため対象外
            continue
        ex = find_event(ev, ex_events)
        if ex is None:
            reasons, lines, dups = [], [], []
            pairs_seen = set()
            for b in ev["bouts"]:
                if not b["kind"]:
                    p = pair(b["a"], b["b"])
                    if p in pairs_seen:
                        reasons.append(f"同じ大会内で同じ組み合わせが2回: {b['a']} vs {b['b']}")
                    pairs_seen.add(p)
                    hit = find_bout_anywhere(b, ev["date"], built)
                    if hit:
                        dups.append({"date": ev["date"], "event": ev["name"], "a": b["a"], "b": b["b"],
                                     "existing_event": hit["event"], "existing_date": hit["date"]})
                        continue
                    female = any(w in b["wc"].lower() for w in FEMALE_WORDS)
                    for nm in (b["a"], b["b"]):
                        st, k, cands = idx.match(nm, female)
                        if st == "new":
                            seen_new_fighters.setdefault(nm, {"name": nm, "key": new_key(nm, built["people"]),
                                                              "first_event": ev["name"], "date": ev["date"]})
                        elif st != "known":
                            reasons.append(f"選手名の照合が曖昧（{st}）: {nm} ≒ {', '.join(cands)}")
                            out["fighters_review"].append({"id": rid("fighter", nm, st), "name": nm, "status": st,
                                                           "candidates": cands, "event": ev["name"], "date": ev["date"]})
                lines.append(_line(ev["name"], ev["date"], b, idx))
            out["duplicates"] += dups
            if dups and len(dups) >= max(1, len(mma) // 2):
                reasons.append("試合の半数以上が別の大会名・日付で登録済み（大会名・日付の違いの可能性）")
            out["new_events"].append({"id": rid("event", event_key(ev["name"]), ev["date"]), "name": ev["name"],
                                      "date": ev["date"], "mma_bouts": len(mma) - len(dups), "lines": lines,
                                      "safe": not reasons, "reasons": sorted(set(reasons)), "source": source_url})
            continue
        # 既存の大会：試合ごとに比較
        ex_by_pair = {pair(x["a"], x["b"]): x for x in ex["bouts"]}
        matched = set()
        if ex["date"] != ev["date"]:
            out["corrections"].append({"id": rid("date", event_key(ev["name"]), ev["date"]), "event": ex["name"],
                                       "date": ex["date"], "bout": "（大会）", "field": "日付",
                                       "ours": ex["date"], "source": ev["date"], "url": source_url})
        for b in mma:
            p = pair(b["a"], b["b"])
            x = ex_by_pair.get(p)
            if not x:
                hit = find_bout_anywhere(b, ev["date"], built)
                if hit:
                    out["duplicates"].append({"date": ev["date"], "event": ev["name"], "a": b["a"], "b": b["b"],
                                              "existing_event": hit["event"], "existing_date": hit["date"]})
                else:
                    out["missing_bouts"].append({"id": rid("missing", event_key(ev["name"]), p and sorted(p)),
                                                 "event": ex["name"], "date": ex["date"],
                                                 "line": _line(ex["name"], ex["date"], b, idx), "url": source_url})
                continue
            matched.add(p)
            label = f"{b['a']} vs {b['b']}"
            diffs = []
            if b["res"] != x["outcome"]:
                diffs.append(("結果", x["outcome"], b["res"]))
            elif b["res"] == "W" and name_key(b["a"]) != name_key(x["a"]):
                diffs.append(("勝者", x["a"], b["a"]))
            if b["res"] == "W" and x["outcome"] == "W" and bf.method_cat(b["method"]) != bf.method_cat(x["method"]):
                diffs.append(("決着方法", x["method"], b["method"]))
            for f, ours, src in (("R", x["round"], b["round"]), ("時間", x["time"], b["time"])):
                if ours and src and ours != src:
                    diffs.append((f, ours, src))
                elif not ours and src:
                    out["fills"].append({"id": rid("fill", event_key(ex["name"]), sorted(p), f, src), "event": ex["name"],
                                         "date": ex["date"], "bout": label, "field": f, "source": src, "url": source_url})
            for f, ours, src in diffs:
                out["corrections"].append({"id": rid("fix", event_key(ex["name"]), sorted(p), f, src), "event": ex["name"],
                                           "date": ex["date"], "bout": label, "field": f, "ours": ours,
                                           "source": src, "url": source_url})
        for p, x in ex_by_pair.items():
            if p not in matched and not x["wc"].upper().startswith(("KICK", "BOX", "EXH")):
                out["source_only_ours"].append({"event": ex["name"], "date": ex["date"], "bout": f"{x['a']} vs {x['b']}"})
    out["fighters_new"] = sorted(seen_new_fighters.values(), key=lambda r: r["name"])
    return out
