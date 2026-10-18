"""週次更新レポート（Actions の実行サマリー・PR 本文・artifact に使う Markdown と JSON）。"""


def summary(R):
    d = R.get("diff", {})
    p = R.get("profile", {})
    cands = p.get("candidates", [])
    ie = R.get("inbox_events", {}) or {}
    isn = R.get("inbox_sns", {}) or {}
    return {
        "started": R["started"], "finished": R.get("finished"), "status": R["status"],
        "new_bouts": sum(e["mma_bouts"] for e in R.get("added_events", [])) + len(ie.get("imported", [])),
        "new_events_added": len(R.get("added_events", [])),
        "new_events_review": sum(1 for e in d.get("new_events", []) if not e["safe"]),
        "corrections": len(d.get("corrections", [])),
        "fills": len(d.get("fills", [])),
        "missing_bouts": len(d.get("missing_bouts", [])),
        "profile_candidates": sum(1 for c in cands if c["type"].startswith("profile")),
        "sns_new": sum(1 for c in cands if c["type"] == "sns_new"),
        "sns_change": sum(1 for c in cands if c["type"] == "sns_change"),
        "sns_applied": len(isn.get("applied", [])),
        "duplicates": len(d.get("duplicates", [])) + len(ie.get("duplicates", [])),
        "errors": R.get("errors", []),
        "review_items": len(R.get("review", [])),
    }


def _t(s):
    return str(s if s not in (None, "") else "—").replace("|", "／").replace("\n", " ")


def render(R):
    s = summary(R)
    d = R.get("diff", {})
    L = [f"## FIGHT BOOK 週次データ更新レポート（{s['status']}）", ""]
    L += ["| 項目 | 内容 |", "|---|---|",
          f"| 実行日時 | 開始 {R['started']} ／ 終了 {R.get('finished', '')} |",
          f"| 実行結果 | **{s['status']}** |",
          f"| 新規試合 | {s['new_bouts']} 試合を追加（新規大会 {s['new_events_added']} 件）／要確認の新規大会 {s['new_events_review']} 件 |",
          f"| 試合結果変更 | 訂正候補 {s['corrections']} 件・空欄の補完候補 {s['fills']} 件・未登録の試合 {s['missing_bouts']} 件（自動では反映しない） |",
          f"| 選手プロフィール | 更新候補 {s['profile_candidates']} 件（自動では反映しない） |",
          f"| SNS | 新規候補 {s['sns_new']} 件・変更候補 {s['sns_change']} 件／本人確認済みの反映 {s['sns_applied']} 件 |",
          f"| 重複 | {s['duplicates']} 件を除外 |",
          f"| エラー | {len(s['errors'])} 件 |", ""]
    L += ["### データ取得元", "", "| 取得元 | URL | 取得日時 | 状態 |", "|---|---|---|---|"]
    for x in R.get("sources", []):
        L.append(f"| {_t(x['name'])} | {_t(x['url'])} | {_t(x.get('fetched'))} | {_t(x['status'])}：{_t(x.get('detail'))} |")
    L.append("| Sherdog / Tapology / 選手SNS | — | — | 利用規約・API の都合で自動取得していません（手動確認） |")
    L.append("")
    if R.get("errors"):
        L += ["### エラー", ""] + [f"- {_t(e)}" for e in R["errors"]] + [""]
    if R.get("added_events"):
        L += ["### 追加した大会（PR で確認してください）", ""]
        for e in R["added_events"]:
            L += [f"**{e['name']}**（{e['date']}・MMA {e['mma_bouts']} 試合）　出典: {e['source']}", "", "```"] + e["lines"] + ["```", ""]
    fn = [f for f in d.get("fighters_new", []) if any(f["first_event"] == e["name"] for e in R.get("added_events", []))]
    if fn:
        L += ["### 新しく登録される選手", ""] + [f"- {f['name']}（key: `{f['key']}`）初出場 {f['first_event']}" for f in fn] + [""]
    ie = R.get("inbox_events") or {}
    if any(ie.get(k) for k in ("imported", "rejected", "duplicates")):
        L += ["### 承認済みデータ（inbox/events.txt）", "",
              f"- 取り込み {len(ie.get('imported', []))} 行・重複で除外 {len(ie.get('duplicates', []))} 行・不備で保留 {len(ie.get('rejected', []))} 行"]
        L += [f"  - 保留（{r['line']}行目）: {_t(r['reason'])} … `{r['text']}`" for r in ie.get("rejected", [])] + [""]
    isn = R.get("inbox_sns") or {}
    if any(isn.get(k) for k in ("applied", "pending", "rejected")):
        L += ["### 本人確認済みSNS（inbox/sns.json）", "",
              f"- 反映 {len(isn.get('applied', []))} 件・本人確認待ち {len(isn.get('pending', []))} 件・不備 {len(isn.get('rejected', []))} 件", ""]
    rv = R.get("review", [])
    if rv:
        L += [f"### 要確認リスト（{len(rv)} 件・`data-src/sync/review.json`）", "",
              "自動では反映していません。正しいと確認できたものは `data-src/events/` などを手で直すか、`data-src/sync/inbox/` に書いてください。",
              "対応不要なものは ID を `data-src/sync/ignore.json` に追加すると次回から表示されません。", "",
              "| ID | 種類 | 大会・選手 | 内容 | 出典 |", "|---|---|---|---|---|"]
        for x in rv[:200]:
            who = f"{x.get('event', '')} {x.get('date', '')}".strip() or x.get("key", "")
            L.append(f"| `{x['id']}` | {_t(x['type'])} | {_t(who)} | {_t(x['detail'])} | {_t(x.get('source'))} |")
        if len(rv) > 200:
            L.append(f"| … | 他 {len(rv) - 200} 件は review.json を参照 | | | |")
        L.append("")
    un = (R.get("profile") or {}).get("unresolved", [])
    if un:
        L += [f"<details><summary>Wikidata の項目を特定できなかった選手（{len(un)} 人・同姓同名防止のため照合しない）</summary>", ""]
        L += [f"- {u['key']}（{u['name']}）候補: {', '.join(u['candidates']) or 'なし'}" for u in un]
        L += ["", "sources.json の `wikidataPins` に `\"key\": \"Q番号\"` を書くと固定できます。", "</details>", ""]
    if R.get("rizin_recent"):
        L += [f"<details><summary>RIZIN公式の新着・更新記事（{len(R['rizin_recent'])} 件・手動確認用）</summary>", ""]
        L += [f"- {x['lastmod'][:16].replace('T', ' ')}　{x['url']}" for x in R["rizin_recent"][:60]] + ["", "</details>", ""]
    if R.get("watch"):
        L += ["<details><summary>手動確認URL</summary>", ""]
        L += [f"- {w['note']}：{w['url']}（前回確認: {w.get('lastManualCheck') or '未記録'}）" for w in R["watch"]] + ["", "</details>", ""]
    if d.get("source_only_ours"):
        L += [f"<details><summary>既存データにあって外部データに無い試合（{len(d['source_only_ours'])} 件・参考）</summary>", ""]
        L += [f"- {x['event']} {x['date']}：{x['bout']}" for x in d["source_only_ours"]] + ["", "</details>", ""]
    if R.get("warnings"):
        L += [f"<details><summary>検証の警告（{len(R['warnings'])} 件）</summary>", ""] + [f"- {_t(w)}" for w in R["warnings"]] + ["", "</details>", ""]
    return "\n".join(L)
