"""週次データ更新のテスト。

  python3 -m unittest discover -s tools/sync/tests -v

外部サイトには一切アクセスしない（取得関数を差し替える）。
本番ファイルを書き換えるテストは、リポジトリを一時ディレクトリに複製してその中で実行する。
最後に本番ファイルが変わっていないことも確認する。
"""
import glob
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import diff as D  # noqa: E402
import discover  # noqa: E402
import inbox  # noqa: E402
import profiles as P  # noqa: E402
import run as RUN  # noqa: E402
from match_fighters import FighterIndex  # noqa: E402
from normalize import ROOT, bf, event_name, fighter, method, parse_date, strip_wiki, weight_class  # noqa: E402
from validate import validate  # noqa: E402

FX = os.path.join(HERE, "fixtures")
SAMPLE = open(os.path.join(FX, "year_sample.wikitext"), encoding="utf-8").read()
PROD_FILES = ["data/fights.js", "data/profiles.js", "data/fighters.js"] + sorted(glob.glob(os.path.join(ROOT, "data-src", "events", "*.txt")))
NOW = datetime.fromisoformat("2026-10-19T05:00:00+09:00")


def digest(root, files):
    h = hashlib.sha1()
    for f in files:
        p = f if os.path.isabs(f) else os.path.join(root, f)
        h.update(open(p, "rb").read())
    return h.hexdigest()


PROD_DIGEST = digest(ROOT, PROD_FILES)


def copy_repo():
    tmp = tempfile.mkdtemp(prefix="fb-sync-")
    for d in ("data", "data-src", "js", "tools"):
        shutil.copytree(os.path.join(ROOT, d), os.path.join(tmp, d))
    return tmp


def fake_fetch(wikitext=SAMPLE, fail=None):
    def fetch(url):
        if fail and fail in url:
            raise discover.FetchError("simulated outage: " + url)
        if "wikipedia.org" in url:
            if "2026" in url:
                return json.dumps({"parse": {"revid": 1, "wikitext": wikitext}})
            return json.dumps({"parse": {"revid": 1, "wikitext": "==References=="}})
        if "sitemap-index" in url:
            return "<sitemapindex><sitemap><loc>https://jp.rizinff.com/sitemap-contents-9.xml</loc></sitemap></sitemapindex>"
        if "sitemap-contents" in url:
            return ("<urlset><url><loc>https://jp.rizinff.com/_ct/1</loc><lastmod>2026-10-17T12:00:00+09:00</lastmod></url>"
                    "<url><loc>https://jp.rizinff.com/_ct/0</loc><lastmod>2026-01-01T12:00:00+09:00</lastmod></url></urlset>")
        if "wbsearchentities" in url:
            if "Horiguchi" in url:
                return json.dumps({"search": [{"id": "Q6451952", "label": "Kyoji Horiguchi", "description": "Japanese mixed martial artist"}]})
            return json.dumps({"search": []})
        if "wbgetentities" in url:
            if "Q6451952" in url:
                return open(os.path.join(FX, "wd_horiguchi.json"), encoding="utf-8").read()
            return json.dumps({"entities": {"Q17": {"labels": {"ja": {"value": "日本"}}}}})
        raise AssertionError("unexpected url " + url)
    return fetch


# ---------------------------------------------------------------- 正規化
class TestNormalize(unittest.TestCase):
    def test_strip_and_fighter(self):
        self.assertEqual(strip_wiki("[[Naoki Inoue|Inoue]]<ref>x</ref> '''a'''"), "Inoue a")
        self.assertEqual(fighter("{{flagicon|JPN}} [[Naoki Inoue]] (c) "), ("Naoki Inoue", "JPN"))
        self.assertEqual(fighter("Kyouma Akimoto")[0], "Kyoma Akimoto")          # 既存の表記ゆれ辞書を再利用

    def test_fields(self):
        self.assertEqual(weight_class("Women's Strawweight 52&nbsp;kg"), "Female Strawweight 52 kg")
        self.assertEqual(method("Decision (unanimous) (29–28, 29–28, 29–28)"), "Decision (unanimous)")
        self.assertEqual(parse_date("{{dts|2026|Oct|3}}"), "2026-10-03")
        self.assertEqual(parse_date("{{dts|2026|03|07}}"), "2026-03-07")
        self.assertEqual(parse_date("March 7, 2026"), "2026-03-07")
        self.assertEqual(parse_date("{{dts|2026|02|30}}"), "")
        self.assertEqual(event_name("Rizin Landmark 16 in Nagasaki"), "Rizin Landmark 16")
        self.assertEqual(event_name("Super Rizin 5: Naniwa No Chou Fukkatsu Matsuri"), "Super Rizin 5")


