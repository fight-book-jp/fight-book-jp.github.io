/**
 * SOCIAL UPDATES 用のデータ取得スクリプト（GitHub Actions から定期実行）
 *
 *   node tools/social/fetch.mjs
 *
 * ・名簿（data/fighters.js）の YouTube アカウントから最新動画を取得し data/social.json に保存
 * ・環境変数 YOUTUBE_API_KEY があれば YouTube Data API v3、無ければ YouTube 公式の新着フィード(RSS)を使う
 *   （どちらも無料。キーはリポジトリに置かず GitHub Secrets に保存する）
 * ・取得に失敗したら直前に正常取得した内容を残し、状態とエラーを記録する（data/social-log.json）
 * ・X は公式APIが有料のため取得しない
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "data", "social.json");
const LOG = path.join(ROOT, "data", "social-log.json");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "social", "config.json"), "utf8"));

/* ---------- 共通 ---------- */
export class FetchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
/** HTTPの結果・エラー内容から表示用の状態に分類する */
export function classify(httpStatus, body = "") {
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429 || /quotaExceeded|rateLimitExceeded|dailyLimitExceeded/.test(body)) return "rate_limited";
  if (httpStatus === 401 || httpStatus === 403) return "auth_error";
  if (httpStatus >= 500 || httpStatus === 0) return "unavailable";
  return "error";
}
async function get(url, fetchImpl) {
  let res;
  try { res = await fetchImpl(url, { headers: { "User-Agent": "fight-book-social/1.0", "Accept-Language": "ja,en" } }); }
  catch (e) { throw new FetchError("unavailable", `network: ${e.message}`); }
  const text = await res.text();
  if (!res.ok) throw new FetchError(classify(res.status, text), `HTTP ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

/* ---------- 名簿の読み込み ---------- */
/** 名簿(fighters.js)に data/profiles.js の SNS_EXTRA を重ねた一覧を返す（名簿外の選手も含む） */
export function loadRoster(file = path.join(ROOT, "data", "fighters.js"), extraFile = path.join(ROOT, "data", "profiles.js")) {
  const ctx = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), ctx);
  if (extraFile && fs.existsSync(extraFile)) vm.runInNewContext(fs.readFileSync(extraFile, "utf8"), ctx);
  const list = (ctx.window.FIGHTERS || []).map(f => ({ ...f, sns: { ...(f.sns || {}) } }));
  const byKey = new Map(list.map(f => [f.key, f]));
  for (const [key, x] of Object.entries(ctx.window.SNS_EXTRA || {})) {
    const f = byKey.get(key) || { key, sns: {} };
    Object.assign(f.sns, x);
    if (x.youtubeChannelId) f.youtubeChannelId = x.youtubeChannelId;
    if (!byKey.has(key)) { byKey.set(key, f); list.push(f); }
  }
  return list;
}
/** YouTube のURL（/channel/UC… /@handle /user/name）または youtubeChannelId から参照先を決める */
export function youtubeRef(f) {
  if (f.youtubeChannelId) return { channelId: f.youtubeChannelId };
  const u = (f.sns && f.sns.youtube) || "";
  let m;
  if ((m = u.match(/youtube\.com\/channel\/(UC[\w-]{20,24})/))) return { channelId: m[1] };
  if ((m = u.match(/youtube\.com\/(@[\w.\-]+)/))) return { handle: m[1] };
  if ((m = u.match(/youtube\.com\/(?:user|c)\/([\w.\-]+)/))) return { user: m[1] };
  return null;
}

/* ---------- RSS（キー不要） ---------- */
const decode = s => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
export function parseFeed(xml) {
  const channelTitle = decode((xml.match(/<feed[\s\S]*?<title>([\s\S]*?)<\/title>/) || [])[1] || "");
  const channelId = (xml.match(/<yt:channelId>(UC[\w-]+)<\/yt:channelId>/) || [])[1] || "";
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const id = (e.match(/<yt:videoId>([\w-]+)<\/yt:videoId>/) || [])[1];
    const thumb = e.match(/<media:thumbnail url="([^"]+)"(?: width="(\d+)")?(?: height="(\d+)")?/);
    const link = (e.match(/<link rel="alternate" href="([^"]+)"/) || [])[1] || "";
    return id && {
      id, title: decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
      url: `https://www.youtube.com/watch?v=${id}`, publishedAt: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || "",
      thumbnail: { url: thumb ? thumb[1] : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: +(thumb && thumb[2]) || 480, height: +(thumb && thumb[3]) || 360 },
      short: /\/shorts\//.test(link),
    };
  }).filter(Boolean);
  return { channel: { id: channelId, title: channelTitle }, videos };
}
async function resolveHandle(handle, fetchImpl) {
  const html = await get(`https://www.youtube.com/${handle}`, fetchImpl);
  const m = html.match(/"externalId":"(UC[\w-]+)"/) || html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]+)"/);
  if (!m) throw new FetchError("not_found", `channel id not found for ${handle}`);
  return m[1];
}
async function viaRss(ref, fetchImpl) {
  const q = ref.channelId ? `channel_id=${ref.channelId}` : `user=${encodeURIComponent(ref.user)}`;
  return parseFeed(await get(`https://www.youtube.com/feeds/videos.xml?${q}`, fetchImpl));
}

