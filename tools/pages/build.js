/* =====================================================================
   検索エンジン向けの静的ページを作る（GitHub Pages は静的配信のため）
     /fighters/{key}/  /gyms/{id}/  /rankings/  /champions/ … と、sitemap-pages.xml・sitemap.xml・robots.txt・404.html

   各ページは index.html をひな形にして、
     ・<!--meta--> 〜 <!--/meta--> をページ固有のタイトル・説明・正規URL・OGP に置き換え
     ・<main id="view"> に、JavaScript が動かなくても読める本文（データから作る事実のみ）を入れる
   読み込み後は同じアプリ（js/app.js）が表示を置き換える。

     node tools/pages/build.js
   ===================================================================== */
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..", "..");
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, "data-src", "site.json"), "utf8")).url.replace(/\/$/, "");

const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
for (const f of ["data/fighters.js", "data/fights.js", "data/names-ja.js", "data/gyms.js", "data/profiles.js", "js/stats.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
}
const W = ctx.window, S = W.STATS, GYMS = W.GYMS || {}, AFFIL = W.AFFIL || {}, CATCH = W.CATCHPHRASE || {};
const TEMPLATE = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
if (!/<!--meta-->[\s\S]*<!--\/meta-->/.test(TEMPLATE)) throw new Error("index.html に <!--meta--> ブロックがありません");

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const enc = encodeURIComponent;
const nm = k => S.nameOf(k), en = k => S.enOf(k);
const fmt = d => (d || "").replace(/-/g, ".");
const METHOD = { KO: "KO/TKO", SUB: "一本", DEC: "判定", DQ: "反則", OTHER: "その他", D: "引き分け", NC: "無効試合" };
// 画像を差し替えたとき X などのキャッシュが古い画像を使い続けないよう、中身のハッシュを付ける
const OG_DEFAULT = `${SITE}/img/og-default.png?v=${require("crypto").createHash("sha1").update(fs.readFileSync(path.join(ROOT, "img", "og-default.png"))).digest("hex").slice(0, 8)}`;

function meta({ title, desc, url, noindex, type = "website" }) {
  return `<!--meta-->
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${url}">`}
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="FIGHT BOOK">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${OG_DEFAULT}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<!--/meta-->`;
}
function page(rel, m, body) {
  const url = `${SITE}${rel}`;
  let out = TEMPLATE.replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, meta({ ...m, url }));
  out = out.replace(/<main id="view">[\s\S]*?<\/main>/, `<main id="view">${body ? `<div class="wrap prerender">${body}</div>` : ""}</main>`);
  return { rel, url, html: out, noindex: !!m.noindex };
}
const recTxt = t => `${t.w}勝${t.l}敗${t.d}分${t.nc ? `（無効試合${t.nc}）` : ""}`;
const crumbs = list => `<nav class="crumb">${list.map(([h, t]) => h ? `<a href="${h}">${esc(t)}</a>` : `<span>${esc(t)}</span>`).join(" › ")}</nav>`;

const pages = [];

/* ---------- トップ（index.html 自身のメタ情報） ---------- */
const fightersN = Object.values(S.profiles).filter(p => p.riz.total > 0).length;
const riz = S.events.filter(e => e.rizin);
const HOME = {
  title: "FIGHT BOOK｜RIZINの勝敗予想とファンが語る見たい一戦",
  desc: `RIZINの対戦カードの勝者を予想して、ファン同士でコメントできる非公式ファンサイト。次に見たい一戦の提案や、全${fightersN}選手の戦績・レーティングも見られます。登録不要。`,
};

/* ---------- 選手ページ ---------- */
const gymOf = k => (AFFIL[k] || []).filter(r => r.cur && GYMS[r.g]).map(r => GYMS[r.g]);
for (const p of Object.values(S.profiles)) {
  if (!p.riz || p.riz.total === 0) continue;
  const k = p.key, f = S.roster[k], t = p.riz;
  const gyms = gymOf(k);
  const fights = p.fights.slice().reverse();
  const title = `${nm(k)}${nm(k) !== en(k) ? `（${en(k)}）` : ""}の戦績・試合結果・レーティング｜FIGHT BOOK`;
  const desc = `${nm(k)}${p.division ? `（${p.division}）` : ""}のRIZIN戦績は${t.w}勝${t.l}敗${t.d ? t.d + "分" : ""}。レーティング${Math.round(p.rating)}${p.rank ? `（全体${p.rank}位）` : ""}。全${p.fights.length}試合の結果・決着・所属ジム・ファンが見たい対戦カードをまとめています。`;
  const rows = fights.slice(0, 40).map(b => {
    const me = b.winner === k, opp = me ? b.loser : b.winner;
    const res = b.outcome === "NC" ? "無効試合" : b.outcome === "D" ? "引き分け" : me ? "勝ち" : "負け";
    return `<li>${fmt(b.date)} ${esc(b.event)}：<a href="/fighters/${enc(opp)}/">${esc(nm(opp))}</a>に${res}（${esc(METHOD[b.cat] || b.method || "")}${b.round ? ` ${esc(b.round)}R${b.time ? " " + esc(b.time) : ""}` : ""}）</li>`;
  }).join("");
  const body = crumbs([["/", "FIGHT BOOK"], ["/fighters/", "選手一覧"], [null, nm(k)]]) +
    `<h1>${esc(nm(k))}${nm(k) !== en(k) ? `<small>（${esc(en(k))}）</small>` : ""}</h1>` +
    (CATCH[k] ? `<p class="note">${esc(CATCH[k])}</p>` : "") +
    `<ul class="kv">${[["階級", p.division], ["国", p.country], ["生年月日", f && f.born], ["出身地", f && f.hometown], ["身長", f && f.height],
      ["RIZIN戦績", recTxt(t)], ["レーティング", `${Math.round(p.rating)}${p.rank ? `（全体${p.rank}位）` : ""}・最高${Math.round(p.peak)}`],
      ["勝ち方（RIZIN）", `KO/TKO ${t.ko}・一本 ${t.sub}・判定ほか ${t.dec + t.other}`],
      ["所属ジム", gyms.map(g => `<a href="/gyms/${enc(g.id)}/">${esc(g.name)}</a>`).join("、")]]
      .filter(r => r[1]).map(r => `<li><b>${r[0]}</b>：${r[0] === "所属ジム" ? r[1] : esc(r[1])}</li>`).join("")}</ul>` +
    `<h2>試合結果（新しい順）</h2><ul>${rows}</ul>` +
    `<p><a href="/create/?a=${enc(k)}">${esc(nm(k))}の次の相手を提案する</a> ・ <a href="/rankings/">ランキング</a></p>`;
  pages.push(page(`/fighters/${enc(k)}/`, { title, desc, type: "profile" }, body));
}

/* ---------- ジムページ ---------- */
const membersOf = id => Object.entries(AFFIL).filter(([k, rows]) => rows.some(r => r.g === id) && S.profiles[k] && S.profiles[k].riz.total > 0).map(([k]) => k);
for (const g of Object.values(GYMS)) {
  const mem = membersOf(g.id);
  if (!mem.length) continue;
  const place = [g.country, g.prefecture, g.city].filter(Boolean).join(" ");
  const title = `${g.name}の所属選手・RIZIN戦績｜FIGHT BOOK`;
  const desc = `${g.name}${place ? `（${place}）` : ""}に所属・在籍したRIZIN出場選手${mem.length}人と、その戦績をまとめています。`;
  const body = crumbs([["/", "FIGHT BOOK"], ["/gyms/", "ジム一覧"], [null, g.name]]) +
    `<h1>${esc(g.name)}</h1>` + (place ? `<p>所在地：${esc(place)}</p>` : "") +
    (g.established_year ? `<p>設立：${esc(g.established_year)}年</p>` : "") + (g.representative ? `<p>代表：${esc(g.representative)}</p>` : "") +
    `<h2>所属・在籍したRIZIN出場選手</h2><ul>${mem.map(k => `<li><a href="/fighters/${enc(k)}/">${esc(nm(k))}</a>（RIZIN ${recTxt(S.profiles[k].riz)}）</li>`).join("")}</ul>`;
  // 選手が1人だけのジムは中身が薄いので検索対象から外す
  pages.push(page(`/gyms/${enc(g.id)}/`, { title, desc, noindex: mem.length < 2 }, body));
}

/* ---------- 一覧・固定ページ ---------- */
const active = S.ranked.filter(p => p.active);
const link = k => `<a href="/fighters/${enc(k)}/">${esc(nm(k))}</a>`;
pages.push(page("/rankings/", { title: "RIZIN選手ランキング（レーティング順）｜FIGHT BOOK", desc: "RIZINのMMA試合から計算したEloレーティングによる現役選手ランキング。階級別・注目度・挑戦者魂・大物食いなどのランキングも。" },
  `<h1>RIZIN選手ランキング</h1><ol>${active.slice(0, 50).map(p => `<li>${link(p.key)}（${esc(p.division || "")}・レート${Math.round(p.rating)}・RIZIN ${recTxt(p.riz)}）</li>`).join("")}</ol>`));
const allF = Object.values(S.profiles).filter(p => p.riz.total > 0).sort((a, b) => b.rating - a.rating);
pages.push(page("/fighters/", { title: `RIZIN出場選手一覧（全${allF.length}人）｜FIGHT BOOK`, desc: `RIZINに出場した全${allF.length}選手の一覧。階級・戦績・レーティングから選手を探せます。` },
  `<h1>RIZIN出場選手一覧</h1><ul>${allF.map(p => `<li>${link(p.key)}${p.division ? `（${esc(p.division)}）` : ""}</li>`).join("")}</ul>`));
pages.push(page("/champions/", { title: "RIZIN歴代王者・タイトルマッチの歴史｜FIGHT BOOK", desc: "RIZINの各階級の現王者と、歴代のタイトルマッチの結果。" },
  `<h1>RIZIN王者とタイトルマッチの歴史</h1><ul>${S.titleFights.slice().reverse().map(f => `<li>${fmt(f.date)} ${esc(f.titleDiv || "")}：${link(f.winner)} vs ${link(f.loser)}（${esc(f.event)}）</li>`).join("")}</ul>`));
pages.push(page("/events/", { title: `RIZIN大会一覧・全試合結果（${riz.length}大会）｜FIGHT BOOK`, desc: "2015年からのRIZIN全大会のMMA試合結果を大会ごとに一覧できます。" },
  `<h1>RIZIN大会一覧</h1><ul>${riz.map(e => `<li>${fmt(e.date)} ${esc(e.name)}（MMA ${e.bouts.length}試合）</li>`).join("")}</ul>`));
pages.push(page("/stats/", { title: "RIZIN統計・記録（KO率・一本勝ち・連勝など）｜FIGHT BOOK", desc: "RIZINのMMA試合から集計した統計。KO率、一本勝ち数、最多出場、最長連勝、秒殺、番狂わせなど。" },
  `<h1>RIZIN統計・記録</h1><p>KO率・一本勝ち・最多出場・最長連勝・秒殺・番狂わせなどの記録をまとめています。</p>`));
pages.push(page("/gyms/", { title: "格闘技ジム一覧（RIZIN出場選手の所属）｜FIGHT BOOK", desc: "RIZIN出場選手が所属・在籍したジムの一覧。所属選手数・戦績・地域から探せます。" },
  `<h1>ジム一覧</h1><ul>${Object.values(GYMS).map(g => [g, membersOf(g.id).length]).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([g, n]) => `<li><a href="/gyms/${enc(g.id)}/">${esc(g.name)}</a>（${n}人）</li>`).join("")}</ul>`));
pages.push(page("/cards/", { title: "ファンが見たい対戦カード（急上昇・週間・新着）｜FIGHT BOOK", desc: "格闘技ファンが「次に見たい一戦」を提案し、投票・コメントで語り合うページ。ファンの提案であり、実際の対戦を決めるものではありません。" },
  `<h1>ファンが見たい対戦カード</h1><p>格闘技ファンが「次に見たい一戦」を提案し、「見たい！」とコメントで語り合います。</p>`));
pages.push(page("/predict/", { title: "大会の勝敗予想（RIZIN）｜FIGHT BOOK", desc: "RIZINの大会の対戦カードの勝敗を予想して、ファン同士で語り合うページ。みんなの予想の割合や、的中ランキングも見られます。" },
  `<h1>大会の勝敗予想</h1><p>大会の対戦カードの勝敗を予想して、ファン同士で語り合えます。</p>`));
pages.push(page("/about/", { title: "FIGHT BOOKについて｜FIGHT BOOK", desc: "FIGHT BOOKは、RIZINの全選手データと、ファン同士で見たい対戦を語り合う場を提供する非公式ファンサイトです。" }, `<h1>FIGHT BOOKについて</h1>`));
pages.push(page("/privacy/", { title: "プライバシーポリシー｜FIGHT BOOK", desc: "FIGHT BOOKのプライバシーポリシー（取得する情報・利用目的・広告・Cookie・お問い合わせ）。" }, `<h1>プライバシーポリシー</h1>`));
pages.push(page("/contact/", { title: "お問い合わせ｜FIGHT BOOK", desc: "FIGHT BOOKへのお問い合わせ・投稿の削除依頼・掲載内容の訂正依頼はこちら。" }, `<h1>お問い合わせ</h1>`));
// 検索対象にしないページ（ログイン・作成・マイページなど）
for (const [rel, title] of [["/compare/", "対戦データ比較"], ["/gyms/compare/", "ジム比較"], ["/create/", "見たい対戦を作る"], ["/me/", "マイページ"],
  ["/admin/", "管理"], ["/login/", "管理者ログイン"], ["/reset/", "パスワードの再設定"]]) {
  pages.push(page(rel, { title: `${title}｜FIGHT BOOK`, desc: HOME.desc, noindex: true }, ""));
}

/* ---------- 書き出し ---------- */
let n = 0;
for (const p of pages) {
  const file = path.join(ROOT, decodeURIComponent(p.rel), "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (old !== p.html) { fs.writeFileSync(file, p.html); n++; }
}
// トップ（index.html）のメタ情報も更新
const home = TEMPLATE.replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, meta({ ...HOME, url: `${SITE}/` }));
if (home !== TEMPLATE) fs.writeFileSync(path.join(ROOT, "index.html"), home);
// 404：存在しないURL。アプリが表示を引き受ける（検索対象外）
fs.writeFileSync(path.join(ROOT, "404.html"), home.replace(/<!--meta-->[\s\S]*?<!--\/meta-->/, meta({ title: "ページが見つかりません｜FIGHT BOOK", desc: HOME.desc, url: `${SITE}/`, noindex: true })));
// サイトマップ（ページ）と、サイトマップの索引・robots.txt
const today = new Date().toISOString().slice(0, 10);
const lastData = S.lastDate || today;
const urls = [`${SITE}/`, ...pages.filter(p => !p.noindex).map(p => p.url)];
fs.writeFileSync(path.join(ROOT, "sitemap-pages.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${esc(u)}</loc><lastmod>${lastData}</lastmod></url>`).join("\n")}\n</urlset>\n`);
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap>\n  <sitemap><loc>${SITE}/sitemap-cards.xml</loc></sitemap>\n</sitemapindex>\n`);
fs.writeFileSync(path.join(ROOT, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /login/\nDisallow: /me/\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`ページ ${pages.length}（更新 ${n}）・検索対象 ${urls.length}`);
