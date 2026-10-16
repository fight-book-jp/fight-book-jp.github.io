/* =====================================================================
   集計ロジック：試合データ（data/fights.js）から
   レーティング（Elo）・戦績・連勝・統計を計算する
   ===================================================================== */
(function () {
  const COLS = window.FIGHT_COLS;
  const BASE = 1500;          // 初期レート
  const K = 32;               // 1試合で動く最大幅
  const K_TITLE = 40;         // タイトル戦は少し大きく動かす

  const DIV_EN = { Flyweight: "フライ級", Bantamweight: "バンタム級", Featherweight: "フェザー級",
                   Lightweight: "ライト級", "Super Atomweight": "女子" };

  const fights = window.FIGHTS.map((r, i) => {
    const o = {}; COLS.forEach((c, j) => o[c] = r[j]);
    o.id = i;
    o.rizin = /rizin/i.test(o.event);
    const m = /Rizin (Flyweight|Bantamweight|Featherweight|Lightweight|Super Atomweight) Championship/i.exec(o.note || "");
    o.titleDiv = m ? DIV_EN[m[1].replace(/\b\w/g, c => c.toUpperCase())] || "" : "";
    o.rizinTitle = !!m && o.title === 1;
    return o;
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

  const roster = {};
  window.FIGHTERS.forEach(f => roster[f.key] = f);

  const rating = {}, hist = {}, peak = {}, count = {};
  const get = k => rating[k] ?? BASE;

  // ---- Elo を時系列で計算 ----
  for (const f of fights) {
    if (f.outcome === "NC") { f.delta = {}; continue; }
    const a = f.winner, b = f.loser;
    const ra = get(a), rb = get(b);
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const sa = f.outcome === "D" ? 0.5 : 1;
    const k = f.title ? K_TITLE : K;
    const d = k * (sa - ea);
    rating[a] = ra + d; rating[b] = rb - d;
    f.delta = { [a]: d, [b]: -d };
    f.after = { [a]: rating[a], [b]: rating[b] };
    for (const x of [a, b]) {
      count[x] = (count[x] || 0) + 1;
      if (roster[x]) {
        (hist[x] = hist[x] || []).push({ date: f.date, r: rating[x] });
        peak[x] = Math.max(peak[x] || 0, rating[x]);
      }
    }
  }

  // ---- 選手ごとの戦績・統計 ----
  function profile(key) {
    const list = fights.filter(f => f.winner === key || f.loser === key);
    const p = { key, fights: list, w: 0, l: 0, d: 0, nc: 0, ko: 0, sub: 0, dec: 0, other: 0,
                rw: 0, rl: 0, rd: 0, streak: 0, best: 0, lossStreak: 0 };
    let run = 0;
    for (const f of list) {
      const isA = f.winner === key;
      if (f.outcome === "NC") { p.nc++; continue; }
      if (f.outcome === "D") { p.d++; if (f.rizin) p.rd++; run = 0; continue; }
      if (isA) {
        p.w++; if (f.rizin) p.rw++;
        if (f.cat === "KO") p.ko++; else if (f.cat === "SUB") p.sub++; else if (f.cat === "DEC") p.dec++; else p.other++;
        run++; p.best = Math.max(p.best, run);
      } else { p.l++; if (f.rizin) p.rl++; run = 0; }
    }
    p.streak = run;
    p.rating = rating[key] ?? BASE;
    p.peak = peak[key] ?? BASE;
    p.history = hist[key] || [];
    p.last = list.length ? list[list.length - 1] : null;
    p.finishRate = p.w ? (p.ko + p.sub) / p.w : 0;
    p.koRate = p.w ? p.ko / p.w : 0;
    p.lastDelta = p.last && p.last.delta ? (p.last.delta[key] || 0) : 0;
    return p;
  }

  const profiles = {};
  window.FIGHTERS.forEach(f => profiles[f.key] = profile(f.key));

  // ---- ランキング ----
  // 戦績データが一部しかない選手（partial）はランキングから外す
  const ranked = window.FIGHTERS.filter(f => !f.partial).sort((a, b) => profiles[b.key].rating - profiles[a.key].rating);
  ranked.forEach((f, i) => profiles[f.key].rank = i + 1);

  // ---- 大会 ----
  const events = [];
  const evMap = {};
  for (const f of fights) {
    const id = f.date + "|" + f.event;
    if (!evMap[id]) { evMap[id] = { id, date: f.date, name: f.event, rizin: f.rizin, bouts: [] }; events.push(evMap[id]); }
    evMap[id].bouts.push(f);
  }
  events.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  events.forEach((e, i) => e.slug = "e" + i);

  // ---- RIZINタイトル戦の歴史 ----
  const titleFights = fights.filter(f => f.rizinTitle && f.outcome === "W").slice().reverse();

  const nameOf = k => roster[k] ? roster[k].name : (window.OPPONENTS[k] || k);

  window.STATS = { fights, profiles, ranked, events, titleFights, nameOf, roster, BASE,
                   ratingOf: k => rating[k] ?? BASE, fightsOf: k => count[k] || 0 };
})();
