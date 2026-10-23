"""schema.sql の動作テスト（本物の PostgreSQL に Supabase の auth を模した最小限を作って実行）

  PGDSN="postgresql://postgres@localhost/postgres" python3 supabase/tests/test_schema.py
"""
import json
import os
import sys
import threading
import time
import unittest
import uuid

import psycopg2
import psycopg2.errors

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = open(os.path.join(HERE, "..", "schema.sql"), encoding="utf-8").read()
ADMIN_DSN = os.environ.get("PGDSN", "postgresql://postgres@localhost/postgres")
DB = "fb_community_test"

AUTH_MOCK = """
create extension if not exists pgcrypto;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, raw_user_meta_data jsonb);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
"""


def dsn(db):
    return ADMIN_DSN.rsplit("/", 1)[0] + "/" + db


class Base(unittest.TestCase):
    su = None

    @classmethod
    def setUpClass(cls):
        if Base.su is not None:
            return
        c = psycopg2.connect(ADMIN_DSN); c.autocommit = True
        cur = c.cursor()
        cur.execute(f"drop database if exists {DB}"); cur.execute(f"create database {DB}")
        c.close()
        Base.su = psycopg2.connect(dsn(DB)); Base.su.autocommit = True
        Base.su.cursor().execute(AUTH_MOCK)
        Base.su.cursor().execute(SCHEMA)
        Base.su.cursor().execute(SCHEMA)          # 2 回流しても壊れないこと

    def setUp(self):
        self.su.cursor().execute("truncate public.cards, public.reactions, public.want_first, public.comments, public.saves, "
                                 "public.reports, public.events, public.themes, public.fighter_requests, public.contacts, public.fight_events, public.profiles, auth.users cascade")

    # --- ヘルパー ---
    def user(self, name="ファン", admin=False):
        uid = str(uuid.uuid4())
        self.su.cursor().execute("insert into auth.users values (%s, %s)",
                                 (uid, json.dumps({"name": name, "user_name": name.lower(), "avatar_url": "https://example.invalid/a.png"})))
        if admin:
            self.su.cursor().execute("update public.profiles set is_admin = true where id = %s", (uid,))
        return uid

    def call(self, uid, fn, *args):
        """uid=None なら未ログイン（anon）として関数を呼ぶ"""
        c = psycopg2.connect(dsn(DB)); c.autocommit = True
        try:
            cur = c.cursor()
            cur.execute("set role " + ("authenticated" if uid else "anon"))
            cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or "",))
            ph = ",".join(["%s"] * len(args))
            cur.execute(f"select public.{fn}({ph})", args)
            return cur.fetchone()[0]
        finally:
            c.close()

    def err(self, uid, fn, *args):
        with self.assertRaises(psycopg2.Error) as cm:
            self.call(uid, fn, *args)
        return str(cm.exception)

    def card(self, cid):
        cur = self.su.cursor(); cur.execute("select want_count, fun_count, comment_count, status, creator from public.cards where id=%s", (cid,))
        return cur.fetchone()

    def age_wants(self, cid, hours):
        self.su.cursor().execute("update public.want_first set first_at = now() - make_interval(hours => %s) where card_id=%s", (hours, cid))


