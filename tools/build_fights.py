"""試合データ（data/fights.js）を作るスクリプト。

入力
  data-src/events/*.txt  … RIZIN全大会のMMA試合結果
      Event|Date|WeightClass|Winner|Loser|Result(W/D/NC)|Method|Round|Time|Notes
  data-src/<key>.txt     … 名簿選手のプロ全戦績（RIZIN以外の試合も含む）
      Res|Record|Opponent|Method|Event|Date|Round|Time|Notes

出力
  data/fights.js  … window.FIGHTS（全試合）と window.PEOPLE（全選手）
"""
import collections, glob, json, os, re, unicodedata
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")

# 名簿選手：ファイル名(key) -> 正式な英語名
ROSTER = {
  "shinryu":"Makoto Takahashi", "ougikubo":"Hiromasa Ougikubo", "sabatello":"Danny Sabatello",
  "inoue":"Naoki Inoue", "shaydullaev":"Razhabali Shaydullaev", "asakura":"Mikuru Asakura",
  "koike":"Kleber Koike Erbst", "akimoto":"Kyoma Akimoto", "suzuki":"Chihiro Suzuki",
  "hiramoto":"Ren Hiramoto", "karamov":"Vugar Karamov", "dautbek":"Karshyga Dautbek",
  "gustavo":"Luiz Gustavo", "satoshi":"Roberto de Souza", "nozimov":"Ilkhom Nozimov",
  "izawa":"Seika Izawa", "goto":"Joji Goto", "motoya":"Yuki Motoya",
}
NAME2KEY = {v: k for k, v in ROSTER.items()}

# 表記ゆれ -> 正式名
ALIASES = {
  "Vugar Keramov":"Vugar Karamov", "Roberto Satoshi de Souza":"Roberto de Souza",
  "Roberto Satoshi Souza":"Roberto de Souza", "Ilhom Nazimov":"Ilkhom Nozimov",
  "Ilkhom Nazimov":"Ilkhom Nozimov", "Makoto Shinryu":"Makoto Takahashi",
  "Patrick Mix":"Patchy Mix", "A. J. McKee":"A.J. McKee", "AJ McKee":"A.J. McKee",
  "Patricio Pitbull":"Patrício Pitbull", "Patricky Freire":"Patricky Pitbull",
  "Luis Gustavo":"Luiz Gustavo", "Ilyas Eziyeu":"Ilyas Eziev",
  "Gabrielle Garcia":"Gabi Garcia", "Mirko Filipovic":"Mirko Cro Cop", "Tsuyoshi Kohsaka":"Tsuyoshi Kosaka",
  "Kyouma Akimoto":"Kyoma Akimoto", "Karl Abrektsson":"Karl Albrektsson",
  "Teodoras Aukstuolis":"Teodoras Aukštuolis", "Gabriel Oliviera":"Gabriel Oliveira",
  "Shinju Nozawa Auclair":"Shinju Nozawa-Auclair", "Kim Soo-chul":"Soo Chul Kim",
  "Park Si-woo":"Si Woo Park", "Ji Yong Yang":"Yang Ji-yong", "Alan Yoshihiro Yamaniha":"Alan Yamaniha",
  "Marcos Yoshio Souza":"Marcos de Souza", "Kana Hayatt":"Kana Hyatt",
  "Nobuyoshi Nakatsuka":"Nobuyoshi Nakatsukasa", "Natasha Kuziutina":"Natalia Kuziutina",
  "Noah Bey":"BeyNoah", "Razhabali Shaidulloev":"Razhabali Shaydullaev",
  "Rajabali Shaidullaev":"Razhabali Shaydullaev", "Sudario Tsuyoshi":"Tsuyoshi Sudario",
  "Alibek Gadzhamatov":"Alibek Gadzhammatov", "Kleber Koike":"Kleber Koike Erbst",
  "Miko Ueda":"Mikio Ueda", "Animal☆Koji":"Animal Koji", "Jérome Le Banner":"Jérôme Le Banner",
  "Jerome Le Banner":"Jérôme Le Banner", "Nurkhan Zumagazy":"Nurkhan Zhumagazy",
  "Li Kai Wen":"Li Kaiwen", "Kaiwen Li":"Li Kaiwen", "Ye Ji Lee":"Lee Ye-ji",
  "Jae Hoon Lee":"Lee Jae-hoon", "Si Woo Park ":"Si Woo Park", "Tenya":"Tenya Yoshimura",
  "Tatsuya \"Yanbo\" Saika":"Tatsuya Saika", "Kate Oyama":"Kate Oyama", "Keito Oyama":"Kate Oyama",
  "Naoki":"Naoki Tanaka", "Ryota Renseigym":"Ryota Renseigym", "Shoko Sato":"Shoko Sato",
  "Topnoi Kiwram":"Topnoi Thanongsaklek", "John Macapá":"John Teixeira",
}

