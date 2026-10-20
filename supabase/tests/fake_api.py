"""E2E テスト用のローカルサーバー（本番では使わない）

  * サイトの静的ファイルを配信（GitHub Pages と同じく、無いパスは 404.html を返す）
  * /rest/v1/rpc/<関数名> を Supabase（PostgREST）と同じ形で受け、本物の PostgreSQL の関数を呼ぶ
  * js/community-config.js だけ、テスト用の接続先・テスト用ログインに差し替える

  PGDSN=postgresql://postgres:pw@localhost/fb_community_test python3 supabase/tests/fake_api.py 8787
"""
import http.server
import json
import os
import re
import sys

import psycopg2

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DSN = os.environ.get("PGDSN", "postgresql://postgres:pw@localhost/fb_community_test")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787

TEST_CONFIG = """window.FB_COMMUNITY = {
  url: location.origin, anonKey: "test-anon", provider: "x", siteUrl: location.origin,
  testAuth: {
    user() { try { return localStorage.getItem("fb_test_user"); } catch (e) { return null; } },
    login() { localStorage.setItem("fb_test_user", localStorage.getItem("fb_test_login_as") || ""); },
    logout() { localStorage.removeItem("fb_test_user"); },
    async anon(name) {
      const r = await fetch("/test/anon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      localStorage.setItem("fb_test_user", (await r.json()).id);
    },
  },
};
"""


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/js/community-config.js":
            b = TEST_CONFIG.encode()
            self.send_response(200); self.send_header("Content-Type", "text/javascript"); self.send_header("Content-Length", str(len(b))); self.end_headers()
            self.wfile.write(b); return
        fs = os.path.join(ROOT, path.lstrip("/"))
        if path.endswith("/"):
            fs = os.path.join(fs, "index.html")
        if not os.path.exists(fs):
            # GitHub Pages と同じく 404.html を 404 で返す
            b = open(os.path.join(ROOT, "404.html"), "rb").read() if os.path.exists(os.path.join(ROOT, "404.html")) else b"not found"
            self.send_response(404); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(b))); self.end_headers()
            self.wfile.write(b); return
        return super().do_GET()

    def do_POST(self):
        if self.path == "/test/anon":            # 匿名ユーザーの作成（Supabase の signInAnonymously の代わり）
            n = int(self.headers.get("Content-Length") or 0)
            name = json.loads(self.rfile.read(n) or b"{}").get("name") or "ファン"
            import uuid
            uid = str(uuid.uuid4())
            c = psycopg2.connect(DSN); c.autocommit = True
            c.cursor().execute("insert into auth.users values (%s, %s)", (uid, json.dumps({"name": name})))
            c.close()
            return self.send_json(200, {"id": uid})
        m = re.match(r"^/rest/v1/rpc/([a-z_]+)$", self.path)
        if not m:
            return self.send_json(404, {"message": "not found"})
        fn = m.group(1)
        n = int(self.headers.get("Content-Length") or 0)
        args = json.loads(self.rfile.read(n) or b"{}")
        auth = (self.headers.get("Authorization") or "").replace("Bearer ", "")
        uid = auth[5:] if auth.startswith("test:") and len(auth) > 5 else None
        names = list(args.keys())
        vals = [json.dumps(v) if isinstance(v, dict) else v for v in args.values()]
        sql = f"select public.{fn}(" + ", ".join(f'"{k}" => %s' for k in names) + ")"
        c = psycopg2.connect(DSN); c.autocommit = True
        try:
            cur = c.cursor()
            cur.execute("set role " + ("authenticated" if uid else "anon"))
            cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (uid or "",))
            cur.execute(sql, vals)
            return self.send_json(200, cur.fetchone()[0])
        except psycopg2.Error as e:
            msg = (e.diag.message_primary or str(e)).strip()
            code = 400 if e.pgcode == "P0001" else (401 if not uid else 403) if "permission denied" in msg else 400
            return self.send_json(code, {"message": msg, "code": e.pgcode})
        finally:
            c.close()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
