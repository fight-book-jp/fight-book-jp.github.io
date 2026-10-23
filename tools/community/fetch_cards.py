"""公開キー（js/community-config.js の url と anonKey）で export_cards() を呼び、JSON を書き出す
   接続先が未設定なら何もせず終了コード 3 を返す（ワークフローはそこで止まる）。
   python3 tools/community/fetch_cards.py out.json
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
cfg = open(os.path.join(ROOT, "js", "community-config.js"), encoding="utf-8").read()
url = (re.search(r'url:\s*"([^"]*)"', cfg) or [None, ""])[1]
key = (re.search(r'anonKey:\s*"([^"]*)"', cfg) or [None, ""])[1]
if not url or not key:
    print("community-config.js が未設定のため、共有ページは作りません")
    sys.exit(3)
if not re.match(r"^https://[a-z0-9-]+\.supabase\.co$", url.rstrip("/")):
    sys.exit("url の形式が正しくありません: " + url)
def call(fn):
    req = urllib.request.Request(url.rstrip("/") + f"/rest/v1/rpc/{fn}", data=b"{}", method="POST",
                                 headers={"apikey": key, "Content-Type": "application/json", "User-Agent": "FightBookPages/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


data = call("export_cards")
json.dump(data, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False)
print(f"カード {len(data)} 件を取得")
# 大会予想（データベースが未更新でも、カードのページ作成は続ける）
if len(sys.argv) > 2:
    try:
        ev = call("export_fight_events")
    except Exception as e:  # noqa: BLE001
        print("大会予想のデータは取得できませんでした:", e); ev = []
    json.dump(ev, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
    print(f"大会 {len(ev)} 件を取得")