# 大会名の表記ゆれ（都市名などを外したあと）
EVENT_ALIAS = {
  "Super Rizin & Rizin 38":"Super Rizin / Rizin 38", "Rizin 38":"Super Rizin / Rizin 38",
  "Super Rizin 2: Rizin X Bellator":"Super Rizin 2", "Bellator MMA x Rizin 2":"Super Rizin 2",
  "Super Rizin 2 (Bellator MMA x Rizin 2)":"Super Rizin 2",
  "Bellator MMA vs. Rizin":"Rizin 40 (Bellator MMA vs. Rizin)", "Rizin 40":"Rizin 40 (Bellator MMA vs. Rizin)",
  "Rizin 40 & Rizin vs Bellator":"Rizin 40 (Bellator MMA vs. Rizin)",
  "Rizin Landmark 11 in Sapporo":"Rizin Landmark 11", "Rizin 49: Decade":"Rizin 49",
  "Rizin - Heisei's Last Yarennoka!":"Rizin: Heisei's Last Yarennoka!",
}

DIV_JA = [("female","女子"), ("heavy","重量級"), ("openweight","重量級"), ("grand-prix 100","重量級"),
          ("middle","重量級"), ("welter","重量級"), ("light heavy","重量級"),
          ("lightweight","ライト級"), ("featherweight","フェザー級"), ("bantam","バンタム級"),
          ("flyweight","フライ級"), ("strawweight","フライ級")]

CC = re.compile(r"^(?:[A-Z]{2,3}|Guam|Tonga|Taiwan)\s+")

def norm_name(n):
    n = re.sub(r"\s*\(c\)\s*$", "", n.strip())
    country = ""
    m = CC.match(n)
    if m:
        country = m.group(0).strip(); n = n[m.end():]
    n = n.strip()
    return ALIASES.get(n, n), country

def norm_event(e):
    e = e.strip()
    e = EVENT_ALIAS.get(e, e)
    e = re.sub(r"\s+[–-]\s+(?!Saraba|Iza)[A-Za-z][A-Za-z -]*$", "", e)  # 都市名を外す
    e = re.sub(r"Landmark [Vv]ol\.?\s*(\d+)", r"Landmark \1", e)
    e = re.sub(r"\s+in\s+[A-Z][a-z]+$", "", e) if e.startswith("Rizin Landmark") else e
    return EVENT_ALIAS.get(e, e)

def slug(n):
    s = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "x"

def method_cat(m):
    m = m.lower()
    if m.startswith("nc") or "no contest" in m: return "NC"
    if m.startswith("draw"): return "D"
    if "submission" in m: return "SUB"
    if m.startswith("dq") or "disqualification" in m: return "DQ"
    if "ko" in m or "stoppage" in m or "retirement" in m or "cut" in m or "injury" in m: return "KO"
    if "decision" in m: return "DEC"
    return "OTHER"

def div_of(w):
    w = w.lower()
    for k, v in DIV_JA:
        if k in w: return v
    return ""

def d2o(s):
    try: return date.fromisoformat(s).toordinal()
    except Exception: return 0

bouts = []
countries = collections.defaultdict(collections.Counter)

# ---- 1) RIZIN 全大会 ----
for path in sorted(glob.glob(os.path.join(SRC, "events", "*.txt"))):
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith(("Event|", "TOTAL", "MISSING")): continue
        p = (line.split("|") + [""] * 10)[:10]
        ev, dt, wc, a, b, res, method, rnd, tm, note = [x.strip() for x in p]
        if wc.upper().startswith(("KICK", "BOX", "EXH")): continue
        if res not in ("W", "D", "NC") or "/" in a or "/" in b or not a or not b: continue
        a, ca = norm_name(a); b, cb = norm_name(b)
        if ca: countries[a][ca] += 1
        if cb: countries[b][cb] += 1
        bouts.append(dict(date=dt, event=norm_event(ev), a=a, b=b, outcome=res, method=method,
                          round=rnd, time=tm, note=note, wc=wc, rizin=True))