# ---------------------------------------------------------------- 解析
class TestParse(unittest.TestCase):
    def setUp(self):
        self.events = {e["name"]: e for e in discover.parse_year(SAMPLE, 2026)}

    def test_template_format(self):
        e = self.events["Rizin 99"]
        self.assertEqual(e["date"], "2026-10-10")
        mma = [b for b in e["bouts"] if not b["kind"]]
        self.assertEqual([b["res"] for b in mma], ["W", "W", "D"])            # 予定カード（vs. 結果なし）は除外
        self.assertEqual(mma[0]["note"], "For the Rizin Featherweight Championship.")
        self.assertEqual(mma[1]["wc"], "Female Strawweight")
        kick = [b for b in e["bouts"] if b["kind"]]
        self.assertEqual([b["kind"] for b in kick], ["KICK"])                  # MMAとキックを混同しない

    def test_wikitable_format(self):
        e = self.events["Rizin 98"]
        self.assertEqual(e["date"], "2026-10-11")
        self.assertEqual([(b["a"], b["ca"], b["res"], b["round"], b["time"]) for b in e["bouts"]],
                         [("Kyomma Akimoto", "JPN", "W", "2", "1:11"), ("Yoshinori Horie", "JPN", "NC", "1", "0:45")])

    def test_rizin_sitemap_recent_only(self):
        r = discover.rizin_recent_urls(fake_fetch(), NOW, 8)
        self.assertEqual([x["url"] for x in r], ["https://jp.rizinff.com/_ct/1"])


