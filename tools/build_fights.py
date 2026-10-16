"""data-src/*.txt (各選手の戦績表) から data/fights.js を作る。
行形式: Res|Record|Opponent|Method|Event|Date|Round|Time|Notes
"""
import glob, json, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data-src")

# ファイル名 -> 名簿キー と、記録表に出てくる英語名
ROSTER = {
  "shinryu":"Makoto Takahashi", "ougikubo":"Hiromasa Ougikubo", "sabatello":"Danny Sabatello",
  "inoue":"Naoki Inoue", "shaydullaev":"Razhabali Shaydullaev", "asakura":"Mikuru Asakura",
  "koike":"Kleber Koike Erbst", "akimoto":"Kyoma Akimoto", "suzuki":"Chihiro Suzuki",
  "hiramoto":"Ren Hiramoto", "karamov":"Vugar Karamov", "dautbek":"Karshyga Dautbek",
  "gustavo":"Luiz Gustavo", "satoshi":"Roberto de Souza", "nozimov":"Ilkhom Nozimov",
  "izawa":"Seika Izawa", "goto":"Joji Goto", "motoya":"Yuki Motoya",
}
ALIASES = {
  "Vugar Keramov":"Vugar Karamov", "Roberto Satoshi de Souza":"Roberto de Souza",
  "Ilhom Nazimov":"Ilkhom Nozimov", "Ilkhom Nazimov":"Ilkhom Nozimov",
  "Makoto Shinryu":"Makoto Takahashi", "Patrick Mix":"Patchy Mix",
  "A. J. McKee":"A.J. McKee", "AJ McKee":"A.J. McKee", "Patricio Pitbull":"Patrício Pitbull",
  "Luis Gustavo":"Luiz Gustavo", "Ilyas Eziyeu":"Ilyas Eziev",
}
NAME2KEY = {v:k for k,v in ROSTER.items()}

# 同じ大会の日付表記ゆれ（米国日付など）を日本の開催日にそろえる
EVENT_DATE = {
  "Rizin: Shiwasu no Cho Tsuwamono Matsuri":"2025-12-31", "Rizin Landmark 13":"2026-04-12",
  "Rizin Landmark 12":"2025-11-03", "Rizin 50":"2025-03-29", "Rizin 43":"2023-06-24",
  "Rizin Landmark 6":"2023-10-01", "Rizin Landmark 15":"2026-07-18",
}
EVENT_ALIAS = {
  "Super Rizin & Rizin 38":"Super Rizin / Rizin 38", "Rizin 38":"Super Rizin / Rizin 38",
  "Bellator MMA x Rizin 2":"Super Rizin 2 (Bellator MMA x Rizin 2)", "Super Rizin 2":"Super Rizin 2 (Bellator MMA x Rizin 2)",
  "Bellator MMA vs. Rizin":"Rizin 40 (Bellator MMA vs. Rizin)", "Rizin 40":"Rizin 40 (Bellator MMA vs. Rizin)",
}

def norm(n):
    n = n.strip()
    return ALIASES.get(n, n)

def slug(n):
    s = unicodedata.normalize("NFKD", n).encode("ascii","ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+","-",s).strip("-")

def method_cat(m):
    m = m.lower()
    if m.startswith("nc") or "no contest" in m: return "NC"
    if m.startswith("draw"): return "DRAW"
    if "submission" in m: return "SUB"
    if "ko" in m or "tko" in m or "stoppage" in m or "retirement" in m: return "KO"
    if "decision" in m: return "DEC"
    if m.startswith("dq"): return "DQ"
    return "OTHER"

bouts = {}
for path in sorted(glob.glob(os.path.join(SRC,"*.txt"))):
    key = os.path.splitext(os.path.basename(path))[0]
    me = ROSTER[key]
    for line in open(path, encoding="utf-8"):
        line=line.strip()
        if not line or line.startswith("Res|"): continue
        p = (line.split("|")+[""]*9)[:9]
        res, _, opp, method, event, date, rnd, tm, notes = [x.strip() for x in p]
        opp = norm(opp); event = EVENT_ALIAS.get(event, event)
        date = EVENT_DATE.get(event, date)
        res = res.capitalize()
        if res == "Win": w, l, outcome = me, opp, "W"
        elif res == "Loss": w, l, outcome = opp, me, "W"
        elif res == "Draw": w, l, outcome = me, opp, "D"
        else: w, l, outcome = me, opp, "NC"
        pair = tuple(sorted([me, opp]))
        bid = f"{date}|{pair[0]}|{pair[1]}"
        rec = dict(date=date, event=event, a=w, b=l, outcome=outcome, method=method,
                   cat=method_cat(method) if outcome=="W" else outcome, round=rnd, time=tm,
                   title=("Championship" in notes and ("Won" in notes or "Defended" in notes or "For the" in notes or "Lost" in notes)),
                   note=notes)
        if bid in bouts:
            old = bouts[bid]
            # 両方の記録にある試合：結果の食い違いを警告、情報が多い方を採用
            if (old["a"],old["outcome"]) != (rec["a"],rec["outcome"]) and old["outcome"]=="W" and rec["outcome"]=="W":
                print("CONFLICT", bid, old["a"], "vs", rec["a"])
            for k in ("note","round","time","method"):
                if not old[k] and rec[k]: old[k]=rec[k]
            old["title"] = old["title"] or rec["title"]
        else:
            bouts[bid]=rec

fights = sorted(bouts.values(), key=lambda r:(r["date"], r["event"]))
names = sorted({f["a"] for f in fights}|{f["b"] for f in fights})
people = {}
for n in names:
    k = NAME2KEY.get(n, slug(n))
    people[n]=k
out = []
for i,f in enumerate(fights):
    out.append([f["date"], f["event"], people[f["a"]], people[f["b"]], f["outcome"], f["cat"],
                f["method"], f["round"], f["time"], 1 if f["title"] else 0, f["note"]])
others = {people[n]: n for n in names if people[n] not in ROSTER}
js = ("/* 自動生成: tools/build_fights.py （data-src/*.txt から作成） */\n"
      "window.FIGHT_COLS=['date','event','winner','loser','outcome','cat','method','round','time','title','note'];\n"
      "window.FIGHTS=" + json.dumps(out, ensure_ascii=False, separators=(",",":")).replace("],[","],\n[") + ";\n"
      "window.OPPONENTS=" + json.dumps(others, ensure_ascii=False, separators=(",",":")) + ";\n")
os.makedirs(os.path.join(ROOT,"data"), exist_ok=True)
open(os.path.join(ROOT,"data","fights.js"),"w",encoding="utf-8").write(js)
print(len(out), "bouts,", len(others), "opponents")
