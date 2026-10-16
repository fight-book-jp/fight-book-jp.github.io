/* =====================================================================
   画面（ルーティングと各ページの表示）
   #/ トップ  #/rankings  #/fighters  #/fighter/<key>  #/champions
   #/events  #/stats
   ===================================================================== */
(function () {
  const S = window.STATS;
  const $view = document.getElementById("view");
  const DIVS = ["フライ級", "バンタム級", "フェザー級", "ライト級", "女子"];

  /* ---------- 小さな道具 ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^https:\/\//.test(u || "") ? u : "";
  const r1 = x => Math.round(x);
  const pct = x => Math.round(x * 100) + "%";
  const fmtDate = d => d ? d.replace(/-/g, ".") : "";
  const rec = p => `${p.w}-${p.l}-${p.d}`;
  const link = k => S.roster[k] ? `<a href="#/fighter/${k}">${esc(S.nameOf(k))}</a>` : esc(S.nameOf(k));
  const deltaHtml = d => !d ? "" : `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(r1(d))}</span>`;
  const statusBadge = f => f.status === "champion" ? '<span class="mini-badge">王者</span>'
                         : f.status === "former" ? '<span class="mini-badge former">元王者</span>' : "";
  const METHOD_JA = { KO: "KO/TKO", SUB: "一本", DEC: "判定", DQ: "反則", OTHER: "その他", D: "引き分け", NC: "無効" };

  const ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1c.3-1.2.4-2.5.4-3.8s-.1-2.6-.4-3.8ZM10 15V9l5.2 3L10 15Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.3 6.2V8.6a7.7 7.7 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.7Z"/></svg>'
  };
  const SNS_LABEL = { x: "X", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok" };
  const SIL = '<svg class="sil" viewBox="0 0 200 180" fill="currentColor" aria-hidden="true"><circle cx="100" cy="46" r="30"/><path d="M28 180c4-46 30-80 72-80s68 34 72 80Z"/></svg>';
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

  const snsItems = f => Object.entries(f.sns || {}).filter(([k, u]) => ICONS[k] && safeUrl(u));

  /* ---------- Instagram公式埋め込み ---------- */
  function igPermalink(f) {
    const m = String(f.igPost || "").match(/^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/);
    return m ? `https://www.instagram.com/${m[1]}/${m[2]}/` : "";
  }
  const igEmbed = url => `<blockquote class="instagram-media" data-instgrm-permalink="${url}?utm_source=ig_embed" data-instgrm-version="14"><a href="${url}" target="_blank" rel="noopener">Instagramで投稿を見る</a></blockquote>`;
  function loadInstagram() {
    if (!document.querySelector(".instagram-media")) return;
    if (window.instgrm) { window.instgrm.Embeds.process(); return; }
    if (document.getElementById("ig-embed-js")) return;
    const s = document.createElement("script");
    s.id = "ig-embed-js"; s.async = true; s.src = "https://www.instagram.com/embed.js";
    s.onload = () => window.instgrm && window.instgrm.Embeds.process();
    document.body.appendChild(s);
  }

  function pageHero(title, sub) {
    return `<section class="page-hero"><div class="in"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div></section>`;
  }

  /* ---------- 共通部品 ---------- */
  function rankTable(list, opts = {}) {
    const rows = list.map((f, i) => {
      const p = S.profiles[f.key];
      return `<tr>
        <td class="rank ${i < 3 ? "top" : ""}">${opts.showGlobal ? p.rank : i + 1}</td>
        <td><a class="who" href="#/fighter/${f.key}"><span><b>${esc(f.name)}</b>${statusBadge(f)}<small>${esc(f.en)}</small></span></a></td>
        <td>${esc(f.division)}</td>
        <td class="num">${rec(p)}${p.nc ? ` <span class="note">(${p.nc}NC)</span>` : ""}</td>
        <td class="r"><span class="rate">${r1(p.rating)}</span>${deltaHtml(p.lastDelta)}</td>
      </tr>`;
    }).join("");
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>選手</th><th>階級</th><th>戦績</th><th class="r">レート</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function champCards() {
    return `<div class="champ-grid">${DIVS.map(d => {
      const c = window.FIGHTERS.find(f => f.division === d && f.status === "champion");
      if (!c) {
        const last = S.titleFights.find(t => t.titleDiv === d);
        return `<div class="champ vacant"><div class="div">${d}</div><div class="nm">空位</div><div class="meta">${last ? `最後の王者：${esc(S.nameOf(last.winner))}` : ""}</div></div>`;
      }
      const p = S.profiles[c.key];
      return `<a class="champ" href="#/fighter/${c.key}"><div class="div">${d}</div><div class="nm">${esc(c.name)}</div><div class="meta">${rec(p)}・レート ${r1(p.rating)}</div></a>`;
    }).join("")}</div>`;
  }

  /* ---------- トップ ---------- */
  function viewHome() {
    const top = S.ranked.slice(0, 10);
    const streaks = S.ranked.filter(f => S.profiles[f.key].streak >= 2)
      .sort((a, b) => S.profiles[b.key].streak - S.profiles[a.key].streak).slice(0, 6);
    const rizinEvents = S.events.filter(e => e.rizin).length;
    return `
    <section class="hero"><div class="hero-in">
      <div class="kicker">RIZIN FIGHTER DATABASE</div>
      <h1>Fight Book</h1>
      <p>RIZIN主要ファイターのプロ全戦績から、レーティング・連勝・王者の歴史・統計を自動で計算する選手データベース</p>
      <div class="cta"><a class="btn primary" href="#/rankings">ランキングを見る</a><a class="btn" href="#/fighters">選手一覧</a></div>
      <div class="hero-stats">
        <div><b>${window.FIGHTERS.length}</b><small>掲載選手</small></div>
        <div><b>${S.fights.length}</b><small>収録試合</small></div>
        <div><b>${rizinEvents}</b><small>RIZIN大会</small></div>
      </div>
    </div></section>
    <div class="wrap">
      <section class="section">
        <div class="sec-head"><h2>Top 10<small>レーティング順</small></h2><a href="#/rankings">すべて見る ›</a></div>
        ${rankTable(top)}
      </section>
      <section class="section">
        <div class="sec-head"><h2>Champions<small>現王者</small></h2><a href="#/champions">王座の歴史 ›</a></div>
        ${champCards()}
      </section>
      <section class="section">
        <div class="sec-head"><h2>Win Streak<small>連勝中の選手</small></h2><a href="#/stats">統計 ›</a></div>
        <div class="tiles">${streaks.map(f => { const p = S.profiles[f.key];
          return `<div class="tile"><div class="lbl">${esc(f.division)}</div><div class="big">${p.streak}<small>連勝</small></div><div><a href="#/fighter/${f.key}">${esc(f.name)}</a></div><div class="sub">レート ${r1(p.rating)}・戦績 ${rec(p)}</div></div>`; }).join("")}</div>
      </section>
      <section class="section">
        <div class="sec-head"><h2>Highlights<small>統計ハイライト</small></h2><a href="#/stats">もっと見る ›</a></div>
        ${highlightTiles()}
      </section>
    </div>`;
  }

  function leader(fn, filter = () => true) {
    return S.ranked.filter(filter).slice().sort((a, b) => fn(S.profiles[b.key]) - fn(S.profiles[a.key]))[0];
  }
  function highlightTiles() {
    const ko = leader(p => p.koRate + p.w / 1e4, f => S.profiles[f.key].w >= 8);
    const sub = leader(p => p.sub);
    const most = leader(p => p.w + p.l + p.d + p.nc);
    const best = leader(p => p.best);
    const peak = leader(p => p.peak);
    const t = (lbl, f, big, unit, sub) => `<div class="tile"><div class="lbl">${lbl}</div><div class="big">${big}<small>${unit}</small></div><div><a href="#/fighter/${f.key}">${esc(f.name)}</a></div><div class="sub">${sub}</div></div>`;
    const P = k => S.profiles[k.key];
    return `<div class="tiles">
      ${t("KO率（8勝以上）", ko, pct(P(ko).koRate), "", `KO ${P(ko).ko} / ${P(ko).w}勝`)}
      ${t("一本勝ち数", sub, P(sub).sub, "回", `勝利の${pct(P(sub).sub / P(sub).w)}`)}
      ${t("最多試合数", most, P(most).w + P(most).l + P(most).d + P(most).nc, "試合", `戦績 ${rec(P(most))}`)}
      ${t("最長連勝", best, P(best).best, "連勝", `現在 ${P(best).streak}連勝中`)}
      ${t("最高レート", peak, r1(P(peak).peak), "", `現在 ${r1(P(peak).rating)}`)}
    </div>`;
  }

  /* ---------- ランキング ---------- */
  let rankDiv = "すべて";
  function viewRankings() {
    const list = S.ranked.filter(f => rankDiv === "すべて" || f.division === rankDiv);
    return pageHero("Rankings", "プロ全戦績から計算したEloレーティング順（初期値1500）。最後の試合での増減も表示しています。") + `
    <div class="wrap">
      <div class="filters"><div class="tabs" id="rankTabs">${["すべて", ...DIVS].map(d => `<button class="tab" aria-pressed="${d === rankDiv}" data-d="${d}">${d}</button>`).join("")}</div></div>
      ${rankTable(list, { showGlobal: rankDiv !== "すべて" })}
      <p class="note" style="margin-top:12px">${rankDiv !== "すべて" ? "左の数字は全体順位です。" : ""}レーティングは勝敗と相手の強さだけで決まり、タイトル戦は少し大きく動きます。対戦相手のうち名簿にいない選手は、手元にある試合データだけで評価しています。元谷友貴は戦績データが一部しかないため、ランキングには含めていません。</p>
    </div>`;
  }

  /* ---------- 選手一覧 ---------- */
  const rosterState = { div: "すべて", q: "", champ: false };
  function cardHtml(f) {
    const p = S.profiles[f.key];
    const ig = igPermalink(f);
    const badge = f.status === "champion" ? '<span class="badge">Champion</span>' : f.status === "former" ? '<span class="badge former">元王者</span>' : "";
    const initial = f.en ? f.en.trim().split(/\s+/).pop().charAt(0) : "";
    const img = safeUrl(f.photo);
    const top = ig ? `<div class="card-ig">${badge}${igEmbed(ig)}</div>`
      : `<a class="photo" href="#/fighter/${f.key}">${badge}${img ? `<img src="${esc(img)}" alt="${esc(f.name)}" loading="lazy">` : `<span class="initial">${esc(initial)}</span>${SIL}`}</a>`;
    const sns = snsItems(f).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener" aria-label="${esc(f.name)}の${SNS_LABEL[k]}" title="${SNS_LABEL[k]}">${ICONS[k]}</a>`).join("") || '<span class="none">SNS情報なし</span>';
    return `<article class="card${ig ? " has-ig" : ""}">${top}
      <div class="card-body">
        <div class="nick">${f.nick ? `"${esc(f.nick)}"` : ""}</div>
        <h2 class="name"><a href="#/fighter/${f.key}">${esc(f.name)}</a></h2>
        <div class="en">${esc(f.en)}</div>
        <div class="meta"><strong>${esc(f.division)}</strong>　${esc(f.country)}</div>
        <div class="card-nums">
          <div><small>戦績</small><b>${f.partial ? "—" : rec(p)}</b></div>
          <div><small>レート</small><b>${f.partial ? "—" : r1(p.rating)}</b></div>
          ${!f.partial && p.rank ? `<div><small>順位</small><b>#${p.rank}</b></div>` : ""}
        </div>
        <div class="foot"><div class="sns">${sns}</div><a class="more" href="#/fighter/${f.key}">プロフィール ›</a></div>
      </div></article>`;
  }
  function rosterGrid() {
    const q = rosterState.q.trim().toLowerCase();
    const list = window.FIGHTERS.filter(f =>
      (rosterState.div === "すべて" || f.division === rosterState.div) &&
      (!rosterState.champ || f.status === "champion") &&
      (!q || [f.name, f.en, f.nick, f.country, f.team].join(" ").toLowerCase().includes(q)));
    return { html: list.length ? list.map(cardHtml).join("") : '<div class="empty">該当する選手が見つかりません</div>', n: list.length };
  }
  function viewFighters() {
    const g = rosterGrid();
    return pageHero("Fighters", "RIZINで戦う主要ファイターの名簿。カードを押すと詳しいプロフィールと全戦績が見られます。") + `
    <div class="wrap">
      <div class="filters">
        <div class="search">${SEARCH_ICON}<input id="q" type="search" placeholder="選手名・ニックネーム・国で検索" value="${esc(rosterState.q)}" aria-label="選手を検索"></div>
        <div class="tabs" id="divTabs">${["すべて", ...DIVS].map(d => `<button class="tab" aria-pressed="${d === rosterState.div}" data-d="${d}">${d}</button>`).join("")}</div>
        <label class="toggle"><input type="checkbox" id="champ" ${rosterState.champ ? "checked" : ""}> 王者のみ</label>
        <div class="count" id="count">${g.n} 選手</div>
      </div>
      <div class="grid" id="grid">${g.html}</div>
    </div>`;
  }
  function refreshGrid() {
    const g = rosterGrid();
    document.getElementById("grid").innerHTML = g.html;
    document.getElementById("count").textContent = g.n + " 選手";
    document.querySelectorAll("#divTabs .tab").forEach(b => b.setAttribute("aria-pressed", b.dataset.d === rosterState.div));
    loadInstagram();
  }

  /* ---------- 選手詳細 ---------- */
  function ratingChart(hist) {
    if (hist.length < 2) return '<p class="note">試合数が少ないためグラフを表示できません。</p>';
    const W = 640, H = 200, P = 30;
    const ys = hist.map(h => h.r), min = Math.min(...ys, S.BASE) - 10, max = Math.max(...ys) + 10;
    const x = i => P + (W - P * 2) * (i / (hist.length - 1));
    const y = v => H - P + (-(H - P * 2)) * ((v - min) / (max - min));
    const pts = hist.map((h, i) => `${x(i).toFixed(1)},${y(h.r).toFixed(1)}`).join(" ");
    const baseY = y(S.BASE).toFixed(1);
    const last = hist[hist.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="レーティングの推移">
      <line x1="${P}" x2="${W - P}" y1="${baseY}" y2="${baseY}" stroke="currentColor" stroke-opacity=".2" stroke-dasharray="4 4"/>
      <text x="${P}" y="${+baseY - 6}" font-size="11" fill="currentColor" opacity=".5">1500</text>
      <polyline points="${pts}" fill="none" stroke="#d20a0a" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="${x(hist.length - 1)}" cy="${y(last.r)}" r="4.5" fill="#d20a0a"/>
      <text x="${P}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6">${hist[0].date.slice(0, 4)}</text>
      <text x="${W - P}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6" text-anchor="end">${last.date.slice(0, 4)}</text>
      <text x="${W - P}" y="${y(last.r) - 10}" font-size="13" font-weight="700" fill="currentColor" text-anchor="end">${r1(last.r)}</text>
    </svg>`;
  }

  function viewFighter(key) {
    const f = S.roster[key];
    if (!f) return pageHero("Not Found", "選手が見つかりません。") + `<div class="wrap"><a href="#/fighters">選手一覧へ戻る</a></div>`;
    const p = S.profiles[key];
    const ig = igPermalink(f);
    const rows = p.fights.slice().reverse().map(b => {
      const me = b.winner === key;
      const opp = me ? b.loser : b.winner;
      const res = b.outcome === "NC" ? "NC" : b.outcome === "D" ? "D" : me ? "W" : "L";
      const d = b.delta && b.delta[key];
      return `<tr>
        <td class="c"><span class="res ${res}">${res}</span></td>
        <td class="opp">${link(opp)}</td>
        <td>${esc(METHOD_JA[b.cat] || "")}<div class="ev">${esc(b.method)}</div></td>
        <td>${b.rizin ? '<span class="tag-rizin">RIZIN</span> ' : ""}${esc(b.event)}${b.rizinTitle ? ' <span class="mini-badge">TITLE</span>' : ""}<div class="ev">${fmtDate(b.date)}</div></td>
        <td class="c num">${esc(b.round || "–")}${b.time ? `<div class="ev">${esc(b.time)}</div>` : ""}</td>
        <td class="r">${d ? deltaHtml(d) : ""}</td>
      </tr>`;
    }).join("");
    const kv = [["階級", f.division], ["国籍", f.country], ["生年月日", f.born], ["出身地", f.hometown], ["身長", f.height], ["所属", f.team]]
      .filter(r => r[1]).map(r => `<tr><th>${r[0]}</th><td>${esc(r[1])}</td></tr>`).join("");
    const tot = p.w || 1;
    const sns = snsItems(f).map(([k, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${ICONS[k]}${SNS_LABEL[k]}</a>`).join("");
    return `
    <section class="f-hero"><div class="in">
      <div>
        <div class="nick">${f.status === "champion" ? "現王者　" : f.status === "former" ? "元王者　" : ""}${f.nick ? `"${esc(f.nick)}"` : ""}</div>
        <h1>${esc(f.name)}</h1>
        <div class="en">${esc(f.en)}</div>
        <div class="tags"><span>${esc(f.division)}</span>${f.country ? `<span>${esc(f.country)}</span>` : ""}${p.streak >= 2 ? `<span>${p.streak}連勝中</span>` : ""}</div>
      </div>
      <div class="f-rating">${f.partial ? `<small>レーティング</small><b>—</b><div class="rk">データ不足</div>` :
        `<small>レーティング</small><b>${r1(p.rating)}</b><div class="rk">全体 #${p.rank}・最高 ${r1(p.peak)}</div>`}</div>
    </div></section>
    <div class="wrap">
      <div class="f-record">
        <div><b>${p.w}</b><small>勝</small></div><div><b>${p.l}</b><small>敗</small></div>
        <div><b>${p.d}</b><small>分</small></div><div><b>${p.nc}</b><small>無効</small></div>
      </div>
      ${f.partial ? `<p class="note" style="margin-top:10px">この選手は全戦績を集めきれていないため、名簿のほかの選手との対戦だけを表示しています。名簿上の戦績：RIZIN ${f.record ? f.record.join("-") : "—"}</p>` : ""}
      <div class="f-cols">
        <div>
          <div class="panel chart"><h3>レーティングの推移</h3>${ratingChart(p.history)}</div>
          <div class="section">
            <div class="sec-head"><h2>Fight History<small>全${p.fights.length}試合（RIZIN ${p.rw}-${p.rl}${p.rd ? "-" + p.rd : ""}）</small></h2></div>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="c">結果</th><th>対戦相手</th><th>決着</th><th>大会</th><th class="c">R</th><th class="r">レート</th></tr></thead><tbody>${rows}</tbody></table></div>
          </div>
        </div>
        <div>
          <div class="panel"><h3>勝ち方</h3>
            <div class="bar"><span style="width:${p.ko / tot * 100}%;background:#d20a0a"></span><span style="width:${p.sub / tot * 100}%;background:#c9a227"></span><span style="width:${(p.dec + p.other) / tot * 100}%;background:#888"></span></div>
            <div class="legend"><span><i style="background:#d20a0a"></i>KO/TKO ${p.ko}</span><span><i style="background:#c9a227"></i>一本 ${p.sub}</span><span><i style="background:#888"></i>判定ほか ${p.dec + p.other}</span></div>
            <table class="kv" style="margin-top:12px">
              <tr><th>フィニッシュ率</th><td>${pct(p.finishRate)}</td></tr>
              <tr><th>現在の連勝</th><td>${p.streak}</td></tr>
              <tr><th>最長連勝</th><td>${p.best}</td></tr>
              <tr><th>最後の試合</th><td>${p.last ? fmtDate(p.last.date) : "—"}</td></tr>
            </table>
          </div>
          <div class="panel" style="margin-top:16px"><h3>プロフィール</h3><table class="kv">${kv}</table>${f.note ? `<p style="font-size:14px;margin:12px 0 0">${esc(f.note)}</p>` : ""}</div>
          ${sns ? `<div class="panel" style="margin-top:16px"><h3>SNS</h3><div class="m-sns">${sns}</div></div>` : ""}
          ${ig ? `<div class="panel card-ig" style="margin-top:16px;padding:12px">${igEmbed(ig)}</div>` : ""}
        </div>
      </div>
    </div>`;
  }

  /* ---------- 王者 ---------- */
  function viewChampions() {
    const byDiv = DIVS.map(d => {
      const list = S.titleFights.filter(t => t.titleDiv === d);
      if (!list.length) return "";
      const rows = list.map(t => {
        const kind = /Defended/i.test(t.note) ? "防衛" : /Won/i.test(t.note) || /For the/i.test(t.note) ? "獲得" : "";
        return `<tr><td class="num">${fmtDate(t.date)}</td><td class="opp">${link(t.winner)} <span class="note">${kind}</span></td><td class="opp">${link(t.loser)}</td><td>${esc(METHOD_JA[t.cat] || "")}</td><td class="ev">${esc(t.event)}</td></tr>`;
      }).join("");
      return `<section class="section"><div class="sec-head"><h2>${d}<small>タイトル戦の記録</small></h2></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>日付</th><th>勝者</th><th>敗者</th><th>決着</th><th>大会</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join("");
    return pageHero("Champions", "各階級の現王者と、RIZINタイトル戦の記録。") + `
    <div class="wrap">
      <section class="section"><div class="sec-head"><h2>Current<small>現王者</small></h2></div>${champCards()}</section>
      ${byDiv}
      <p class="note" style="margin-top:14px">タイトル戦の記録は、名簿の選手が出場した試合だけが対象です。</p>
    </div>`;
  }

  /* ---------- 大会一覧 ---------- */
  let evRizinOnly = true, evYear = "すべて";
  function viewEvents() {
    const years = [...new Set(S.events.filter(e => !evRizinOnly || e.rizin).map(e => e.date.slice(0, 4)))];
    if (evYear !== "すべて" && !years.includes(evYear)) evYear = "すべて";
    const list = S.events.filter(e => (!evRizinOnly || e.rizin) && (evYear === "すべて" || e.date.startsWith(evYear)));
    const cards = list.map((e, i) => {
      const rows = e.bouts.map(b => `<tr>
        <td class="opp">${b.outcome === "W" ? "" : ""}${link(b.winner)}</td>
        <td class="c">${b.outcome === "W" ? '<span class="res W">W</span>' : `<span class="res ${b.outcome}">${b.outcome}</span>`}</td>
        <td class="opp">${link(b.loser)}</td>
        <td>${esc(METHOD_JA[b.cat] || "")}${b.round ? `<span class="ev">　${esc(b.round)}R ${esc(b.time)}</span>` : ""}</td>
        <td>${b.rizinTitle ? '<span class="mini-badge">TITLE</span> ' + esc(b.titleDiv) : ""}</td></tr>`).join("");
      return `<details class="ev-card" ${i < 3 ? "open" : ""}>
        <summary><span class="ev-date">${fmtDate(e.date)}</span>${e.rizin ? '<span class="tag-rizin">RIZIN</span>' : ""}<span class="ev-name">${esc(e.name)}</span><span class="ev-count">${e.bouts.length}試合</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></summary>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>勝者</th><th class="c"></th><th>敗者</th><th>決着</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
      </details>`;
    }).join("");
    return pageHero("Events", "名簿の選手が出場した大会と試合結果。") + `
    <div class="wrap">
      <div class="filters">
        <div class="tabs" id="yearTabs">${["すべて", ...years].map(y => `<button class="tab" aria-pressed="${y === evYear}" data-y="${y}">${y}</button>`).join("")}</div>
        <label class="toggle"><input type="checkbox" id="rizinOnly" ${evRizinOnly ? "checked" : ""}> RIZINの大会のみ</label>
        <div class="count">${list.length} 大会</div>
      </div>
      <div class="ev-list">${cards || '<div class="empty">該当する大会がありません</div>'}</div>
      <p class="note" style="margin-top:14px">各大会には、名簿に載っている選手の試合だけを表示しています（引き分け・無効試合は左右の並びに意味はありません）。</p>
    </div>`;
  }

  /* ---------- 統計 ---------- */
  function statTable(title, sub, fn, fmt, filter = () => true, n = 10) {
    const list = S.ranked.filter(filter).slice().sort((a, b) => fn(S.profiles[b.key]) - fn(S.profiles[a.key])).slice(0, n);
    const rows = list.map((f, i) => { const p = S.profiles[f.key];
      return `<tr><td class="rank ${i < 3 ? "top" : ""}">${i + 1}</td><td><a class="who" href="#/fighter/${f.key}"><span><b>${esc(f.name)}</b><small>${esc(f.division)}</small></span></a></td><td class="r"><span class="rate">${fmt(p)}</span></td></tr>`; }).join("");
    return `<section class="section"><div class="sec-head"><h2>${title}<small>${sub}</small></h2></div>
      <div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>${rows}</tbody></table></div></section>`;
  }
  function viewStats() {
    return pageHero("Stats", "プロ全戦績から計算した各種ランキング。") + `
    <div class="wrap">
      ${highlightTiles()}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 24px">
        ${statTable("KO Rate", "KO率（8勝以上）", p => p.koRate, p => pct(p.koRate), f => S.profiles[f.key].w >= 8)}
        ${statTable("Finish Rate", "フィニッシュ率（8勝以上）", p => p.finishRate, p => pct(p.finishRate), f => S.profiles[f.key].w >= 8)}
        ${statTable("Submissions", "一本勝ち数", p => p.sub, p => p.sub)}
        ${statTable("Knockouts", "KO/TKO勝ち数", p => p.ko, p => p.ko)}
        ${statTable("Win Streak", "現在の連勝", p => p.streak, p => p.streak)}
        ${statTable("Longest Streak", "最長連勝", p => p.best, p => p.best)}
        ${statTable("Most Fights", "プロ試合数", p => p.w + p.l + p.d + p.nc, p => p.w + p.l + p.d + p.nc)}
        ${statTable("RIZIN Wins", "RIZINでの勝利数", p => p.rw, p => p.rw)}
        ${statTable("Peak Rating", "最高レーティング", p => p.peak, p => r1(p.peak))}
      </div>
    </div>`;
  }

  /* ---------- ルーター ---------- */
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [page, arg] = h.split("/");
    let html;
    switch (page) {
      case "rankings": html = viewRankings(); break;
      case "fighters": html = viewFighters(); break;
      case "fighter": html = viewFighter(decodeURIComponent(arg || "")); break;
      case "champions": html = viewChampions(); break;
      case "events": html = viewEvents(); break;
      case "stats": html = viewStats(); break;
      default: html = viewHome();
    }
    $view.innerHTML = html;
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === page || (page === "fighter" && a.dataset.r === "fighters")));
    document.getElementById("nav").classList.remove("open");
    document.getElementById("menuBtn").setAttribute("aria-expanded", "false");
    const titles = { rankings: "ランキング", fighters: "選手一覧", champions: "王者", events: "大会一覧", stats: "統計" };
    document.title = (page === "fighter" && S.roster[arg] ? S.roster[arg].name : titles[page] || "RIZIN選手データベース") + "｜FIGHT BOOK";
    window.scrollTo(0, 0);
    loadInstagram();
  }

  /* ---------- 画面内の操作 ---------- */
  $view.addEventListener("click", e => {
    const t = e.target.closest("button.tab"); if (!t) return;
    if (t.closest("#rankTabs")) { rankDiv = t.dataset.d; $view.innerHTML = viewRankings(); }
    else if (t.closest("#divTabs")) { rosterState.div = t.dataset.d; refreshGrid(); }
    else if (t.closest("#yearTabs")) { evYear = t.dataset.y; $view.innerHTML = viewEvents(); }
  });
  $view.addEventListener("input", e => { if (e.target.id === "q") { rosterState.q = e.target.value; refreshGrid(); } });
  $view.addEventListener("change", e => {
    if (e.target.id === "champ") { rosterState.champ = e.target.checked; refreshGrid(); }
    if (e.target.id === "rizinOnly") { evRizinOnly = e.target.checked; $view.innerHTML = viewEvents(); }
  });
  document.getElementById("menuBtn").addEventListener("click", () => {
    const n = document.getElementById("nav"); n.classList.toggle("open");
    document.getElementById("menuBtn").setAttribute("aria-expanded", n.classList.contains("open"));
  });

  window.addEventListener("hashchange", route);
  route();
})();
