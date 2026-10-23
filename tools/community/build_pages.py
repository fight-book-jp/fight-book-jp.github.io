"""ファンの対戦カードごとの共有ページ（/matchups/{id}/）と共有画像・サイトマップを作る

GitHub Pages は静的配信なので、X などが JavaScript を動かさずに読む
タイトル・説明・画像（Open Graph / X カード）を、カードごとの HTML に書き込んでおく。

  python3 tools/community/build_pages.py --cards cards.json --names names.json

  cards.json : Supabase の export_cards() の結果（公開キーで読める範囲だけ）
  names.json : tools/community/dump_names.js の出力

* 共有画像には投票数を載せない（X のキャッシュで古い数字が残るため）。
* 選手の写真は使わない（権利を確認できないため）。文字だけで構成する。
* 非公開になったカードは noindex の「非公開」ページに置き換え、サイトマップから外す。
* 変化のないカードは作り直さない（manifest でハッシュを比較）。
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SITE = json.load(open(os.path.join(ROOT, "data-src", "site.json"), encoding="utf-8"))["url"].rstrip("/")
OUT_DIR = os.path.join(ROOT, "matchups")
MANIFEST = os.path.join(ROOT, "data-src", "community", "pages.json")
RULES = {"mma": "MMA", "kickboxing": "キックボクシング", "grappling": "グラップリング", "boxing": "ボクシング"}
CONDS = {"standard": "", "title": "タイトル戦", "catchweight": "契約体重", "openweight": "無差別級"}
FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Bold.ttc",
]
ID_RE = re.compile(r"^[A-Za-z0-9]{6,20}$")
VERSION = "1"   # 画像やページの作りを変えたら上げる（全カードを作り直す）


def rule_label(c):
    r = RULES.get(c["rule"], c["rule"])
    k = CONDS.get(c.get("cond") or "standard", "")
    return f"{r}・{k}" if k else r


def esc(s):
    return html.escape(str(s or ""), quote=True)


def page_html(template, c, names, hidden):
    url = f"{SITE}/matchups/{c['id']}/"
    a, b = names[c["fa"]], names[c["fb"]]
    origin = "編集部提案" if c.get("origin") == "editorial" else "ファン提案"
    if hidden:
        title = "非公開のカード｜FIGHT BOOK"
        desc = "このカードは非公開になりました。"
        head = (f'<meta name="robots" content="noindex">\n<meta property="og:title" content="{esc(title)}">\n'
                f'<meta property="og:description" content="{esc(desc)}">\n<meta name="twitter:card" content="summary">\n')
        body = '<div class="wrap"><p>このカードは非公開になりました。</p><p><a href="/#/cards">ファンの見たい対戦へ</a></p></div>'
    else:
        title = f"{a['name']} vs {b['name']}（{rule_label(c)}）この対戦、見たい？｜FIGHT BOOK"
        reason = (c.get("reason") or "").strip()
        desc = (f"{origin}・未決定。{a['name']}（{a['division'] or '階級不明'}）と{b['name']}（{b['division'] or '階級不明'}）の"
                f"{rule_label(c)}を見たいかどうか、ファンが「見たい！」とコメントで語り合うページです。")
        if reason:
            desc = f"「{reason[:80]}」— {desc}"
        img = f"{url}og.png?v={c['_hash'][:8]}"
        head = (f'<link rel="canonical" href="{url}">\n'
                f'<meta property="og:type" content="article">\n<meta property="og:site_name" content="FIGHT BOOK">\n'
                f'<meta property="og:url" content="{url}">\n<meta property="og:title" content="{esc(title)}">\n'
                f'<meta property="og:description" content="{esc(desc)}">\n<meta property="og:image" content="{img}">\n'
                f'<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
                f'<meta property="og:image:alt" content="{esc(a["name"])} vs {esc(b["name"])}（{esc(rule_label(c))}）この対戦、見たい？ ファン提案・未決定">\n'
                f'<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="{esc(title)}">\n'
                f'<meta name="twitter:description" content="{esc(desc)}">\n<meta name="twitter:image" content="{img}">\n')
        # JavaScript が動く前・動かない環境でも読める本文（読み込み後はアプリが置き換える）
        body = (f'<div class="wrap"><p class="note">{origin}・未決定（実際の対戦を決めるものではありません）</p>'
                f'<h1>{esc(a["name"])}（{esc(a["en"])}） vs {esc(b["name"])}（{esc(b["en"])}）</h1>'
                f'<p>ルール：{esc(rule_label(c))}</p>'
                + (f'<blockquote>{esc(reason)}</blockquote>' if reason else "")
                + f'<p><a href="/#/fighter/{esc(c["fa"])}">{esc(a["name"])}の選手ページ</a> ・ <a href="/#/fighter/{esc(c["fb"])}">{esc(b["name"])}の選手ページ</a> ・ <a href="/#/cards">ほかのカード</a></p></div>')
    # index.html の <!--meta--> ブロックを、このカード用のタイトル・説明・OGP に置き換える
    block = f"<!--meta-->\n<title>{esc(title)}</title>\n<meta name=\"description\" content=\"{esc(desc)}\">\n{head}<!--/meta-->"
    out = re.sub(r"<!--meta-->.*?<!--/meta-->", lambda m: block, template, count=1, flags=re.S)
    out = out.replace('<main id="view"></main>', f'<main id="view">{body}</main>', 1)
    return out


def font(size):
    from PIL import ImageFont
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            for idx in (0, 1, 2, 3):      # .ttc の中から日本語（JP）を探す
                try:
                    ft = ImageFont.truetype(f, size, index=idx)
                    if "JP" in " ".join(ft.getname()):
                        return ft
                except OSError:
                    break
            return ImageFont.truetype(f, size)
    raise SystemExit("日本語フォントが見つかりません（fonts-noto-cjk を入れてください）")


def fit(draw, text, max_w, size, min_size=40):
    while size > min_size:
        f = font(size)
        if draw.textlength(text, font=f) <= max_w:
            return f
        size -= 4
    return font(min_size)


def og_image(c, names, path):
    from PIL import Image, ImageDraw
    W, Hh = 1200, 630
    BG, INK, MUTED, ACC, RED, BLUE, GOLD = "#2E3A1F", "#F7F6F0", "#C3C8B1", "#B5C783", "#D06A52", "#6F95C4", "#E3CF8F"
    im = Image.new("RGB", (W, Hh), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, Hh - 14, W, Hh], fill=ACC)
    a, b = names[c["fa"]]["name"], names[c["fb"]]["name"]
    f_small, f_mid = font(30), font(40)
    d.text((64, 52), "この対戦、見たい？", font=font(46), fill=GOLD)
    tag = "編集部提案・未決定" if c.get("origin") == "editorial" else "ファン提案・未決定"
    tw = d.textlength(tag, font=f_small)
    d.rounded_rectangle([W - 64 - tw - 32, 50, W - 64, 104], radius=27, outline=MUTED, width=2)
    d.text((W - 64 - tw - 16, 59), tag, font=f_small, fill=MUTED)
    # 2人の名前（長い名前は文字を小さく）
    fa, fb = fit(d, a, 1060, 96), fit(d, b, 1060, 96)
    d.rectangle([64, 160, 76, 268], fill=RED)
    d.text((100, 160), a, font=fa, fill=INK)
    d.text((100, 290), "VS", font=font(52), fill=MUTED)
    d.rectangle([64, 372, 76, 480], fill=BLUE)
    d.text((100, 372), b, font=fb, fill=INK)
    d.text((64, 528), rule_label(c), font=f_mid, fill=ACC)
    site = "FIGHT BOOK"
    d.text((W - 64 - d.textlength(site, font=f_mid), 528), site, font=f_mid, fill=INK)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    im.save(path, "PNG", optimize=True)


EV_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,39}$")


def ev_when(t):
    d = datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=9)))
    return f"{d.year}年{d.month}月{d.day}日 {d.hour:02d}:{d.minute:02d}"


def bout_names(b, names):
    return b["fa_name"], b["fb_name"]   # 公式発表の表記


def event_html(template, e, names, hidden):
    url = f"{SITE}/predict/{e['id']}/"
    if hidden:
        title, desc = "非公開の大会｜FIGHT BOOK", "この大会は非公開です。"
        head = '<meta name="robots" content="noindex">\n'
        body = '<div class="wrap"><p>この大会は非公開です。</p></div>'
    else:
        main = bout_names(e["bouts"][-1], names) if e["bouts"] else None
        title = f"{e['name']} 勝敗予想・みんなの予想｜FIGHT BOOK"
        desc = (f"{e['name']}（{ev_when(e['starts_at'])}）の対戦カード{len(e['bouts'])}試合の勝敗を予想しよう。"
                + (f"メインは{main[0]} vs {main[1]}。" if main else "") + "みんなの予想の割合と、大会の雑談スレッドも。")
        img = f"{url}og.png?v={e['_hash'][:8]}"
        head = (f'<link rel="canonical" href="{url}">\n<meta property="og:type" content="article">\n<meta property="og:site_name" content="FIGHT BOOK">\n'
                f'<meta property="og:url" content="{url}">\n<meta property="og:title" content="{esc(title)}">\n<meta property="og:description" content="{esc(desc)}">\n'
                f'<meta property="og:image" content="{img}">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
                f'<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="{esc(title)}">\n'
                f'<meta name="twitter:description" content="{esc(desc)}">\n<meta name="twitter:image" content="{img}">\n')
        rows = "".join(f"<li>{esc(a)} vs {esc(b)}</li>" for a, b in (bout_names(x, names) for x in reversed(e["bouts"])))
        body = (f'<div class="wrap"><h1>{esc(e["name"])} 勝敗予想</h1><p>{esc(ev_when(e["starts_at"]))}{"・" + esc(e["venue"]) if e.get("venue") else ""}</p>'
                f'<h2>対戦カード</h2><ol>{rows}</ol><p><a href="/predict/">大会予想の一覧</a></p></div>')
    block = f"<!--meta-->\n<title>{esc(title)}</title>\n<meta name=\"description\" content=\"{esc(desc)}\">\n{head}<!--/meta-->"
    out = re.sub(r"<!--meta-->.*?<!--/meta-->", lambda m: block, template, count=1, flags=re.S)
    return out.replace('<main id="view"></main>', f'<main id="view">{body}</main>', 1)


def event_image(e, names, path):
    from PIL import Image, ImageDraw
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), "#1F2715"); d = ImageDraw.Draw(im)
    for x in range(-H, W, 56):
        d.line([(x, 0), (x + H, H)], fill="#26301B", width=2); d.line([(x + H, 0), (x, H)], fill="#26301B", width=2)
    d.rectangle([0, H - 14, W, H], fill="#8FA35E")
    d.rounded_rectangle([64, 56, 64 + 300, 112], radius=28, fill="#D06A52")
    d.text((92, 64), "勝敗予想 受付中", font=font(32), fill="#FFFFFF")
    d.text((64, 140), e["name"], font=fit(d, e["name"], W - 128, 76), fill="#F7F6F0")
    d.text((64, 250), ev_when(e["starts_at"]), font=font(34), fill="#C3C8B1")
    if e["bouts"]:
        a, b = bout_names(e["bouts"][-1], names)
        t = f"{a}  vs  {b}"
        d.text((64, 340), "MAIN EVENT", font=font(28), fill="#E3CF8F")
        d.text((64, 380), t, font=fit(d, t, W - 128, 64), fill="#F7F6F0")
    d.text((64, 528), "あなたの予想は？", font=font(40), fill="#B5C783")
    site = "FIGHT BOOK"
    d.text((W - 64 - d.textlength(site, font=font(40)), 528), site, font=font(40), fill="#F7F6F0")
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    im.save(path, "PNG", optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cards", required=True)
    ap.add_argument("--names", required=True)
    ap.add_argument("--events", help="export_fight_events() の結果（任意）")
    ap.add_argument("--no-images", action="store_true", help="画像を作らない（テスト用）")
    args = ap.parse_args()
    cards = json.load(open(args.cards, encoding="utf-8"))
    names = json.load(open(args.names, encoding="utf-8"))
    template = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    tpl_hash = hashlib.sha1((template + VERSION).encode()).hexdigest()
    manifest = json.load(open(MANIFEST, encoding="utf-8")) if os.path.exists(MANIFEST) else {}
    new_manifest, sitemap, changed, skipped = {}, [], 0, 0


    for c in cards:
        if not ID_RE.match(str(c.get("id", ""))):
            continue
        if c.get("fa") not in names or c.get("fb") not in names:
            skipped += 1                      # 選手データに無いキーのカードは作らない（推測で名前を出さない）
            continue
        hidden = c.get("status") != "public"
        key = json.dumps([c["fa"], c["fb"], c["rule"], c.get("cond"), c.get("origin"), c.get("status"), c.get("reason"),
                          names[c["fa"]], names[c["fb"]], tpl_hash], ensure_ascii=False)
        h = hashlib.sha1(key.encode()).hexdigest()
        c["_hash"] = h
        new_manifest[c["id"]] = h
        d = os.path.join(OUT_DIR, c["id"])
        if not hidden:
            sitemap.append((f"{SITE}/matchups/{c['id']}/", c.get("created_at", "")[:10]))
        if manifest.get(c["id"]) == h and os.path.exists(os.path.join(d, "index.html")):
            continue
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(page_html(template, c, names, hidden))
        png = os.path.join(d, "og.png")
        if hidden:
            if os.path.exists(png):
                os.remove(png)
        elif not args.no_images:
            og_image(c, names, png)
        changed += 1

    # 大会予想のページ（/predict/{id}/）
    events = json.load(open(args.events, encoding="utf-8")) if args.events and os.path.exists(args.events) else []
    for e in events:
        if not EV_RE.match(str(e.get("id", ""))):
            continue
        hidden = e.get("status") != "public"
        h = hashlib.sha1(json.dumps([e, tpl_hash, [bout_names(b, names) for b in e["bouts"]]], ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        e["_hash"] = h
        new_manifest["ev:" + e["id"]] = h
        d = os.path.join(ROOT, "predict", e["id"])
        if not hidden:
            sitemap.append((f"{SITE}/predict/{e['id']}/", e["starts_at"][:10]))
        if manifest.get("ev:" + e["id"]) == h and os.path.exists(os.path.join(d, "index.html")):
            continue
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, "index.html"), "w", encoding="utf-8").write(event_html(template, e, names, hidden))
        png = os.path.join(d, "og.png")
        if hidden:
            if os.path.exists(png): os.remove(png)
        elif not args.no_images:
            event_image(e, names, png)
        changed += 1

    # サイトマップ（トップと公開中のカードだけ）
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls = sorted(sitemap)
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(
        f"  <url><loc>{u}</loc>{f'<lastmod>{m}</lastmod>' if m else ''}</url>\n" for u, m in urls) + "</urlset>\n"
    open(os.path.join(ROOT, "sitemap-cards.xml"), "w", encoding="utf-8").write(xml)   # 索引 sitemap.xml は tools/pages/build.js が作る
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    json.dump(new_manifest, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, indent=0, sort_keys=True)
    print(f"カード {len(cards)}・作り直し {changed}・選手データ不明でスキップ {skipped}・サイトマップ {len(urls)}件")


if __name__ == "__main__":
    main()
