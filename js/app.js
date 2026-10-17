/* =====================================================================
   画面（ルーティングと各ページの表示）
   #/ トップ  #/rankings  #/fighters  #/fighter/<key>  #/champions
   #/events  #/stats
   ===================================================================== */
(function () {
  const S = window.STATS;
  const $view = document.getElementById("view");
  const DIVS = ["フライ級", "バンタム級", "フェザー級", "ライト級", "重量級", "女子"];
  const CHAMP_DIVS = [
    { t: "フライ級", r: "フライ級" }, { t: "バンタム級", r: "バンタム級" }, { t: "フェザー級", r: "フェザー級" },
    { t: "ライト級", r: "ライト級" }, { t: "ライトヘビー級", r: null }, { t: "女子スーパーアトム級", r: null }];

  /* ---------- 小さな道具 ---------- */
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = u => /^https:\/\//.test(u || "") ? u : "";
  const r1 = x => Math.round(x);
  const pct = x => Math.round(x * 100) + "%";
  const fmtDate = d => d ? d.replace(/-/g, ".") : "";
  const rec = t => `${t.w}-${t.l}-${t.d}`;
  const P = k => S.profiles[k];
  const link = k => `<a href="#/fighter/${encodeURIComponent(k)}">${esc(S.nameOf(k))}</a>`;
  const deltaHtml = d => !d ? "" : `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"}${Math.abs(r1(d))}</span>`;
  const statusBadge = k => { const f = S.roster[k]; if (!f) return "";
    return f.status === "champion" ? '<span class="mini-badge">王者</span>' : f.status === "former" ? '<span class="mini-badge former">元王者</span>' : ""; };
  const METHOD_JA = { KO: "KO/TKO", SUB: "一本", DEC: "判定", DQ: "反則", OTHER: "その他", D: "引き分け", NC: "無効" };
  const subName = k => { const en = S.enOf(k), nm = S.nameOf(k); return nm !== en ? en : (S.countryOf(k) || ""); };

  const ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1c.3-1.2.4-2.5.4-3.8s-.1-2.6-.4-3.8ZM10 15V9l5.2 3L10 15Z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9a6.3 6.3 0 1 0 5.3 6.2V8.6a7.7 7.7 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.7Z"/></svg>'
  };
  ICONS.site = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z"/></svg>';
  const SNS_LABEL = { x: "X", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", site: "公式サイト" };
  const SNS_ORDER = ["x", "instagram", "youtube", "tiktok", "site"];
  const SIL = '<svg class="sil" viewBox="0 0 200 180" fill="currentColor" aria-hidden="true"><circle cx="100" cy="46" r="30"/><path d="M28 180c4-46 30-80 72-80s68 34 72 80Z"/></svg>';
  const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  // 名簿のSNSに data/profiles.js の追加分（名簿外の選手を含む）を重ねる
  const profileOf = key => { const f = S.roster[key] || {}; const x = (window.SNS_EXTRA || {})[key] || {};
    return { ...f, key, sns: { ...(f.sns || {}), ...x }, youtubeChannelId: f.youtubeChannelId || x.youtubeChannelId }; };
  const snsItems = f => SNS_ORDER.map(k => [k, f && f.sns && f.sns[k]]).filter(([k, u]) => ICONS[k] && safeUrl(u));

  /* ---------- Instagram公式埋め込み ---------- */
  function igPermalink(f) {
    const m = String((f && f.igPost) || "").match(/^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([A-Za-z0-9_-]+)/);
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

  const pageHero = (title, sub) => `<section class="page-hero"><div class="in"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ""}</div></section>`;
  const tabs = (id, list, cur, attr = "d") => `<div class="tabs" id="${id}">${list.map(d => `<button class="tab" aria-pressed="${d === cur}" data-${attr}="${esc(d)}">${esc(d)}</button>`).join("")}</div>`;

  /* ---------- 共通部品 ---------- */
  function rankTable(list, opts = {}) {
    const rows = list.map((p, i) => `<tr>
        <td class="rank ${i < 3 && !opts.offset ? "top" : ""}">${opts.showGlobal ? p.rank : i + 1 + (opts.offset || 0)}</td>
        <td><a class="who" href="#/fighter/${encodeURIComponent(p.key)}"><span><b>${esc(S.nameOf(p.key))}</b>${statusBadge(p.key)}<small>${esc(subName(p.key))}</small></span></a></td>
        <td>${esc(p.division || "—")}</td>
        <td class="num">${rec(p.riz)}${p.riz.nc ? ` <span class="note">(${p.riz.nc}NC)</span>` : ""}</td>
        <td class="r"><span class="rate">${r1(p.rating)}</span>${deltaHtml(p.lastDelta)}</td>
      </tr>`).join("");
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>選手</th><th>階級</th><th>RIZIN戦績</th><th class="r">レート</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">該当なし</td></tr>'}</tbody></table></div>`;
  }

  function champCards() {
    return `<div class="champ-grid">${CHAMP_DIVS.map(({ t, r }) => {
      const c = r && window.FIGHTERS.find(f => f.division === r && f.status === "champion");
      if (!c) {
        const last = S.titleFights.find(x => x.titleDiv === t);
        return `<div class="champ vacant"><div class="div">${t}</div><div class="nm">空位</div><div class="meta">${last ? `最後の王者：${esc(S.nameOf(last.winner))}` : ""}</div></div>`;
      }
      const p = P(c.key);
      return `<a class="champ" href="#/fighter/${c.key}"><div class="div">${t}</div><div class="nm">${esc(c.name)}</div><div class="meta">RIZIN ${rec(p.riz)}・レート ${r1(p.rating)}</div></a>`;
    }).join("")}</div>`;
  }

  const activeRanked = () => S.ranked.filter(p => p.active);

  /* ---------- トップ ---------- */
  function viewHome() {
    const top = activeRanked().slice(0, 10);
    const streaks = activeRanked().filter(p => p.riz.streak >= 3).sort((a, b) => b.riz.streak - a.riz.streak || b.rating - a.rating).slice(0, 8);
    const riz = S.events.filter(e => e.rizin);
    const fighters = Object.values(S.profiles).filter(p => p.riz.total > 0).length;
    const bouts = riz.reduce((n, e) => n + e.bouts.length, 0);
    const latest = riz[0];
    return `
    <section class="hero"><div class="hero-in">
      <div class="kicker">RIZIN FIGHTER DATABASE</div>
      <h1>Fight Book</h1>
      <p>2015年からのRIZIN全大会のMMA試合をもとに、全選手のレーティング・戦績・王座の歴史・統計を自動で計算する選手データベース</p>
      <div class="cta"><a class="btn primary" href="#/rankings">ランキングを見る</a><a class="btn" href="#/fighters">選手一覧</a></div>
      <div class="hero-stats">
        <div><b>${fighters}</b><small>出場選手</small></div>
        <div><b>${bouts}</b><small>MMA試合</small></div>
        <div><b>${riz.length}</b><small>大会</small></div>
      </div>
    </div></section>
    <div class="wrap">
      <section class="section">
        <div class="sec-head"><h2>Top 10<small>現役選手のレーティング順</small></h2><a href="#/rankings">すべて見る ›</a></div>
        ${rankTable(top)}
      </section>
      <section class="section">
        <div class="sec-head"><h2>Champions<small>現王者</small></h2><a href="#/champions">王座の歴史 ›</a></div>
        ${champCards()}
      </section>
      <section class="section">
        <div class="sec-head"><h2>Win Streak<small>RIZINで連勝中</small></h2><a href="#/stats">統計 ›</a></div>
        <div class="tiles">${streaks.map(p => `<div class="tile"><div class="lbl">${esc(p.division)}</div><div class="big">${p.riz.streak}<small>連勝</small></div><div>${link(p.key)}</div><div class="sub">レート ${r1(p.rating)}・RIZIN ${rec(p.riz)}</div></div>`).join("")}</div>
      </section>
      ${latest ? `<section class="section">
        <div class="sec-head"><h2>Latest<small>最新大会</small></h2><a href="#/events">大会一覧 ›</a></div>
        ${eventCard(latest, true)}
      </section>` : ""}
      <section class="section">
        <div class="sec-head"><h2>Highlights<small>統計ハイライト</small></h2><a href="#/stats">もっと見る ›</a></div>
        ${highlightTiles()}
      </section>
    </div>`;
  }

  const leader = (fn, filter = () => true) => S.ranked.filter(filter).slice().sort((a, b) => fn(b) - fn(a))[0];
  function highlightTiles() {
    const ko = leader(p => p.riz.koRate + p.riz.w / 1e4, p => p.riz.w >= 5);
    const sub = leader(p => p.riz.sub);
    const most = leader(p => p.riz.total);
    const best = leader(p => p.riz.best);
    const peak = leader(p => p.peak);
    const t = (lbl, p, big, unit, sub) => `<div class="tile"><div class="lbl">${lbl}</div><div class="big">${big}<small>${unit}</small></div><div>${link(p.key)}</div><div class="sub">${sub}</div></div>`;
    return `<div class="tiles">
      ${t("KO率（RIZIN 5勝以上）", ko, pct(ko.riz.koRate), "", `KO ${ko.riz.ko} / ${ko.riz.w}勝`)}
      ${t("一本勝ち数", sub, sub.riz.sub, "回", `RIZIN ${rec(sub.riz)}`)}
      ${t("RIZIN最多出場", most, most.riz.total, "試合", `RIZIN ${rec(most.riz)}`)}
      ${t("RIZIN最長連勝", best, best.riz.best, "連勝", `現在 ${best.riz.streak}連勝中`)}
      ${t("最高レート", peak, r1(peak.peak), "", `現在 ${r1(peak.rating)}`)}
    </div>`;
  }

  /* ---------- ランキング ---------- */
  const RANK_CATS = [
    { id: "power",     label: "実力",     en: "Pound for Pound", desc: `RIZINのMMA試合から計算したEloレーティング順（初期値1500・RIZINで${S.MIN_RANK_FIGHTS}試合以上）。勝敗と相手の強さで決まり、タイトル戦は少し大きく動きます。` },
    { id: "spotlight", label: "注目度",   en: "Spotlight",       desc: "RIZINの「顔」度。メインイベント×5点＋タイトル戦×4点＋大晦日・超RIZIN出場×2点＋出場1試合ごとに1点で計算。" },
    { id: "grit",      label: "挑戦者魂", en: "Fighting Spirit",  desc: "男気ランキング。試合前のレートが自分より上の相手と戦った数＋その相手に勝った数×2で計算。格上に挑み続けた選手ほど上位です。" },
    { id: "upset",     label: "大物食い", en: "Giant Killer",    desc: "番狂わせの大きさ。格上（試合前レートが40以上上）に勝った試合の、レート差の合計で順位を付けています。" },
    { id: "quick",     label: "秒殺",     en: "Fastest Finish",  desc: "1ラウンドで決着したKO・一本勝ちを、決着タイムの早い順に並べた試合ランキング。" },
    { id: "nye",       label: "大晦日",   en: "New Year's Eve",  desc: "年末の大晦日大会への出場回数ランキング。RIZINの年末を彩ってきた選手たち。" },
    { id: "music",     label: "入場曲",   en: "Walkout Songs",   desc: "選手の入場曲コレクション。♡を押すと、このブラウザにお気に入りとして保存され「あなたのランキング」の上位に並びます。▶で試聴できます。" },
  ];
  const rankState = { cat: "power", div: "すべて", active: true };
  const LIKE_KEY = "fb_song_likes";
  const getLikes = () => { try { return JSON.parse(localStorage.getItem(LIKE_KEY) || "{}"); } catch (e) { return {}; } };
  const setLikes = o => { try { localStorage.setItem(LIKE_KEY, JSON.stringify(o)); } catch (e) {} };

  function scoreTable(list, head, cell, opts = {}) {
    const rows = list.map((p, i) => `<tr>
        <td class="rank ${i < 3 ? "top" : ""}">${i + 1}</td>
        <td><a class="who" href="#/fighter/${encodeURIComponent(p.key)}"><span><b>${esc(S.nameOf(p.key))}</b>${statusBadge(p.key)}<small>${esc(subName(p.key))}</small></span></a></td>
        <td>${esc(p.division || "—")}</td>
        <td class="ev">${opts.detail ? opts.detail(p) : ""}</td>
        <td class="r"><span class="rate">${cell(p)}</span></td></tr>`).join("");
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>選手</th><th>階級</th><th>内訳</th><th class="r">${head}</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="empty">該当なし</td></tr>'}</tbody></table></div>`;
  }
  function boutTable(list, head, cell) {
    const rows = list.map((f, i) => `<tr>
        <td class="rank ${i < 3 ? "top" : ""}">${i + 1}</td>
        <td class="opp">${link(f.winner)}<div class="ev">vs ${esc(S.nameOf(f.loser))}</div></td>
        <td>${esc(METHOD_JA[f.cat] || "")}<div class="ev">${esc(f.method)}</div></td>
        <td class="ev">${esc(f.event)}<br>${fmtDate(f.date)}</td>
        <td class="r"><span class="rate">${cell(f)}</span></td></tr>`).join("");
    return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>勝者</th><th>決着</th><th>大会</th><th class="r">${head}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function musicTable() {
    const likes = getLikes();
    const list = Object.keys(window.ENTRANCE || {}).filter(k => P(k)).map(k => ({ k, song: window.ENTRANCE[k][0], p: P(k) }))
      .sort((a, b) => (likes[b.k] ? 1 : 0) - (likes[a.k] ? 1 : 0) || b.p.x.spotlight - a.p.x.spotlight);
    const rows = list.map((r, i) => `<tr>
        <td class="rank ${i < 3 ? "top" : ""}">${i + 1}</td>
        <td><a class="who" href="#/fighter/${encodeURIComponent(r.k)}"><span><b>${esc(S.nameOf(r.k))}</b><small>${esc(r.p.division || "")}</small></span></a></td>
        <td><b>${esc(r.song.title)}</b><div class="ev">${esc(r.song.artist)}</div></td>
        <td class="r nowrap">
          <button class="icon-btn play-song" data-yt="${esc(r.song.yt)}" aria-label="${esc(r.song.title)}を試聴" title="試聴">▶</button>
          <button class="icon-btn like ${likes[r.k] ? "on" : ""}" data-like="${esc(r.k)}" aria-pressed="${!!likes[r.k]}" aria-label="お気に入り" title="お気に入り">${likes[r.k] ? "♥" : "♡"}</button>
        </td></tr>
        <tr class="song-row" hidden><td colspan="4"><div class="yt-wrap" data-for="${esc(r.song.yt)}"></div></td></tr>`).join("");
    const liked = Object.keys(likes).filter(k => likes[k] && window.ENTRANCE[k]).length;
    return `<p class="note" style="margin:0 0 10px">お気に入り ${liked} 曲（あなたのランキング）／登録 ${list.length} 曲。並び順：お気に入り → 注目度。</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>選手</th><th>入場曲</th><th class="r"></th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function viewRankings() {
    const cat = RANK_CATS.find(c => c.id === rankState.cat) || RANK_CATS[0];
    const pool = Object.values(S.profiles).filter(p => p.riz.total > 0 && (rankState.div === "すべて" || p.division === rankState.div) && (!rankState.active || p.active));
    const sortBy = (fn, min = 1) => pool.filter(p => fn(p) >= min).sort((a, b) => fn(b) - fn(a) || b.rating - a.rating).slice(0, 50);
    const needsFilter = ["power", "spotlight", "grit", "upset", "nye"].includes(cat.id);
    let body = "";
    if (cat.id === "power") {
      const list = S.ranked.filter(p => (rankState.div === "すべて" || p.division === rankState.div) && (!rankState.active || p.active));
      body = rankTable(list, { showGlobal: rankState.div !== "すべて" || rankState.active }) +
        `<p class="note" style="margin-top:12px">左の数字は全体（引退・移籍した選手を含む）での順位です。階級は直近の試合の階級です。</p>`;
    } else if (cat.id === "spotlight") {
      body = scoreTable(sortBy(p => p.x.spotlight), "注目度", p => p.x.spotlight, { detail: p => `メイン${p.x.main}・タイトル戦${p.x.title}・ビッグイベント${p.x.big}・出場${p.riz.total}` });
    } else if (cat.id === "grit") {
      body = scoreTable(sortBy(p => p.x.grit), "挑戦者魂", p => p.x.grit, { detail: p => `格上と${p.x.challenge}戦・うち${p.x.challengeWin}勝` });
    } else if (cat.id === "upset") {
      body = scoreTable(sortBy(p => Math.round(p.x.upsetGap)), "番狂わせ度", p => Math.round(p.x.upsetGap), { detail: p => `格上撃破 ${p.x.upsets}回` }) +
        `<div class="section"><div class="sec-head"><h2>Biggest Upsets<small>番狂わせ 試合ベスト10</small></h2></div>${boutTable(S.upsets.slice(0, 10), "レート差", f => "+" + Math.round(f.gap))}</div>`;
    } else if (cat.id === "quick") {
      body = boutTable(S.quickest.slice(0, 30), "決着", f => f.time);
    } else if (cat.id === "nye") {
      body = scoreTable(sortBy(p => p.x.nye), "大晦日出場", p => p.x.nye + "回", { detail: p => `RIZIN通算 ${rec(p.riz)}` });
    } else if (cat.id === "music") {
      body = musicTable();
    }
    return pageHero("Rankings", "強さだけじゃない、いろんな切り口のランキング。") + `
    <div class="wrap">
      <div class="cat-tabs" id="catTabs" role="tablist">${RANK_CATS.map(c => `<button role="tab" class="cat ${c.id === cat.id ? "on" : ""}" aria-selected="${c.id === cat.id}" data-cat="${c.id}"><b>${c.label}</b><small>${c.en}</small></button>`).join("")}</div>
      <p class="cat-desc">${cat.desc}</p>
      ${needsFilter ? `<div class="filters">
        ${tabs("rankTabs", ["すべて", ...DIVS], rankState.div)}
        <label class="toggle"><input type="checkbox" id="activeOnly" ${rankState.active ? "checked" : ""}> 現役のみ（直近2年に試合）</label>
      </div>` : ""}
      ${body}
    </div>`;
  }

  /* ---------- 選手一覧 ---------- */
  const rosterState = { div: "すべて", q: "", champ: false };
  const allState = { q: "", div: "すべて", sort: "rating", page: 1 };
  const PAGE = 50;

  function cardHtml(f) {
    const p = P(f.key);
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
          <div><small>RIZIN戦績</small><b>${rec(p.riz)}</b></div>
          <div><small>レート</small><b>${r1(p.rating)}</b></div>
          ${p.rank ? `<div><small>順位</small><b>#${p.rank}</b></div>` : ""}
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
    return list.length ? list.map(cardHtml).join("") : '<div class="empty">該当する選手が見つかりません</div>';
  }

  function allList() {
    const q = allState.q.trim().toLowerCase();
    let list = Object.values(S.profiles).filter(p => p.riz.total > 0 &&
      (allState.div === "すべて" || p.division === allState.div) &&
      (!q || [S.nameOf(p.key), S.enOf(p.key), p.country].join(" ").toLowerCase().includes(q)));
    const sorters = {
      rating: (a, b) => (b.riz.total >= S.MIN_RANK_FIGHTS) - (a.riz.total >= S.MIN_RANK_FIGHTS) || b.rating - a.rating,
      fights: (a, b) => b.riz.total - a.riz.total || b.rating - a.rating,
      wins: (a, b) => b.riz.w - a.riz.w || b.rating - a.rating,
      recent: (a, b) => (b.lastRizin ? b.lastRizin.date : "").localeCompare(a.lastRizin ? a.lastRizin.date : ""),
      name: (a, b) => S.enOf(a.key).localeCompare(S.enOf(b.key)),
    };
    return list.sort(sorters[allState.sort]);
  }
  function allTable() {
    const list = allList();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    allState.page = Math.min(allState.page, pages);
    const slice = list.slice((allState.page - 1) * PAGE, allState.page * PAGE);
    const rows = slice.map(p => `<tr>
      <td><a class="who" href="#/fighter/${encodeURIComponent(p.key)}"><span><b>${esc(S.nameOf(p.key))}</b>${statusBadge(p.key)}<small>${esc(subName(p.key))}</small></span></a></td>
      <td>${esc(p.country || "")}</td><td>${esc(p.division || "—")}</td>
      <td class="num">${rec(p.riz)}${p.riz.nc ? ` <span class="note">(${p.riz.nc}NC)</span>` : ""}</td>
      <td class="r"><span class="rate">${r1(p.rating)}</span>${p.rank ? ` <span class="note">#${p.rank}</span>` : ""}</td>
      <td class="ev">${p.lastRizin ? fmtDate(p.lastRizin.date) : ""}</td></tr>`).join("");
    const pager = pages > 1 ? `<div class="pager">${Array.from({ length: pages }, (_, i) => `<button class="tab" data-page="${i + 1}" aria-pressed="${i + 1 === allState.page}">${i + 1}</button>`).join("")}</div>` : "";
    return `<div class="count" style="margin:0 0 8px">${list.length} 選手中 ${(allState.page - 1) * PAGE + (slice.length ? 1 : 0)}〜${(allState.page - 1) * PAGE + slice.length}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>選手</th><th>国</th><th>階級</th><th>RIZIN戦績</th><th class="r">レート</th><th>最終試合</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty">該当する選手が見つかりません</td></tr>'}</tbody></table></div>${pager}`;
  }
  function viewFighters() {
    return pageHero("Fighters", "RIZINに出場したすべての選手。上はプロフィールやSNSを詳しく載せた注目選手、下は全選手の一覧です。") + `
    <div class="wrap">
      <section class="section">
        <div class="sec-head"><h2>Featured<small>注目選手</small></h2></div>
        <div class="filters">
          <div class="search">${SEARCH_ICON}<input id="q" type="search" placeholder="注目選手を検索" value="${esc(rosterState.q)}" aria-label="注目選手を検索"></div>
          ${tabs("divTabs", ["すべて", "フライ級", "バンタム級", "フェザー級", "ライト級", "女子"], rosterState.div)}
          <label class="toggle"><input type="checkbox" id="champ" ${rosterState.champ ? "checked" : ""}> 王者のみ</label>
        </div>
        <div class="grid" id="grid">${rosterGrid()}</div>
      </section>
      <section class="section" id="all">
        <div class="sec-head"><h2>All Fighters<small>RIZIN出場選手 全員</small></h2></div>
        <div class="filters">
          <div class="search">${SEARCH_ICON}<input id="qa" type="search" placeholder="名前（日本語・英語）・国名で検索" value="${esc(allState.q)}" aria-label="全選手を検索"></div>
          ${tabs("allDiv", ["すべて", ...DIVS], allState.div)}
          <label class="toggle">並び順
            <select id="allSort" class="sel">
              ${[["rating", "レート順"], ["fights", "試合数順"], ["wins", "勝利数順"], ["recent", "最近試合した順"], ["name", "名前順（英語）"]].map(([v, l]) => `<option value="${v}" ${allState.sort === v ? "selected" : ""}>${l}</option>`).join("")}
            </select></label>
        </div>
        <div id="allTable">${allTable()}</div>
      </section>
    </div>`;
  }
  function refreshGrid() {
    document.getElementById("grid").innerHTML = rosterGrid();
    document.querySelectorAll("#divTabs .tab").forEach(b => b.setAttribute("aria-pressed", b.dataset.d === rosterState.div));
    loadInstagram();
  }
  function refreshAll() {
    document.getElementById("allTable").innerHTML = allTable();
    document.querySelectorAll("#allDiv .tab").forEach(b => b.setAttribute("aria-pressed", b.dataset.d === allState.div));
  }

  /* ---------- 選手詳細 ---------- */
  function ratingChart(hist) {
    if (hist.length < 2) return '<p class="note">RIZINでの試合数が少ないためグラフを表示できません。</p>';
    const W = 640, H = 200, PD = 30;
    const ys = hist.map(h => h.r), min = Math.min(...ys, S.BASE) - 10, max = Math.max(...ys, S.BASE) + 10;
    const x = i => PD + (W - PD * 2) * (i / (hist.length - 1));
    const y = v => H - PD - (H - PD * 2) * ((v - min) / (max - min));
    const pts = hist.map((h, i) => `${x(i).toFixed(1)},${y(h.r).toFixed(1)}`).join(" ");
    const baseY = y(S.BASE).toFixed(1), last = hist[hist.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="レーティングの推移">
      <line x1="${PD}" x2="${W - PD}" y1="${baseY}" y2="${baseY}" stroke="currentColor" stroke-opacity=".2" stroke-dasharray="4 4"/>
      <text x="${PD}" y="${+baseY - 6}" font-size="11" fill="currentColor" opacity=".5">1500</text>
      <polyline points="${pts}" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
      <circle cx="${x(hist.length - 1)}" cy="${y(last.r)}" r="4.5" style="fill:var(--accent)"/>
      <text x="${PD}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6">${hist[0].date.slice(0, 4)}</text>
      <text x="${W - PD}" y="${H - 8}" font-size="11" fill="currentColor" opacity=".6" text-anchor="end">${last.date.slice(0, 4)}</text>
      <text x="${W - PD}" y="${y(last.r) - 10}" font-size="13" font-weight="700" fill="currentColor" text-anchor="end">${r1(last.r)}</text>
    </svg>`;
  }

  function viewFighter(key) {
    const p = P(key);
    if (!p) return pageHero("Not Found", "選手が見つかりません。") + `<div class="wrap"><a href="#/fighters">選手一覧へ戻る</a></div>`;
    const f = S.roster[key];
    const t = p.riz;
    const ig = igPermalink(f);
    const rows = p.fights.slice().reverse().map(b => {
      const me = b.winner === key, opp = me ? b.loser : b.winner;
      const res = b.outcome === "NC" ? "NC" : b.outcome === "D" ? "D" : me ? "W" : "L";
      const d = b.delta && b.delta[key];
      return `<tr>
        <td class="c"><span class="res ${res}">${res}</span></td>
        <td class="opp">${link(opp)}</td>
        <td>${esc(METHOD_JA[b.cat] || "")}<div class="ev">${esc(b.method)}</div></td>
        <td>${b.rizin ? '<span class="tag-rizin">RIZIN</span> ' : ""}${esc(b.event)}${b.rizinTitle ? ' <span class="mini-badge">TITLE</span>' : ""}<div class="ev">${fmtDate(b.date)}</div></td>
        <td class="c num">${esc(b.round || "–")}${b.time ? `<div class="ev">${esc(b.time)}</div>` : ""}</td>
        <td class="r">${d ? deltaHtml(d) : ""}</td></tr>`;
    }).join("");
    const kv = f ? [["階級", f.division], ["国籍", f.country], ["生年月日", f.born], ["出身地", f.hometown], ["身長", f.height], ["所属", f.team]]
      : [["階級（直近）", p.division], ["国", p.country], ["RIZIN初出場", p.rizinFights[0] ? fmtDate(p.rizinFights[0].date) : ""]];
    const kvHtml = kv.filter(r => r[1]).map(r => `<tr><th>${r[0]}</th><td>${esc(r[1])}</td></tr>`).join("");
    const tot = t.w || 1;
    const sns = snsItems(profileOf(key)).map(([k, u]) => `<a class="sns-${k}" href="${esc(u)}" target="_blank" rel="noopener" aria-label="${esc(S.nameOf(key))}の${SNS_LABEL[k]}（新しいタブで開く）" title="${SNS_LABEL[k]}">${ICONS[k]}<span>${SNS_LABEL[k]}</span></a>`).join("");
    const name = S.nameOf(key), en = S.enOf(key);
    // 背景のキャッチコピー（未登録ならリングネーム→英語名→表示名の順でフォールバック）
    const ring = (window.CATCHPHRASE || {})[key] || (f && f.ringName) || en || name;
    // 全角は1、半角は0.55として幅を見積もり、画面幅に収まる文字サイズをCSSで計算する
    const ringW = Math.max(4, [...ring].reduce((w, ch) => w + (/[\u0000-\u00ff]/.test(ch) ? 0.55 : 1), 0)).toFixed(2);
    return `
    <section class="f-hero"><div class="f-bgname" style="--w:${ringW}" aria-hidden="true">${esc(ring)}</div><div class="in">
      <div>
        <div class="nick">${f && f.status === "champion" ? "現王者　" : f && f.status === "former" ? "元王者　" : ""}${f && f.nick ? `"${esc(f.nick)}"` : ""}</div>
        <h1>${esc(name)}</h1>
        ${name !== en ? `<div class="en">${esc(en)}</div>` : ""}
        <div class="tags">${p.division ? `<span>${esc(p.division)}</span>` : ""}${p.country ? `<span>${esc(p.country)}</span>` : ""}${t.streak >= 2 ? `<span>RIZIN ${t.streak}連勝中</span>` : ""}${p.active ? "" : "<span>直近2年試合なし</span>"}</div>
        ${sns ? `<div class="f-sns" role="list" aria-label="SNS">${sns}</div>` : ""}
      </div>
      <div class="f-rating"><small>RIZINレーティング</small><b>${r1(p.rating)}</b><div class="rk">${p.rank ? `全体 #${p.rank}・` : ""}最高 ${r1(p.peak)}</div></div>
    </div></section>
    ${walkoutBar(key)}
    <div class="wrap">
      <div class="f-record">
        <div><b>${t.w}</b><small>勝</small></div><div><b>${t.l}</b><small>敗</small></div>
        <div><b>${t.d}</b><small>分</small></div><div><b>${t.nc}</b><small>無効</small></div>
      </div>
      <p class="note" style="margin-top:8px">上の数字はRIZINでのMMA戦績です。${f && !f.partial ? `プロ通算は ${rec(p.pro)}${p.pro.nc ? `（無効${p.pro.nc}）` : ""}。` : ""}${f && f.partial ? "この選手はRIZIN外の戦績を集めきれていません。" : ""}</p>
      ${socialSection(key)}
      <div class="f-cols">
        <div>
          <div class="panel chart"><h3>レーティングの推移（RIZIN）</h3>${ratingChart(p.history)}</div>
          <div class="section">
            <div class="sec-head"><h2>Fight History<small>${f ? `全${p.fights.length}試合（うちRIZIN ${p.rizinFights.length}）` : `RIZIN ${p.rizinFights.length}試合`}</small></h2></div>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th class="c">結果</th><th>対戦相手</th><th>決着</th><th>大会</th><th class="c">R</th><th class="r">レート</th></tr></thead><tbody>${rows}</tbody></table></div>
          </div>
        </div>
        <div>
          <div class="panel"><h3>勝ち方（RIZIN）</h3>
            <div class="bar"><span style="width:${t.ko / tot * 100}%;background:var(--accent)"></span><span style="width:${t.sub / tot * 100}%;background:var(--gold)"></span><span style="width:${(t.dec + t.other) / tot * 100}%;background:var(--draw)"></span></div>
            <div class="legend"><span><i style="background:var(--accent)"></i>KO/TKO ${t.ko}</span><span><i style="background:var(--gold)"></i>一本 ${t.sub}</span><span><i style="background:var(--draw)"></i>判定ほか ${t.dec + t.other}</span></div>
            <table class="kv" style="margin-top:12px">
              <tr><th>フィニッシュ率</th><td>${pct(t.finishRate)}</td></tr>
              <tr><th>現在の連勝</th><td>${t.streak}</td></tr>
              <tr><th>最長連勝</th><td>${t.best}</td></tr>
              <tr><th>最後のRIZIN</th><td>${p.lastRizin ? fmtDate(p.lastRizin.date) : "—"}</td></tr>
            </table>
          </div>
          ${kvHtml || (f && f.note) ? `<div class="panel" style="margin-top:16px"><h3>プロフィール</h3><table class="kv">${kvHtml}</table>${f && f.note ? `<p style="font-size:14px;margin:12px 0 0">${esc(f.note)}</p>` : ""}</div>` : ""}
          ${walkoutPanel(key)}
          ${ig ? `<div class="panel card-ig" style="margin-top:16px;padding:12px">${igEmbed(ig)}</div>` : ""}
        </div>
      </div>
    </div>`;
  }

  /* ---------- 王者 ---------- */
  function viewChampions() {
    const byDiv = S.TITLE_DIVS.map(d => {
      const list = S.titleFights.filter(t => t.titleDiv === d);
      if (!list.length) return "";
      const rows = list.map(t => {
        const kind = /Defended/i.test(t.note) ? "防衛" : "獲得";
        return `<tr><td class="num">${fmtDate(t.date)}</td><td class="opp">${link(t.winner)} <span class="note">${kind}</span></td><td class="opp">${link(t.loser)}</td><td>${esc(METHOD_JA[t.cat] || "")}</td><td class="ev">${esc(t.event)}</td></tr>`;
      }).join("");
      return `<section class="section"><div class="sec-head"><h2>${d}<small>タイトル戦 ${list.length}試合</small></h2></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>日付</th><th>勝者</th><th>敗者</th><th>決着</th><th>大会</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join("");
    return pageHero("Champions", "各階級の現王者と、RIZINタイトル戦の全記録。") + `
    <div class="wrap">
      <section class="section"><div class="sec-head"><h2>Current<small>現王者</small></h2></div>${champCards()}</section>
      ${byDiv}
    </div>`;
  }

  /* ---------- 大会一覧 ---------- */
  const evState = { rizin: true, year: "すべて" };
  function eventCard(e, open) {
    const rows = e.bouts.map(b => `<tr>
      <td class="opp">${link(b.winner)}</td>
      <td class="c"><span class="res ${b.outcome}">${b.outcome}</span></td>
      <td class="opp">${link(b.loser)}</td>
      <td>${esc(METHOD_JA[b.cat] || "")}${b.round ? `<span class="ev">　${esc(b.round)}R ${esc(b.time)}</span>` : ""}</td>
      <td>${b.rizinTitle ? '<span class="mini-badge">TITLE</span> ' + esc(b.titleDiv) : ""}</td></tr>`).join("");
    return `<details class="ev-card" ${open ? "open" : ""}>
      <summary><span class="ev-date">${fmtDate(e.date)}</span>${e.rizin ? '<span class="tag-rizin">RIZIN</span>' : ""}<span class="ev-name">${esc(e.name)}</span><span class="ev-count">${e.bouts.length}試合</span>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></summary>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>勝者</th><th class="c"></th><th>敗者</th><th>決着</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </details>`;
  }
  function viewEvents() {
    const base = S.events.filter(e => !evState.rizin || e.rizin);
    const years = [...new Set(base.map(e => e.date.slice(0, 4)))];
    if (evState.year !== "すべて" && !years.includes(evState.year)) evState.year = "すべて";
    const list = base.filter(e => evState.year === "すべて" || e.date.startsWith(evState.year));
    return pageHero("Events", "RIZIN全大会のMMA試合結果。") + `
    <div class="wrap">
      <div class="filters">
        ${tabs("yearTabs", ["すべて", ...years], evState.year, "y")}
        <label class="toggle"><input type="checkbox" id="rizinOnly" ${evState.rizin ? "checked" : ""}> RIZINの大会のみ</label>
        <div class="count">${list.length} 大会</div>
      </div>
      <div class="ev-list">${list.map((e, i) => eventCard(e, i < 2)).join("") || '<div class="empty">該当する大会がありません</div>'}</div>
      <p class="note" style="margin-top:14px">キックボクシング・ボクシング・エキシビション・特別ルールの試合は含めていません。「RIZINの大会のみ」を外すと、注目選手のRIZIN以外の試合も表示されます（その大会の全試合ではありません）。引き分け・無効試合は左右の並びに意味はありません。</p>
    </div>`;
  }

  /* ---------- 統計 ---------- */
  function statTable(title, sub, fn, fmt, filter = () => true, n = 10) {
    const list = S.ranked.filter(filter).slice().sort((a, b) => fn(b) - fn(a) || b.rating - a.rating).slice(0, n);
    const rows = list.map((p, i) => `<tr><td class="rank ${i < 3 ? "top" : ""}">${i + 1}</td><td><a class="who" href="#/fighter/${encodeURIComponent(p.key)}"><span><b>${esc(S.nameOf(p.key))}</b><small>${esc(p.division || "")}</small></span></a></td><td class="r"><span class="rate">${fmt(p)}</span></td></tr>`).join("");
    return `<section class="section"><div class="sec-head"><h2>${title}<small>${sub}</small></h2></div>
      <div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>${rows}</tbody></table></div></section>`;
  }
  function viewStats() {
    return pageHero("Stats", `RIZINのMMA戦績から計算した各種ランキング（RIZINで${S.MIN_RANK_FIGHTS}試合以上の選手）。`) + `
    <div class="wrap">
      ${highlightTiles()}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:0 24px">
        ${statTable("KO Rate", "KO率（5勝以上）", p => p.riz.koRate, p => pct(p.riz.koRate), p => p.riz.w >= 5)}
        ${statTable("Finish Rate", "フィニッシュ率（5勝以上）", p => p.riz.finishRate, p => pct(p.riz.finishRate), p => p.riz.w >= 5)}
        ${statTable("Wins", "RIZINでの勝利数", p => p.riz.w, p => p.riz.w)}
        ${statTable("Most Fights", "RIZIN出場数", p => p.riz.total, p => p.riz.total)}
        ${statTable("Knockouts", "KO/TKO勝ち数", p => p.riz.ko, p => p.riz.ko)}
        ${statTable("Submissions", "一本勝ち数", p => p.riz.sub, p => p.riz.sub)}
        ${statTable("Win Streak", "現在の連勝", p => p.riz.streak, p => p.riz.streak)}
        ${statTable("Longest Streak", "最長連勝", p => p.riz.best, p => p.riz.best)}
        ${statTable("Peak Rating", "最高レーティング", p => p.peak, p => r1(p.peak))}
      </div>
    </div>`;
  }

  /* ---------- 入場曲プレーヤー ----------
     ・プレーヤーは画面右下に1つだけ置き、ページを移っても使い回す
       （一度でも画面に触れたあとは、選手ページに移るだけで音つきで自動再生できる）
     ・最初の1ページ目でブラウザが音を止めた場合は、音なしで再生を始め、
       画面のどこかに最初に触れた瞬間に音を出す */
  const AUTO_KEY = "fb_walkout_autoplay";
  const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch (e) { return true; } };
  const setAuto = v => { try { localStorage.setItem(AUTO_KEY, v ? "1" : "0"); } catch (e) {} };
  const songsOf = k => (window.ENTRANCE && window.ENTRANCE[k]) || [];
  const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
  const walk = { player: null, ready: false, key: null, idx: 0, pendingSound: false, unlocked: false };

  function walkoutBar(key) {
    const s = songsOf(key)[0]; if (!s) return "";
    return `<div class="walkout" id="walkout"><div class="in">
      <button class="wo-play" id="woPlay" aria-label="入場曲を再生"><span class="wo-icon">▶</span></button>
      <div class="wo-meta"><small>ENTRANCE MUSIC ${EQ}</small><b id="woTitle">${esc(s.title)}</b><span id="woArtist">${esc(s.artist)}</span></div>
      <div class="wo-hint" id="woHint" hidden>🔇 画面のどこかをタップすると音が出ます</div>
      <label class="switch" title="選手ページを開いたときに入場曲を自動で流す"><input type="checkbox" id="woAuto" ${autoOn() ? "checked" : ""}><span class="slider"></span><em>自動再生</em></label>
    </div></div>`;
  }
  function walkoutPanel(key) {
    const list = songsOf(key); if (!list.length) return "";
    return `<div class="panel" style="margin-top:16px"><h3>入場曲</h3>
      <div class="song-list">${list.map((s, i) => `<button class="song-pick ${i === 0 ? "on" : ""}" data-idx="${i}">♪ ${esc(s.title)} <small>${esc(s.artist)}</small></button>`).join("")}</div>
      <p class="note" style="margin:8px 0 0">YouTubeの動画を画面右下のプレーヤーで再生します。<a href="https://www.youtube.com/watch?v=${esc(list[0].yt)}" target="_blank" rel="noopener">YouTubeで開く</a></p></div>`;
  }

  // 画面右下のプレーヤー枠（ページ全体で1つ）
  const dock = document.createElement("div");
  dock.id = "ytDock"; dock.className = "yt-dock"; dock.hidden = true;
  dock.innerHTML = `<div class="yt-dock-head"><span>♪ 入場曲</span><button id="dockMin" aria-label="プレーヤーを小さくする">–</button></div><div class="yt-frame"><div id="ytGlobal"></div></div>`;
  document.body.appendChild(dock);

  let ytReady = null;
  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise(res => {
      if (window.YT && window.YT.Player) return res();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      const sc = document.createElement("script"); sc.src = "https://www.youtube.com/iframe_api"; sc.async = true;
      document.head.appendChild(sc);
    });
    return ytReady;
  }
  loadYT(); // 先に読み込んでおき、選手ページに移ったらすぐ鳴らせるようにする

  const isPlaying = () => { try { const st = walk.player.getPlayerState(); return st === 1 || st === 3; } catch (e) { return false; } };
  const isMuted = () => { try { return walk.player.isMuted(); } catch (e) { return false; } };
  function showHint(on) { const h = document.getElementById("woHint"); if (h) h.hidden = !on; }
  function setPlaying(on) {
    const bar = document.getElementById("walkout"); if (!bar) return;
    const audible = on && !isMuted();
    bar.classList.toggle("playing", audible);
    const b = document.getElementById("woPlay");
    b.querySelector(".wo-icon").textContent = audible ? "❚❚" : "▶";
    b.setAttribute("aria-label", audible ? "入場曲を一時停止" : "入場曲を再生");
    if (audible) showHint(false);
  }

  // 音が出なかったら、音なしで再生を続けて最初のタップを待つ
  function verifySound(key) {
    setTimeout(() => {
      if (walk.key !== key || !walk.player) return;
      if (isPlaying() && !isMuted()) { walk.pendingSound = false; return; }
      walk.pendingSound = true;
      try { walk.player.mute(); walk.player.playVideo(); } catch (e) {}
      showHint(true);
    }, 1200);
  }
  function startSong(key, idx) {
    const s = songsOf(key)[idx]; if (!s || !walk.player || !walk.ready) return;
    const auto = autoOn();
    if (auto) {
      try { walk.player.unMute(); walk.player.setVolume(70); } catch (e) {}
      walk.player.loadVideoById(s.yt);
      verifySound(key);
    } else {
      walk.player.cueVideoById(s.yt);
    }
  }
  function initWalkout(key) {
    const list = songsOf(key);
    if (!list.length) { stopWalkout(); return; }
    walk.key = key; walk.idx = 0;
    dock.hidden = false;
    loadYT().then(() => {
      if (walk.key !== key) return;
      if (walk.player) { startSong(key, 0); return; }
      const auto = autoOn();
      walk.player = new YT.Player("ytGlobal", {
        videoId: list[0].yt, host: "https://www.youtube-nocookie.com",
        playerVars: { autoplay: auto ? 1 : 0, playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: e => {
            walk.ready = true;
            try { e.target.setVolume(70); } catch (_) {}
            if (auto && walk.key) { e.target.playVideo(); verifySound(walk.key); }
          },
          onStateChange: e => setPlaying(e.data === 1 || e.data === 3),
        },
      });
    });
  }
  function stopWalkout() {
    walk.key = null; walk.pendingSound = false;
    if (walk.player && walk.ready) { try { walk.player.pauseVideo(); } catch (e) {} }
    dock.hidden = true;
  }
  function soundOn() {
    if (!walk.player || !walk.ready) return;
    try { walk.player.unMute(); walk.player.setVolume(70); walk.player.playVideo(); } catch (e) {}
    walk.pendingSound = false; showHint(false);
    setTimeout(() => setPlaying(isPlaying()), 300);
  }
  function togglePlay() {
    if (!walk.player || !walk.ready) return;
    if (isPlaying() && !isMuted()) walk.player.pauseVideo(); else soundOn();
  }
  function pickSong(i) {
    const s = songsOf(walk.key)[i]; if (!s || !walk.player) return;
    walk.idx = i;
    try { walk.player.unMute(); } catch (e) {}
    walk.player.loadVideoById(s.yt);
    document.getElementById("woTitle").textContent = s.title;
    document.getElementById("woArtist").textContent = s.artist;
    document.querySelectorAll(".song-pick").forEach(b => b.classList.toggle("on", +b.dataset.idx === i));
  }

  // 最初のタップ・クリック・キー入力で音を出す（ブラウザの決まりで、操作の中でしか音を出せない）
  function onFirstGesture(e) {
    walk.unlocked = true;
    if (e.target.closest && (e.target.closest("#woPlay") || e.target.closest(".switch") || e.target.closest("#dockMin"))) return;
    if (walk.pendingSound && autoOn() && walk.key) soundOn();
  }
  ["pointerdown", "keydown", "touchend"].forEach(t => document.addEventListener(t, onFirstGesture, true));

  document.addEventListener("click", e => {
    if (e.target.closest("#woPlay")) togglePlay();
    if (e.target.closest("#dockMin")) dock.classList.toggle("min");
    const pk = e.target.closest(".song-pick"); if (pk) pickSong(+pk.dataset.idx);
  });
  document.addEventListener("change", e => {
    if (e.target.id !== "woAuto") return;
    setAuto(e.target.checked);
    if (!walk.player || !walk.ready) return;
    if (e.target.checked) soundOn(); else { walk.player.pauseVideo(); walk.pendingSound = false; showHint(false); }
  });

  /* ---------- 見たい対戦カード ---------- */
  const MU_KEY = "fb_matchups";
  const getMU = () => { try { return JSON.parse(localStorage.getItem(MU_KEY) || "[]"); } catch (e) { return []; } };
  const setMU = a => { try { localStorage.setItem(MU_KEY, JSON.stringify(a)); } catch (e) {} };
  const muId = (a, b) => [a, b].sort().join("~");
  const winProb = (a, b) => 1 / (1 + Math.pow(10, (P(b).rating - P(a).rating) / 400));
  const pickable = () => Object.values(S.profiles).filter(p => p.riz.total > 0);
  const mu = { red: null, blue: null, pick: { corner: null, q: "", div: "すべて", active: true } };

  function defaultPair() {
    const fw = activeRanked().filter(p => p.division === "フェザー級");
    return fw.length >= 2 ? [fw[0].key, fw[1].key] : [S.ranked[0].key, S.ranked[1].key];
  }
  function meetings(a, b) {
    return S.fights.filter(f => (f.winner === a && f.loser === b) || (f.winner === b && f.loser === a)).slice().reverse();
  }
  function cornerHtml(k, side) {
    const p = P(k);
    return `<div class="mu-corner ${side}">
      <div class="mu-side">${side === "red" ? "RED CORNER" : "BLUE CORNER"}</div>
      <a class="mu-name" href="#/fighter/${encodeURIComponent(k)}">${esc(S.nameOf(k))}</a>
      <div class="mu-en">${esc(subName(k))}</div>
      <div class="mu-tags">${p.division ? `<span>${esc(p.division)}</span>` : ""}${statusBadge(k)}${p.active ? "" : "<span>直近2年試合なし</span>"}</div>
      <div class="mu-rate"><b>${r1(p.rating)}</b><small>レート${p.rank ? `・#${p.rank}` : ""}</small></div>
      <button class="mu-change" data-corner="${side}">選手を変更</button>
    </div>`;
  }
  function compareRows(a, b) {
    const A = P(a), B = P(b);
    const rows = [
      ["レーティング", r1(A.rating), r1(B.rating), A.rating - B.rating],
      ["RIZIN戦績", rec(A.riz), rec(B.riz), (A.riz.w - A.riz.l) - (B.riz.w - B.riz.l)],
      ["勝率", pct(A.riz.w / Math.max(1, A.riz.w + A.riz.l)), pct(B.riz.w / Math.max(1, B.riz.w + B.riz.l)), A.riz.w / Math.max(1, A.riz.w + A.riz.l) - B.riz.w / Math.max(1, B.riz.w + B.riz.l)],
      ["KO率", pct(A.riz.koRate), pct(B.riz.koRate), A.riz.koRate - B.riz.koRate],
      ["一本勝ち", A.riz.sub, B.riz.sub, A.riz.sub - B.riz.sub],
      ["現在の連勝", A.riz.streak, B.riz.streak, A.riz.streak - B.riz.streak],
      ["最長連勝", A.riz.best, B.riz.best, A.riz.best - B.riz.best],
      ["注目度", A.x.spotlight, B.x.spotlight, A.x.spotlight - B.x.spotlight],
    ];
    return rows.map(([l, va, vb, d]) => `<div class="cmp-row"><span class="v ${d > 0 ? "win" : ""}">${va}</span><span class="l">${l}</span><span class="v ${d < 0 ? "win" : ""}">${vb}</span></div>`).join("");
  }
  function dreamCards(div) {
    const pool = activeRanked().filter(p => p.division && p.division !== "重量級" && (div === "すべて" || p.division === div));
    const byDiv = {};
    pool.forEach(p => (byDiv[p.division] = byDiv[p.division] || []).push(p));
    const cards = [];
    for (const d in byDiv) {
      const top = byDiv[d].slice(0, 6);
      for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
        const a = top[i], b = top[j];
        const met = meetings(a.key, b.key).length;
        const close = 1 - Math.abs(winProb(a.key, b.key) - 0.5) * 2;     // 実力が近いほど高い
        cards.push({ a: a.key, b: b.key, d, met, score: (a.rating + b.rating) / 2 + close * 60 - met * 25 });
      }
    }
    return cards.sort((x, y) => y.score - x.score).slice(0, 12);
  }
  function miniCard(a, b, extra = "") {
    const pa = winProb(a, b);
    return `<a class="mu-mini" href="#/matchups/${encodeURIComponent(a)}~${encodeURIComponent(b)}">
      <div class="mm-div">${esc(P(a).division || "")}${extra}</div>
      <div class="mm-names"><b class="r">${esc(S.nameOf(a))}</b><span>VS</span><b class="b">${esc(S.nameOf(b))}</b></div>
      <div class="mm-bar"><i style="width:${(pa * 100).toFixed(0)}%"></i></div>
      <div class="mm-pct"><span>${Math.round(pa * 100)}%</span><span>${Math.round((1 - pa) * 100)}%</span></div>
    </a>`;
  }
  const muDiv = { v: "すべて" };
  function viewMatchups(arg) {
    if (arg && arg.includes("~")) {
      const [a, b] = arg.split("~").map(decodeURIComponent);
      if (P(a) && P(b) && a !== b) { mu.red = a; mu.blue = b; }
    }
    if (!mu.red || !mu.blue) [mu.red, mu.blue] = defaultPair();
    const a = mu.red, b = mu.blue, pa = winProb(a, b);
    const saved = getMU(), isSaved = saved.some(m => muId(m.a, m.b) === muId(a, b));
    const met = meetings(a, b);
    const sameDiv = P(a).division && P(a).division === P(b).division;
    return pageHero("Dream Match", "見たい対戦カードを作ろう。レーティングから勝率を予想します。") + `
    <div class="wrap">
      <section class="mu-board">
        ${cornerHtml(a, "red")}
        <div class="mu-vs">
          <div class="vs">VS</div>
          <div class="mu-prob"><div class="bar"><i class="r" style="width:${(pa * 100).toFixed(1)}%"></i><i class="b" style="width:${((1 - pa) * 100).toFixed(1)}%"></i></div>
            <div class="pcts"><b class="r">${Math.round(pa * 100)}%</b><small>勝率予想</small><b class="b">${Math.round((1 - pa) * 100)}%</b></div></div>
          <div class="mu-note">${sameDiv ? `${esc(P(a).division)}の一戦` : "階級が異なるカードです"}${met.length ? `・過去${met.length}戦` : "・初対戦"}</div>
          <div class="mu-actions">
            <button class="btn-want ${isSaved ? "on" : ""}" id="muWant" aria-pressed="${isSaved}">${isSaved ? "♥ 見たいリストに追加済み" : "♡ この対戦を見たい！"}</button>
            <div class="mu-sub"><button class="ghost" id="muSwap" aria-label="コーナーを入れ替える">⇄ 入れ替え</button><button class="ghost" id="muShare">🔗 リンクをコピー</button></div>
          </div>
        </div>
        ${cornerHtml(b, "blue")}
      </section>

      <section class="section">
        <div class="sec-head"><h2>Tale of the Tape<small>データ比較（RIZIN）</small></h2></div>
        <div class="cmp">${compareRows(a, b)}</div>
      </section>

      <section class="section">
        <div class="sec-head"><h2>Head to Head<small>過去の対戦</small></h2></div>
        ${met.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>日付</th><th>勝者</th><th>決着</th><th>大会</th></tr></thead><tbody>${met.map(f => `<tr><td class="num">${fmtDate(f.date)}</td><td class="opp">${f.outcome === "W" ? link(f.winner) : (f.outcome === "D" ? "引き分け" : "無効試合")}</td><td>${esc(METHOD_JA[f.cat] || "")}${f.round ? `<span class="ev">　${esc(f.round)}R ${esc(f.time)}</span>` : ""}</td><td class="ev">${esc(f.event)}</td></tr>`).join("")}</tbody></table></div>`
          : `<p class="note">まだ対戦したことのない、まさに「夢のカード」です。</p>`}
      </section>

      <section class="section">
        <div class="sec-head"><h2>My List<small>あなたの見たいカード（${saved.length}）</small></h2></div>
        ${saved.length ? `<div class="mu-grid">${saved.slice().reverse().filter(m => P(m.a) && P(m.b)).map(m => miniCard(m.a, m.b)).join("")}</div>`
          : `<p class="note">「この対戦を見たい！」を押したカードがここに並びます（このブラウザに保存されます）。</p>`}
      </section>

      <section class="section">
        <div class="sec-head"><h2>Dream Cards<small>実現したら熱いカード</small></h2></div>
        <div class="filters">${tabs("muDiv", ["すべて", "フライ級", "バンタム級", "フェザー級", "ライト級", "女子"], muDiv.v)}</div>
        <div class="mu-grid">${dreamCards(muDiv.v).map(c => miniCard(c.a, c.b, c.met ? `・再戦（過去${c.met}戦）` : "・初対戦")).join("") || '<p class="note">該当するカードがありません</p>'}</div>
        <p class="note" style="margin-top:10px">各階級の現役上位選手どうしで、実力が近く、まだ対戦が少ない組み合わせを自動で選んでいます。</p>
      </section>
    </div>
    <dialog class="picker" id="picker" aria-labelledby="pickerTitle"></dialog>`;
  }

  /* 選手を選ぶ画面 */
  function pickerList() {
    const st = mu.pick, q = st.q.trim().toLowerCase();
    const other = st.corner === "red" ? mu.blue : mu.red;
    const list = pickable().filter(p =>
      (st.div === "すべて" || p.division === st.div) && (!st.active || p.active) &&
      (!q || [S.nameOf(p.key), S.enOf(p.key), p.country].join(" ").toLowerCase().includes(q)))
      .sort((x, y) => y.rating - x.rating).slice(0, 80);
    if (!list.length) return '<li class="pk-empty">該当する選手がいません。「現役のみ」を外すと引退・移籍した選手も選べます。</li>';
    return list.map(p => {
      const cur = p.key === (st.corner === "red" ? mu.red : mu.blue), dis = p.key === other;
      return `<li><button class="pk-item ${cur ? "cur" : ""}" data-key="${esc(p.key)}" ${dis ? "disabled" : ""}>
        <span class="pk-main"><b>${esc(S.nameOf(p.key))}</b><small>${esc(subName(p.key))}</small></span>
        <span class="pk-meta">${esc(p.division || "—")}<br><span class="num">${rec(p.riz)}</span></span>
        <span class="pk-rate">${r1(p.rating)}</span>
        <span class="pk-state">${cur ? "選択中" : dis ? "相手側" : "選ぶ"}</span></button></li>`;
    }).join("");
  }
  function openPicker(corner) {
    mu.pick.corner = corner; mu.pick.q = "";
    const dlg = document.getElementById("picker");
    dlg.innerHTML = `<div class="pk-head ${corner}">
        <div><small>${corner === "red" ? "RED CORNER" : "BLUE CORNER"}</small><h3 id="pickerTitle">選手を選ぶ</h3></div>
        <button class="pk-close" id="pkClose" aria-label="閉じる">×</button></div>
      <div class="pk-tools">
        <div class="search">${SEARCH_ICON}<input id="pkQ" type="search" placeholder="名前（日本語・英語）・国名で検索" autocomplete="off" aria-label="選手を検索"></div>
        ${tabs("pkDiv", ["すべて", ...DIVS], mu.pick.div)}
        <label class="toggle"><input type="checkbox" id="pkActive" ${mu.pick.active ? "checked" : ""}> 現役のみ</label>
      </div>
      <ul class="pk-list" id="pkList">${pickerList()}</ul>`;
    dlg.showModal();
    setTimeout(() => { const i = document.getElementById("pkQ"); if (i && matchMedia("(min-width:561px)").matches) i.focus(); }, 30);
  }
  function choose(key) {
    if (mu.pick.corner === "red") mu.red = key; else mu.blue = key;
    document.getElementById("picker").close();
    location.hash = `#/matchups/${encodeURIComponent(mu.red)}~${encodeURIComponent(mu.blue)}`;
  }
  function muEvents(e) {
    const ch = e.target.closest(".mu-change"); if (ch) { openPicker(ch.dataset.corner); return true; }
    const it = e.target.closest(".pk-item"); if (it && !it.disabled) { choose(it.dataset.key); return true; }
    if (e.target.closest("#pkClose")) { document.getElementById("picker").close(); return true; }
    if (e.target.id === "picker") { e.target.close(); return true; }   // 背景クリックで閉じる
    const pd = e.target.closest("#pkDiv .tab"); if (pd) { mu.pick.div = pd.dataset.d; document.querySelectorAll("#pkDiv .tab").forEach(b => b.setAttribute("aria-pressed", b === pd)); document.getElementById("pkList").innerHTML = pickerList(); return true; }
    if (e.target.closest("#muSwap")) { location.hash = `#/matchups/${encodeURIComponent(mu.blue)}~${encodeURIComponent(mu.red)}`; return true; }
    if (e.target.closest("#muWant")) {
      const a = getMU(), id = muId(mu.red, mu.blue), i = a.findIndex(m => muId(m.a, m.b) === id);
      if (i >= 0) a.splice(i, 1); else a.push({ a: mu.red, b: mu.blue, t: Date.now() });
      setMU(a); const y = window.scrollY; $view.innerHTML = viewMatchups(); window.scrollTo(0, y); return true;
    }
    if (e.target.closest("#muShare")) {
      const url = location.href, btn = e.target.closest("#muShare");
      const done = () => { btn.textContent = "✓ コピーしました"; setTimeout(() => btn.textContent = "🔗 リンクをコピー", 1800); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt("このリンクをコピーしてください", url)); else prompt("このリンクをコピーしてください", url);
      return true;
    }
    const md = e.target.closest("#muDiv .tab"); if (md) { muDiv.v = md.dataset.d; const y = window.scrollY; $view.innerHTML = viewMatchups(); window.scrollTo(0, y); return true; }
    return false;
  }
  $view.addEventListener("input", e => { if (e.target.id === "pkQ") { mu.pick.q = e.target.value; document.getElementById("pkList").innerHTML = pickerList(); } });
  $view.addEventListener("change", e => { if (e.target.id === "pkActive") { mu.pick.active = e.target.checked; document.getElementById("pkList").innerHTML = pickerList(); } });
  $view.addEventListener("keydown", e => {
    if (e.target.id === "pkQ" && e.key === "Enter") { const f = document.querySelector("#pkList .pk-item:not([disabled])"); if (f) { e.preventDefault(); choose(f.dataset.key); } }
  });

  /* ---------- SOCIAL UPDATES（X・YouTubeの最新投稿） ----------
     data/social.json は GitHub Actions が定期的に（初期値60分）YouTubeから取得して更新するキャッシュ。
     ブラウザからは外部APIを直接呼ばない。Xは公式APIが有料のため取得せず、リンクのみ表示。 */
  const X_LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.8 3h3.1l-6.8 7.8 8 10.2h-6.3l-4.9-6.4L5.3 21H2.2l7.3-8.3L1.8 3h6.4l4.4 5.9L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z"/></svg>';
  const YT_LOGO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1c.3-1.2.4-2.5.4-3.8s-.1-2.6-.4-3.8Z"/><path fill="#fff" d="M10 15V9l5.2 3L10 15Z"/></svg>';
  let socialData = null, socialPromise = null;
  function loadSocialData() {
    if (socialData) return Promise.resolve(socialData);
    if (!socialPromise) {
      const bust = Math.floor(Date.now() / 6e5);     // 10分ごとに新しいファイルを取りに行く
      socialPromise = fetch(`data/social.json?v=${bust}`, { cache: "no-cache" })
        .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(j => (socialData = j))
        .catch(e => { socialPromise = null; throw e; });
    }
    return socialPromise;
  }
  const hasX = f => !!(f && (f.xUser || (f.sns && safeUrl(f.sns.x))));
  const hasYT = f => !!(f && (f.youtubeChannelId || (f.sns && safeUrl(f.sns.youtube))));
  const fmtDT = iso => { const d = new Date(iso); if (isNaN(d)) return ""; return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; };
  const fmtDTm = iso => { const d = new Date(iso); if (isNaN(d)) return ""; return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const skeleton = n => Array.from({ length: n }, () => '<div class="sc sc-skel" aria-hidden="true"><div class="sc-media"></div><div class="sc-body"><i></i><i></i><i></i></div></div>').join("");

  function socialSection(key) {
    const f = profileOf(key);
    const x = false, y = hasYT(f);   // Xの投稿取得は有料APIのため行わない（Xはヘッダーのリンクのみ）
    if (!y) return "";              // YouTube未登録の選手はセクションごと出さない
    return `<section class="section social" id="social" data-key="${esc(key)}" aria-labelledby="socialTitle">
      <div class="sec-head"><h2 id="socialTitle">Social Updates<small>YouTubeの最新動画</small></h2><span class="note" id="socialUpdated" aria-live="polite"></span></div>
      ${x ? `<div class="sc-block" id="scX"><div class="sc-label">${X_LOGO}<b>X</b><span>最新の投稿</span></div><div class="sc-grid" aria-busy="true">${skeleton(3)}</div></div>` : ""}
      ${y ? `<div class="sc-block" id="scYT"><div class="sc-label">${YT_LOGO}<b>YouTube</b><span>最新の動画</span></div><div class="sc-grid" aria-busy="true">${skeleton(3)}</div></div>` : ""}
    </section>`;
  }
  const STATUS_MSG = {
    not_configured: "連携の準備中です。", auth_error: "現在表示できません（連携の設定を確認中）。",
    rate_limited: "アクセスが集中しているため、しばらくしてから更新されます。", unavailable: "サービス側の障害のため、現在表示できません。",
    not_found: "アカウントが見つかりませんでした。", error: "現在表示できません。",
  };
  function stateBox(msg, kind = "") { return `<div class="sc-state ${kind}"><p>${esc(msg)}</p></div>`; }
  function staleNote(src) {
    if (!src || src.status === "ok" || !src.lastSuccessAt) return "";
    return `<p class="sc-stale">最新の取得に失敗したため、${esc(fmtDTm(src.lastSuccessAt))} 時点の内容を表示しています。</p>`;
  }
  function xCards(src, f) {
    if (!src) return stateBox(STATUS_MSG.not_configured);
    const posts = (src.posts || []).slice(0, 3);
    if (!posts.length) return src.status === "ok" ? stateBox("最近の投稿はありません。", "empty") : stateBox(STATUS_MSG[src.status] || STATUS_MSG.error, "err");
    const acc = src.account || {};
    return posts.map(pt => {
      const m = (pt.media || [])[0];
      const img = m && (m.url || m.preview);
      return `<a class="sc sc-x" href="${esc(safeUrl(pt.url))}" target="_blank" rel="noopener" aria-label="Xの投稿を開く（${esc(fmtDT(pt.createdAt))}）">
        ${img ? `<div class="sc-media"><img src="${esc(img)}" alt="${esc(m.alt || "投稿の画像")}" loading="lazy" decoding="async" width="${m.width || 1200}" height="${m.height || 675}">${m.type !== "photo" ? '<span class="sc-play" aria-hidden="true">▶</span>' : ""}</div>` : ""}
        <div class="sc-body">
          <div class="sc-src">${X_LOGO}<span><b>${esc(acc.name || S.nameOf(f.key))}</b> @${esc(acc.username || "")}</span></div>
          <p class="sc-text">${esc(pt.text || "")}</p>
          <time class="sc-date" datetime="${esc(pt.createdAt)}">${esc(fmtDT(pt.createdAt))}</time>
        </div></a>`;
    }).join("") + staleNote(src);
  }
  function ytCards(src) {
    if (!src) return stateBox(STATUS_MSG.not_configured);
    const vids = (src.videos || []).slice(0, 3);
    if (!vids.length) return src.status === "ok" ? stateBox("最近の動画はありません。", "empty") : stateBox(STATUS_MSG[src.status] || STATUS_MSG.error, "err");
    return vids.map(v => `<article class="sc sc-yt">
        <div class="sc-media yt-lite" data-yt="${esc(v.id)}">
          <img src="${esc(v.thumbnail && v.thumbnail.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`)}" alt="" loading="lazy" decoding="async" width="480" height="270">
          <button class="sc-playbtn" data-yt="${esc(v.id)}" aria-label="「${esc(v.title)}」をこのページで再生">▶</button>
        </div>
        <div class="sc-body">
          <div class="sc-src">${YT_LOGO}<span><b>${esc(src.channel && src.channel.title || "YouTube")}</b></span></div>
          <h3 class="sc-title"><a href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">${esc(v.title)}</a></h3>
          <div class="sc-foot"><time class="sc-date" datetime="${esc(v.publishedAt)}">${esc(fmtDT(v.publishedAt))}</time><a class="sc-out" href="${esc(safeUrl(v.url))}" target="_blank" rel="noopener">YouTubeで見る ↗</a></div>
        </div></article>`).join("") + staleNote(src);
  }
  function fillSocial(key) {
    const sec = document.getElementById("social"); if (!sec || sec.dataset.key !== key) return;
    const f = profileOf(key);
    const put = (id, html) => { const g = document.querySelector(`#${id} .sc-grid`); if (g) { g.innerHTML = html; g.removeAttribute("aria-busy"); } };
    loadSocialData().then(d => {
      if (!document.getElementById("social") || document.getElementById("social").dataset.key !== key) return;
      const e = (d.fighters || {})[key] || {};
      put("scX", xCards(e.x, f));
      put("scYT", ytCards(e.youtube));
      const u = document.getElementById("socialUpdated");
      if (u && d.generatedAt) u.textContent = `更新：${fmtDTm(d.generatedAt)}`;
    }).catch(() => {
      put("scX", stateBox("投稿を読み込めませんでした。時間をおいて再読み込みしてください。", "err"));
      put("scYT", stateBox("動画を読み込めませんでした。時間をおいて再読み込みしてください。", "err"));
    });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest(".sc-playbtn"); if (!b) return;
    const box = b.closest(".yt-lite");
    if (walk.player && walk.ready) { try { walk.player.pauseVideo(); } catch (_) {} }   // 入場曲は止める
    box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(b.dataset.yt)}?autoplay=1&playsinline=1&rel=0" title="YouTube動画" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  });

  /* ---------- ルーター ---------- */
  function route() {
    const h = location.hash.replace(/^#\/?/, "");
    const [page, arg] = h.split("/");
    const key = decodeURIComponent(arg || "");
    let html;
    switch (page) {
      case "rankings": html = viewRankings(); break;
      case "fighters": html = viewFighters(); break;
      case "fighter": html = viewFighter(key); break;
      case "champions": html = viewChampions(); break;
      case "events": html = viewEvents(); break;
      case "stats": html = viewStats(); break;
      case "matchups": html = viewMatchups(arg); break;
      default: html = viewHome();
    }
    $view.innerHTML = html;
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.r === page || (page === "fighter" && a.dataset.r === "fighters")));
    document.getElementById("nav").classList.remove("open");
    document.getElementById("menuBtn").setAttribute("aria-expanded", "false");
    const titles = { rankings: "ランキング", fighters: "選手一覧", champions: "王者", events: "大会一覧", stats: "統計", matchups: "見たい対戦カード" };
    document.title = (page === "fighter" && P(key) ? S.nameOf(key) : titles[page] || "RIZIN選手データベース") + "｜FIGHT BOOK";
    window.scrollTo(0, 0);
    loadInstagram();
    if (page === "fighter" && P(key)) { initWalkout(key); fillSocial(key); } else stopWalkout();
  }

  /* ---------- 画面内の操作 ---------- */
  $view.addEventListener("click", e => {
    if (muEvents(e)) return;
    const c = e.target.closest("#catTabs .cat");
    if (c) { rankState.cat = c.dataset.cat; $view.innerHTML = viewRankings(); return; }
    const lk = e.target.closest("button.like");
    if (lk) { const o = getLikes(); o[lk.dataset.like] = !o[lk.dataset.like]; if (!o[lk.dataset.like]) delete o[lk.dataset.like]; setLikes(o); $view.innerHTML = viewRankings(); return; }
    const ps = e.target.closest("button.play-song");
    if (ps) {
      const row = ps.closest("tr").nextElementSibling, box = row.querySelector(".yt-wrap");
      const open = row.hidden;
      document.querySelectorAll(".song-row").forEach(r => { r.hidden = true; r.querySelector(".yt-wrap").innerHTML = ""; });
      document.querySelectorAll(".play-song").forEach(b => b.textContent = "▶");
      if (open) {
        row.hidden = false; ps.textContent = "■";
        box.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(ps.dataset.yt)}?autoplay=1&playsinline=1&rel=0" title="入場曲" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
      }
      return;
    }
    const t = e.target.closest("button.tab"); if (!t) return;
    if (t.closest("#rankTabs")) { rankState.div = t.dataset.d; $view.innerHTML = viewRankings(); }
    else if (t.closest("#divTabs")) { rosterState.div = t.dataset.d; refreshGrid(); }
    else if (t.closest("#allDiv")) { allState.div = t.dataset.d; allState.page = 1; refreshAll(); }
    else if (t.dataset.page) { allState.page = +t.dataset.page; refreshAll(); document.getElementById("all").scrollIntoView(); }
    else if (t.closest("#yearTabs")) { evState.year = t.dataset.y; $view.innerHTML = viewEvents(); }
  });
  $view.addEventListener("input", e => {
    if (e.target.id === "q") { rosterState.q = e.target.value; refreshGrid(); }
    if (e.target.id === "qa") { allState.q = e.target.value; allState.page = 1; refreshAll(); }
  });
  $view.addEventListener("change", e => {
    if (e.target.id === "champ") { rosterState.champ = e.target.checked; refreshGrid(); }
    if (e.target.id === "allSort") { allState.sort = e.target.value; allState.page = 1; refreshAll(); }
    if (e.target.id === "activeOnly") { rankState.active = e.target.checked; $view.innerHTML = viewRankings(); }
    if (e.target.id === "rizinOnly") { evState.rizin = e.target.checked; $view.innerHTML = viewEvents(); }
  });
  document.getElementById("menuBtn").addEventListener("click", () => {
    const n = document.getElementById("nav"); n.classList.toggle("open");
    document.getElementById("menuBtn").setAttribute("aria-expanded", n.classList.contains("open"));
  });

  window.addEventListener("hashchange", route);
  route();
})();