class Cards(Base):
    def test_duplicate_is_merged_regardless_of_order(self):
        u, v = self.user("A"), self.user("B")
        c1 = self.call(u, "create_card", "kyoji-horiguchi", "asakura", "mma", "standard", "見たい", "why", False)
        c2 = self.call(v, "create_card", "asakura", "kyoji-horiguchi", "mma", "standard", None, None, False)
        self.assertFalse(c1["existed"]); self.assertTrue(c2["existed"]); self.assertEqual(c1["id"], c2["id"])
        self.assertEqual(c1["fa"], "asakura")                     # 並び替えて保存
        c3 = self.call(v, "create_card", "asakura", "kyoji-horiguchi", "kickboxing", "standard", None, None, False)
        self.assertNotEqual(c3["id"], c1["id"])                   # ルール違いは別カード
        found = self.call(None, "find_cards", "kyoji-horiguchi", "asakura")
        self.assertEqual(len(found), 2)

    def test_creator_reason_and_first_want(self):
        u = self.user("A")
        c = self.call(u, "create_card", "a1", "b1", "mma", "standard", "理由です", "why", False)
        self.assertEqual(c["want"], 1); self.assertEqual(c["reason"]["body"], "理由です"); self.assertTrue(c["me"]["mine"])

    def test_validation(self):
        u = self.user()
        self.assertIn("SAME_FIGHTER", self.err(u, "create_card", "a1", "a1", "mma", "standard", None, None, False))
        self.assertIn("TOO_LONG", self.err(u, "create_card", "a1", "b1", "mma", "standard", "x" * 141, None, False))
        self.assertIn("check", self.err(u, "create_card", "A B", "b1", "mma", "standard", None, None, False).lower())
        self.assertIn("FORBIDDEN", self.err(u, "create_card", "a1", "b1", "mma", "standard", None, None, True))

    def test_login_required_and_no_direct_table_access(self):
        # 未ログインでは書き込み関数そのものを実行できない
        self.assertIn("permission denied", self.err(None, "create_card", "a1", "b1", "mma", "standard", None, None, False))
        self.assertIn("permission denied", self.err(None, "set_reaction", "x", "want", True))
        c = psycopg2.connect(dsn(DB)); c.autocommit = True
        for role in ("anon", "authenticated"):
            cur = c.cursor(); cur.execute("set role " + role)
            for sql in ("select * from public.cards", "insert into public.reactions values ('x', gen_random_uuid(), 'want')",
                        "update public.cards set want_count = 999"):
                with self.assertRaises(psycopg2.Error):
                    cur.execute(sql)
            cur.execute("reset role")
        c.close()
        # 管理用の関数は一般ユーザー・未ログインでは使えない
        self.assertIn("FORBIDDEN", self.err(self.user(), "admin_reports"))
        self.assertIn("permission denied", self.err(None, "admin_reports"))

    def test_rate_limit_cards(self):
        u = self.user()
        for i in range(10):
            self.call(u, "create_card", f"a{i}", "zz", "mma", "standard", None, None, False)
        self.assertIn("RATE_LIMIT", self.err(u, "create_card", "a99", "zz", "mma", "standard", None, None, False))