# ---- 2) 名簿選手のプロ全戦績（RIZIN外の試合を補う） ----
def find_match(me, opp, dt):
    o = d2o(dt)
    for x in bouts:
        if {x["a"], x["b"]} == {me, opp} and abs(d2o(x["date"]) - o) <= 3:
            return x
    return None

for key, me in ROSTER.items():
    path = os.path.join(SRC, key + ".txt")
    if not os.path.exists(path): continue
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("Res|"): continue
        p = (line.split("|") + [""] * 9)[:9]
        res, _, opp, method, event, dt, rnd, tm, note = [x.strip() for x in p]
        opp, _c = norm_name(opp)
        hit = find_match(me, opp, dt)
        if hit:
            if not hit["note"] and note: hit["note"] = note
            if not hit["round"] and rnd: hit["round"] = rnd
            if not hit["time"] and tm: hit["time"] = tm
            continue
        res = res.capitalize()
        if res == "Win": a, b, out = me, opp, "W"
        elif res == "Loss": a, b, out = opp, me, "W"
        elif res == "Draw": a, b, out = me, opp, "D"
        else: a, b, out = me, opp, "NC"
        ev = norm_event(event)
        bouts.append(dict(date=dt, event=ev, a=a, b=b, outcome=out, method=method, round=rnd,
                          time=tm, note=note, wc="", rizin=bool(re.search(r"rizin", ev, re.I))))

# 名簿ファイル由来のRIZIN大会が、大会ファイルにない場合の警告
ev_names = {x["event"] for x in bouts if x["wc"]}
for x in bouts:
    if x["rizin"] and not x["wc"]:
        print("note: RIZIN bout only in roster file:", x["date"], x["event"], x["a"], "vs", x["b"])

bouts.sort(key=lambda r: (r["date"], r["event"]))

# ---- 選手ID ----
names = sorted({x["a"] for x in bouts} | {x["b"] for x in bouts})
key_of, used = {}, set()
for n in names:
    k = NAME2KEY.get(n) or slug(n)
    while k in used and n not in NAME2KEY: k += "-2"
    used.add(k); key_of[n] = k

# 最新の試合の階級を、その選手の主な階級とする
last_div = {}
for x in bouts:
    d = div_of(x["wc"]) if x["wc"] else ""
    if d:
        last_div[x["a"]] = d; last_div[x["b"]] = d

people = {}
for n in names:
    c = countries[n].most_common(1)[0][0] if countries[n] else ""
    people[key_of[n]] = [n, c, last_div.get(n, "")]

# 大会ファイルは各大会の先頭がメインイベント（Wikipediaの並び順）
seen_ev = set()
for x in bouts:
    k = (x["date"], x["event"])
    x["main"] = bool(x["wc"]) and k not in seen_ev
    if x["wc"]: seen_ev.add(k)

cols = ["date","event","winner","loser","outcome","cat","method","round","time","title","note","rizin","main"]
out = []
for x in bouts:
    cat = method_cat(x["method"]) if x["outcome"] == "W" else x["outcome"]
    title = 1 if re.search(r"Championship", x["note"]) and re.search(r"Won|Defended|For the|Lost", x["note"]) else 0
    out.append([x["date"], x["event"], key_of[x["a"]], key_of[x["b"]], x["outcome"], cat, x["method"],
                x["round"], x["time"], title, x["note"], 1 if x["rizin"] else 0, 1 if x["main"] else 0])

js = ("/* 自動生成: python3 tools/build_fights.py （data-src から作成。直接編集しない） */\n"
      "window.FIGHT_COLS=" + json.dumps(cols) + ";\n"
      "window.PEOPLE=" + json.dumps(people, ensure_ascii=False, separators=(",", ":")) + ";\n"
      "window.FIGHTS=[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in out) + "\n];\n")
open(os.path.join(ROOT, "data", "fights.js"), "w", encoding="utf-8").write(js)
riz = [x for x in out if x[11]]
print(len(out), "bouts total,", len(riz), "RIZIN bouts,", len({x[1] for x in riz}), "RIZIN events,",
      len({p for x in riz for p in (x[2], x[3])}), "RIZIN fighters")
