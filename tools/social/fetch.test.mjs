// node --test tools/social/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify, youtubeRef, parseFeed, fetchYouTube, run, loadRoster } from "./fetch.mjs";

const FEED = (n = 4) => `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><yt:channelId>UCabcdefghijklmnopqrstuv</yt:channelId><title>Test &amp; Channel</title>
${Array.from({ length: n }, (_, i) => `<entry><yt:videoId>vid${i}</yt:videoId><title>Video ${i} &lt;new&gt;</title><link rel="alternate" href="https://www.youtube.com/watch?v=vid${i}"/><published>2026-10-1${i}T00:00:00+00:00</published><media:group><media:thumbnail url="https://i.ytimg.com/vi/vid${i}/hqdefault.jpg" width="480" height="360"/></media:group></entry>`).join("")}</feed>`;
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body });
const fighter = { key: "t", sns: { youtube: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv" } };
const prevOk = { status: "ok", lastSuccessAt: "2026-10-01T00:00:00.000Z", channel: { id: "UCabcdefghijklmnopqrstuv", title: "Old" }, videos: [{ id: "old1", title: "Old video" }] };
const now = new Date("2026-10-17T00:00:00Z");

test("URLからチャンネル参照を判定できる", () => {
  assert.deepEqual(youtubeRef(fighter), { channelId: "UCabcdefghijklmnopqrstuv" });
  assert.deepEqual(youtubeRef({ sns: { youtube: "https://www.youtube.com/@kyoma.mma38" } }), { handle: "@kyoma.mma38" });
  assert.deepEqual(youtubeRef({ sns: { youtube: "https://www.youtube.com/user/toshi6268" } }), { user: "toshi6268" });
  assert.equal(youtubeRef({ sns: {} }), null);
});

test("HTTPエラーの分類", () => {
  assert.equal(classify(401), "auth_error");
  assert.equal(classify(403, '{"reason":"quotaExceeded"}'), "rate_limited");
  assert.equal(classify(429), "rate_limited");
  assert.equal(classify(404), "not_found");
  assert.equal(classify(503), "unavailable");
});

test("RSSを解析できる（エスケープ文字も復元）", () => {
  const r = parseFeed(FEED(2));
  assert.equal(r.channel.title, "Test & Channel");
  assert.equal(r.videos.length, 2);
  assert.equal(r.videos[0].title, "Video 0 <new>");
});

test("正常取得：最新3件だけ保存", async () => {
  const yt = await fetchYouTube(fighter, null, { fetchImpl: async () => res(200, FEED(5)), apiKey: "", now });
  assert.equal(yt.status, "ok");
  assert.equal(yt.videos.length, 3);
  assert.equal(yt.lastSuccessAt, now.toISOString());
});

test("投稿なし：状態はokで動画0件", async () => {
  const yt = await fetchYouTube(fighter, prevOk, { fetchImpl: async () => res(200, FEED(0)), apiKey: "", now });
  assert.equal(yt.status, "ok");
  assert.equal(yt.videos.length, 0);
});

test("認証エラー（APIキー不正）：前回の動画を残す", async () => {
  const yt = await fetchYouTube(fighter, prevOk, { fetchImpl: async () => res(403, '{"error":{"errors":[{"reason":"keyInvalid"}]}}'), apiKey: "bad", now });
  assert.equal(yt.status, "auth_error");
  assert.deepEqual(yt.videos, prevOk.videos);
  assert.equal(yt.lastSuccessAt, prevOk.lastSuccessAt);
});

test("利用上限到達：rate_limited、前回の動画を残す", async () => {
  const yt = await fetchYouTube(fighter, prevOk, { fetchImpl: async () => res(403, '{"error":{"errors":[{"reason":"quotaExceeded"}]}}'), apiKey: "k", now });
  assert.equal(yt.status, "rate_limited");
  assert.equal(yt.videos[0].id, "old1");
});

test("外部サービス障害・通信エラー：unavailable、前回の動画を残す", async () => {
  const a = await fetchYouTube(fighter, prevOk, { fetchImpl: async () => res(503, "down"), apiKey: "", now });
  const b = await fetchYouTube(fighter, prevOk, { fetchImpl: async () => { throw new Error("ECONNRESET"); }, apiKey: "", now });
  assert.equal(a.status, "unavailable"); assert.equal(b.status, "unavailable");
  assert.equal(a.videos[0].id, "old1"); assert.equal(b.videos[0].id, "old1");
});

test("Data API：非公開・年齢制限・埋め込み不可は除外", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes("/channels")) return res(200, JSON.stringify({ items: [{ id: "UCx", snippet: { title: "Ch" }, contentDetails: { relatedPlaylists: { uploads: "UUx" } } }] }));
    if (url.includes("/playlistItems")) return res(200, JSON.stringify({ items: ["a", "b", "c", "d", "e"].map(v => ({ contentDetails: { videoId: v } })) }));
    const v = (id, d, extra = {}) => ({ id, snippet: { title: id, publishedAt: d, thumbnails: {} }, status: { privacyStatus: "public", uploadStatus: "processed", embeddable: true }, contentDetails: {}, ...extra });
    return res(200, JSON.stringify({ items: [
      v("a", "2026-10-05"), v("b", "2026-10-04", { status: { privacyStatus: "private", uploadStatus: "processed" } }),
      v("c", "2026-10-03", { contentDetails: { contentRating: { ytRating: "ytAgeRestricted" } } }),
      v("d", "2026-10-02", { status: { privacyStatus: "public", uploadStatus: "processed", embeddable: false } }), v("e", "2026-10-01")] }));
  };
  const yt = await fetchYouTube(fighter, null, { fetchImpl, apiKey: "k", now });
  assert.equal(yt.status, "ok");
  assert.deepEqual(yt.videos.map(x => x.id), ["a", "e"]);
  assert.ok(calls.every(u => u.includes("key=k")));
});

test("run：失敗時はログに記録し、前回データを保持したまま保存", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-"));
  const outFile = path.join(dir, "social.json"), logFile = path.join(dir, "log.json");
  fs.writeFileSync(outFile, JSON.stringify({ fighters: { t: { youtube: prevOk } } }));
  const r = await run({ fetchImpl: async () => res(500, "boom"), now, outFile, logFile, roster: [fighter, { key: "nosns", sns: {} }] });
  const saved = JSON.parse(fs.readFileSync(outFile, "utf8"));
  assert.equal(saved.fighters.t.youtube.status, "unavailable");
  assert.equal(saved.fighters.t.youtube.videos[0].id, "old1");
  assert.equal(saved.fighters.nosns, undefined);
  const log = JSON.parse(fs.readFileSync(logFile, "utf8"));
  assert.equal(log.at(-1).status, "unavailable");
  assert.equal(r.errors, 1);
});

test("名簿にprofiles.jsのSNS_EXTRAを重ねる（名簿外の選手も対象）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roster-"));
  const a = path.join(dir, "f.js"), b = path.join(dir, "p.js");
  fs.writeFileSync(a, 'window.FIGHTERS=[{key:"a",sns:{x:"https://x.com/a"}}];');
  fs.writeFileSync(b, 'window.SNS_EXTRA={a:{youtube:"https://www.youtube.com/@a"},b:{youtube:"https://www.youtube.com/@b"}};');
  const r = loadRoster(a, b);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].sns, { x: "https://x.com/a", youtube: "https://www.youtube.com/@a" });
  assert.equal(r[1].key, "b");
});