/* ---------- YouTube Data API v3（キーがある場合） ---------- */
async function viaApi(ref, key, fetchImpl) {
  const api = (p, params) => get(`https://www.googleapis.com/youtube/v3/${p}?${new URLSearchParams({ ...params, key })}`, fetchImpl).then(JSON.parse);
  const chParams = ref.channelId ? { id: ref.channelId } : ref.handle ? { forHandle: ref.handle } : { forUsername: ref.user };
  const ch = await api("channels", { part: "snippet,contentDetails", ...chParams });
  const c = (ch.items || [])[0];
  if (!c) throw new FetchError("not_found", "channel not found");
  const pl = await api("playlistItems", { part: "contentDetails", playlistId: c.contentDetails.relatedPlaylists.uploads, maxResults: "10" });
  const ids = (pl.items || []).map(i => i.contentDetails.videoId);
  if (!ids.length) return { channel: { id: c.id, title: c.snippet.title }, videos: [] };
  const vs = await api("videos", { part: "snippet,status,contentDetails", id: ids.join(",") });
  // 非公開・削除済み・埋め込み不可・年齢制限・配信予定は除外
  const videos = (vs.items || []).filter(v =>
    v.status && v.status.privacyStatus === "public" && v.status.uploadStatus === "processed" && v.status.embeddable !== false &&
    !(v.contentDetails && v.contentDetails.contentRating && v.contentDetails.contentRating.ytRating === "ytAgeRestricted") &&
    !(v.snippet && v.snippet.liveBroadcastContent === "upcoming"))
    .map(v => {
      const t = v.snippet.thumbnails || {}; const best = t.high || t.medium || t.default || {};
      return { id: v.id, title: v.snippet.title, url: `https://www.youtube.com/watch?v=${v.id}`, publishedAt: v.snippet.publishedAt,
               thumbnail: { url: best.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, width: best.width || 480, height: best.height || 360 } };
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { channel: { id: c.id, title: c.snippet.title }, videos };
}

/**
 * 1選手分の YouTube を取得する。失敗時は直前の正常データを残して状態だけ更新する。
 * @returns {object} social.json の fighters[key].youtube
 */
export async function fetchYouTube(f, prev, { fetchImpl = fetch, apiKey = process.env.YOUTUBE_API_KEY, now = new Date(), count = CONFIG.youtube.count, excludeShorts = CONFIG.youtube.excludeShorts } = {}) {
  const at = now.toISOString();
  const ref = youtubeRef(f);
  if (!ref) return null;
  try {
    let r;
    if (apiKey) r = await viaApi(ref, apiKey, fetchImpl);
    else {
      const knownId = prev && prev.channel && prev.channel.id;
      const rr = ref.handle ? { channelId: knownId || await resolveHandle(ref.handle, fetchImpl) } : ref;
      r = await viaRss(rr, fetchImpl);
    }
    const videos = r.videos.filter(v => !(excludeShorts && v.short)).slice(0, count).map(({ short, ...v }) => v);
    return { status: "ok", source: apiKey ? "youtube-data-api" : "youtube-rss", fetchedAt: at, lastSuccessAt: at, channel: r.channel, videos };
  } catch (e) {
    const status = e instanceof FetchError ? e.status : "error";
    return { ...(prev || { videos: [] }), status, fetchedAt: at, error: String(e.message || e).slice(0, 300) };
  }
}

/* ---------- 実行 ---------- */
const strip = o => JSON.stringify(o, (k, v) => (k === "generatedAt" || k === "fetchedAt" ? undefined : v));

export async function run({ fetchImpl = fetch, now = new Date(), outFile = OUT, logFile = LOG, roster = loadRoster() } = {}) {
  const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : { fighters: {} };
  const out = { version: 1, generatedAt: now.toISOString(), intervalMinutes: CONFIG.intervalMinutes, fighters: {} };
  const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, "utf8")) : [];
  const logLen = log.length;
  for (const f of roster) {
    const before = prev.fighters && prev.fighters[f.key] || {};
    const yt = await fetchYouTube(f, before.youtube, { fetchImpl, now });
    if (!yt) continue;
    out.fighters[f.key] = { youtube: yt };
    if (yt.status !== "ok") {
      log.push({ at: now.toISOString(), fighter: f.key, source: "youtube", status: yt.status, message: yt.error || "" });
      console.error(`[social] ${f.key} youtube: ${yt.status} ${yt.error || ""}`);
    } else console.log(`[social] ${f.key} youtube: ok (${yt.videos.length})`);
  }
  // 中身が変わっていなければ書き換えない（毎時の無駄なコミットを防ぐ）
  const changed = strip(out) !== strip(prev);
  if (changed) fs.writeFileSync(outFile, JSON.stringify(out, null, 1) + "\n");
  if (log.length !== logLen || !fs.existsSync(logFile)) fs.writeFileSync(logFile, JSON.stringify(log.slice(-CONFIG.logKeep), null, 1) + "\n");
  const errors = Object.values(out.fighters).filter(x => x.youtube.status !== "ok").length;
  console.log(`[social] done: ${Object.keys(out.fighters).length} channels, ${errors} errors, ${changed ? "updated" : "no change"}`);
  return { out, changed, errors };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(e => { console.error("[social] fatal:", e); process.exit(1); });
}