# ---------------------------------------------------------------- 選手照合
class TestMatch(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.built = bf.build(ROOT, write=False, verbose=False)
        cls.idx = FighterIndex(cls.built["people"])

    def test_statuses(self):
        self.assertEqual(self.idx.match("Kyoji Horiguchi")[:2], ("known", "kyoji-horiguchi"))
        self.assertEqual(self.idx.match("Makoto Takahashi")[:2], ("known", "shinryu"))      # 既存の key を維持
        self.assertEqual(self.idx.match("Horiguchi Kyoji")[0], "variant")                    # 語順違いは要確認
        self.assertEqual(self.idx.match("Kyomma Akimoto")[0], "similar")                     # 綴りが近いと要確認
        self.assertEqual(self.idx.match("Testo Newman")[0], "new")

    def test_same_name_other_person(self):
        # 同名でも性別区分が違えば別人の可能性 → 統合しない
        self.assertEqual(self.idx.match("Kyoji Horiguchi", female=True)[0], "conflict")


# ---------------------------------------------------------------- 差分
class TestDiff(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.built = bf.build(ROOT, write=False, verbose=False)
        cls.r = D.compare(discover.parse_year(SAMPLE, 2026), cls.built, "2026-10-19", "test")

    def test_new_event_safe(self):
        ev = {e["name"]: e for e in self.r["new_events"]}
        self.assertTrue(ev["Rizin 99"]["safe"])
        self.assertEqual(ev["Rizin 99"]["lines"][0],
                         "Rizin 99|2026-10-10|Featherweight|JPN Kyoji Horiguchi|Testo Newman|W|TKO (punches)|1|2:00|For the Rizin Featherweight Championship.")
        self.assertTrue(any(l.split("|")[2].startswith("KICK ") for l in ev["Rizin 99"]["lines"]))

    def test_ambiguous_event_goes_to_review(self):
        ev = {e["name"]: e for e in self.r["new_events"]}
        self.assertFalse(ev["Rizin 98"]["safe"])
        self.assertTrue(any("Kyomma Akimoto" in x for x in ev["Rizin 98"]["reasons"]))

    def test_future_event_ignored(self):
        self.assertNotIn("Rizin 100", [e["name"] for e in self.r["new_events"]])

    def test_correction_detected_not_new(self):
        self.assertNotIn("Rizin 53", [e["name"] for e in self.r["new_events"]])
        fx = [c for c in self.r["corrections"] if c["event"] == "Rizin 53"]
        self.assertEqual([(c["field"], c["ours"], c["source"]) for c in fx], [("R", "1", "2")])

    def test_duplicate_under_other_name(self):
        renamed = SAMPLE.replace("==Rizin 53==", "==Rizin Fifty Three==")
        r = D.compare(discover.parse_year(renamed, 2026), self.built, "2026-10-19")
        self.assertNotIn("Rizin Fifty Three", [e["name"] for e in r["new_events"] if e["safe"]])


# ---------------------------------------------------------------- 検証
class TestValidate(unittest.TestCase):
    def test_production_data_is_valid(self):
        errs, _w, _b = validate(ROOT)
        self.assertEqual(errs, [])

    def _bad(self, line=None, profiles_patch=None):
        tmp = copy_repo()
        try:
            if line:
                with open(os.path.join(tmp, "data-src", "events", "2026.txt"), "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            if profiles_patch:
                p = os.path.join(tmp, "data", "profiles.js")
                t = open(p, encoding="utf-8").read()
                open(p, "w", encoding="utf-8").write(t.replace(*profiles_patch, 1))
            return validate(tmp)[0]
        finally:
            shutil.rmtree(tmp)

    def test_duplicate_bout(self):
        errs = self._bad("Rizin 53|2026-05-10|Lightweight|BRA Luiz Gustavo|UZB Ilkhom Nozimov|W|KO (punches)|1|2:08|")
        self.assertTrue(any("二重登録" in e for e in errs))

    def test_result_method_mismatch(self):
        self.assertTrue(any("矛盾" in e for e in self._bad("Rizin 99|2026-10-10|Flyweight|A Aa|B Bb|W|Draw (split)|3|5:00|")))

    def test_bad_date(self):
        self.assertTrue(any("日付" in e for e in self._bad("Rizin 99|2026/10/10|Flyweight|A Aa|B Bb|W|KO|1|1:00|")))

    def test_unknown_key_and_bad_sns(self):
        errs = self._bad(profiles_patch=('"ayaka-hamasaki":{ youtube:"https://www.youtube.com/', '"no-such-key":{ youtube:"https://evil.example.com/'))
        self.assertTrue(any("存在しない選手キー" in e for e in errs))
        self.assertTrue(any("youtube のものではない" in e for e in errs))


# ---------------------------------------------------------------- 承認済みデータ
class TestInbox(unittest.TestCase):
    def test_events_inbox(self):
        tmp = copy_repo()
        try:
            open(os.path.join(tmp, "data-src", "sync", "inbox", "events.txt"), "w", encoding="utf-8").write(
                inbox.HEADER +
                "Rizin 97|2026-10-12|Flyweight|JPN Testa Uno|JPN Testa Due|W|KO (punch)|1|0:30|\n"
                "Rizin 53|2026-05-10|Lightweight|BRA Luiz Gustavo|UZB Ilkhom Nozimov|W|KO (punches)|1|2:08|\n"
                "bad line\n")
            built = bf.build(tmp, write=False, verbose=False)
            r = inbox.import_events(tmp, built, "2026-10-19")
            self.assertEqual((len(r["imported"]), len(r["duplicates"]), len(r["rejected"])), (1, 1, 1))
            self.assertIn("Testa Uno", open(os.path.join(tmp, "data-src", "events", "2026.txt"), encoding="utf-8").read())
            left = open(os.path.join(tmp, "data-src", "sync", "inbox", "events.txt"), encoding="utf-8").read()
            self.assertIn("bad line", left)
            self.assertNotIn("Testa Uno", left)
        finally:
            shutil.rmtree(tmp)

    def test_unverified_sns_not_registered(self):
        tmp = copy_repo()
        try:
            items = [{"key": "kyoji-horiguchi", "platform": "x", "url": "https://x.com/kyoji1012", "verified": False},
                     {"key": "kyoji-horiguchi", "platform": "instagram", "url": "https://www.instagram.com/kyoji1012/",
                      "verified": True, "evidence": "テスト"}]
            json.dump(items, open(os.path.join(tmp, "data-src", "sync", "inbox", "sns.json"), "w"))
            built = bf.build(tmp, write=False, verbose=False)
            js = P.load_js_data(tmp)
            state = {}
            r = inbox.import_sns(tmp, built["people"], js["sns"], state, "2026-10-19")
            self.assertEqual((len(r["applied"]), len(r["pending"])), (1, 1))
            js2 = P.load_js_data(tmp)
            self.assertEqual(js2["sns"]["kyoji-horiguchi"].get("instagram"), "https://www.instagram.com/kyoji1012/")
            self.assertNotIn("x", js2["sns"]["kyoji-horiguchi"])             # 未確認は登録しない
            self.assertEqual(len(js2["fighters"]), 18)                         # 名簿は変えない
            self.assertEqual(state["history"][0]["source"], "manual-approved")
        finally:
            shutil.rmtree(tmp)


# ---------------------------------------------------------------- プロフィール
class TestProfiles(unittest.TestCase):
    def test_resolve_only_unique_fighter(self):
        data = open(os.path.join(FX, "wds_takahashi.json"), encoding="utf-8").read()
        qid, _ = P.resolve("Makoto Takahashi", lambda u: data)                 # 同姓同名10人中、格闘家は1人
        self.assertEqual(qid, "Q96273479")
        two = json.dumps({"search": [{"id": "Q1", "label": "A B", "description": "mixed martial artist"},
                                     {"id": "Q2", "label": "A B", "description": "Brazilian MMA fighter"}]})
        self.assertIsNone(P.resolve("A B", lambda u: two)[0])                 # 2人いたら決めない

    def test_candidates_not_applied(self):
        built = bf.build(ROOT, write=False, verbose=False)
        js = P.load_js_data(ROOT)
        state = {}
        c, _u, errs = P.check_profiles(built["people"], js, state, {}, "2026-10-19", fake_fetch())
        self.assertEqual(errs, [])
        hk = {(x["type"], x["field"]) for x in c if x["key"] == "kyoji-horiguchi"}
        self.assertIn(("sns_new", "X"), hk)
        self.assertIn(("sns_new", "Instagram"), hk)
        self.assertEqual(state["fighters"]["kyoji-horiguchi"]["values"]["born"]["value"], "1990-10-12")
        self.assertEqual(digest(ROOT, PROD_FILES), PROD_DIGEST)               # 候補を出すだけで書き換えない


# ---------------------------------------------------------------- バッチ全体
class TestBatch(unittest.TestCase):
    def _run(self, tmp, **kw):
        out = os.path.join(tmp, "out")
        rc = RUN.run(root=tmp, out=out, fetch=kw.get("fetch", fake_fetch()), now=NOW)
        return rc, json.load(open(os.path.join(out, "summary.json"), encoding="utf-8"))

    def test_end_to_end_and_idempotent(self):
        tmp = copy_repo()
        try:
            before = node_probe(tmp, "kyoji-horiguchi")
            rc, s = self._run(tmp)
            self.assertEqual(rc, 0)
            self.assertEqual(s["new_events_added"], 1)
            self.assertEqual(s["new_bouts"], 3)
            self.assertEqual(s["corrections"], 1)
            ev = open(os.path.join(tmp, "data-src", "events", "2026.txt"), encoding="utf-8").read()
            self.assertIn("Rizin 99|2026-10-10", ev)
            self.assertNotIn("Rizin 98", ev)                                   # 要確認の大会は入れない
            self.assertNotIn("Rizin 100", ev)
            after = node_probe(tmp, "kyoji-horiguchi")                         # 既存の集計処理で戦績・Eloが更新される
            self.assertEqual(after["fighters"]["kyoji-horiguchi"]["riz"]["w"], before["fighters"]["kyoji-horiguchi"]["riz"]["w"] + 1)
            self.assertGreater(after["fighters"]["kyoji-horiguchi"]["rating"], before["fighters"]["kyoji-horiguchi"]["rating"])
            self.assertEqual(after["missingKeys"], 0)
            self.assertAlmostEqual(after["eloSum"], 0, places=6)
            files = PROD_FILES[:2] + ["data-src/sync/review.json", "data-src/sync/profile-sources.json"] + \
                sorted(glob.glob(os.path.join(tmp, "data-src", "events", "*.txt")))
            files = [f if os.path.isabs(f) else os.path.join(tmp, f) for f in files]
            d1 = digest(tmp, files)
            rc2, s2 = self._run(tmp)                                           # 2回目：同じデータなら何も変わらない
            self.assertEqual((rc2, s2["new_events_added"]), (0, 0))
            self.assertEqual(digest(tmp, files), d1)
        finally:
            shutil.rmtree(tmp)

    def test_fetch_failure_keeps_data(self):
        tmp = copy_repo()
        try:
            files = [os.path.join(tmp, f) for f in ("data/fights.js", "data-src/events/2026.txt", "data/profiles.js")]
            d0 = digest(tmp, files)
            rc, s = self._run(tmp, fetch=fake_fetch(fail="wikipedia.org"))
            self.assertEqual(rc, 0)
            self.assertEqual(s["status"], "一部失敗")
            self.assertEqual(digest(tmp, files), d0)
        finally:
            shutil.rmtree(tmp)

    def test_inconsistent_data_stops_safely(self):
        tmp = copy_repo()
        try:
            p = os.path.join(tmp, "data-src", "events", "2026.txt")
            with open(p, "a", encoding="utf-8") as f:
                f.write("Rizin 53|2026-05-10|Lightweight|BRA Luiz Gustavo|UZB Ilkhom Nozimov|W|KO (punches)|1|2:08|\n")
            files = [os.path.join(tmp, f) for f in ("data/fights.js", "data-src/events/2026.txt")]
            d0 = digest(tmp, files)
            rc, s = self._run(tmp)
            self.assertEqual(rc, 1)
            self.assertEqual(s["status"], "失敗")
            self.assertEqual(s["new_events_added"], 0)
            self.assertEqual(digest(tmp, files), d0)
        finally:
            shutil.rmtree(tmp)


def node_probe(root, *keys):
    out = subprocess.run(["node", os.path.join(HERE, "stats_probe.mjs"), root, *keys], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


class TestProductionUntouched(unittest.TestCase):
    def test_zz_production_files_unchanged(self):
        self.assertEqual(digest(ROOT, PROD_FILES), PROD_DIGEST)


if __name__ == "__main__":
    unittest.main()
