/* =====================================================================
   集計ロジック：試合データ（data/fights.js）から
   レーティング（Elo）・戦績・連勝・統計を計算する
   ・レーティングは全選手を同じ条件で比べるため「RIZINでのMMA試合のみ」で計算
   ・名簿選手はプロ全戦績（RIZIN外を含む）も別に集計
   ===================================================================== */
(function () {
  const COLS = window.FIGHT_COLS;
  const BASE = 1500, K = 32, K_TITLE = 40;
  const MIN_RANK_FIGHTS = 3;          // ランキングに載る最低RIZIN試合数
  const ACTIVE_DAYS = 730;            // 直近2年に試合があれば「現役」

  const TITLE_DIV = { "flyweight": "フライ級", "bantamweight": "バンタム級", "featherweight": "フェザー級",
    "lightweight": "ライト級", "light heavyweight": "ライトヘビー級", "super atomweight": "女子スーパーアトム級" };

  const roster = {};
  window.FIGHTERS.forEach(f => roster[f.key] = f);
  const PEOPLE = window.PEOPLE || {};
  const JA = window.NAMES_JA || {};

  const enOf = k => roster[k] ? roster[k].en : (PEOPLE[k] ? PEOPLE[k][0] : k);
  const nameOf = k => roster[k] ? roster[k].name : (PEOPLE[k] ? (JA[PEOPLE[k][0]] || PEOPLE[k][0]) : k);
  const CC = { JPN:"日本", USA:"アメリカ", BRA:"ブラジル", KOR:"韓国", RUS:"ロシア", CZE:"チェコ", CRO:"クロアチア",
    KAZ:"カザフスタン", KGZ:"キルギス", UZB:"ウズベキスタン", AZE:"アゼルバイジャン", POR:"ポルトガル", ANG:"アンゴラ",
    UKR:"ウクライナ", LIT:"リトアニア", LTU:"リトアニア", SWE:"スウェーデン", NED:"オランダ", EST:"エストニア", IRN:"イラン",
    POL:"ポーランド", GUM:"グアム", FRA:"フランス", GER:"ドイツ", ENG:"イギリス", GBR:"イギリス", IRL:"アイルランド",
    CAN:"カナダ", MEX:"メキシコ", AUS:"オーストラリア", NZL:"ニュージーランド", NZ:"ニュージーランド", CHN:"中国", THA:"タイ",
    PHI:"フィリピン", MGL:"モンゴル", ESP:"スペイン", SPA:"スペイン", ITA:"イタリア", HUN:"ハンガリー", BUL:"ブルガリア",
    BGR:"ブルガリア", SUI:"スイス", SWI:"スイス", BEL:"ベルギー", GEO:"ジョージア", LAT:"ラトビア", LVA:"ラトビア",
    ROU:"ルーマニア", ROM:"ルーマニア", TUR:"トルコ", CMR:"カメルーン", RSA:"南アフリカ", ZAF:"南アフリカ", NGA:"ナイジェリア",
    COD:"コンゴ", DRC:"コンゴ", SEN:"セネガル", GHA:"ガーナ", ARG:"アルゼンチン", SUR:"スリナム", IND:"インド", LBN:"レバノン",
    TGA:"トンガ", PUR:"プエルトリコ", PRI:"プエルトリコ", EGY:"エジプト", BOL:"ボリビア" };
  const countryOf = k => roster[k] ? roster[k].country : (PEOPLE[k] ? (CC[PEOPLE[k][1]] || PEOPLE[k][1]) : "");
  const divOf = k => roster[k] ? roster[k].division : (PEOPLE[k] ? PEOPLE[k][2] : "");

  const fights = window.FIGHTS.map((r, i) => {
    const o = {}; COLS.forEach((c, j) => o[c] = r[j]);
    o.id = i; o.rizin = !!o.rizin; o.main = !!o.main;
    const m = /Rizin (Light Heavyweight|Flyweight|Bantamweight|Featherweight|Lightweight|Super Atomweight) Championship/i.exec(o.note || "");
    o.titleDiv = m ? TITLE_DIV[m[1].toLowerCase()] || "" : "";
    o.rizinTitle = !!m && o.title === 1;
    return o;
  }).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

  const lastDate = fights.length ? fights[fights.length - 1].date : "";
  const dayNum = d => Date.parse(d) / 864e5;

  // ---- Elo（RIZINの試合のみ）----
  const rating = {}, hist = {}, peak = {};
  const get = k => rating[k] ?? BASE;
  for (const f of fights) {
    f.delta = {};
    if (!f.rizin || f.outcome === "NC") continue;
    const a = f.winner, b = f.loser, ra = get(a), rb = get(b);
    f.pre = { [a]: ra, [b]: rb };
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const d = (f.title ? K_TITLE : K) * ((f.outcome === "D" ? 0.5 : 1) - ea);
    rating[a] = ra + d; rating[b] = rb - d;
    f.delta = { [a]: d, [b]: -d };
    for (const x of [a, b]) {
      (hist[x] = hist[x] || []).push({ date: f.date, r: rating[x] });
      peak[x] = Math.max(peak[x] ?? BASE, rating[x]);
    }
  }

  // ---- 選手ごとの集計 ----
  const byFighter = {};
  for (const f of fights) for (const k of [f.winner, f.loser]) (byFighter[k] = byFighter[k] || []).push(f);

  function tally(list, key) {
    const t = { w: 0, l: 0, d: 0, nc: 0, ko: 0, sub: 0, dec: 0, other: 0, streak: 0, best: 0 };
    let run = 0;
    for (const f of list) {
      if (f.outcome === "NC") { t.nc++; continue; }
      if (f.outcome === "D") { t.d++; run = 0; continue; }
      if (f.winner === key) {
        t.w++; run++; t.best = Math.max(t.best, run);
        if (f.cat === "KO") t.ko++; else if (f.cat === "SUB") t.sub++; else if (f.cat === "DEC") t.dec++; else t.other++;
      } else { t.l++; run = 0; }
    }
    t.streak = run;
    t.total = t.w + t.l + t.d + t.nc;
    t.koRate = t.w ? t.ko / t.w : 0;
    t.finishRate = t.w ? (t.ko + t.sub) / t.w : 0;
    return t;
  }

  const profiles = {};
  const allKeys = new Set([...Object.keys(PEOPLE), ...Object.keys(roster)]);
  for (const key of allKeys) {
    const list = byFighter[key] || [];
    const rl = list.filter(f => f.rizin);
    const pro = tally(list, key), riz = tally(rl, key);
    const lastR = rl.length ? rl[rl.length - 1] : null;
    // ---- 面白ランキング用の指標（RIZINの試合のみ）----
    const x = { main: 0, title: 0, big: 0, nye: 0, challenge: 0, challengeWin: 0, upsets: 0, upsetGap: 0 };
    for (const f of rl) {
      if (f.main) x.main++;
      if (f.rizinTitle) x.title++;
      if (/Super Rizin/i.test(f.event) || /-12-(29|30|31)$/.test(f.date)) x.big++;
      if (/-12-(29|30|31)$/.test(f.date)) x.nye++;
      if (f.pre && f.outcome !== "NC") {
        const opp = f.winner === key ? f.loser : f.winner;
        const gap = f.pre[opp] - f.pre[key];
        if (gap > 0) { x.challenge++; if (f.winner === key && f.outcome === "W") x.challengeWin++; }
        if (f.winner === key && f.outcome === "W" && gap >= 40) { x.upsets++; x.upsetGap += gap; }
      }
    }
    // 注目度：メインイベント×5＋タイトル戦×4＋ビッグイベント（大晦日・超RIZIN）×2＋出場数
    x.spotlight = x.main * 5 + x.title * 4 + x.big * 2 + rl.length;
    // 挑戦者魂：格上（試合前レートが上）との対戦数＋その勝利×2
    x.grit = x.challenge + x.challengeWin * 2;
    profiles[key] = {
      key, fights: list, rizinFights: rl, pro, riz, x,
      // 名簿選手はプロ全戦績、それ以外はRIZIN戦績を主に使う
      main: roster[key] && !roster[key].partial ? pro : riz,
      rating: rating[key] ?? BASE, peak: peak[key] ?? BASE, history: hist[key] || [],
      last: list.length ? list[list.length - 1] : null, lastRizin: lastR,
      lastDelta: lastR && lastR.delta ? (lastR.delta[key] || 0) : 0,
      active: !!lastR && dayNum(lastDate) - dayNum(lastR.date) <= ACTIVE_DAYS,
      inRoster: !!roster[key], division: divOf(key), country: countryOf(key),
    };
  }

  // ---- ランキング（RIZIN 3試合以上）----
  const ranked = Object.values(profiles).filter(p => p.riz.total - p.riz.nc >= MIN_RANK_FIGHTS)
    .sort((a, b) => b.rating - a.rating);
  ranked.forEach((p, i) => p.rank = i + 1);

  // ---- 大会 ----
  const events = [], evMap = {};
  for (const f of fights) {
    const id = f.date + "|" + f.event;
    if (!evMap[id]) { evMap[id] = { id, date: f.date, name: f.event, rizin: f.rizin, bouts: [] }; events.push(evMap[id]); }
    evMap[id].bouts.push(f);
  }
  events.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

  const titleFights = fights.filter(f => f.rizinTitle && f.outcome === "W").slice().reverse();

  // ---- 秒殺：1Rで決着したフィニッシュを決着タイムの早い順 ----
  const secs = t => { const m = /^(\d+):(\d{1,2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };
  const quickest = fights.filter(f => f.rizin && f.outcome === "W" && (f.cat === "KO" || f.cat === "SUB") && String(f.round) === "1" && secs(f.time) !== null)
    .map(f => Object.assign(f, { secs: secs(f.time) })).sort((a, b) => a.secs - b.secs);

  // ---- 大物食い：試合前レートの差が大きい順の番狂わせ ----
  const upsets = fights.filter(f => f.rizin && f.outcome === "W" && f.pre && f.pre[f.loser] - f.pre[f.winner] >= 40)
    .map(f => Object.assign(f, { gap: f.pre[f.loser] - f.pre[f.winner] })).sort((a, b) => b.gap - a.gap);

  window.STATS = { fights, profiles, ranked, events, titleFights, quickest, upsets, roster, BASE, lastDate,
    nameOf, enOf, countryOf, divOf, MIN_RANK_FIGHTS, TITLE_DIVS: Object.values(TITLE_DIV) };
})();
