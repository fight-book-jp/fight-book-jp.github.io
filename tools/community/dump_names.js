// 選手キー → 表示名・英語名・階級 を JSON で出力（サイトと同じ計算 js/stats.js を使う）
//   node tools/community/dump_names.js > /tmp/names.json
const fs = require("fs"), path = require("path"), vm = require("vm");
const root = path.join(__dirname, "..", "..");
const ctx = { window: {}, console };
ctx.window.window = ctx.window;
vm.createContext(ctx);
for (const f of ["data/fighters.js", "data/fights.js", "data/names-ja.js", "js/stats.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
const S = ctx.window.STATS, out = {};
for (const k of Object.keys(S.profiles)) out[k] = { name: S.nameOf(k), en: S.enOf(k), division: S.profiles[k].division || "" };
process.stdout.write(JSON.stringify(out));
