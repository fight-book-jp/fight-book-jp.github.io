"""ジムデータのテスト：python3 -m unittest discover -s tools/gyms -p 'test_*.py'"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parse import current_and_history, split_entries  # noqa: E402
import build  # noqa: E402


class TestParse(unittest.TestCase):
    def test_years_and_present(self):
        es = current_and_history(split_entries("KRAZY BEE (2009–2015)<ref>x</ref><br />[[American Top Team]] (2015–present)", "en"), "en")
        self.assertEqual([(e["name"], e["from"], e["to"], e["current"]) for e in es],
                         [("KRAZY BEE", 2009, 2015, False), ("American Top Team", 2015, None, True)])

    def test_ja_chain_last_is_current_and_free_removed(self):
        es = current_and_history(split_entries("[[パラエストラ|パラエストラ松戸]]<br />→フリー<br />→神龍ワールドジム/[[アメリカン・トップチーム]]", "ja"), "ja")
        self.assertEqual([(e["name"], e["current"]) for e in es],
                         [("パラエストラ松戸", False), ("神龍ワールドジム", True), ("アメリカン・トップチーム", True)])

    def test_unknown_current_not_guessed(self):
        es = current_and_history(split_entries("A Gym <br /> B Gym", "en"), "en")
        self.assertTrue(all(e["current"] is None for e in es))   # 複数で期間なし → 現所属を決めない


class TestBuild(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gyms, cls.affil = build.build()

    def test_aliases_merge_and_no_duplicates(self):
        names = {}
        for gid, g in self.gyms.items():
            k = build.nk(g["name"])
            self.assertNotIn(k, names, f"同じ名前のジムが2つ: {g['name']} ({gid}, {names.get(k)})")
            names[k] = gid
        self.assertIn("american-top-team", self.gyms)
        self.assertNotIn(build.nk("American Top Team"), {build.nk(g["name"]) for i, g in self.gyms.items() if i != "american-top-team"})

    def test_every_affiliation_points_to_gym(self):
        for k, rows in self.affil.items():
            for r in rows:
                self.assertIn(r["g"], self.gyms)
                self.assertIn(r["cur"], (True, False, None))

    def test_sources_recorded(self):
        for k, rows in self.affil.items():
            for r in rows:
                self.assertTrue(r["via"] in ("ja", "en", "roster", "manual"))
                if r["via"] in ("ja", "en"):
                    self.assertTrue(r["src"].startswith("https://"))


if __name__ == "__main__":
    unittest.main()
