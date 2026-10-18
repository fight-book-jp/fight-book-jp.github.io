// 既存の集計ロジック（js/stats.js）をそのまま読み込み、指定ルートのデータで計算した結果を JSON で出す。
//   node tools/sync/tests/stats_probe.mjs <root> [key ...]
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = process.argv[2] || ".";
const keys = process.argv.slice(3);
const ctx = { window: {} };
ctx.window.window = ctx.window;
for (const f of ["data/fighters.js", "data/fights.js", "data/names-ja.js", "data/profiles.js", "js/stats.js"]) {
  const p = path.join(root, f);
  if (fs.existsSync(p)) vm.runInNewContext(fs.readFileSync(p, "utf8"), ctx);
}
const S = ctx.window.STATS;
const rated = Object.values(S.profiles).filter(p => p.history.length);
const out = {
  fights: S.fights.length, rawFights: ctx.window.FIGHTS.length, events: S.events.length, ranked: S.ranked.length,
  eloSum: rated.reduce((s, p) => s + (p.rating - S.BASE), 0),
  rankedSorted: S.ranked.every((p, i, a) => i === 0 || a[i - 1].rating >= p.rating),
  rankedMinFights: S.ranked.every(p => p.riz.total - p.riz.nc >= S.MIN_RANK_FIGHTS),
  missingKeys: S.fights.filter(f => !S.profiles[f.winner] || !S.profiles[f.loser]).length,
  fighters: Object.fromEntries(keys.map(k => {
    const p = S.profiles[k];
    return [k, p ? { riz: p.riz, pro: p.pro, rating: p.rating, rank: p.rank ?? null, fights: p.fights.length } : null];
  })),
};
process.stdout.write(JSON.stringify(out));