class Reactions(Base):
    def test_idempotent_and_concurrent(self):
        u, v = self.user("A"), self.user("B")
        cid = self.call(u, "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        for _ in range(5):
            self.call(v, "set_reaction", cid, "want", True)        # 連打・再送
        self.assertEqual(self.card(cid)[0], 2)
        # 同時送信
        ths = [threading.Thread(target=self.call, args=(v, "set_reaction", cid, "fun", True)) for _ in range(8)]
        [t.start() for t in ths]; [t.join() for t in ths]
        self.assertEqual(self.card(cid)[1], 1)
        self.call(v, "set_reaction", cid, "want", False); self.call(v, "set_reaction", cid, "want", False)
        self.assertEqual(self.card(cid)[0], 1)
        self.assertIn("BAD_KIND", self.err(v, "set_reaction", cid, "love", True))

    def test_revote_cannot_boost_trending(self):
        users = [self.user(f"U{i}") for i in range(4)]
        cid = self.call(users[0], "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        for u in users[1:3]:
            self.call(u, "set_reaction", cid, "want", True)
        self.age_wants(cid, 200)                                  # 全員 200 時間前（8日以上前）に投票した扱い
        self.assertEqual(self.call(None, "list_cards", "trending", None, None, 20, 0)["cards"], [])
        for u in users[:3]:                                       # 取り消して押し直す
            self.call(u, "set_reaction", cid, "want", False); self.call(u, "set_reaction", cid, "want", True)
        self.assertEqual(self.call(None, "list_cards", "trending", None, None, 20, 0)["cards"], [])
        self.assertEqual(self.call(None, "list_cards", "weekly", None, None, 20, 0)["cards"], [])
        tot = self.call(None, "list_cards", "total", None, None, 20, 0)["cards"]
        self.assertEqual(tot[0]["want"], 3)

    def test_trending_needs_three_people_and_orders(self):
        us = [self.user(f"U{i}") for i in range(5)]
        c1 = self.call(us[0], "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        c2 = self.call(us[0], "create_card", "a2", "b2", "mma", "standard", None, None, False)["id"]
        for u in us[1:3]: self.call(u, "set_reaction", c1, "want", True)    # c1 = 3人
        for u in us[1:2]: self.call(u, "set_reaction", c2, "want", True)    # c2 = 2人
        tr = self.call(None, "list_cards", "trending", None, None, 20, 0)["cards"]
        self.assertEqual([c["id"] for c in tr], [c1]); self.assertEqual(tr[0]["period_n"], 3)
        wk = self.call(None, "list_cards", "weekly", None, None, 20, 0)["cards"]
        self.assertEqual([c["id"] for c in wk], [c1, c2])
        self.assertEqual(len(self.call(None, "list_cards", "weekly", None, None, 1, 0)["cards"]), 1)
        self.assertEqual(len(self.call(None, "list_cards", "new", "a1", None, 20, 0)["cards"]), 1)   # 選手で絞り込み
        self.assertEqual(len(self.call(None, "list_cards", "new", None, "kickboxing", 20, 0)["cards"]), 0)

    def test_hidden_card_excluded(self):
        u, adm = self.user(), self.user("管理", admin=True)
        cid = self.call(u, "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        self.call(adm, "admin_set_hidden", "card", cid, True)
        for tab in ("new", "total", "weekly"):
            self.assertEqual(self.call(None, "list_cards", tab, None, None, 20, 0)["cards"], [])
        self.assertEqual(self.call(None, "get_card", cid), {"id": cid, "status": "hidden"})
        self.assertIn("NOT_FOUND", self.err(u, "set_reaction", cid, "want", True))
        exp = self.call(None, "export_cards", "2000-01-01")
        self.assertEqual(exp[0]["status"], "hidden"); self.assertIsNone(exp[0]["reason"])


class Comments(Base):
    def test_flow(self):
        u, v, w = self.user("A"), self.user("B"), self.user("C")
        cid = self.call(u, "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        m1 = self.call(v, "add_comment", cid, "打撃戦が見たい", None, False, "why")["id"]
        dup = self.call(v, "add_comment", cid, "打撃戦が見たい", None, False, "why")       # 再送
        self.assertTrue(dup["duplicate"]); self.assertEqual(dup["id"], m1)
        self.assertIn("TOO_FAST", self.err(v, "add_comment", cid, "別の話", None, False, None))
        r1 = self.call(w, "add_comment", cid, "同意", m1, False, None)["id"]
        time.sleep(0.01)
        self.su.cursor().execute("update public.comments set created_at = created_at - interval '1 minute'")
        r2 = self.call(v, "add_comment", cid, "返信への返信", r1, False, None)["id"]
        tree = self.call(None, "list_comments", cid, "new")
        self.assertEqual(len(tree), 1); self.assertEqual([r["id"] for r in tree[0]["replies"]], [r1, r2])   # 1 階層
        self.assertEqual(self.card(cid)[2], 3)
        # 他人は編集・削除できない
        self.assertIn("FORBIDDEN", self.err(w, "edit_comment", m1, "改ざん"))
        self.assertIn("FORBIDDEN", self.err(w, "delete_comment", m1))
        self.call(v, "edit_comment", m1, "打撃戦が見たい！")
        self.call(v, "delete_comment", m1)
        tree = self.call(None, "list_comments", cid, "new")
        self.assertEqual(tree[0]["status"], "deleted"); self.assertIsNone(tree[0]["body"]); self.assertIsNone(tree[0]["user"])
        self.assertEqual(len(tree[0]["replies"]), 2)               # 返信の文脈は残る
        self.assertEqual(self.card(cid)[2], 2)
        self.assertIn("EMPTY", self.err(w, "add_comment", cid, "   ", None, False, None))
        self.assertIn("TOO_LONG", self.err(w, "add_comment", cid, "あ" * 301, None, False, None))

    def test_notifications(self):
        u, v = self.user("A"), self.user("B")
        cid = self.call(u, "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        m = self.call(u, "add_comment", cid, "最初のコメント", None, False, None)["id"]
        self.su.cursor().execute("update public.profiles set notif_seen_at = now() - interval '1 hour'")
        self.call(v, "add_comment", cid, "返信です", m, False, None)
        self.call(v, "set_reaction", cid, "want", True)
        self.assertEqual(self.call(u, "unread_count"), 1)
        items = self.call(u, "my_notifications", 30)["items"]
        self.assertEqual(sorted(i["type"] for i in items), ["reply", "wants_on_my_card"])
        self.call(u, "mark_notifications_seen")
        self.assertEqual(self.call(u, "unread_count"), 0)
        self.assertEqual(self.call(None, "unread_count"), 0)

    def test_account_deletion_keeps_card_and_others(self):
        u, v = self.user("A"), self.user("B")
        cid = self.call(u, "create_card", "a1", "b1", "mma", "standard", "作者の理由", None, False)["id"]
        self.call(v, "set_reaction", cid, "want", True)
        self.call(v, "add_comment", cid, "Bの意見", None, False, None)
        self.su.cursor().execute("delete from auth.users where id = %s", (u,))
        want, fun, cc, status, creator = self.card(cid)
        self.assertEqual((want, status, creator), (1, "public", None))   # B の票とカードは残る
        tree = self.call(None, "list_comments", cid, "new")
        self.assertEqual([t["body"] for t in tree], ["Bの意見"])        # 作者の理由は消える
        self.assertIsNone(self.call(None, "get_card", cid)["reason"])


class Discovery(Base):
    def test_related_and_my_page(self):
        u, v, adm = self.user("A"), self.user("B"), self.user("編集部", admin=True)
        base = self.call(u, "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        same = self.call(v, "create_card", "a1", "c1", "mma", "standard", None, None, False)["id"]
        cls_ = self.call(v, "create_card", "d1", "e1", "mma", "standard", None, None, False)["id"]
        ed = self.call(adm, "create_card", "f1", "g1", "mma", "standard", None, None, True)
        self.assertEqual(ed["origin"], "editorial")
        rel = self.call(None, "related_cards", base, ["a1", "b1", "d1", "e1"])
        whys = {r["id"]: r["why"] for r in rel}
        self.assertEqual(whys[same], "same_fighter"); self.assertEqual(whys[cls_], "same_class")
        self.assertNotIn(base, whys); self.assertEqual(len(rel), len(whys))     # 重複なし
        self.call(u, "set_save", same, True); self.call(u, "set_save", same, True)
        self.call(u, "set_reaction", cls_, "fun", True)
        mp = self.call(u, "my_page")
        self.assertEqual([c["id"] for c in mp["created"]], [base])
        self.assertEqual([c["id"] for c in mp["saved"]], [same])
        self.assertEqual({c["id"] for c in mp["joined"]}, {cls_})
        self.su.cursor().execute("insert into public.themes (title, starts_at, ends_at, card_ids) values ('お題', now() - interval '1 day', now() + interval '6 days', %s)", ([same],))
        th = self.call(None, "current_theme")
        self.assertEqual(th["title"], "お題"); self.assertEqual(th["cards"][0]["id"], same)


class Admin(Base):
    def test_reports(self):
        u, v, adm = self.user(), self.user(), self.user(admin=True)
        cid = self.call(u, "create_card", "a1", "b1", "mma", "standard", None, None, False)["id"]
        m = self.call(u, "add_comment", cid, "ひどい言葉", None, False, None)["id"]
        self.call(v, "report", "comment", str(m), "abuse", None)
        self.call(v, "report", "comment", str(m), "abuse", None)          # 二重通報は 1 件
        reps = self.call(adm, "admin_reports")
        self.assertEqual(reps[0]["n"], 1); self.assertEqual(reps[0]["card_id"], cid)
        self.call(adm, "admin_set_hidden", "comment", str(m), True)
        self.assertEqual(self.call(adm, "admin_reports"), [])
        self.assertEqual(self.call(None, "list_comments", cid, "new"), [])   # 返信のない非表示コメントは出ない


class Misc(Base):
    def test_whoami_and_fighter_request(self):
        u = self.user("Koya")
        self.assertIsNone(self.call(None, "whoami"))
        w = self.call(u, "whoami"); self.assertEqual((w["name"], w["admin"]), ("Koya", False))
        for _ in range(5): self.call(u, "request_fighter", "新しい選手", None)
        self.assertIn("RATE_LIMIT", self.err(u, "request_fighter", "新しい選手", None))
        self.call(u, "set_display_name", "改名")
        self.assertEqual(self.call(u, "whoami")["name"], "改名")     # 表示名が変わっても同じユーザー
        self.assertIn("BAD_NAME", self.err(u, "set_display_name", "me@example.com"))
        self.assertIn("BAD_LENGTH", self.err(u, "set_display_name", "あ" * 31))
        # 登録時の表示名にメールアドレスが入っていても表示名には使わない
        v = str(uuid.uuid4())
        self.su.cursor().execute("insert into auth.users values (%s, %s)", (v, json.dumps({"name": "x@example.com"})))
        self.assertEqual(self.call(v, "whoami")["name"], "ファン")


class Contact(Base):
    def test_contact(self):
        self.call(None, "submit_contact", "delete", "このコメントを消してください", "こや", "a@example.com", "https://x/")
        self.assertIn("TOO_SHORT", self.err(None, "submit_contact", "other", "短い", None, None, None))
        self.assertIn("check", self.err(None, "submit_contact", "other", "メールが不正なとき", None, "not-an-email", None).lower())
        self.assertIn("FORBIDDEN", self.err(self.user(), "admin_contacts"))
        adm = self.user(admin=True)
        lst = self.call(adm, "admin_contacts")
        self.assertEqual(len(lst), 1); self.assertEqual(lst[0]["email"], "a@example.com")
        self.call(adm, "admin_contact_done", lst[0]["id"])
        self.assertEqual(self.call(adm, "admin_contacts"), [])


class Predict(Base):
    def setup_event(self, hours_ahead=24):
        adm = self.user("管理", admin=True)
        self.call(adm, "admin_upsert_event", "rizin-test", "RIZIN テスト大会", f"{'2099-01-01' if hours_ahead > 0 else '2000-01-01'}T18:00:00+09:00", "さいたま", "https://example.com/", "public")
        b1 = self.call(adm, "admin_add_bout", "rizin-test", "朝倉 未来", "鈴木 千裕", "asakura", "suzuki", "mma", "フェザー級", True, None)
        b2 = self.call(adm, "admin_add_bout", "rizin-test", "新人A", "新人B", None, None, "mma", None, False, None)
        return adm, b1, b2

    def test_predict_flow(self):
        adm, b1, b2 = self.setup_event()
        u, v = self.user("U"), self.user("V")
        self.assertIn("FORBIDDEN", self.err(u, "admin_add_bout", "rizin-test", "x", "y", None, None, "mma", None, False, None))
        ev = self.call(None, "get_fight_event", "rizin-test")
        self.assertEqual(len(ev["bouts"]), 2); self.assertFalse(ev["locked"])
        self.assertIsNone(ev["bouts"][0]["counts"])                    # 予想前は割合を見せない
        self.call(u, "set_prediction", b1, "a", "ko")
        for _ in range(3): self.call(v, "set_prediction", b1, "b", None)   # 再送しても1票
        r = self.call(u, "set_prediction", b1, "b", "dec")                # 変更できる
        self.assertEqual(r["counts"]["b"], 2); self.assertEqual(r["counts"]["a"], 0); self.assertEqual(r["me"]["pick"], "b")
        self.assertIsNone(self.call(None, "get_fight_event", "rizin-test")["bouts"][0]["counts"])
        self.assertIn("BAD_PICK", self.err(u, "set_prediction", b1, "c", None))
        lst = self.call(None, "list_fight_events")
        self.assertEqual(lst[0]["predictors"], 2); self.assertTrue(lst[0]["upcoming"])
        # 結果入力 → その試合は締め切り、ランキング
        self.call(adm, "admin_set_result", b1, "b", "dec")
        self.assertIn("LOCKED", self.err(v, "set_prediction", b1, "a", None))
        rk = self.call(u, "event_ranking", "rizin-test")
        self.assertEqual(rk["top"][0]["pts"], 2); self.assertTrue(rk["top"][0]["mine"]); self.assertEqual(rk["me"]["rank"], 1)
        self.assertEqual(rk["top"][1]["pts"], 1)

    def test_lock_and_hidden(self):
        adm, b1, b2 = self.setup_event(hours_ahead=-1)                     # 開始済みの大会
        u = self.user()
        self.assertIn("LOCKED", self.err(u, "set_prediction", b1, "a", None))
        ev = self.call(None, "get_fight_event", "rizin-test")
        self.assertTrue(ev["locked"]); self.assertIsNotNone(ev["bouts"][0]["counts"])   # 締め切り後は公開
        self.assertIsNone(ev["phase"])                                  # 締め切っただけでは「試合中」にしない
        # 締め切り後・試合中・終了後もコメントはできる
        self.call(u, "add_bout_comment", b1, "締め切り後のコメント")
        self.call(adm, "admin_set_phase", "rizin-test", "live")
        self.assertEqual(self.call(None, "get_fight_event", "rizin-test")["phase"], "live")
        self.su.cursor().execute("update public.event_comments set created_at = created_at - interval '1 minute'")
        self.call(u, "add_bout_comment", b1, "試合中のコメント")
        self.call(adm, "admin_set_phase", "rizin-test", None)
        self.call(adm, "admin_set_result", b1, "a", "ko"); self.call(adm, "admin_set_result", b2, "b", "dec")
        self.assertEqual(self.call(None, "get_fight_event", "rizin-test")["phase"], "finished")   # 全試合の結果で自動的に終了
        self.assertIn("FORBIDDEN", self.err(u, "admin_set_phase", "rizin-test", "live"))
        self.call(adm, "admin_upsert_event", "rizin-test", "RIZIN テスト大会", "2000-01-01T18:00:00+09:00", None, None, "hidden")
        self.assertIsNone(self.call(None, "get_fight_event", "rizin-test"))
        self.assertEqual(self.call(None, "list_fight_events"), [])

    def test_event_chat(self):
        adm, b1, b2 = self.setup_event()
        u, v = self.user("U"), self.user("V")
        m1 = self.call(u, "add_event_comment", "rizin-test", "楽しみ！")["id"]
        self.assertTrue(self.call(u, "add_event_comment", "rizin-test", "楽しみ！")["duplicate"])
        self.assertIn("TOO_FAST", self.err(u, "add_event_comment", "rizin-test", "別の話"))
        m2 = self.call(v, "add_event_comment", "rizin-test", "朝倉勝つ")["id"]
        all_ = self.call(None, "list_event_comments", "rizin-test", 0)
        self.assertEqual([c["id"] for c in all_], [m1, m2])
        self.assertEqual([c["id"] for c in self.call(None, "list_event_comments", "rizin-test", m1)], [m2])
        self.assertIn("FORBIDDEN", self.err(v, "delete_event_comment", m1))
        self.call(v, "report", "event_comment", str(m1), "spam", None)
        self.assertEqual(self.call(adm, "admin_reports")[0]["event_id"], "rizin-test")
        self.call(adm, "admin_set_hidden", "event_comment", str(m1), True)
        self.assertEqual([c["id"] for c in self.call(None, "list_event_comments", "rizin-test", 0)], [m2])
        self.assertIn("TOO_LONG", self.err(v, "add_event_comment", "rizin-test", "あ" * 201))
        # 試合ごとのコメント：書いた人の予想も一緒に返す
        self.su.cursor().execute("update public.event_comments set created_at = created_at - interval '1 minute'")
        self.call(u, "set_prediction", b1, "a", None)
        c1 = self.call(u, "add_bout_comment", b1, "朝倉の打撃が上")["id"]
        lst = self.call(None, "list_event_comments", "rizin-test", 0)
        bc = [c for c in lst if c["id"] == c1][0]
        self.assertEqual((bc["bout"], bc["pick"]), (b1, "a"))
        self.assertIsNone([c for c in lst if c["id"] == m2][0]["bout"])
        self.assertIn("NOT_FOUND", self.err(v, "add_bout_comment", 999999, "x"))
        exp = self.call(None, "export_fight_events")
        self.assertEqual(exp[0]["bouts"][0]["fa_name"], "朝倉 未来")

    def test_replies_and_likes(self):
        adm, b1, b2 = self.setup_event()
        u, v, w = self.user("U"), self.user("V"), self.user("W")
        age = lambda: self.su.cursor().execute("update public.event_comments set created_at = created_at - interval '1 minute'")
        root = self.call(u, "add_bout_comment", b1, "朝倉が勝つ", None)["id"]; age()
        r1 = self.call(v, "add_bout_comment", b1, "いや鈴木", root)["id"]; age()
        r2 = self.call(w, "add_bout_comment", b1, "@V 同意", r1)["id"]; age()   # 返信への返信も同じスレッドに入る
        lst = {c["id"]: c for c in self.call(None, "list_event_comments", "rizin-test", 0)}   # 未ログインでも見える
        self.assertEqual((lst[r1]["parent"], lst[r1]["reply_name"]), (root, "U"))
        self.assertEqual((lst[r2]["parent"], lst[r2]["reply_to"], lst[r2]["reply_name"]), (root, r1, "V"))
        self.assertIn("REPLY_GONE", self.err(v, "add_bout_comment", b2, "別の試合へ返信", root))
        # いいね（1人1回・取り消し可）
        self.assertEqual(self.call(v, "like_event_comment", root, True)["likes"], 1)
        self.assertEqual(self.call(v, "like_event_comment", root, True)["likes"], 1)
        self.assertEqual(self.call(w, "like_event_comment", root, True)["likes"], 2)
        self.assertEqual(self.call(w, "like_event_comment", root, False)["likes"], 1)
        self.assertIn("permission denied", self.err(None, "like_event_comment", root, True))
        lk = self.call(v, "event_comment_likes", "rizin-test")
        self.assertEqual(lk[str(root)], [1, True])
        mine = {c["id"]: c for c in self.call(v, "list_event_comments", "rizin-test", 0)}
        self.assertEqual((mine[root]["likes"], mine[root]["liked"]), (1, True))
        # 先頭のコメントを消しても、返信があれば「削除されました」として残る
        self.call(u, "delete_event_comment", root)
        lst = {c["id"]: c for c in self.call(None, "list_event_comments", "rizin-test", 0)}
        self.assertTrue(lst[root]["deleted"]); self.assertEqual((lst[root]["body"], lst[root]["name"]), ("", ""))
        self.assertIn("REPLY_GONE", self.err(w, "add_bout_comment", b1, "消えたコメントへ", root))
        self.call(v, "delete_event_comment", r1); self.call(w, "delete_event_comment", r2)
        self.assertEqual(self.call(None, "list_event_comments", "rizin-test", 0), [])


class Events(Base):
    def test_dedupe(self):
        for _ in range(3):
            self.call(None, "log_event", "card_view", "anon-12345678", "abc", json.dumps({"src": "x"}), "card_view:anon-12345678:abc:2026-10-19")
        self.call(None, "log_event", "Bad Name", "anon-12345678", None, "{}", None)
        cur = self.su.cursor(); cur.execute("select count(*) from public.events"); self.assertEqual(cur.fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
