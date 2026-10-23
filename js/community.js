/* =====================================================================
   ファン参加機能（見たい対戦カード・投票・コメント・計測）
   一般の参加者はログイン不要（ニックネームのみ）。ブラウザごとに Supabase の匿名ユーザーを自動で発行し、
   1人1票・自分の投稿だけ編集できる仕組みに使う。管理者だけメールアドレス＋パスワードでログインする（#/admin）。
   データは Supabase（js/community-config.js で接続先を指定）。
   接続先が未設定のときは「準備中」と表示し、架空のカードや票は出さない。

   画面
     #/cards              ファンの見たい対戦（急上昇・週間・新着・累計）
     #/c/{id}             カード詳細（共有用の正規URLは /matchups/{id}/ ）
     #/create[/{a}[/{b}]] カードを作る（選手ページからは A を入力済み）
     #/me[/{tab}]         マイページ（お知らせ・作った・参加した・保存）
     #/admin              通報の確認（管理者のみ）
   ===================================================================== */
window.FBC_INIT = function (H) {
  const { S, P, esc, av } = H;
  const photoOf = H.photoOf || (() => null), SIL = H.SIL || "";
  const CFG = window.FB_COMMUNITY || {};
  // public:false のあいだは、?preview=1 で開いた端末だけで表示（公開前の確認用。?preview=0 で解除）
  const PREVIEW = (() => {
    try {
      const q = new URLSearchParams(location.search).get("preview");
      if (q === "1") localStorage.setItem("fb_preview", "1");
      if (q === "0") localStorage.removeItem("fb_preview");
      return localStorage.getItem("fb_preview") === "1";
    } catch (e) { return false; }
  })();
  const ENABLED = !!(CFG.url && CFG.anonKey && (CFG.public !== false || PREVIEW || CFG.testAuth));
  const SITE = (CFG.siteUrl || location.origin).replace(/\/$/, "");
  const RULES = { mma: "MMA", kickboxing: "キックボクシング", grappling: "グラップリング", boxing: "ボクシング" };
  const CONDS = { standard: "通常", title: "タイトル戦", catchweight: "契約体重", openweight: "無差別級" };
  const HINTS = [
    { k: "why", t: "見たい理由は？" }, { k: "key", t: "この試合の分かれ目は？" },
    { k: "other", t: "別の相手なら誰を見たい？" }, { k: "rule", t: "このルールならどうなる？" }];
  const HINT_T = Object.fromEntries(HINTS.map(h => [h.k, h.t]));
  const WHY = { same_fighter: "同じ選手の対戦案", same_class: "同じ階級で見たい数が多い", fresh: "まだ反応が少ない新着", editorial: "編集部の提案" };
  const TABS = [{ id: "trending", t: "急上昇" }, { id: "weekly", t: "週間" }, { id: "new", t: "新着" }, { id: "total", t: "累計" }];
  const ERR = {
    LOGIN_REQUIRED: "参加の準備ができていません。ページを再読み込みしてもう一度お試しください。", BANNED: "このアカウントでは投稿できません。", NOT_FOUND: "カードが見つからないか、非公開になりました。",
    TOO_FAST: "続けて投稿するときは15秒ほど待ってください。", RATE_LIMIT: "今日の投稿数の上限に達しました。明日また参加してください。",
    TOO_LONG: "文字数が多すぎます。", REPLY_GONE: "返信先のコメントは削除されました。", EMPTY: "本文を入力してください。", SAME_FIGHTER: "同じ選手どうしは選べません。",
    FORBIDDEN: "この操作の権限がありません。", BAD_LENGTH: "文字数を確認してください。", BAD_NAME: "ニックネームにメールアドレスやURLは使えません。", PROFILE_MISSING: "参加情報を確認できませんでした。ページを再読み込みしてください。",
  };
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };
  const valid = k => !!(k && P(k));
  const nm = k => esc(S.nameOf(k));
  const ago = t => {
    const s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return "たった今"; if (s < 3600) return `${Math.floor(s / 60)}分前`; if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)}日前`;
    const d = new Date(t); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  };
  const hhmm = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const cardUrl = id => `${SITE}/matchups/${encodeURIComponent(id)}/`;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));

  /* ---------- 接続・ログイン ---------- */
  let sb = null, readyP = null, who = null;
  function loadLib() {
    return new Promise((res, rej) => {
      if (window.supabase) return res();
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js";
      s.onload = () => res(); s.onerror = () => rej(new Error("NETWORK"));
      document.head.appendChild(s);
    });
  }
  async function token() {
    if (CFG.testAuth) { const u = CFG.testAuth.user(); return u ? "test:" + u : null; }
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data && data.session ? data.session.access_token : null;
  }
  function ready() {
    if (!ENABLED) return Promise.resolve(false);
    if (readyP) return readyP;
    readyP = (async () => {
      if (!CFG.testAuth) {
        await loadLib();
        sb = window.supabase.createClient(CFG.url, CFG.anonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
        await sb.auth.getSession();         // URL の ?code= をここでセッションに交換する
        sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") { who = null; paintMe(); } });
      }
      if (await token()) { try { who = await rpc("whoami"); } catch (e) { who = null; } }
      return true;
    })();
    return readyP;
  }
  async function rpc(fn, args = {}) {
    if (!ENABLED) throw Object.assign(new Error("準備中です"), { code: "DISABLED" });
    const t = await token();
    let r;
    try {
      r = await fetch(`${CFG.url}/rest/v1/rpc/${fn}`, {
        method: "POST",
        // 未ログイン時は apikey だけを送る（新形式の publishable キーは Authorization に入れられないため）
        headers: Object.assign({ "Content-Type": "application/json", apikey: CFG.anonKey }, t ? { Authorization: `Bearer ${t}` } : {}),
        body: JSON.stringify(args),
      });
    } catch (e) { throw Object.assign(new Error("通信できませんでした。電波の良いところでもう一度お試しください。"), { code: "NETWORK" }); }
    const txt = await r.text(); let j = null;
    try { j = txt ? JSON.parse(txt) : null; } catch (e) {}
    if (!r.ok) {
      const code = j && j.message;
      throw Object.assign(new Error(ERR[code] || (r.status === 401 || /permission denied/.test(code || "") ? ERR.LOGIN_REQUIRED : "うまく処理できませんでした。時間をおいてもう一度お試しください。")), { code: code || `HTTP${r.status}` });
    }
    return j;
  }
  const loggedIn = () => !!who;
  const isAdmin = () => !!(who && who.admin);

  /* ---------- ログインなしの参加（ニックネーム＋匿名ユーザー） ---------- */
  const NICK = "fb_nick";
  const nickOf = () => (who && who.name && who.name !== "ファン" ? who.name : "") || ls.get(NICK, "") || "";
  const nickErr = n => !n ? "ニックネームを入力してください。" : n.length > 30 ? "ニックネームは30字までです。" : /@|https?:\/\//i.test(n) ? ERR.BAD_NAME : "";
  let joining = null;
  // 初めて参加する操作（見たい・コメント・作成など）のときに、このブラウザ用の匿名ユーザーを作る
  async function ensureUser(name) {
    name = (name || "").trim();
    if (name) ls.set(NICK, name);
    if (loggedIn()) {
      if (name && name !== who.name) { await rpc("set_display_name", { name }); who.name = name; }
      return who;
    }
    if (!joining) joining = (async () => {
      await ready();
      const nmv = (name || ls.get(NICK, "") || "ファン").slice(0, 30);
      if (CFG.testAuth) await CFG.testAuth.anon(nmv);
      else {
        const { error } = await sb.auth.signInAnonymously({ options: { data: { name: nmv } } });
        if (error) throw Object.assign(new Error(error.status === 429 ? "アクセスが集中しています。少し時間をおいてお試しください。" : "参加の準備ができませんでした。時間をおいてお試しください。"), { code: "ANON" });
      }
      who = await rpc("whoami");
      if (!who) throw Object.assign(new Error(ERR.PROFILE_MISSING), { code: "PROFILE_MISSING" });
      track("join", null, {});
      paintMe();
      return who;
    })().finally(() => { joining = null; });
    return joining;
  }

  // ログイン後に戻る画面と、続けたい操作を覚えておく（下書きは別に保存）
  function rememberReturn(pending) {
    // 共有URL（/matchups/{id}/）で開いていた場合も、同じカードへ戻れるようにハッシュの形で覚える
    const pm = location.pathname.match(/\/matchups\/([A-Za-z0-9]{6,20})\/?$/);
    const cur = location.pathname + location.search;
    if (/^\/(login|reset)\//.test(cur)) return;
    ls.set("fb_return", { hash: cur, pending: pending || null, t: Date.now() });
  }
  function login(pending) {        // 管理者ログイン画面へ
    rememberReturn(pending);
    location.href = "/login/";
  }
  async function logout() {
    if (CFG.testAuth) CFG.testAuth.logout(); else if (sb) await sb.auth.signOut();
    who = null; paintMe(); flash("ログアウトしました"); location.href = "/";
  }
  // ログインできたら：元の画面へ戻し、押そうとしていた操作（見たい・面白い・保存）を続ける
  async function finishLogin(how) {
    try { who = await rpc("whoami"); } catch (e) { who = null; }
    if (!who) { toast(ERR.PROFILE_MISSING); return; }
    const back = ls.get("fb_return", null); ls.del("fb_return");
    paintMe();
    flash(who.admin ? `管理者としてログインしました（${esc(who.name)}）` : "ログインしました。この端末には管理者の権限がありません。");
    track("login_success", null, { action: back && back.pending ? back.pending.type : "menu", how });
    const p = back && back.pending;
    if (p && p.card && (p.type === "want" || p.type === "fun")) { try { const c = await rpc("set_reaction", { cid: p.card, kind: p.type, on: true }); cache[c.id] = c; track("vote", c.id, { kind: p.type, on: true, where: "after_login" }); } catch (e) {} }
    if (p && p.card && p.type === "save") { try { await rpc("set_save", { cid: p.card, on: true }); } catch (e) {} }
    const to = back && back.hash && Date.now() - back.t < 86400000 ? back.hash : (who.admin ? "/admin/" : "/");
    if (location.pathname + location.search !== to) location.href = to; else { ss.set("fb_flash", ""); H.rerender(); }
  }
  // メール内のリンク（登録の確認・パスワード再設定）から戻ってきたとき
  async function afterAuthReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error") && !q.has("error_description")) return;
    const reset = q.get("fb") === "reset";
    history.replaceState(null, "", location.pathname);
    if (q.has("error") || q.has("error_description")) {
      flash("リンクが無効か、有効期限が切れています。もう一度お試しください。");
      track("login_fail", null, { reason: "link" });
      location.href = "/login/"; return;
    }
    if (!loggedIn()) {
      flash("リンクを確認できませんでした。登録・再設定をしたのと同じ端末・ブラウザで開いてください。");
      track("login_fail", null, { reason: "link_session" });
      location.href = "/login/"; return;
    }
    if (reset) { location.href = "/reset/"; return; }
    track("signup_confirmed", null, {});
    await finishLogin("email_link");
  }

  /* ---------- ログイン・新規登録・パスワード再設定 ---------- */
  const AUTH_ERR = {
    invalid_credentials: "メールアドレスかパスワードが違います。",
    email_not_confirmed: "まだメールアドレスの確認が済んでいません。届いたメールのリンクを開いてください。",
    user_already_exists: "このメールアドレスはすでに登録されています。ログインしてください。",
    weak_password: "パスワードが弱すぎます。8文字以上で、英字と数字を混ぜてください。",
    over_email_send_rate_limit: "メールの送信が混み合っています。しばらく待ってからお試しください。",
    over_request_rate_limit: "操作が続いたため、少し時間をおいてからお試しください。",
    same_password: "今と同じパスワードは使えません。",
  };
  const authErr = e => AUTH_ERR[e && e.code] || (/Invalid login/i.test(e && e.message) ? AUTH_ERR.invalid_credentials : /confirm/i.test(e && e.message) ? AUTH_ERR.email_not_confirmed : "うまく処理できませんでした。時間をおいてもう一度お試しください。");
  const auth = { mode: "login", busy: false };
  function viewLogin(mode) {
    auth.mode = mode === "forgot" ? "forgot" : "login";
    if (!ENABLED) return H.pageHero("Admin", "") + `<div class="wrap"><section class="section">${offBox()}</section></div>`;
    const m = auth.mode;
    return H.pageHero("Admin", "管理者用のログインです。一般の方はログインなしで参加できます。") + `<div class="wrap">
      <div class="fb-auth">
        <form id="fbAuth" data-mode="${m}" novalidate>
          <h2>${m === "login" ? "管理者ログイン" : "パスワードを忘れたとき"}</h2>
          <label>メールアドレス<input id="fbEmail" name="email" type="email" autocomplete="email" required inputmode="email"></label>
          ${m === "forgot" ? "" : `<label>パスワード<span class="fb-pw"><input id="fbPass" name="password" type="password" minlength="8" autocomplete="current-password" required><button type="button" class="fblink" data-showpw aria-label="パスワードを表示">表示</button></span></label>`}
          <div id="fbAuthMsg" class="fb-auth-msg" role="alert" aria-live="assertive"></div>
          <button class="btn primary big" type="submit">${m === "login" ? "ログイン" : "再設定メールを送る"}</button>
          ${m === "login" ? `<p class="note"><a href="/login/?mode=forgot">パスワードを忘れた場合</a> ・ <a href="/">トップへ戻る</a></p>` : `<p class="note">登録したメールアドレスに、再設定のリンクを送ります。<a href="/login/">ログインに戻る</a></p>`}
        </form>
      </div></div>`;
  }
  function viewReset() {
    return H.pageHero("Password", "新しいパスワードを設定します。") + `<div class="wrap"><div class="fb-auth">
      ${loggedIn() ? `<form id="fbReset" novalidate><h2>新しいパスワード</h2>
        <label>新しいパスワード（8文字以上）<span class="fb-pw"><input id="fbNewPass" type="password" minlength="8" autocomplete="new-password" required><button type="button" class="fblink" data-showpw aria-label="パスワードを表示">表示</button></span></label>
        <div id="fbAuthMsg" class="fb-auth-msg" role="alert"></div>
        <button class="btn primary big" type="submit">変更する</button></form>`
      : `<p>再設定のリンクを確認できませんでした。<a href="/login/?mode=forgot">もう一度メールを送る</a></p>`}
    </div></div>`;
  }
  const authMsg = (t, good) => { const m = $("#fbAuthMsg"); if (m) { m.textContent = t; m.classList.toggle("good", !!good); } };
  async function submitAuth(f) {
    if (auth.busy) return;
    const mode = f.dataset.mode, email = ($("#fbEmail").value || "").trim(), pass = $("#fbPass") ? $("#fbPass").value : "";
    const name = $("#fbName") ? $("#fbName").value.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authMsg("メールアドレスを正しく入力してください。");
    if (mode !== "forgot" && pass.length < 8) return authMsg("パスワードは8文字以上で入力してください。");
    if (mode === "signup" && (!name || name.length > 30)) return authMsg("表示名を30字以内で入力してください。");
    if (mode === "signup" && /@|https?:\/\//i.test(name)) return authMsg("表示名にメールアドレスやURLは使えません。");
    const btn = f.querySelector('[type="submit"]'), label = btn.textContent;
    auth.busy = true; btn.disabled = true; btn.textContent = "送信中…"; authMsg("");
    try {
      await ready();
      if (CFG.testAuth) {                      // テスト用（本番では使われない）
        if (mode === "forgot") { authMsg("再設定メールを送りました。", true); return; }
        CFG.testAuth.login(email); await finishLogin(mode); return;
      }
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email, password: pass });
        if (error) throw error;
        await finishLogin("password");
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name }, emailRedirectTo: SITE + "/" } });
        if (error) throw error;
        track("signup_start", null, {});
        if (data.session) await finishLogin("signup");      // 確認メールを使わない設定の場合
        else { f.reset(); authMsg(`確認メールを ${email} に送りました。メール内のリンクを、この端末・このブラウザで開くと登録が完了します（届かない場合は迷惑メールフォルダもご確認ください）。`, true); }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE + "/?fb=reset" });
        if (error) throw error;
        authMsg("登録されているメールアドレスであれば、再設定のメールを送りました。この端末・このブラウザでリンクを開いてください。", true);
      }
    } catch (e) {
      authMsg(authErr(e)); track("login_fail", null, { reason: (e && e.code) || "error", mode });
    } finally { auth.busy = false; if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  }
  async function submitReset(f) {
    const pass = $("#fbNewPass").value;
    if (pass.length < 8) return authMsg("パスワードは8文字以上で入力してください。");
    try {
      if (!CFG.testAuth) { const { error } = await sb.auth.updateUser({ password: pass }); if (error) throw error; }
      flash("パスワードを変更しました"); location.href = "/me/";
    } catch (e) { authMsg(authErr(e)); }
  }

  /* ---------- 計測（未ログインでも端末ごとの匿名IDで記録。メールなど個人情報は送らない） ---------- */
  const anon = (() => { let a = ls.get("fb_anon", null); if (!a) { a = "a" + Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set("fb_anon", a); } return a; })();
  const today = () => new Date().toISOString().slice(0, 10);
  let navSrc = null;          // 直前にクリックしたリンクの種類（関連カード・ホームなど）
  function track(name, card, props = {}, dedupe = null) {
    if (!ENABLED) return;
    rpc("log_event", { name, anon_id: anon, card_id: card || null, props, dedupe_key: dedupe }).catch(() => {});
  }

  /* ---------- 小さな部品 ---------- */
  // ページ移動の直後に表示するお知らせ（移動するとページが読み直されるため）
  const flash = msg => { ss.set("fb_flash", msg); toast(msg); };
  let toastT = null;
  function toast(msg) {
    let t = $("#fbToast");
    if (!t) { t = document.createElement("div"); t.id = "fbToast"; t.className = "fb-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); document.body.appendChild(t); }
    t.innerHTML = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3200);
  }
  function paintMe() {
    let b = $("#meBtn");
    const nav = $(".topbar-in");
    if (!b && nav) { b = document.createElement("a"); b.id = "meBtn"; b.className = "me-btn"; nav.insertBefore(b, $("#menuBtn")); }
    if (!b) return;
    b.href = "/me/";
    if (!ENABLED || !loggedIn()) { b.hidden = true; return; }   // まだ参加していない人には出さない
    b.hidden = false;
    b.innerHTML = loggedIn() ? `${who.avatar ? `<img src="${esc(who.avatar)}" alt="" width="26" height="26" referrerpolicy="no-referrer">` : "👤"}<span class="me-name">${isAdmin() ? "管理者" : "マイページ"}</span><i class="me-dot" hidden></i>` : "";
    b.setAttribute("aria-label", "マイページ");
    if (loggedIn()) refreshUnread();
  }
  function refreshUnread() {
    const b = $("#meBtn"); if (!b || !loggedIn()) return;
    rpc("unread_count").then(n => {
      const d = b.querySelector(".me-dot"); if (!d) return;
      d.hidden = !(n > 0); d.textContent = n > 9 ? "9+" : n;
      b.setAttribute("aria-label", n > 0 ? `マイページ（未読${n}件）` : "マイページ");
    }).catch(() => {});
  }
  const ruleLbl = c => `${RULES[c.rule] || c.rule}${c.cond && c.cond !== "standard" ? "・" + (CONDS[c.cond] || c.cond) : ""}`;
  const statusLbl = c => c.origin === "editorial" ? "編集部提案・未決定" : "ファン提案・未決定";
  const isRematch = c => H.meetings(c.fa, c.fb).length > 0;
  const div = k => (P(k) && P(k).division) || "";
  const loading = (msg = "読み込み中…") => `<div class="fb-loading" role="status"><span class="spin" aria-hidden="true"></span>${msg}</div>`;
  const failBox = (e, retry) => `<div class="fb-fail" role="alert"><p>${esc(e && e.message || "読み込めませんでした。")}</p>${retry ? `<button class="btn small" data-retry="${retry}">もう一度読み込む</button>` : ""}</div>`;
  const offBox = () => `<div class="fb-off"><b>ファン投票は準備中です</b><p>カードの作成・「見たい！」・コメントは公開準備中です。架空の票やコメントは表示していません。</p></div>`;

  // カード（一覧・ホーム・選手ページで共通）
  function cardHtml(c, o = {}) {
    if (!valid(c.fa) || !valid(c.fb)) return "";
    const href = `/matchups/${encodeURIComponent(c.id)}/`;
    const reason = c.reason && c.reason.body;
    const side = (k, cls) => `<div class="fc-side ${cls}"><span class="fc-av">${av(k, "l")}</span><b>${nm(k)}</b><small>${esc(div(k) || "階級不明")}</small></div>`;
    return `<article class="fc ${o.big ? "fc-big" : ""} ${o.preview ? "fc-preview" : ""}" data-card="${esc(c.id)}">
      ${o.label ? `<div class="fc-label">${esc(o.label)}</div>` : ""}
      <a class="fc-link" href="${href}" data-src="${esc(o.src || "list")}"${o.why ? ` data-why="${esc(o.why)}"` : ""} aria-label="${nm(c.fa)} 対 ${nm(c.fb)}（${esc(ruleLbl(c))}）のカードを見る">
        <div class="fc-meta"><span class="fc-rule">${esc(ruleLbl(c))}</span>${isRematch(c) ? '<span class="fc-re">再戦希望</span>' : ""}<span class="fc-status">${statusLbl(c)}</span></div>
        <div class="fc-vs">${side(c.fa, "red")}<span class="fc-x" aria-hidden="true">VS</span>${side(c.fb, "blue")}</div>
        ${reason ? `<p class="fc-reason"><span class="q" aria-hidden="true">“</span>${esc(reason)}<small>${esc(c.creator ? c.creator.name : "退会したユーザー")}</small></p>` : ""}
        ${o.period ? `<div class="fc-period">🔥 ${esc(o.period)}</div>` : ""}
      </a>
      ${o.preview ? "" : actions(c)}
      <div class="fc-next" hidden></div>
    </article>`;
  }
  function actions(c) {
    const me = c.me || {};
    return `<div class="fc-acts">
      <button class="fb-want" data-act="want" data-id="${esc(c.id)}" aria-pressed="${!!me.want}" aria-label="この対戦を見たい（現在${c.want}人）"><span class="ic" aria-hidden="true">${me.want ? "★" : "☆"}</span><span class="t">見たい！</span><b>${c.want}</b></button>
      <button class="fb-fun" data-act="fun" data-id="${esc(c.id)}" aria-pressed="${!!me.fun}" aria-label="組み合わせが面白い（現在${c.fun}人）"><span class="t">面白い</span><b>${c.fun}</b></button>
      <a class="fb-cmlink" href="/matchups/${encodeURIComponent(c.id)}/?focus=comments" data-src="comment_link" aria-label="コメント${c.comments}件"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg><b>${c.comments}</b></a>
    </div>`;
  }
  // 反応の結果を、同じカードが表示されているすべての場所に反映
  function paintCounts(c) {
    if (!c || !c.id) return;
    $$(`[data-card="${CSS.escape(c.id)}"]`).forEach(el => {
      const me = c.me || {};
      const w = el.querySelector('[data-act="want"]'), f = el.querySelector('[data-act="fun"]'), cm = el.querySelector(".fb-cmlink b");
      if (w) { w.setAttribute("aria-pressed", !!me.want); w.querySelector("b").textContent = c.want; w.querySelector(".ic").textContent = me.want ? "★" : "☆"; w.setAttribute("aria-label", `この対戦を見たい（現在${c.want}人）`); }
      if (f) { f.setAttribute("aria-pressed", !!me.fun); f.querySelector("b").textContent = c.fun; f.setAttribute("aria-label", `組み合わせが面白い（現在${c.fun}人）`); }
      if (cm) cm.textContent = c.comments;
    });
    const sv = $(`#fbSave[data-id="${CSS.escape(c.id)}"]`);
    if (sv && c.me) { sv.setAttribute("aria-pressed", !!c.me.saved); sv.textContent = c.me.saved ? "✓ 保存済み" : "保存"; }
  }
  const cache = {};   // id → 最後に受け取ったカード
  const remember = list => (list || []).forEach(c => { cache[c.id] = c; });
  const grid = (list, o = {}) => { const h = (list || []).map(c => cardHtml(c, typeof o === "function" ? o(c) : o)).join(""); return h ? `<div class="fc-grid">${h}</div>` : ""; };

  /* ---------- X共有 ---------- */
  function shareText(c, withReason) {
    const r = withReason && c.reason && c.reason.body ? `\n「${c.reason.body.slice(0, 60)}」` : "";
    return `自分はこの一戦が見たい。${S.nameOf(c.fa)} vs ${S.nameOf(c.fb)}（${ruleLbl(c)}）、みんなはどう思う？${r}\n#RIZIN #FIGHTBOOK`;
  }
  const xIntent = (c, text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(cardUrl(c.id) + "?ref=x_share")}&via=fightbookjp`;
  function sharePanel(c) {
    const hasR = !!(c.reason && c.reason.body);
    return `<div class="fb-share" id="fbShare" data-id="${esc(c.id)}">
      <label for="fbShareText">投稿文（Xの画面で編集できます）</label>
      <textarea id="fbShareText" rows="3" maxlength="200">${esc(shareText(c, false))}</textarea>
      ${hasR ? `<label class="toggle"><input type="checkbox" id="fbShareReason"> 提案理由も入れる</label>` : ""}
      <div class="fb-share-acts"><a class="btn primary" id="fbShareGo" href="${esc(xIntent(c, shareText(c, false)))}" target="_blank" rel="noopener">Xの投稿画面を開く</a>
      <button class="btn" id="fbCopy" data-url="${esc(cardUrl(c.id))}">URLをコピー</button></div>
      <p class="note">共有は任意です。ボタンを押してもXに自動で投稿されることはありません。</p>
    </div>`;
  }

  /* ---------- ホーム ----------
     役割は2つだけ：①決定済みの試合の勝敗を予想して語る（主役） ②次に見たい一戦をファンが提案して語る
     ・表示する試合：受付中の大会のうち締め切りが近い大会。先頭はメインイベント（管理者が決めた試合順）、続けて3試合
     ・予想前は割合を見せない（多数派に引っ張られないように）。予想後に割合と「理由をコメント」「次の試合」を出す
     ・数字はすべて実際の集計。0件のときは0件と分かる表示にする */
  const home = { tab: null, rule: "", ev: null, others: [], mode: null, live: null };
  const HOME_BOUTS = 4;
  function homeTop() {
    if (!ENABLED) return "";
    return `<section class="hp" aria-labelledby="hpT"><div class="wrap">
        <div class="hp-head"><h2 id="hpT">次の一戦、あなたはどっち？</h2>
          <p>発表済みの対戦カードの勝者を予想しよう。登録不要・締め切りまで何度でも変更できます。</p></div>
        <div id="hpBox" aria-live="polite">${loading("対戦カードを読み込み中…")}</div>
      </div></section>
      <section class="hf" aria-labelledby="hfT"><div class="wrap">
        <div class="hf-head">
          <div><span class="hf-tag">ファン提案・開催未定</span><h2 id="hfT">次に見たい一戦を、ファンで語ろう</h2>
            <p>実際に決まった試合ではなく、ファンが「この試合が見たい」と提案した対戦です。</p></div>
          <a class="fz-btn hf-post" href="/create/" data-src="home_fan_post"><span aria-hidden="true">＋</span>見たい一戦を投稿する</a>
        </div>
        <div id="hfList">${loading()}</div>
      </div></section>`;
  }
  async function loadHome() {
    if (!ENABLED) return;
    await ready();
    paintMe();
    loadHomePredict();
    loadHomeFans();
  }
  async function loadHomePredict() {
    const box = $("#hpBox"); if (!box) return;
    try {
      const list = (await rpc("list_fight_events")).filter(e => e.bouts > 0);
      const open = list.filter(e => !e.locked).sort((a, b) => a.starts_at < b.starts_at ? -1 : 1);
      const past = list.filter(e => e.locked).sort((a, b) => a.starts_at < b.starts_at ? 1 : -1);
      home.live = past.find(e => e.phase === "live") || null;
      const pickEv = open[0] || past[0];
      home.others = open.slice(1);
      home.mode = open[0] ? "open" : pickEv ? "past" : "none";
      home.ev = pickEv ? await rpc("get_fight_event", { eid: pickEv.id }) : null;
      if (home.ev) home.skew = new Date(home.ev.now).getTime() - Date.now();
      paintHomePredict();
      if (home.mode === "open") track("home_predict_view", null, { event: home.ev.id, picked: home.ev.bouts.filter(b => b.me).length }, `hpv:${anon}:${home.ev.id}:${new Date().toISOString().slice(0, 10)}`);
    } catch (e) { box.innerHTML = failBox(e, "home"); }
  }
  // 表示する試合：メインイベントから順に（試合順の大きい方がメイン）
  const homeBouts = ev => ev.bouts.slice().sort((a, b) => b.ord - a.ord || b.id - a.id);
  function paintHomePredict() {
    const box = $("#hpBox"); if (!box) return;
    const ev = home.ev;
    const liveStrip = home.live && (!ev || home.live.id !== ev.id || home.mode !== "past")
      ? `<a class="hp-live" href="/predict/${encodeURIComponent(home.live.id)}/" data-src="home_live"><i aria-hidden="true"></i><b>試合中</b>${esc(home.live.name)}｜コメントで盛り上がろう<span aria-hidden="true">→</span></a>` : "";
    if (!ev) {
      box.innerHTML = liveStrip + `<div class="hp-empty"><b>いま受付中の試合はありません</b><p>次の大会の対戦カードが発表されたら、ここで勝敗を予想できます。それまでは、ファンが提案する「見たい一戦」で語りましょう。</p><a class="btn small" href="#hfT">見たい一戦を見る ↓</a></div>`;
      return;
    }
    const st = stateOf(ev), bouts = homeBouts(ev), shown = bouts.slice(0, HOME_BOUTS);
    const BADGE = { open: "勝敗予想 受付中", closed: "勝敗予想の受付は終了", live: "● 試合中", finished: "試合終了" };
    const picked = ev.bouts.filter(b => b.me).length;
    box.innerHTML = liveStrip
      + (home.mode === "past" ? `<p class="hp-note">いま受付中の試合はありません。直近の大会の試合について、コメントで語りましょう。</p>` : "")
      + `<div class="hp-ev"><span class="pv-badge st-${st}">${BADGE[st]}</span>
          <a class="hp-ev-name" href="/predict/${encodeURIComponent(ev.id)}/" data-src="home_event">${esc(ev.name)}</a>
          <small>${fmtWhen(ev.starts_at)}${ev.venue ? `・${esc(ev.venue)}` : ""}・${ev.predictors ? `${ev.predictors}人が予想に参加` : "まだ予想した人はいません"}${picked ? `・あなたは${picked}/${ev.bouts.length}試合を予想済み` : ""}</small></div>
        <div class="hp-grid">${shown.map((b, i) => hpBout(b, i === 0)).join("")}</div>
        <div class="hp-foot"><a class="hp-all" href="/predict/${encodeURIComponent(ev.id)}/" data-src="home_all_bouts">${st === "open" ? `受付中の試合をすべて見る（全${ev.bouts.length}試合）` : `全${ev.bouts.length}試合の${st === "finished" ? "結果と" : ""}コメントを見る`}<span aria-hidden="true">→</span></a></div>
        ${home.others.length ? `<p class="hp-others">ほかに受付中の大会：${home.others.map(o => `<a href="/predict/${encodeURIComponent(o.id)}/" data-src="home_other_event">${esc(o.name)}</a>`).join("、")}</p>` : ""}`;
    startHomeCountdown();
  }
  function hpBout(b, featured) {
    const ev = home.ev, open = !ev.locked && !b.winner, me = b.me || {}, c = b.counts, tot = c ? c.a + c.b : 0;
    const pa = tot ? Math.round(c.a / tot * 100) : 0, decided = b.winner === "a" || b.winner === "b";
    const corner = s => vsPanel(b, s, { featured, src: "home_fighter" });
    const pickBtn = s => `<button class="hpb-pick ${s === "a" ? "red" : "blue"}" data-hpick="${s}" data-bid="${b.id}" aria-pressed="${me.pick === s}">${me.pick === s ? "✓ " : ""}${esc(fname(b, s))}が勝つ</button>`;
    const bar = c ? `<div class="pv-bar" aria-label="${esc(fname(b, "a"))} ${pa}%・${esc(fname(b, "b"))} ${100 - pa}%"><i style="width:${pa}%"></i></div>
        <div class="pv-pct"><span>${pa}%</span><small>${tot}人が予想</small><span>${tot ? 100 - pa : 0}%</span></div>` : "";
    const cmLink = (t) => `<a class="hpb-cm" href="/predict/${encodeURIComponent(ev.id)}/?bout=${b.id}" data-src="home_to_comment" data-bid="${b.id}">💬 ${t}${b.ncm ? `（${b.ncm}件）` : ""}</a>`;
    let body;
    if (open && !me.pick) {
      body = `<div class="hpb-picks" role="group" aria-label="勝者を予想">${pickBtn("a")}${pickBtn("b")}</div>
        <p class="hpb-hint">${b.n ? `${b.n}人が予想済み。` : "まだ予想はありません。最初の予想をどうぞ。"}予想すると、みんなの予想の割合が見られます。</p>
        ${b.ncm ? `<div class="hpb-next">${cmLink("コメントを読む")}</div>` : ""}`;
    } else if (open) {
      body = `<div class="hpb-picks" role="group" aria-label="勝者を予想（変更できます）">${pickBtn("a")}${pickBtn("b")}</div>
        <div class="hpb-res" role="status"><p class="hpb-done">✓ <b>${esc(fname(b, me.pick))}</b>の勝ちと予想しました<small>締め切りまで変更できます</small></p>${bar}</div>
        <div class="hpb-next">${cmLink(b.ncm ? "みんなの理由を読んで、コメントしよう" : "そう思った理由をコメントしよう")}<button class="hpb-go" data-hpnext="${b.id}">次の試合を予想<span aria-hidden="true"> ↓</span></button></div>`;
    } else {
      const hit = decided && me.pick ? me.pick === b.winner : null;
      body = `${me.pick ? `<p class="hpb-done">あなたの予想：<b>${esc(fname(b, me.pick))}</b>${hit === true ? '<span class="pv-hit">的中！</span>' : hit === false ? '<span class="pv-miss">はずれ</span>' : ""}</p>` : ""}${bar}
        <div class="hpb-next">${cmLink(stateOf(ev) === "finished" || b.winner ? "感想をコメントしよう" : "この試合について語ろう")}</div>`;
    }
    return `<article class="hpb ${featured ? "big" : ""} ${me.pick ? "done" : ""}" data-hpb="${b.id}">
      <div class="hpb-meta">${featured ? '<span class="hpb-main">メインイベント</span>' : ""}${b.title ? '<span class="pv-title">タイトルマッチ</span>' : ""}${b.weight ? `<span>${esc(b.weight)}</span>` : ""}</div>
      <div class="hpb-vs fp-vs">${corner("a")}<span class="fp-x" aria-hidden="true">VS</span>${corner("b")}</div>
      ${featured && open ? `<div class="hp-cd" id="hpCd" role="timer" aria-live="off"><span class="hp-cd-l">勝敗予想の締め切りまで</span><span class="hp-cd-t" id="hpCdT"></span><small>締め切り：${fmtWhen(ev.starts_at)}</small></div>` : ""}
      ${body}
    </article>`;
  }
  /* 選手パネル：ポスターのように写真を大きく見せ、名前を写真の下部に重ねる（赤コーナー／青コーナーの色帯つき）
     写真が無い選手は同じ枠にシルエット。自分が予想した側には「あなたの予想」、勝者には WIN を重ねる */
  function vsPanel(b, s, o = {}) {
    const x = side(b, s), name = fname(b, s), link = x.key && valid(x.key), ph = link ? photoOf(x.key) : null;
    const me = b.me || {}, win = b.winner === s, lose = (b.winner === "a" || b.winner === "b") && !win;
    const inner = `${ph ? `<img src="${esc(ph.src)}" alt="" loading="${o.featured ? "eager" : "lazy"}" decoding="async" style="object-position:${esc(ph.pos)}" onerror="this.remove()">` : ""}<span class="fp-sil" aria-hidden="true">${SIL}</span>
      <span class="fp-shade" aria-hidden="true"></span>
      ${me.pick === s ? '<span class="fp-mine">✓ あなたの予想</span>' : ""}
      ${win ? `<span class="fp-win">WIN${b.method ? "・" + esc(METH[b.method] || "") : ""}</span>` : ""}
      <b class="fp-name">${esc(name)}</b>`;
    return `<div class="fp ${s === "a" ? "red" : "blue"} ${o.featured ? "big" : ""} ${me.pick === s ? "on" : ""} ${win ? "win" : ""} ${lose ? "lose" : ""}">
      ${link ? `<a class="fp-ph" href="/fighters/${encodeURIComponent(x.key)}/" data-src="${o.src || "fighter"}" aria-label="${esc(name)}の選手ページ">${inner}</a>` : `<div class="fp-ph">${inner}</div>`}
    </div>`;
  }
  // 1秒ごとに、締め切りまでの文字だけを書き換える
  function startHomeCountdown() {
    clearInterval(home.timer);
    const el = $("#hpCdT"); if (!el || !home.ev) return;
    const at = new Date(home.ev.starts_at).getTime(), pad = n => String(n).padStart(2, "0");
    const tick = home.tick = () => {
      const t0 = $("#hpCdT"); if (!t0) { clearInterval(home.timer); return; }
      const ms = at - (Date.now() + (home.skew || 0));
      if (ms <= 0) { clearInterval(home.timer); loadHomePredict(); return; }
      const t = Math.floor(ms / 1000), d = Math.floor(t / 86400);
      const txt = `${d ? `<b>${d}</b>日 ` : ""}<b>${pad(Math.floor(t % 86400 / 3600))}</b>時間 <b>${pad(Math.floor(t % 3600 / 60))}</b>分 <b>${pad(t % 60)}</b>秒`;
      if (t0.innerHTML !== txt) t0.innerHTML = txt;
      const cd = $("#hpCd"); if (cd) cd.dataset.level = ms <= 3600e3 ? "hot" : ms <= 86400e3 ? "warm" : "normal";
    };
    tick(); home.timer = setInterval(tick, 1000);
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && home.tick && $("#hpCdT")) home.tick(); });
  async function homePick(btn) {
    const bid = +btn.dataset.bid, ev = home.ev; if (!ev) return;
    const b = ev.bouts.find(x => x.id === bid); if (!b || busy.has("h" + bid)) return;
    busy.add("h" + bid);
    const was = b.me && b.me.pick, p = btn.dataset.hpick;
    try {
      if (!loggedIn()) await ensureUser();
      const nb = await rpc("set_prediction", { bid, pick: p, method: was === p ? b.me.method : null });
      Object.assign(b, nb);
      if (!was && !ev.bouts.some(x => x !== b && x.me)) ev.predictors++;
      const card = $(`[data-hpb="${bid}"]`);
      if (card) {
        card.outerHTML = hpBout(b, card.classList.contains("big"));
        if (card.classList.contains("big")) startHomeCountdown();
        const nb2 = $(`[data-hpb="${bid}"] [data-hpick="${p}"]`); if (nb2) nb2.focus({ preventScroll: true });
      }
      track("predict", null, { event: ev.id, bout: bid, change: !!was, src: "home" });
    } catch (e) {
      if (e.code === "LOCKED") { toast("勝敗予想の受付は終了しました。コメントは引き続き投稿できます。"); loadHomePredict(); }
      else toast(esc(e.message));
    } finally { busy.delete("h" + bid); }
  }
  // 「次の試合を予想」：まだ予想していないホームのカードへ。無ければ大会ページへ
  function homeNext(bid) {
    const cards = $$("[data-hpb]"), i = cards.findIndex(c => +c.dataset.hpb === bid);
    const next = cards.slice(i + 1).concat(cards.slice(0, i)).find(c => !c.classList.contains("done"));
    track("home_next_bout", null, { event: home.ev.id, from: bid, to: next ? "home" : "event" });
    if (!next) { location.href = `/predict/${encodeURIComponent(home.ev.id)}/`; return; }
    next.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    const b = next.querySelector(".hpb-pick"); if (b) setTimeout(() => b.focus({ preventScroll: true }), 350);
  }
  // 見たい一戦：「見たい！」が多い順に3件（足りなければ新着で埋める）
  async function loadHomeFans() {
    const box = $("#hfList"); if (!box) return;
    try {
      const [tot, nw] = await Promise.all([rpc("list_cards", { tab: "total", lim: 3 }), rpc("list_cards", { tab: "new", lim: 6 })]);
      const cards = tot.cards.slice(0, 3);
      for (const c of nw.cards) { if (cards.length >= 3) break; if (!cards.some(x => x.id === c.id)) cards.push(c); }
      remember(cards);
      if (!cards.length) {
        box.innerHTML = `<div class="fz-empty"><b>最初の「見たい一戦」を、あなたが。</b><p>選手を2人選んで、見たい理由をひと言書くだけです。</p>${exampleCard()}</div>`;
        return;
      }
      const html = cards.map(c => cardHtml(c, { src: "home_fan" })).join("");
      box.innerHTML = `<div class="hf-grid">${html}</div>
        <div class="hf-foot"><small>${tot.cards.length ? "「見たい！」が多い順" : "新着順"}${tot.cards.length && tot.cards.length < 3 ? "（足りない分は新着）" : ""}・${hhmm(tot.as_of)} 時点</small><a class="hp-all" href="/cards/" data-src="home_fan_all">見たい一戦をすべて見る<span aria-hidden="true">→</span></a></div>`;
    } catch (e) { box.innerHTML = failBox(e, "home"); }
  }
  async function loadHomeList() {}   // 旧ホームの一覧（今は使わない。古いイベント処理から呼ばれても何もしない）
  const tabBar = (id, cur) => `<div class="tabs" id="${id}" role="tablist">${TABS.map(t => `<button class="tab" role="tab" aria-selected="${t.id === cur}" aria-pressed="${t.id === cur}" data-tab="${t.id}">${t.t}</button>`).join("")}</div>`;
  const ruleSelect = (id, cur) => `<label class="fb-sel"><span class="sr">ルールで絞り込み</span><select id="${id}"><option value="">すべてのルール</option>${Object.entries(RULES).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
  const periodText = (tab, c) => tab === "trending" ? `直近48時間で${c.period_n}人が「見たい！」` : tab === "weekly" ? `今週${c.period_n}人が「見たい！」` : "";
  const EMPTY_TAB = {
    trending: "急上昇の条件（直近48時間に3人以上が「見たい！」）を満たすカードは、まだありません。",
    weekly: "この7日間に「見たい！」が付いたカードは、まだありません。",
    total: "「見たい！」が付いたカードは、まだありません。",
    new: "まだカードがありません。最初の1枚を作ってみませんか？",
  };
  // カードが1枚も無いときの作成例（投票できない見本であることを明示）
  function exampleCard() {
    const fw = S.ranked.filter(p => p.active && p.division === "フェザー級");
    if (fw.length < 2) return "";
    return `<div class="fb-example"><div class="fb-example-h">作成例（見本です。投票はできません）</div>${cardHtml({ id: "example", fa: fw[0].key, fb: fw[1].key, rule: "mma", cond: "standard", origin: "fan", want: 0, fun: 0, comments: 0 }, { preview: true, src: "example" }).replace('href="/matchups/example/"', `href="/create/?a=${encodeURIComponent(fw[0].key)}&b=${encodeURIComponent(fw[1].key)}"`)}</div>`;
  }

  /* ---------- 一覧 ---------- */
  const list = { tab: "trending", rule: "", off: 0, items: [] };
  function viewCards() {
    return H.pageHero("Fan Cards", "ファンが「見たい！」と声を上げた対戦カード。実際の対戦を決めるものではありません。") + `
    <div class="wrap">
      ${ENABLED ? `<section class="section">
        <div class="fb-tools">${tabBar("fbListTab", list.tab)}${ruleSelect("fbListRule", list.rule)}<a class="btn primary small" href="/create/">＋ カードを作る</a></div>
        <div id="fbList">${loading()}</div>
      </section>
      <section class="section"><details class="fb-def"><summary>ランキングの決め方</summary>
        <dl>
          <dt>急上昇</dt><dd>直近48時間に、初めて「見たい！」を押した人の数。3人以上のカードだけを対象にします。</dd>
          <dt>週間</dt><dd>直近7日間に、初めて「見たい！」を押した人の数（取り消された票は数えません）。</dd>
          <dt>累計</dt><dd>現在有効な「見たい！」の総数。</dd>
          <dt>新着</dt><dd>公開された順。</dd>
          <dt>共通のルール</dt><dd>表示した時点で集計します。同じ数のときは、最後に「見たい！」が付いたのが新しい順です。取り消してから押し直しても、最初に押した時刻のまま数えるので、押し直しで順位は上がりません。コメントの数は順位に影響しません。非公開になったカードは除外します。新しいカードにも特別な加点・減点はありません。</dd>
        </dl></details></section>` : `<section class="section">${offBox()}</section>`}
    </div>`;
  }
  async function loadList(more) {
    const box = $("#fbList"); if (!box) return;
    if (!more) { list.off = 0; list.items = []; box.innerHTML = loading(); }
    try {
      await ready(); paintMe();
      const r = await rpc("list_cards", { tab: list.tab, rule_f: list.rule || null, lim: 20, off: list.off });
      remember(r.cards); list.items = list.items.concat(r.cards); list.off += r.cards.length;
      box.innerHTML = (grid(list.items, c => ({ src: "list_" + list.tab, period: periodText(list.tab, c) })) || `<div class="fb-empty"><p>${EMPTY_TAB[list.tab]}</p><a class="btn primary" href="/create/">＋ 見たい対戦を作る</a></div>`)
        + (r.cards.length === 20 ? `<button class="btn fb-more" id="fbMore">もっと見る</button>` : "")
        + `<p class="fb-asof">${hhmm(r.as_of)} 時点の集計</p>`;
    } catch (e) { box.innerHTML = failBox(e, "list"); }
  }

  /* ---------- カード詳細 ---------- */
  const det = { id: null, sort: "new", card: null, focus: null };
  function viewCard(id, sub) {
    det.id = id; det.card = null; det.focus = sub || null;
    if (!ENABLED) return `<div class="wrap"><section class="section">${offBox()}</section></div>`;
    return `<div class="wrap fb-detail" id="fbDetail">${loading("カードを読み込み中…")}</div>`;
  }
  async function loadCard() {
    const box = $("#fbDetail"); if (!box) return;
    const id = det.id;
    try {
      await ready(); paintMe();
      const c = await rpc("get_card", { cid: id });
      if (det.id !== id) return;
      if (!c) { box.innerHTML = `<div class="fb-empty"><b>カードが見つかりません</b><p>URLが間違っているか、削除された可能性があります。</p><a class="btn" href="/cards/">カード一覧へ</a></div>`; setMeta(null); return; }
      if (c.status !== "public" && !(who && who.admin)) { box.innerHTML = `<div class="fb-empty"><b>このカードは削除されました</b><p>管理者の判断により削除されました。</p><a class="btn" href="/cards/">カード一覧へ</a></div>`; setMeta(null, true); return; }
      if (!valid(c.fa) || !valid(c.fb)) { box.innerHTML = `<div class="fb-empty"><b>選手データを確認中のカードです</b></div>`; return; }
      det.card = c; cache[c.id] = c;
      box.innerHTML = detailHtml(c);
      setMeta(c);
      const ref = new URLSearchParams(location.search).get("ref");
      const src = navSrc || ss.get("fb_navsrc") || (ref ? "share" : document.referrer && new URL(document.referrer).origin === location.origin ? "internal" : "direct");
      ss.set("fb_navsrc", "");
      track("card_view", c.id, { src, logged_in: loggedIn() }, `cv:${anon}:${c.id}:${today()}`);
      if (ref === "x_share" && !ss.get("sl:" + c.id)) { ss.set("sl:" + c.id, "1"); track("share_landing", c.id, {}, `sl:${anon}:${c.id}`); }
      navSrc = null;
      loadComments(); loadRelated(c);
      if (det.focus === "comments") setTimeout(() => { const el = $("#comments"); if (el) el.scrollIntoView(); }, 60);
      if (ss.get("fb_new") === c.id) { ss.set("fb_new", ""); const sp = $("#fbShareWrap"); if (sp) { sp.innerHTML = sharePanel(c); sp.hidden = false; } }
    } catch (e) { box.innerHTML = failBox(e, "card"); }
  }
  function detailHtml(c) {
    const a = c.fa, b = c.fb, met = H.meetings(a, b), me = c.me || {};
    const hidden = c.status !== "public" ? `<div class="fb-warn">削除済み（管理者のみ表示）</div>` : "";
    return `${hidden}
    <nav class="crumb"><a href="/cards/">ファンの見たい対戦</a> › <span>${nm(a)} vs ${nm(b)}</span></nav>
    <section class="fb-board" data-card="${esc(c.id)}">
      <div class="fb-board-meta"><span class="fc-rule">${esc(ruleLbl(c))}</span><span class="fc-status">${statusLbl(c)}</span>${met.length ? `<span class="fc-re">再戦希望（実際の対戦 ${met.length}回）</span>` : '<span class="fc-re">初対戦</span>'}</div>
      <h1 class="fb-title"><a href="/fighters/${encodeURIComponent(a)}/" class="red">${av(a, "l")}<span>${nm(a)}</span></a><span class="vs" aria-label="対">VS</span><a href="/fighters/${encodeURIComponent(b)}/" class="blue"><span>${nm(b)}</span>${av(b, "l")}</a></h1>
      ${c.reason ? `<blockquote class="fb-reason"><p>${esc(c.reason.body)}</p><cite>${c.creator ? `${c.creator.avatar ? `<img src="${esc(c.creator.avatar)}" alt="" width="20" height="20" referrerpolicy="no-referrer">` : ""}${esc(c.creator.name)}` : "退会したユーザー"} さんの提案理由</cite></blockquote>`
        : `<p class="fb-reason none">${c.creator ? `${esc(c.creator.name)} さん` : c.origin === "editorial" ? "編集部" : "退会したユーザー"}の提案です。</p>`}
      ${actions(c)}
      <div class="fc-next" hidden></div>
      <div class="fb-tools2">
        <button class="btn small" id="fbSave" data-id="${esc(c.id)}" aria-pressed="${!!me.saved}">${me.saved ? "✓ 保存済み" : "保存"}</button>
        <button class="btn small" id="fbShareBtn" aria-expanded="false" aria-controls="fbShareWrap">Xで共有</button>
        <button class="btn small" id="fbCopy" data-url="${esc(cardUrl(c.id))}">URLをコピー</button>
        <button class="btn small ghost" data-report="card" data-target="${esc(c.id)}">通報</button>
        ${who && who.admin ? `<button class="btn small danger" data-admin-hide="card" data-target="${esc(c.id)}" data-hidden="${c.status === "public"}">${c.status === "public" ? "🗑 カードを削除（管理者）" : "削除を取り消す"}</button>` : ""}
      </div>
      <div id="fbShareWrap" hidden></div>
      <p class="fb-note">ファンによる提案で、実際の対戦が決まったものではありません。公開：${hhmm(c.created_at)}</p>
    </section>

    <section class="section" id="comments">
      <div class="sec-head"><h2>Comments<small>みんなの意見（${c.comments}）</small></h2></div>
      ${composer(null)}
      <div class="tabs fb-sort" id="fbSort" aria-label="並び順"><button class="tab" data-sort="new" aria-pressed="${det.sort === "new"}">新しい順</button><button class="tab" data-sort="old" aria-pressed="${det.sort === "old"}">古い順</button></div>
      <div id="fbComments">${loading()}</div>
    </section>

    <section class="section" id="related">
      <div class="sec-head"><h2>Next<small>次に見るカード</small></h2></div>
      <div id="fbRelated">${loading()}</div>
    </section>

    <section class="section">
      <div class="sec-head"><h2>Tale of the Tape<small>データ比較（RIZIN・確認済みの記録）</small></h2><a href="/compare/?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}">詳しい比較 ›</a></div>
      <div class="cmp">${H.compareRows(a, b)}</div>
      ${met.length ? `<h3 class="fb-h3">実際の対戦記録</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>日付</th><th>勝者</th><th>決着</th><th>大会</th></tr></thead><tbody>${met.map(f => `<tr><td class="num">${H.fmtDate(f.date)}</td><td class="opp">${f.outcome === "W" ? H.link(f.winner) : (f.outcome === "D" ? "引き分け" : "無効試合")}</td><td>${esc(H.METHOD_JA[f.cat] || "")}${f.round ? `<span class="ev">　${esc(f.round)}R ${esc(f.time)}</span>` : ""}</td><td class="ev">${esc(f.event)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">RIZINでの対戦記録はありません。</p>`}
    </section>`;
  }
  function composer(parent) {
    const id = parent ? `r${parent}` : "main";
    const draft = ls.get(`fb_draft_cm_${det.id}_${id}`, "");
    return `<form class="fb-comp" data-parent="${parent || ""}" data-cid="${id}">
      ${parent ? "" : `<div class="fb-hints" role="group" aria-label="書き出しのヒント（任意）">${HINTS.map(h => `<button type="button" class="fbchip" data-hint="${h.k}" aria-pressed="false">${h.t}</button>`).join("")}</div>`}
      <label class="fb-nick-l">ニックネーム（公開）<input class="fb-nick" maxlength="30" value="${esc(nickOf())}" placeholder="例：格闘技好き" autocomplete="nickname"></label>
      <label class="sr" for="cm_${id}">${parent ? "返信を書く" : "コメントを書く"}</label>
      <textarea id="cm_${id}" rows="${parent ? 2 : 3}" maxlength="300" placeholder="${parent ? "返信を書く（300字まで）" : "一言でもOK。あなたの意見を書いてください（300字まで）"}">${esc(draft)}</textarea>
      <div class="fb-comp-foot"><span class="fb-count" aria-live="polite">${draft.length}/300</span>
        ${parent ? `<button type="button" class="btn small ghost" data-cancel-reply>やめる</button>` : ""}
        <button class="btn primary small" type="submit">${parent ? "返信する" : "投稿する"}</button></div>
      <p class="fb-rules">ログインは不要です。ニックネームは公開されます。このブラウザで投稿したコメントは、あとから編集・削除できます。「見たくない」「この条件では難しい」などの反対意見も歓迎です。選手や他のファンへの侮辱・差別は管理者が削除します。</p>
    </form>`;
  }
  async function loadComments() {
    const box = $("#fbComments"); if (!box || !det.id) return;
    try {
      const list = await rpc("list_comments", { cid: det.id, sort: det.sort });
      box.innerHTML = list.length ? `<ol class="fb-cms">${list.map(m => commentHtml(m, false)).join("")}</ol>`
        : `<p class="note">まだコメントはありません。「見たい理由」を一言書いてみませんか？</p>`;
    } catch (e) { box.innerHTML = failBox(e, "comments"); }
  }
  function commentHtml(m, isReply) {
    const dead = m.status !== "visible";
    const body = dead ? `<p class="fb-dead">${m.status === "hidden" ? "このコメントは管理者が削除しました" : "このコメントは削除されました"}</p>${who && who.admin && m.body ? `<p class="fb-admin-body">${esc(m.body)}</p>` : ""}`
      : `<p class="fb-body" id="body_${m.id}">${esc(m.body)}</p>`;
    const head = dead ? "" : `<div class="fb-cm-h">${m.user && m.user.avatar ? `<img src="${esc(m.user.avatar)}" alt="" width="24" height="24" referrerpolicy="no-referrer" loading="lazy">` : '<span class="fb-noav" aria-hidden="true"></span>'}<b>${esc(m.user ? m.user.name : "退会したユーザー")}</b>${m.reason ? '<span class="fbtag">提案理由</span>' : ""}${m.hint ? `<span class="fbtag soft">${esc(HINT_T[m.hint] || "")}</span>` : ""}<time datetime="${esc(m.created_at)}">${ago(m.created_at)}</time>${m.edited_at ? '<span class="edited">（編集済み）</span>' : ""}</div>`;
    const tools = dead ? (who && who.admin && m.status === "hidden" ? `<div class="fb-cm-tools"><button class="fblink" data-admin-hide="comment" data-target="${m.id}" data-hidden="false">削除を取り消す</button></div>` : "")
      : `<div class="fb-cm-tools">${isReply ? "" : `<button class="fblink" data-reply="${m.id}">返信</button>`}${m.mine ? `<button class="fblink" data-edit="${m.id}">編集</button><button class="fblink" data-del="${m.id}">削除</button>` : `<button class="fblink" data-report="comment" data-target="${m.id}">通報</button>`}${who && who.admin ? `<button class="fblink danger" data-admin-hide="comment" data-target="${m.id}" data-hidden="true">🗑 削除（管理者）</button>` : ""}</div>`;
    const reps = !isReply && m.replies && m.replies.length ? `<ol class="fb-reps">${m.replies.map(r => commentHtml(r, true)).join("")}</ol>` : "";
    return `<li class="fb-cm ${dead ? "dead" : ""}" id="cm${m.id}">${head}${body}${tools}<div class="fb-reply-slot"></div>${reps}</li>`;
  }
  async function loadRelated(c) {
    const box = $("#fbRelated"); if (!box) return;
    try {
      const d = div(c.fa) && div(c.fa) === div(c.fb) ? div(c.fa) : "";
      const keys = d ? S.ranked.filter(p => p.division === d).map(p => p.key) : [];
      const rel = (await rpc("related_cards", { cid: c.id, class_keys: keys })).filter(x => valid(x.fa) && valid(x.fb)).slice(0, 5);
      remember(rel);
      // 選手が同じでも、まだカードの無い相手への導線（データにもとづく：同階級でレートが近い現役選手）
      const sugg = suggestOpponents(c.fa, c.fb);
      box.innerHTML = (rel.length ? grid(rel, x => ({ label: WHY[x.why] || "", src: "related", why: x.why })) : `<p class="note">関連するカードはまだありません。</p>`)
        + (sugg.length ? `<div class="fb-sugg"><div class="fb-fresh-h">別の相手で考える（同じ階級でレートが近い現役選手）</div><div class="fb-sugg-row">${sugg.map(([x, y]) => `<a class="fbchip" href="/create/?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}" data-src="suggest">${nm(x)} vs ${nm(y)}</a>`).join("")}</div></div>` : "");
    } catch (e) { box.innerHTML = failBox(e); }
  }
  function suggestOpponents(a, b) {
    const out = [];
    [a, b].forEach(k => {
      const p = P(k); if (!p || !p.division) return;
      const near = S.ranked.filter(x => x.active && x.division === p.division && x.key !== a && x.key !== b)
        .sort((x, y) => Math.abs(x.rating - p.rating) - Math.abs(y.rating - p.rating)).slice(0, 2);
      near.forEach(x => out.push([k, x.key]));
    });
    return out.slice(0, 4);
  }
  // 共有プレビューは静的ページ（/matchups/{id}/）が担う。ここでは画面のタイトルだけ更新
  function setMeta(c, hidden) {
    document.title = c ? `${S.nameOf(c.fa)} vs ${S.nameOf(c.fb)}（${ruleLbl(c)}）見たい？｜FIGHT BOOK` : (hidden ? "非公開のカード｜FIGHT BOOK" : "カードが見つかりません｜FIGHT BOOK");
  }

  // 投票後に出す「次の行動」（モーダルは出さない。最大3つ）
  function showNext(el, c, where) {
    const box = el.querySelector(".fc-next") || (el.closest(".fb-board") && el.closest(".fb-board").querySelector(".fc-next"));
    if (!box || box.dataset.shown) return;
    box.dataset.shown = "1";
    const onDetail = where === "detail";
    box.innerHTML = `<span class="fc-next-h">「見たい！」を送りました。いま${c.want}人です。</span>
      ${onDetail ? `<button class="fbchip" data-next="write">理由を一言書く</button><button class="fbchip" data-next="related">関連カードを見る</button>`
        : `<a class="fbchip" href="/matchups/${encodeURIComponent(c.id)}/?focus=comments" data-src="after_vote">理由を一言書く</a><a class="fbchip" href="/matchups/${encodeURIComponent(c.id)}/" data-src="after_vote">みんなの意見を見る</a>`}
      <a class="fbchip" href="${esc(xIntent(c, shareText(c, false)))}" target="_blank" rel="noopener" data-xshare="${esc(c.id)}">Xで仲間に聞く</a>`;
    box.hidden = false;
  }

  /* ---------- カードを作る ---------- */
  const DRAFT = "fb_draft_create";
  const cr = { a: null, b: null, rule: "mma", cond: "standard", reason: "", hint: null, dup: null, busy: false };
  const pk = { corner: null, q: "", active: true };
  function viewCreate(a, b) {
    const d = ls.get(DRAFT, null);
    if (a || b) Object.assign(cr, { a: valid(a) ? a : null, b: valid(b) && b !== a ? b : null, reason: "", hint: null });
    else if (d) Object.assign(cr, d);
    cr.dup = null;
    if (!ss.get("fb_cs")) { ss.set("fb_cs", "1"); track("create_start", null, { prefilled: !!a }, null); }
    return H.pageHero("Make a Card", "見たい対戦を作って、ファンの意見を聞いてみよう。") + `<div class="wrap">
      ${ENABLED ? "" : `<section class="section">${offBox()}</section>`}
      <form class="fb-create" id="fbCreate" novalidate>
        <ol class="fb-steps">
          <li><div class="st-h"><span>1</span>選手を2人選ぶ</div>
            <div class="fb-pick-row">${slot("a")}<span class="fb-pick-vs">VS</span>${slot("b")}</div>
            <p class="note">見つからない選手は <button type="button" class="fblink" id="fbReqOpen">追加をリクエスト</button>（運営が確認してから追加します）</p></li>
          <li><div class="st-h"><span>2</span>ルール</div><div class="chips" role="radiogroup" aria-label="ルール">${Object.entries(RULES).map(([k, v]) => `<button type="button" class="fbchip" role="radio" data-rule="${k}" aria-checked="${cr.rule === k}">${v}</button>`).join("")}</div></li>
          <li><div class="st-h"><span>3</span>条件</div><div class="chips" role="radiogroup" aria-label="条件">${Object.entries(CONDS).map(([k, v]) => `<button type="button" class="fbchip" role="radio" data-cond="${k}" aria-checked="${cr.cond === k}">${v}</button>`).join("")}</div>
            <p class="note">ルールか条件が違えば別のカードになります。同じ2人・同じルール・同じ条件のカードは1枚にまとめます。</p></li>
          <li><div class="st-h"><span>4</span>見たい理由（任意・140字まで）</div>
            <div class="fb-hints">${HINTS.slice(0, 2).concat(HINTS.slice(3)).map(h => `<button type="button" class="fbchip" data-chint="${h.k}" aria-pressed="${cr.hint === h.k}">${h.t}</button>`).join("")}</div>
            <label class="sr" for="fbReason">見たい理由</label>
            <textarea id="fbReason" rows="3" maxlength="140" placeholder="${esc(cr.hint ? HINT_T[cr.hint] : "例：打撃とレスリング、どちらが上か見てみたい")}">${esc(cr.reason)}</textarea>
            <div class="fb-count" id="fbReasonN">${cr.reason.length}/140</div></li>
        </ol>
        <div id="fbDup" aria-live="polite"></div>
        <div class="fb-preview"><div class="fb-fresh-h">プレビュー</div><div id="fbPrev">${previewHtml()}</div></div>
        <div class="fb-publish">
          <label class="fb-nick-l">ニックネーム（公開・30字まで）<input id="fbNickC" class="fb-nick" maxlength="30" value="${esc(nickOf())}" placeholder="例：格闘技好き" autocomplete="nickname"></label>
          <button class="btn primary big" type="submit" id="fbPublish" ${canPublish() ? "" : "disabled"}>公開する</button>
          <p class="note">ログインは不要です。公開すると誰でも見られます。ファンの提案であり、実際の対戦を決めるものではありません。入力内容はこの端末に下書きとして残ります。</p>
        </div>
      </form>
    </div>
    <dialog class="picker" id="fbPicker" aria-labelledby="fbPkTitle"></dialog>
    <dialog class="picker small" id="fbReq" aria-labelledby="fbReqTitle"></dialog>`;
  }
  const slot = s => { const k = cr[s]; return `<button type="button" class="fb-slot ${s === "a" ? "red" : "blue"} ${k ? "on" : ""}" data-slot="${s}">${k ? `${av(k, "l")}<b>${nm(k)}</b><small>${esc(div(k) || "")}</small><em>変更</em>` : `<span class="plus">＋</span><b>選手${s === "a" ? "A" : "B"}を選ぶ</b>`}</button>`; };
  const canPublish = () => ENABLED && cr.a && cr.b && cr.a !== cr.b && !cr.busy && !(cr.dup && cr.dup.same);
  function previewHtml() {
    if (!cr.a || !cr.b) return `<p class="note">選手を2人選ぶとプレビューが表示されます。</p>`;
    return cardHtml({ id: "preview", fa: cr.a, fb: cr.b, rule: cr.rule, cond: cr.cond, origin: "fan", want: 0, fun: 0, comments: 0,
      reason: cr.reason.trim() ? { body: cr.reason.trim() } : null, creator: who ? { name: who.name } : { name: "あなた" } }, { preview: true }).replace(/href="\/matchups\/preview\/"/, 'href="javascript:void(0)" tabindex="-1"');
  }
  function saveDraft() { ls.set(DRAFT, { a: cr.a, b: cr.b, rule: cr.rule, cond: cr.cond, reason: cr.reason, hint: cr.hint }); }
  function refreshCreate(part) {
    saveDraft();
    if (part !== "text") {
      $$(".fb-slot").forEach(el => { el.outerHTML = slot(el.dataset.slot); });
      $$("[data-rule]").forEach(el => el.setAttribute("aria-checked", el.dataset.rule === cr.rule));
      $$("[data-cond]").forEach(el => el.setAttribute("aria-checked", el.dataset.cond === cr.cond));
      $$("[data-chint]").forEach(el => el.setAttribute("aria-pressed", el.dataset.chint === cr.hint));
      const t = $("#fbReason"); if (t) t.placeholder = cr.hint ? HINT_T[cr.hint] : "例：打撃とレスリング、どちらが上か見てみたい";
    }
    const p = $("#fbPrev"); if (p) p.innerHTML = previewHtml();
    const n = $("#fbReasonN"); if (n) n.textContent = `${cr.reason.length}/140`;
    const b = $("#fbPublish"); if (b) { b.disabled = !canPublish(); b.textContent = cr.busy ? "公開中…" : "公開する"; }
    if (part !== "text") checkDup();
  }
  let dupSeq = 0;
  async function checkDup() {
    const box = $("#fbDup"); if (!box) return;
    cr.dup = null;
    if (!ENABLED || !cr.a || !cr.b) { box.innerHTML = ""; return; }
    const seq = ++dupSeq;
    try {
      const list = await rpc("find_cards", { a: cr.a, b: cr.b });
      if (seq !== dupSeq) return;
      remember(list);
      const same = list.find(c => c.rule === cr.rule && c.cond === cr.cond);
      cr.dup = { same, others: list.filter(c => c !== same) };
      const met = H.meetings(cr.a, cr.b).length;
      box.innerHTML = (same ? `<div class="fb-dup"><b>このカードはすでにあります</b><p>新しく作らず、こちらで「見たい！」やコメントで参加してください。理由はコメントとして書けます。</p>${cardHtml(same, { src: "dup" })}</div>` : "")
        + (cr.dup.others.length ? `<div class="fb-dup soft"><b>同じ2人の、ルールや条件が違うカード</b>${grid(cr.dup.others, { src: "dup" })}</div>` : "")
        + (met ? `<p class="note">この2人はRIZINで${met}回対戦しています。公開すると「再戦希望」のカードになります。</p>` : "");
      if (same) track("dup_guided", same.id, {}, `dup:${anon}:${same.id}:${today()}`);
      const b = $("#fbPublish"); if (b) b.disabled = !canPublish();
    } catch (e) { if (seq === dupSeq) box.innerHTML = ""; }
  }
  function openPick(corner) {
    pk.corner = corner; pk.q = "";
    const dlg = $("#fbPicker");
    dlg.innerHTML = `<div class="pk-head ${corner === "a" ? "red" : "blue"}"><div><small>${corner === "a" ? "選手A" : "選手B"}</small><h3 id="fbPkTitle">選手を選ぶ</h3></div><button class="pk-close" data-pkclose aria-label="閉じる">×</button></div>
      <div class="pk-tools"><div class="search">${H.SEARCH_ICON}<input id="fbPkQ" type="search" placeholder="名前（日本語・英語）で検索" autocomplete="off" aria-label="選手を検索"></div>
      <label class="toggle"><input type="checkbox" id="fbPkActive" ${pk.active ? "checked" : ""}> 現役のみ</label></div>
      <ul class="pk-list" id="fbPkList">${pickList()}</ul>`;
    dlg.showModal();
    setTimeout(() => { const i = $("#fbPkQ"); if (i && matchMedia("(min-width:561px)").matches) i.focus(); }, 30);
  }
  function pickList() {
    const q = pk.q.trim().toLowerCase(), other = pk.corner === "a" ? cr.b : cr.a;
    const l = Object.values(S.profiles).filter(p => p.riz.total > 0 && (!pk.active || p.active) &&
      (!q || [S.nameOf(p.key), S.enOf(p.key)].join(" ").toLowerCase().includes(q))).sort((x, y) => y.rating - x.rating).slice(0, 80);
    if (!l.length) return `<li class="pk-empty">該当する選手がいません。「現役のみ」を外すか、<button class="fblink" id="fbReqOpen2">追加をリクエスト</button>してください。</li>`;
    return l.map(p => `<li><button class="pk-item" data-pk="${esc(p.key)}" ${p.key === other ? "disabled" : ""}>
      <span class="pk-main">${av(p.key)}<span><b>${nm(p.key)}</b><small>${esc(S.enOf(p.key))}</small></span></span>
      <span class="pk-meta">${esc(p.division || "—")}</span><span class="pk-state">${p.key === other ? "相手側" : "選ぶ"}</span></button></li>`).join("");
  }
  function openReq() {
    const dlg = $("#fbReq"); if (!dlg) return;
    const p = $("#fbPicker"); if (p && p.open) p.close();
    dlg.innerHTML = `<div class="pk-head"><div><small>選手追加リクエスト</small><h3 id="fbReqTitle">追加してほしい選手</h3></div><button class="pk-close" data-reqclose aria-label="閉じる">×</button></div>
      <form id="fbReqForm" class="fb-reqf"><label>選手名<input id="fbReqName" maxlength="60" required></label>
      <label>補足（所属団体・階級など、任意）<input id="fbReqNote" maxlength="200"></label>
      <p class="note">運営が確認してから追加します。すぐには反映されません。</p>
      <button class="btn primary" type="submit">送信する</button></form>`;
    dlg.showModal();
  }
  async function publish() {
    if (!canPublish()) return;
    const nick = ($("#fbNickC") ? $("#fbNickC").value : nickOf()).trim(), ne = nickErr(nick);
    if (ne) { toast(ne); const i = $("#fbNickC"); if (i) i.focus(); return; }
    cr.busy = true; refreshCreate("text");
    try {
      await ensureUser(nick);
      const c = await rpc("create_card", { a: cr.a, b: cr.b, rule: cr.rule, cond: cr.cond, reason: cr.reason.trim() || null, hint: cr.reason.trim() ? cr.hint : null, editorial: false });
      cr.busy = false;
      track("card_publish", c.id, { existed: !!c.existed, with_reason: !!cr.reason.trim() });
      ls.del(DRAFT); Object.assign(cr, { a: null, b: null, rule: "mma", cond: "standard", reason: "", hint: null, dup: null });
      if (c.existed) flash("同じカードがすでにあったので、そちらに案内しました。");
      else { flash("公開しました！"); ss.set("fb_new", c.id); }
      ss.set("fb_navsrc", c.existed ? "dup" : "created");
      location.href = `/matchups/${encodeURIComponent(c.id)}/`;
    } catch (e) { cr.busy = false; refreshCreate("text"); toast(esc(e.message)); }
  }

  /* ---------- マイページ ---------- */
  const mp = { tab: "notice" };
  function viewMe(tab) {
    if (tab) mp.tab = tab;
    if (!ENABLED) return H.pageHero("My Page", "") + `<div class="wrap"><section class="section">${offBox()}</section></div>`;
    return H.pageHero("My Page", "あなたのコメント・予想・カードと、届いた反応") + `<div class="wrap" id="fbMe">${loading()}</div>`;
  }
  async function loadMe() {
    const box = $("#fbMe"); if (!box) return;
    await ready(); paintMe();
    if (!loggedIn()) {
      box.innerHTML = `<div class="fb-login"><b>まだ参加していません</b>
        <p>ログインは不要です。大会の勝敗を予想したり、コメントしたり、カードに「見たい！」を押したりすると、あなたのニックネーム・コメント・予想がここに表示されます。</p>
        <a class="btn primary big" href="/cards/">カードを見る</a></div>`;
      return;
    }
    try {
      const [d, n] = await Promise.all([rpc("my_page"), rpc("my_notifications", { lim: 30 })]);
      remember(d.created); remember(d.joined); remember(d.saved);
      const unread = n.items.filter(i => i.unread).length;
      d.comments = d.comments || []; d.predictions = d.predictions || [];
      const T = [["notice", `お知らせ${unread ? `（${unread}）` : ""}`], ["comments", `コメント（${d.comments.length}）`], ["predictions", `予想（${d.predictions.length}）`], ["created", `作った（${d.created.length}）`], ["joined", `参加した（${d.joined.length}）`], ["saved", `保存（${d.saved.length}）`]];
      const body = mp.tab === "notice" ? noticeHtml(n.items) : mp.tab === "comments" ? myCommentsHtml(d.comments) : mp.tab === "predictions" ? myPredHtml(d.predictions) : grid(d[mp.tab].map(c => c.status === "public" ? c : { ...c, _hidden: true }), c => ({ src: "me_" + mp.tab, label: c._hidden ? "非公開になりました" : "" })) || `<p class="note">${{ created: "まだカードを作っていません。", joined: "まだ参加したカードはありません。", saved: "保存したカードはありません。" }[mp.tab]}</p>`;
      box.innerHTML = `<div class="fb-me-head">${d.profile.avatar ? `<img src="${esc(d.profile.avatar)}" alt="" width="48" height="48" referrerpolicy="no-referrer">` : ""}<div><b>${esc(d.profile.name)}</b>${d.profile.username ? `<small>@${esc(d.profile.username)}</small>` : ""}</div>
          <div class="fb-me-acts">${d.profile.admin ? '<a class="btn small" href="/admin/">通報の確認</a><button class="btn small ghost" data-logout>ログアウト</button>' : ""}</div></div>
        <details class="fb-def fb-acct"><summary>アカウント設定</summary>
          <form id="fbNameForm" class="fb-name-form"><label>ニックネーム（公開）<input id="fbNameIn" maxlength="30" value="${esc(d.profile.name)}" required></label><button class="btn small primary" type="submit">変更</button></form>
          <p class="note">${d.profile.admin ? '<a href="/reset/">パスワードを変更する</a>' : "ニックネーム・コメント・予想はサーバー（データベース）に保存されています。ログインの代わりに、このブラウザに参加用の合い言葉を保存して本人を見分けています。ブラウザのデータを消したり、別の端末・別のブラウザで開いたりすると、このマイページには入れなくなります（投稿は消えずにサイトに残ります）。"}</p></details>
        <div class="tabs" id="fbMeTabs">${T.map(([k, t]) => `<a class="tab" href="/me/?tab=${k}" aria-pressed="${k === mp.tab}">${t}</a>`).join("")}</div>
        <div class="fb-me-body">${body}</div>`;
      if (mp.tab === "notice" && unread) { rpc("mark_notifications_seen").then(paintMe).catch(() => {}); track("notif_open", null, { unread }); }
    } catch (e) { box.innerHTML = failBox(e, "me"); }
  }
  // 自分のコメント（大会予想・見たいカード）
  function myCommentsHtml(list) {
    if (!list.length) return `<p class="note">まだコメントはありません。<a href="/predict/">大会予想</a>の各試合の下や、<a href="/cards/">見たいカード</a>からコメントできます。</p>`;
    return `<ul class="fb-notice my-cm">${list.map(c => {
      const href = c.kind === "event" ? `/predict/${encodeURIComponent(c.event_id)}/?c=${c.id}` : `/matchups/${encodeURIComponent(c.card_id)}/?focus=comments`;
      const where = c.kind === "event" ? `${esc(c.event_name)}${c.bout ? `・${esc(c.bout)}` : ""}` : (valid(c.fa) && valid(c.fb) ? `見たいカード：${nm(c.fa)} vs ${nm(c.fb)}` : "見たいカード");
      const meta = c.kind === "event" ? `<span class="my-cm-n">💬 ${c.replies || 0}　♥ ${c.likes || 0}</span>` : "";
      return `<li><a href="${href}" data-src="me_comments">${c.reply_name ? `<span class="my-cm-to">返信先：@${esc(c.reply_name)}</span>` : ""}<span class="my-cm-b">${esc(c.body)}</span><small>${where}・${ago(c.at)}${meta}</small></a></li>`;
    }).join("")}</ul>`;
  }
  // 自分の勝敗予想（大会ごと）
  function myPredHtml(list) {
    if (!list.length) return `<p class="note">まだ予想していません。<a href="/predict/">大会予想</a>から参加できます。</p>`;
    const M = { ko: "KO", sub: "一本", dec: "判定" };
    return list.map(ev => {
      const done = ev.picks.filter(p => p.hit !== null && p.hit !== undefined), hit = done.filter(p => p.hit).length;
      return `<section class="my-pv"><div class="my-pv-h"><a href="/predict/${encodeURIComponent(ev.event_id)}/"><b>${esc(ev.event_name)}</b></a>
          <small>${fmtWhen(ev.starts_at)}・${ev.locked ? "受付終了" : "受付中（締め切りまで変更できます）"}${done.length ? `・的中 ${hit}/${done.length}` : ""}</small></div>
        <ul>${ev.picks.map(p => `<li class="${p.hit === true ? "hit" : p.hit === false ? "miss" : ""}"><span class="my-pv-b">${p.title ? '<span class="fbtag">タイトル戦</span> ' : ""}${esc(p.bout)}</span>
          <span class="my-pv-p">${esc(p.pick)}${p.method ? `（${M[p.method] || p.method}）` : ""}${p.hit === true ? " ✓ 的中" : p.hit === false ? " ✕" : ""}</span></li>`).join("")}</ul></section>`;
    }).join("");
  }
  function noticeHtml(items) {
    if (!items.length) return `<p class="note">まだお知らせはありません。あなたのコメントへの返信・いいねや、作ったカードへの反応がここに届きます。</p>`;
    const line = i => {
      if (i.type === "ec_reply" || i.type === "ec_likes") {   // 大会予想のコメント
        const txt = i.type === "ec_reply" ? `<b>${esc(i.who || "退会したユーザー")}</b> さんがあなたのコメントに返信しました：「${esc(i.body)}」`
          : `あなたのコメント「${esc(i.mine_body || "")}」に <b>${i.n}人</b> がいいねしました`;
        return `<li class="${i.unread ? "unread" : ""}"><a href="/predict/${encodeURIComponent(i.event_id)}/?c=${i.comment_id}" data-src="notice">${i.unread ? '<span class="fbtag">未読</span>' : ""}${i.type === "ec_reply" ? "💬 " : "♥ "}${txt}<small>${esc(i.event_name || "")}${i.bout ? `・${esc(i.bout)}` : ""}・${ago(i.at)}</small></a></li>`;
      }
      const c = cache[i.card_id]; const pair = c && valid(c.fa) ? `${nm(c.fa)} vs ${nm(c.fb)}` : "カード";
      const txt = i.type === "reply" ? `<b>${esc(i.who || "退会したユーザー")}</b> さんがあなたのコメントに返信しました：「${esc(i.body)}」`
        : i.type === "comment_on_my_card" ? `<b>${esc(i.who || "退会したユーザー")}</b> さんがあなたのカードにコメントしました：「${esc(i.body)}」`
        : `あなたのカードに、この30日間で${i.n}人が「見たい！」を送りました`;
      return `<li class="${i.unread ? "unread" : ""}"><a href="/matchups/${encodeURIComponent(i.card_id)}/${i.type === "wants_on_my_card" ? "" : "/comments"}" data-src="notice">${i.unread ? '<span class="fbtag">未読</span>' : ""}${txt}<small>${pair}・${ago(i.at)}</small></a></li>`;
    };
    return `<ul class="fb-notice">${items.map(line).join("")}</ul>`;
  }

  /* ---------- 管理（通報の確認） ---------- */
  function viewAdmin() { return H.pageHero("Admin", "通報・お問い合わせの確認と、大会予想の管理（管理者のみ）") + `<div class="wrap"><div id="fbAdmin">${ENABLED ? loading() : offBox()}</div><h2 class="fb-h3" style="margin-top:28px">大会予想の管理</h2><div id="admEvents"></div></div>`; }
  async function loadAdmin() {
    const box = $("#fbAdmin"); if (!box || !ENABLED) return;
    await ready(); paintMe();
    if (!who || !who.admin) { login(null); return; }
    try {
      const [r, cts] = await Promise.all([rpc("admin_reports"), rpc("admin_contacts").catch(() => null)]);
      const RS = { abuse: "侮辱・差別", spam: "宣伝・連投", wrong: "誤情報", other: "その他" };
      box.innerHTML = r.length ? `<table class="tbl"><thead><tr><th>対象</th><th>内容</th><th>理由</th><th>件数</th><th></th></tr></thead><tbody>${r.map(x => `<tr>
        <td>${x.target_type === "card" ? "カード" : x.target_type === "event_comment" ? "大会の雑談" : "コメント"}</td><td><a href="${x.event_id ? `/predict/${encodeURIComponent(x.event_id)}/` : `/matchups/${encodeURIComponent(x.card_id || "")}/`}">${esc(x.preview || "（削除済み）")}</a></td>
        <td>${(x.reasons || []).map(k => RS[k] || k).join("・")}</td><td class="num">${x.n}</td>
        <td><button class="btn small danger" data-admin-hide="${x.target_type}" data-target="${esc(x.target_id)}" data-hidden="true">削除</button> <button class="btn small ghost" data-dismiss="${x.target_type}" data-target="${esc(x.target_id)}">対応不要</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="note">未対応の通報はありません。</p>`;
      const KIND = { opinion: "ご意見", delete: "削除依頼", correct: "訂正依頼", other: "その他" };
      box.innerHTML = `<h2 class="fb-h3">通報</h2>` + box.innerHTML + `<h2 class="fb-h3" style="margin-top:28px">お問い合わせ</h2>` + (cts === null ? `<p class="note">お問い合わせ機能のデータベース設定がまだです（schema.sql を実行し直してください）。</p>`
        : cts.length ? `<ul class="fb-notice">${cts.map(c => `<li><div style="padding:12px 14px"><span class="fbtag">${KIND[c.kind] || c.kind}</span> ${esc(c.name || "（名前なし）")} ${c.email ? `&lt;${esc(c.email)}&gt;` : ""}<small>${hhmm(c.created_at)}${c.url ? `・${esc(c.url)}` : ""}</small><p style="white-space:pre-wrap;margin:6px 0">${esc(c.body)}</p><button class="btn small" data-ctdone="${c.id}">対応済みにする</button></div></li>`).join("")}</ul>` : `<p class="note">未対応のお問い合わせはありません。</p>`);
      loadAdminEvents();
    } catch (e) { box.innerHTML = failBox(e, "admin"); }
  }

  /* ---------- サイトについて・プライバシーポリシー・お問い合わせ ---------- */
  const doc = (title, en, body) => H.pageHero(en, title) + `<div class="wrap"><article class="fb-doc">${body}</article></div>`;
  function viewAbout() {
    return doc("FIGHT BOOKについて", "About", `
      <h2>このサイトについて</h2>
      <p>FIGHT BOOK（ファイトブック）は、格闘技ファンが運営する<b>非公式のファンサイト</b>です。RIZINをはじめとする団体・選手・関係者とは関係ありません。</p>
      <p>「格闘技の素晴らしさを、もっと多くの人へ。」を目標に、2015年からのRIZIN全大会のMMA試合をもとにした選手データベースと、ファン同士が「次に見たい一戦」を語り合う場所を提供しています。</p>
      <h2>データについて</h2>
      <p>選手の戦績・レーティング・統計は、公開されている試合結果をもとに自動で計算しています。主な出典は Wikipedia などで、出典の一覧はページ下部に記載しています。誤りに気づいた場合は<a href="/contact/">お問い合わせ</a>からお知らせください。確認のうえ訂正します。</p>
      <p>レーティングや勝率の予想は、計算にもとづく目安であり、実際の結果を保証するものではありません。</p>
      <h2>ファンの見たい対戦カードについて</h2>
      <ul><li>カードはファンによる提案で、実際の対戦を決めるものではありません。</li>
        <li>運営が作ったカードには「編集部提案」と表示します。架空のユーザーや票・コメントは作りません。</li>
        <li>選手や他のファンへの侮辱・差別・個人情報の書き込みは、管理者が削除します。</li></ul>
      <h2>運営</h2>
      <p>FIGHT BOOK 運営（個人運営）。ご連絡は<a href="/contact/">お問い合わせ</a>からお願いします。</p>`);
  }
  function viewPrivacy() {
    return doc("プライバシーポリシー", "Privacy", `
      <p>FIGHT BOOK（以下「当サイト」）は、利用者の情報を次のとおり取り扱います。</p>
      <h2>1. 取得する情報</h2>
      <ul><li><b>投稿・反応</b>：ニックネーム、作成したカード、コメント、「見たい！」「面白い」、保存、通報の内容</li>
        <li><b>ブラウザの識別情報</b>：参加のためにブラウザごとに自動で発行する識別ID（氏名・メールアドレスは取得しません）</li>
        <li><b>利用状況</b>：閲覧したページ、ボタンの操作、訪問日などの記録（サービス改善のための集計に使います）</li>
        <li><b>お問い合わせ</b>：お問い合わせの内容と、任意で入力されたお名前・メールアドレス</li></ul>
      <h2>2. 利用目的</h2>
      <ul><li>投稿・投票などの機能を提供するため</li><li>不正な投稿や迷惑行為を防ぐため</li><li>利用状況を集計し、サービスを改善するため</li><li>お問い合わせに回答するため</li></ul>
      <h2>3. 外部サービスの利用</h2>
      <ul><li>データの保存に Supabase、サイトの配信に GitHub Pages を利用しています。</li>
        <li>文字の表示に Google Fonts、動画・投稿の表示に YouTube・Instagram の埋め込み機能を利用しています。これらのサービスが独自に情報を取得する場合があります。</li>
        <li>X（旧Twitter）への共有ボタンは、押したときだけ X の投稿画面を開きます。当サイトから自動で投稿することはありません。</li></ul>
      <h2>4. 広告について</h2>
      <p>当サイトでは、第三者配信の広告サービス（Google AdSense）を利用しています。Google などの第三者配信事業者は、Cookie を使用して、利用者が当サイトや他のウェブサイトに過去にアクセスした際の情報にもとづいて広告を配信します。</p>
      <p>Google が広告 Cookie を使用することにより、利用者が当サイトや他のサイトにアクセスした際の情報にもとづいて、Google やそのパートナーが適切な広告を表示できます。利用者は <a href="https://adssettings.google.com/" target="_blank" rel="noopener">Google の広告設定</a> でパーソナライズ広告を無効にできます。また、<a href="https://www.aboutads.info/" target="_blank" rel="noopener">www.aboutads.info</a> にアクセスすると、第三者配信事業者の Cookie を無効にできます。詳しくは <a href="https://policies.google.com/technologies/ads?hl=ja" target="_blank" rel="noopener">Google の広告に関するポリシー</a> をご覧ください。</p>
      <h2>5. Cookie・ブラウザの保存領域</h2>
      <p>当サイトは、参加のための識別ID、下書き、表示の設定などをブラウザの保存領域（ローカルストレージ等）に保存します。ブラウザの設定で削除できますが、削除するとそれまでの投稿を編集・削除できなくなります。</p>
      <h2>6. 第三者への提供</h2>
      <p>法令にもとづく場合を除き、取得した情報を本人の同意なく第三者に提供しません。</p>
      <h2>7. 投稿の削除・訂正の依頼</h2>
      <p>自分の投稿は、投稿したブラウザから編集・削除できます。それ以外の削除依頼や、掲載内容（選手情報・画像など）の訂正・削除の依頼は、<a href="/contact/">お問い合わせ</a>からご連絡ください。</p>
      <h2>8. 免責事項</h2>
      <p>当サイトの情報は正確さに努めていますが、内容を保証するものではありません。当サイトの利用によって生じた損害について、当サイトは責任を負いかねます。当サイトは非公式のファンサイトであり、RIZIN などの団体・選手とは関係ありません。</p>
      <h2>9. 改定</h2>
      <p>このポリシーは必要に応じて改定します。改定後の内容はこのページに掲載した時点から有効です。</p>
      <p class="note">制定：2026年10月22日</p>`);
  }
  function viewContact() {
    return doc("お問い合わせ", "Contact", `
      <p>ご意見、投稿の削除依頼、掲載内容の訂正依頼などはこちらから送ってください。返信が必要な場合のみ、メールアドレスを入力してください（公開されません）。</p>
      ${ENABLED ? `<form id="fbContact" class="fb-contact" novalidate>
        <label>種類<select id="ctKind"><option value="opinion">ご意見・ご要望</option><option value="delete">投稿の削除依頼</option><option value="correct">掲載内容の訂正依頼</option><option value="other">その他</option></select></label>
        <label>お名前（任意）<input id="ctName" maxlength="50" autocomplete="nickname"></label>
        <label>メールアドレス（任意・返信が必要な場合）<input id="ctEmail" type="email" maxlength="200" autocomplete="email" inputmode="email"></label>
        <label>対象のページのURL（任意）<input id="ctUrl" maxlength="300" inputmode="url" placeholder="https://"></label>
        <label>内容（必須・2000字まで）<textarea id="ctBody" rows="6" maxlength="2000" required></textarea></label>
        <div id="ctMsg" class="fb-auth-msg" role="alert" aria-live="assertive"></div>
        <button class="btn primary big" type="submit">送信する</button>
        <p class="note">送信された内容は、管理者だけが確認します。<a href="/privacy/">プライバシーポリシー</a></p>
      </form>` : `<p>現在、お問い合わせフォームは準備中です。</p>`}`);
  }
  async function submitContact(f) {
    const msg = (t, good) => { const m = $("#ctMsg"); m.textContent = t; m.classList.toggle("good", !!good); };
    const body = $("#ctBody").value.trim(), email = $("#ctEmail").value.trim();
    if (body.length < 5) return msg("内容を5文字以上で入力してください。");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg("メールアドレスの形式を確認してください。");
    const b = f.querySelector('[type="submit"]'); b.disabled = true; b.textContent = "送信中…";
    try {
      await rpc("submit_contact", { kind: $("#ctKind").value, body, name: $("#ctName").value || null, email: email || null, url: $("#ctUrl").value || null });
      f.reset(); msg("送信しました。お問い合わせありがとうございます。", true); track("contact", null, {});
    } catch (e) { msg(e.code === "RATE_LIMIT" ? "送信が混み合っています。時間をおいてお試しください。" : e.message); }
    finally { b.disabled = false; b.textContent = "送信する"; }
  }

  /* ---------- 選手ページの「次に見たい相手」 ---------- */
  function fighterPanel(k) {
    if (!ENABLED) return "";
    return `<section class="section fb-fighter" id="fbFighter" data-key="${esc(k)}">
      <div class="sec-head"><h2>Next Opponent<small>${nm(k)}の次に見たい相手（ファンの声）</small></h2><a class="btn primary small" href="/create/?a=${encodeURIComponent(k)}" data-src="fighter_cta">＋ 次の相手を提案する</a></div>
      <div id="fbFighterList">${ENABLED ? loading() : `<p class="note">ファン投票は準備中です。</p>`}</div>
    </section>`;
  }
  async function loadFighter(k) {
    const box = $("#fbFighterList"); if (!box || !ENABLED) return;
    try {
      await ready(); paintMe();
      const [tot, nw] = await Promise.all([rpc("list_cards", { tab: "total", fighter: k, lim: 5 }), rpc("list_cards", { tab: "new", fighter: k, lim: 6 })]);
      remember(tot.cards); remember(nw.cards);
      const seen = new Set(tot.cards.map(c => c.id)), fresh = nw.cards.filter(c => !seen.has(c.id)).slice(0, 2);
      if (!tot.cards.length && !fresh.length) { box.innerHTML = `<div class="fb-empty"><p>まだ${nm(k)}の対戦提案はありません。最初の1枚を作ってみませんか？</p><a class="btn primary" href="/create/?a=${encodeURIComponent(k)}" data-src="fighter_empty">＋ 次の相手を提案する</a></div>`; return; }
      const opp = c => c.fa === k ? c.fb : c.fa;
      box.innerHTML = (tot.cards.length ? `<ol class="fb-opp">${tot.cards.map((c, i) => `<li><span class="rk">${i + 1}</span><a href="/matchups/${encodeURIComponent(c.id)}/" data-src="fighter_rank">${av(opp(c))}<b>${nm(opp(c))}</b><small>${esc(ruleLbl(c))}</small></a><span class="n">見たい ${c.want}人</span></li>`).join("")}</ol><p class="fb-asof">現在有効な「見たい！」の数・${hhmm(tot.as_of)} 時点</p>` : "")
        + (fresh.length ? `<div class="fb-fresh-h">新しい提案</div>${grid(fresh, { src: "fighter_new" })}` : "");
    } catch (e) { box.innerHTML = failBox(e); }
  }

  /* ---------- 操作 ---------- */
  const busy = new Set();
  async function react(btn) {
    const id = btn.dataset.id, kind = btn.dataset.act, on = btn.getAttribute("aria-pressed") !== "true";
    if (!ENABLED) return;
    if (busy.has(id + kind)) return;
    if (!loggedIn()) { try { await ensureUser(); } catch (e) { toast(esc(e.message)); return; } }
    busy.add(id + kind);
    // 先に見た目を変え、結果で上書きする
    const n = btn.querySelector("b"), before = +n.textContent;
    btn.setAttribute("aria-pressed", on); n.textContent = before + (on ? 1 : -1);
    try {
      const c = await rpc("set_reaction", { cid: id, kind, on });
      cache[id] = c; paintCounts(c);
      const where = btn.closest(".fb-board") ? "detail" : btn.closest(".hf") ? "home_fan" : "list";
      track("vote", id, { kind, on, where }, null);
      if (on && kind === "want") showNext(btn.closest("[data-card]"), c, where);
    } catch (e) {
      btn.setAttribute("aria-pressed", !on); n.textContent = before; toast(esc(e.message));
    } finally { busy.delete(id + kind); }
  }
  async function submitComment(form) {
    const ta = form.querySelector("textarea"), body = ta.value.trim(), parent = form.dataset.parent ? +form.dataset.parent : null;
    if (!body) { toast(ERR.EMPTY); ta.focus(); return; }
    const key = `fb_draft_cm_${det.id}_${form.dataset.cid}`;
    const ni = form.querySelector(".fb-nick"), nick = (ni ? ni.value : nickOf()).trim(), ne = nickErr(nick);
    if (ne) { toast(ne); if (ni) ni.focus(); return; }
    const b = form.querySelector('[type="submit"]'); if (b.disabled) return;
    b.disabled = true; b.textContent = "送信中…";
    try { await ensureUser(nick); } catch (e) { toast(esc(e.message)); b.disabled = false; b.textContent = parent ? "返信する" : "投稿する"; return; }
    const hint = form.dataset.hint || null;
    try {
      const r = await rpc("add_comment", { cid: det.id, body, parent, reason: false, hint });
      ls.del(key);
      if (!r.duplicate) track(parent ? "reply_post" : "comment_post", det.id, { hint: !!hint });
      toast(parent ? "返信しました" : "投稿しました");
      ta.value = "";
      if (parent) form.remove();
      const c = await rpc("get_card", { cid: det.id }); paintCounts(c);
      await loadComments();
      const el = $(`#cm${r.id}`); if (el) { el.classList.add("flash"); el.scrollIntoView({ block: "nearest" }); }
    } catch (e) { toast(esc(e.message)); }
    finally { if (form.isConnected) { b.disabled = false; b.textContent = parent ? "返信する" : "投稿する"; } }
  }
  async function doReport(type, target) {
    if (!loggedIn()) { try { await ensureUser(); } catch (e) { toast(esc(e.message)); return; } }
    const reasons = { abuse: "侮辱・差別", spam: "宣伝・連投", wrong: "誤情報", other: "その他" };
    const pick = prompt(`通報の理由を番号で入力してください\n1：${reasons.abuse}\n2：${reasons.spam}\n3：${reasons.wrong}\n4：${reasons.other}`);
    const k = { 1: "abuse", 2: "spam", 3: "wrong", 4: "other" }[String(pick || "").trim()];
    if (!k) return;
    try { await rpc("report", { target_type: type, target_id: String(target), reason: k, note: null }); toast("通報を受け付けました。運営が確認します。"); track("report", det.id, { type }); }
    catch (e) { toast(esc(e.message)); }
  }
  async function copy(url, btn) {
    const done = () => { const t = btn.textContent; btn.textContent = "✓ コピーしました"; setTimeout(() => btn.textContent = t, 1800); };
    try { await navigator.clipboard.writeText(url); done(); } catch (e) { prompt("このURLをコピーしてください", url); }
    track("copy_url", det.id, {});
  }

  /* =====================================================================
     大会の勝敗予想（/predict/ ・ /predict/{id}/）と雑談スレッド
     対戦カードは公式発表をもとに管理者が登録する。予想は開始時刻で締め切り。
     ===================================================================== */
  const METH = { ko: "KO/TKO", sub: "一本", dec: "判定", other: "その他" };
  const RES = { a: null, b: null, draw: "引き分け", nc: "無効試合" };
  const pv = { ev: null, timer: null, chatLast: 0, chatTimer: null };
  const fmtWhen = t => { const d = new Date(t); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const side = (bt, s) => ({ key: bt["f" + s], name: bt["f" + s + "_name"] });
  const fname = (bt, s) => side(bt, s).name;   // 表記は登録した名前（公式発表の表記）を使う
  const evUrl = id => `/predict/${encodeURIComponent(id)}/`;

  function viewPredictList() {
    return H.pageHero("Predict", "大会の対戦カードの勝敗を予想して、ファン同士で語り合おう。") + `<div class="wrap" id="pvList">${ENABLED ? loading() : offBox()}</div>`;
  }
  async function loadPredictList() {
    const box = $("#pvList"); if (!box || !ENABLED) return;
    try {
      await ready(); paintMe();
      const list = await rpc("list_fight_events");
      if (!list.length) { box.innerHTML = `<div class="fb-empty"><b>予想を受け付けている大会はまだありません</b><p>大会の対戦カードが発表されたら、ここで勝敗予想を受け付けます。</p></div>`; return; }
      box.innerHTML = `<div class="pv-events">${list.map(e => `<a class="pv-ev ${e.locked ? "locked" : ""}" href="${evUrl(e.id)}" data-src="predict_list">
        <span class="pv-badge">${e.locked ? (e.upcoming ? "締切・開催中" : "終了") : "予想受付中"}</span>
        <b>${esc(e.name)}</b><small>${fmtWhen(e.starts_at)}${e.venue ? "・" + esc(e.venue) : ""}</small>
        <span class="pv-meta">${e.bouts}試合・${e.predictors}人が予想・雑談${e.comments}件</span></a>`).join("")}</div>`;
    } catch (e) { box.innerHTML = failBox(e, "plist"); }
  }

  function viewPredict(id) {
    pv.ev = null; pv.id = id; pv.chatLast = 0; pv.cm = {}; pv.open = new Set(); pv.th = new Set(); pv.reply = null; pv.permaDone = false; pv.boutDone = false;
    return `<div class="wrap pv" id="pvBox">${ENABLED ? loading("大会を読み込み中…") : offBox()}</div>`;
  }
  async function loadPredict() {
    const box = $("#pvBox"); if (!box || !ENABLED) return;
    try {
      await ready(); paintMe();
      const ev = await rpc("get_fight_event", { eid: pv.id });
      if (!ev) { box.innerHTML = `<div class="fb-empty"><b>大会が見つかりません</b><p><a href="/predict/">大会予想の一覧へ</a></p></div>`; return; }
      pv.ev = ev;
      pv.skew = new Date(ev.now).getTime() - Date.now();   // 端末の時計のずれを補正（サーバーの時刻を基準にする）
      document.title = `${ev.name} 勝敗予想｜FIGHT BOOK`;
      box.innerHTML = predictHtml(ev);
      startCountdown();
      track("predict_view", null, { event: ev.id, src: navSrc || ss.get("fb_navsrc") || "direct" }, `pv:${anon}:${ev.id}:${today()}`);
      ss.set("fb_navsrc", "");
      loadBoutComments(true); loadRanking();
      clearInterval(pv.chatTimer);
      // 開いているあいだ20秒ごとに新しいコメントを取りに行く（タブが裏にあるときは止める）
      pv.chatN = 0;
      pv.chatTimer = setInterval(() => {
        if (!$("#pvBox")) return clearInterval(pv.chatTimer);
        if (document.visibilityState !== "visible") return;
        loadBoutComments(false); refreshLikes();
        if (++pv.chatN % 3 === 0) refreshUnread();
        if (pv.ev && pv.ev.locked && pv.chatN % 3 === 0) refreshEvent(false);   // 締め切り後は1分ごとに試合の状態・結果を確認
      }, 20000);
    } catch (e) { box.innerHTML = failBox(e, "predict"); }
  }
  function predictHtml(ev) {
    const picked = ev.bouts.filter(b => b.me).length;
    return `<nav class="crumb"><a href="/predict/">大会予想</a> › <span>${esc(ev.name)}</span></nav>
      <section class="pv-head" id="pvHead">${headHtml(ev)}</section>
      <section class="section"><div class="sec-head"><h2>Fight Card<small>対戦カード（${ev.bouts.length}試合）</small></h2></div>
        <div id="pvStatus">${statusHtml(ev)}</div>
        ${ev.bouts.length ? `<div class="bc-nickbar"><span class="bc-nb-t">💬 各試合の下で、ファン同士コメントできます</span>
          <label>ニックネーム<input class="fb-nick" id="pvNick" maxlength="30" value="${esc(nickOf())}" placeholder="例：格闘技好き" autocomplete="nickname"></label>
          <small>ログイン不要・ニックネームは公開されます</small></div>` : ""}
        ${ev.bouts.length ? `<ol class="pv-bouts">${ev.bouts.slice().reverse().map(b => boutHtml(b, ev.locked)).join("")}</ol>` : `<p class="note">対戦カードはまだ発表されていません。</p>`}
      </section>
      <section class="section" id="pvRankWrap" hidden><div class="sec-head"><h2>Ranking<small>的中ランキング</small></h2></div><div id="pvRank"></div></section>
      <p class="fb-rules">コメントは20秒ごとに自動で新しいものを表示します。選手や他のファンへの侮辱・差別は管理者が削除します。</p>`;
  }
  /* ---------- 状態：予想の受付（締め切り時刻）と、試合の進行（管理者が設定）は別に扱う ---------- */
  const stateOf = ev => !ev.locked ? "open" : ev.phase === "live" ? "live" : ev.phase === "finished" ? "finished" : "closed";
  const deadlineText = ev => `締め切り：${fmtWhen(ev.starts_at)}`;
  function headHtml(ev) {
    const st = stateOf(ev), picked = ev.bouts.filter(b => b.me).length;
    const BADGE = { open: "勝敗予想 受付中", closed: "勝敗予想の受付は終了", live: "● LIVE 試合中", finished: "試合終了" };
    return `<div class="pv-badge st-${st}">${BADGE[st]}</div>
      <h1>${esc(ev.name)}</h1>
      <p class="pv-when">${fmtWhen(ev.starts_at)}${ev.venue ? `・${esc(ev.venue)}` : ""}</p>
      <p class="pv-sum"><b id="pvPicked">${picked}</b> / ${ev.bouts.length}試合を予想${st === "open" ? "済み" : ""}・${ev.predictors}人が参加</p>
      <div class="pv-acts">${st === "open"
        ? `<button class="fz-btn pv-share" id="pvShare" ${picked ? "" : "disabled"}>📣 私の予想を共有</button>`
        : `<button class="fz-btn" data-gocomment>💬 コメントする</button>${picked ? `<button class="fz-link pv-share-link" id="pvShare">私の予想を共有</button>` : ""}`}
        ${ev.source_url ? `<a class="fz-link" href="${esc(ev.source_url)}" target="_blank" rel="noopener">公式の発表を見る ↗</a>` : ""}</div>
      <p class="note">対戦カードは公式発表をもとに掲載しています。${st === "open" ? "予想は締め切りまで何度でも変えられます。みんなの予想の割合は、自分が予想した試合から見られます。" : "コメントは試合中・試合後も各試合の下から投稿できます。"}</p>`;
  }
  function statusHtml(ev) {
    const st = stateOf(ev);
    if (st === "open") return `<div class="cd" id="pvCd" data-level="normal" role="timer" aria-live="off" aria-labelledby="pvCdSr">
        <div class="cd-top"><span class="cd-label">⏱ 勝敗予想の締め切りまで</span><span class="cd-flag" id="pvCdFlag" hidden></span></div>
        <div class="cd-digits" aria-hidden="true">
          <span class="cd-g" data-g="d"><b data-k="d">0</b><small>日</small></span>
          <span class="cd-g"><b data-k="h">00</b><small>時間</small></span>
          <span class="cd-g"><b data-k="m">00</b><small>分</small></span>
          <span class="cd-g"><b data-k="s">00</b><small>秒</small></span>
        </div>
        <p class="cd-sub">${esc(deadlineText(ev))}<span>・締め切りまで何度でも予想を変えられます</span></p>
        <span class="sr" id="pvCdSr">勝敗予想の${esc(deadlineText(ev))}</span>
      </div>`;
    const T = {
      closed: ["勝敗予想の受付は終了しました", "コメントは引き続き投稿できます。みんなの予想の割合も見られます。"],
      live: ["試合中｜コメントで盛り上がろう", "勝敗予想の受付は終了しました。各試合の下から、いつでもコメントできます。"],
      finished: ["試合終了｜感想を投稿しよう", "結果と的中ランキングをチェック。感想は各試合の下から投稿できます。"],
    }[st];
    return `<div class="cd cd-end" data-phase="${st}" role="status">
        <div class="cd-top"><span class="cd-label">${st === "live" ? '<i class="cd-live" aria-hidden="true"></i>' : ""}${T[0]}</span></div>
        <p class="cd-msg">${T[1]}</p>
        <button class="cd-cta" data-gocomment>💬 コメントする</button>
        <p class="cd-sub">${esc(deadlineText(ev))}（受付終了）</p>
      </div>`;
  }
  // 1秒ごとに数字だけを書き換える（ページやコメント欄は描き直さない）
  function startCountdown() {
    clearInterval(pv.timer); clearTimeout(pv.timer2);
    const el = $("#pvCd"); if (!el || !pv.ev) return;
    const at = new Date(pv.ev.starts_at).getTime(), pad = n => String(n).padStart(2, "0");
    const set = (k, v) => { const b = el.querySelector(`[data-k="${k}"]`); if (b && b.textContent !== v) { b.textContent = v; b.classList.remove("cd-tick"); void b.offsetWidth; b.classList.add("cd-tick"); } };
    const tickFn = pv.tickFn = () => {
      if (!$("#pvCd")) { clearInterval(pv.timer); return; }
      const ms = at - (Date.now() + (pv.skew || 0));
      if (ms <= 0) { clearInterval(pv.timer); onDeadline(); return; }
      const t = Math.floor(ms / 1000), d = Math.floor(t / 86400);
      set("d", String(d)); set("h", pad(Math.floor(t % 86400 / 3600))); set("m", pad(Math.floor(t % 3600 / 60))); set("s", pad(t % 60));
      el.querySelector('[data-g="d"]').hidden = d === 0;
      const level = ms <= 3600e3 ? "hot" : ms <= 86400e3 ? "warm" : "normal";
      if (el.dataset.level !== level) {
        el.dataset.level = level;
        const f = $("#pvCdFlag"); f.hidden = level === "normal";
        f.textContent = level === "hot" ? "締め切り間近！" : "まもなく締め切り";
      }
    };
    tickFn();
    // 秒の切り替わりに合わせて更新
    pv.timer2 = setTimeout(() => { tickFn(); pv.timer = setInterval(tickFn, 1000); }, 1000 - ((Date.now() + (pv.skew || 0)) % 1000));
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && pv.tickFn && $("#pvCd")) pv.tickFn(); });
  // 締め切りを迎えた瞬間：表示と操作を切り替える（入力途中のコメントは残す）
  async function onDeadline() {
    if (pv.ev) pv.ev.locked = true;
    paintState();
    toast("勝敗予想の受付を締め切りました。コメントは引き続き投稿できます。");
    await refreshEvent(true);
  }
  // サーバーから最新の大会情報（締め切り・試合の状態・結果・割合）を取り直す
  async function refreshEvent(force) {
    if (!pv.ev) return;
    try {
      const ev = await rpc("get_fight_event", { eid: pv.ev.id }); if (!ev) return;
      const changed = force || ev.locked !== pv.ev.locked || ev.phase !== pv.ev.phase || JSON.stringify(ev.bouts.map(b => [b.winner, b.method])) !== JSON.stringify(pv.ev.bouts.map(b => [b.winner, b.method]));
      ev._joined = pv.ev._joined;
      if (pv.ev.locked && Date.now() + (pv.skew || 0) >= new Date(ev.starts_at).getTime()) ev.locked = true;   // 端末側で締め切りを迎えた後は戻さない
      pv.ev = ev;
      if (!changed) return;
      paintState();
      ev.bouts.forEach(rerenderBout);
      if (ev.bouts.some(b => b.winner)) loadRanking();
    } catch (e) {}
  }
  function paintState() {
    const h = $("#pvHead"), st = $("#pvStatus");
    if (h) h.innerHTML = headHtml(pv.ev);
    if (st) { st.innerHTML = statusHtml(pv.ev); startCountdown(); }
  }
  function rerenderBout(b) {   // 書きかけのコメントとフォーカスを保ったまま、1試合だけ描き直す
    const li = $(`.pv-bout[data-bid="${b.id}"]`); if (!li) return;
    const inp = li.querySelector(".bc-in"), keep = inp ? inp.value : "", focused = inp && document.activeElement === inp;
    li.outerHTML = boutHtml(b, pv.ev.locked);
    const ni = $(`.pv-bout[data-bid="${b.id}"] .bc-in`);
    if (ni) { if (keep) ni.value = keep; if (focused) ni.focus(); }
  }
  function goComment() {
    const draft = $$(".bc-in").find(i => i.value.trim()), target = draft || $(".pv-bout .bc-in");
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setTimeout(() => target.focus({ preventScroll: true }), 300);
    track("go_comment", null, { event: pv.ev.id, state: stateOf(pv.ev) });
  }

  function boutHtml(b, locked) {
    const me = b.me || {}, c = b.counts, tot = c ? c.a + c.b : 0;
    const pa = tot ? Math.round(c.a / tot * 100) : 0;
    const decided = b.winner === "a" || b.winner === "b";
    const hit = decided && me.pick ? me.pick === b.winner : null;
    const corner = s => {
      const x = side(b, s), name = fname(b, s), on = me.pick === s, win = b.winner === s;
      return `<div class="pv-side ${s === "a" ? "red" : "blue"} ${on ? "on" : ""} ${win ? "win" : ""}">
        ${vsPanel(b, s, { src: "predict_fighter" })}
        <button class="pv-pick" data-pick="${s}" data-bid="${b.id}" aria-pressed="${on}" ${locked || b.winner ? "disabled" : ""}>${on ? "✓ 勝つと予想中" : "この選手が勝つ"}</button>
      </div>`;
    };
    return `<li class="pv-bout ${hit === true ? "hit" : hit === false ? "miss" : ""}" data-bid="${b.id}">
      <div class="pv-bmeta">${b.title ? '<span class="pv-title">タイトルマッチ</span>' : ""}${b.weight ? `<span>${esc(b.weight)}</span>` : ""}<span>${esc(RULES[b.rule] || "その他")}</span>
        ${b.winner && !decided ? `<span class="pv-res">${RES[b.winner]}</span>` : ""}${hit === true ? '<span class="pv-hit">的中！</span>' : hit === false ? '<span class="pv-miss">はずれ</span>' : ""}</div>
      <div class="pv-vs fp-vs">${corner("a")}<span class="fp-x" aria-hidden="true">VS</span>${corner("b")}</div>
      ${me.pick && !locked && !b.winner ? `<div class="pv-meth" role="group" aria-label="決着の予想（任意）"><span>決着も予想（任意）：</span>${["ko", "sub", "dec"].map(m => `<button class="fbchip" data-meth="${m}" data-bid="${b.id}" aria-pressed="${me.method === m}">${METH[m]}</button>`).join("")}</div>` : ""}
      ${c ? `<div class="pv-bar" aria-label="${esc(fname(b, "a"))} ${pa}%・${esc(fname(b, "b"))} ${100 - pa}%"><i style="width:${pa}%"></i></div>
        <div class="pv-pct"><span>${pa}%</span><small>${tot}人が予想${tot ? `・KO ${c.ko}／一本 ${c.sub}／判定 ${c.dec}` : ""}</small><span>${tot ? 100 - pa : 0}%</span></div>`
        : (locked ? "" : `<p class="pv-hint">予想すると、みんなの予想の割合が見られます${b.n ? `（${b.n}人が予想済み）` : ""}</p>`)}
      ${bcHtml(b)}
    </li>`;
  }
  async function pick(btn, method) {
    const bid = +btn.dataset.bid, ev = pv.ev; if (!ev) return;
    const b = ev.bouts.find(x => x.id === bid); if (!b) return;
    if (busy.has("p" + bid)) return; busy.add("p" + bid);
    try {
      if (!loggedIn()) await ensureUser();
      const p = method ? b.me.pick : btn.dataset.pick;
      const m = method ? (b.me.method === method ? null : method) : (b.me && b.me.pick === p ? b.me.method : null);
      const before = ev.bouts.filter(x => x.me).length;
      const nb = await rpc("set_prediction", { bid, pick: p, method: m });
      Object.assign(b, nb);
      rerenderBout(b);
      const n = ev.bouts.filter(x => x.me).length;
      if (before === 0 && n === 1) { ev.predictors++; const sm = $(".pv-sum"); if (sm) sm.innerHTML = sm.innerHTML.replace(/\d+人が参加/, `${ev.predictors}人が参加`); }
      $("#pvPicked").textContent = n; const sh = $("#pvShare"); if (sh) sh.disabled = !n;
      track("predict", null, { event: ev.id, bout: bid, method: !!m, change: !!method }, null);
    } catch (e) {
      if (e.code === "LOCKED") { toast("勝敗予想の受付は終了しました。コメントは引き続き投稿できます。"); refreshEvent(true); }
      else toast(esc(e.message));
    }
    finally { busy.delete("p" + bid); }
  }
  async function loadRanking() {
    const wrap = $("#pvRankWrap"), box = $("#pvRank"); if (!wrap || !pv.ev) return;
    try {
      const r = await rpc("event_ranking", { eid: pv.ev.id });
      if (!r.decided) return;
      wrap.hidden = false;
      box.innerHTML = (r.me ? `<p class="pv-myrank">あなたは <b>${r.me.rank}位</b>（${r.me.of}人中）・${r.me.pts}点（勝者 ${r.me.hit}／${r.me.decided}試合的中・決着方法 ${r.me.mhit}的中）</p>` : "")
        + (r.top.length ? `<ol class="fb-opp">${r.top.map(x => `<li class="${x.mine ? "me" : ""}"><span class="rk">${x.rank}</span><span><b>${esc(x.name)}</b><small>勝者 ${x.hit}/${x.decided}・決着 ${x.mhit}</small></span><span class="n">${x.pts}点</span></li>`).join("")}</ol>` : "")
        + `<p class="note">勝者が的中で1点、決着方法（KO・一本・判定）も的中でさらに1点。結果が入った ${r.decided}試合で計算しています。</p>`;
    } catch (e) {}
  }
  /* ---------- 試合ごとのコメント（Xと同じ形：誰でも読める・返信・いいね・リンク共有） ----------
     ・カードの下に最新5スレッドを常に表示（新しい順）。6件以上は「すべて見る」で全件
     ・返信はスレッドの先頭コメントの下にまとめる（返信への返信も同じスレッド）。「返信先：@名前」を表示
     ・返信は最新2件を表示し、それより前は「返信をさらに表示」
     ・書いた人がその試合でどちらを予想しているかを色付きのタグで表示
     ・各コメントには固有のリンク（/predict/大会/?c=ID）があり、開くとそのコメントへ移動する */
  const PREVIEW_N = 5, REPLY_N = 2;
  function bcHtml(b) {
    return `<div class="bc" data-bc="${b.id}">
      <div class="bc-body">${bcBody(b)}</div>
      <form class="bc-form" data-bid="${b.id}">
        <label class="sr" for="bci${b.id}">${esc(fname(b, "a"))} 対 ${esc(fname(b, "b"))} にコメント</label>
        <input class="bc-in" id="bci${b.id}" maxlength="200" autocomplete="off" placeholder="${esc(bcPlaceholder(b))}">
        <button class="bc-send" type="submit">送信</button>
      </form>
    </div>`;
  }
  const bcPlaceholder = b => b.me && b.me.pick ? `${fname(b, b.me.pick)}が勝つと思う理由は？` : "この試合、どう見る？（200字まで）";
  function threadsOf(bid) {
    const all = pv.cm[bid] || [], roots = [], reps = {};
    for (const c of all) { if (c.parent) (reps[c.parent] = reps[c.parent] || []).push(c); else roots.push(c); }
    return { roots: roots.reverse(), reps, total: all.filter(c => !c.deleted).length };
  }
  function bcBody(b) {
    const { roots, reps, total } = threadsOf(b.id), open = pv.open.has(b.id);
    const shown = open ? roots : roots.slice(0, PREVIEW_N);
    return `<div class="bc-head"><b>💬 コメント</b><span class="bc-n">${total}件</span><small class="bc-pub">誰でも読めます</small></div>
      ${roots.length ? `<ul class="bc-list ${open ? "open" : ""}">${shown.map(c => bcThread(b, c, reps[c.id] || [])).join("")}</ul>` : `<p class="bc-empty">まだコメントはありません。最初のひとことをどうぞ。</p>`}
      ${roots.length > PREVIEW_N ? `<button class="bc-more" data-bcmore="${b.id}" aria-expanded="${open}">${open ? "閉じる ▲" : `すべてのコメントを見る（${roots.length}スレッド） ▼`}</button>` : ""}`;
  }
  function bcThread(b, c, reps) {
    const live = reps.filter(r => !r.deleted), all = pv.th.has(c.id), hidden = all ? 0 : Math.max(0, reps.length - REPLY_N);
    const shown = all ? reps : reps.slice(-REPLY_N);
    const rf = pv.reply && pv.reply.root === c.id ? replyForm(b) : "";
    return `<li class="bc-th">${bcItem(b, c, live.length)}
      ${reps.length ? `<ul class="bc-reps">
        ${hidden ? `<li><button class="bc-thmore" data-bcthread="${c.id}" data-bid="${b.id}">返信をさらに表示（${hidden}件）</button></li>` : ""}
        ${shown.map(r => `<li>${bcItem(b, r, 0)}</li>`).join("")}</ul>` : ""}
      ${rf}</li>`;
  }
  function bcItem(b, c, nrep) {
    if (c.deleted) return `<article class="bc-c del" id="ec${c.id}"><p>このコメントは削除されました</p></article>`;
    const tag = c.pick ? `<span class="bc-pick ${c.pick === "a" ? "red" : "blue"}">${esc(fname(b, c.pick))}予想</span>` : "";
    const av = `<span class="bc-av ${c.pick === "a" ? "red" : c.pick === "b" ? "blue" : ""}" aria-hidden="true">${esc([...(c.name || "?")][0])}</span>`;
    const tools = c.mine ? `<button class="fblink" data-ecdel="${c.id}" data-bid="${b.id}">削除</button>`
      : `<button class="fblink" data-report="event_comment" data-target="${c.id}">通報</button>`;
    return `<article class="bc-c ${c.mine ? "mine" : ""} ${c._new ? "bc-new" : ""} ${c.parent ? "rep" : ""}" id="ec${c.id}">
      ${av}<div class="bc-main">
      <div class="bc-meta"><b>${esc(c.name)}</b>${tag}<a class="bc-time" href="${esc(commentUrl(c.id))}" data-bcperma="${c.id}"><time datetime="${esc(c.created_at)}">${ago(c.created_at)}</time></a>
        <span class="bc-tools">${tools}${isAdmin() ? ` <button class="fblink danger" data-admin-hide="event_comment" data-target="${c.id}" data-hidden="true">🗑 削除</button>` : ""}</span></div>
      ${c.parent && c.reply_name ? `<p class="bc-to">返信先：<b>@${esc(c.reply_name)}</b>${c.to_me ? '<span class="bc-tome">あなたへの返信</span>' : ""}</p>` : ""}
      <p class="bc-text">${esc(c.body)}</p>
      <div class="bc-acts">
        <button class="bc-act" data-bcreply="${c.id}" data-bid="${b.id}" aria-label="${esc(c.name)}さんに返信${nrep ? `（返信${nrep}件）` : ""}"><span aria-hidden="true">💬</span>${nrep ? `<b>${nrep}</b>` : ""}<span class="bc-act-t">返信</span></button>
        <button class="bc-act bc-like ${c.liked ? "on" : ""}" data-bclike="${c.id}" data-bid="${b.id}" aria-pressed="${!!c.liked}" aria-label="いいね（${c.likes || 0}）"><span class="ic" aria-hidden="true">${c.liked ? "♥" : "♡"}</span><b>${c.likes || ""}</b></button>
        <button class="bc-act" data-bcshare="${c.id}" aria-label="このコメントのリンクを共有"><span aria-hidden="true">↗</span><span class="bc-act-t">共有</span></button>
      </div></div></article>`;
  }
  function replyForm(b) {
    const r = pv.reply;
    return `<form class="bc-rform" data-bid="${b.id}">
      <p class="bc-to">返信先：<b>@${esc(r.name)}</b><button type="button" class="fblink" data-bcrcancel>キャンセル</button></p>
      <div class="bc-rrow"><label class="sr" for="bcr${b.id}">@${esc(r.name)}さんへの返信</label>
        <input class="bc-rin" id="bcr${b.id}" maxlength="200" autocomplete="off" placeholder="返信をポスト（200字まで）" value="${esc(r.text || "")}">
        <button class="bc-send" type="submit">返信</button></div>
    </form>`;
  }
  const commentUrl = id => `${location.origin}/predict/${pv.ev ? pv.ev.id : pv.id}/?c=${id}`;
  // コメント欄だけを描き直す。開いている返信フォームの入力内容とフォーカスは保つ
  function paintBc(bid) {
    const b = pv.ev && pv.ev.bouts.find(x => x.id === bid), el = $(`.bc[data-bc="${bid}"] .bc-body`);
    if (!b || !el) return;
    const ri = el.querySelector(".bc-rin"), focused = ri && document.activeElement === ri, sel = ri ? ri.selectionStart : 0;
    el.innerHTML = bcBody(b);
    const ni = el.querySelector(".bc-rin");
    if (ni && focused) { ni.focus({ preventScroll: true }); try { ni.setSelectionRange(sel, sel); } catch (e) {} }
  }
  const findComment = id => { for (const k in pv.cm) { const c = pv.cm[k].find(x => x.id === id); if (c) return c; } return null; };
  async function loadBoutComments(first) {
    if (!pv.ev) return;
    try {
      const list = await rpc("list_event_comments", { eid: pv.ev.id, after_id: first ? 0 : pv.chatLast });
      if (first) { pv.cm = {}; }
      const touched = new Set();
      for (const c of list) {
        if (!c.bout) continue;
        if (!first) {
          if (findComment(c.id)) continue; c._new = true;
          if (c.to_me) toast(`💬 ${esc(c.name)}さんがあなたのコメントに返信しました`);
        }
        (pv.cm[c.bout] = pv.cm[c.bout] || []).push(c); touched.add(c.bout);
      }
      if (list.length) pv.chatLast = Math.max(pv.chatLast || 0, list[list.length - 1].id);
      if (first) pv.ev.bouts.forEach(b => touched.add(b.id));
      touched.forEach(paintBc);
      if (first) { focusPermalink(); focusBoutParam(); }
      else if (list.length) setTimeout(() => { Object.values(pv.cm).flat().forEach(c => { c._new = false; }); $$(".bc-new").forEach(el => el.classList.remove("bc-new")); }, 2500);
    } catch (e) {}
  }
  // いいね数の変化を反映（描き直さずに数字だけ更新）
  async function refreshLikes() {
    if (!pv.ev) return;
    try {
      const m = await rpc("event_comment_likes", { eid: pv.ev.id });
      for (const k in pv.cm) for (const c of pv.cm[k]) {
        const v = m[c.id] || [0, false];
        if (pv.liking && pv.liking.has(c.id)) continue;
        if ((c.likes || 0) !== v[0] || !!c.liked !== !!v[1]) { c.likes = v[0]; c.liked = !!v[1]; paintLike(c); }
      }
    } catch (e) {}
  }
  function paintLike(c) {
    const btn = $(`[data-bclike="${c.id}"]`); if (!btn) return;
    btn.classList.toggle("on", !!c.liked); btn.setAttribute("aria-pressed", !!c.liked); btn.setAttribute("aria-label", `いいね（${c.likes || 0}）`);
    btn.querySelector(".ic").textContent = c.liked ? "♥" : "♡"; btn.querySelector("b").textContent = c.likes || "";
  }
  async function likeComment(id) {
    const c = findComment(id); if (!c || c.deleted) return;
    pv.liking = pv.liking || new Set(); if (pv.liking.has(id)) return; pv.liking.add(id);
    const on = !c.liked; c.liked = on; c.likes = (c.likes || 0) + (on ? 1 : -1); paintLike(c);   // 押した瞬間に反映
    try {
      await ensureUser(($("#pvNick") || {}).value || "");
      const r = await rpc("like_event_comment", { mid: id, on_: on });
      c.likes = r.likes; c.liked = r.liked; paintLike(c);
      if (on) track("comment_like", null, { event: pv.ev.id, comment: id });
    } catch (e) { c.liked = !on; c.likes = (c.likes || 0) + (on ? -1 : 1); paintLike(c); toast(esc(e.message)); }
    finally { pv.liking.delete(id); }
  }
  function startReply(id, bid) {
    const c = findComment(id); if (!c) return;
    const root = c.parent || c.id;
    pv.reply = { bid, to: id, root, name: c.name, text: pv.reply && pv.reply.to === id ? pv.reply.text : "" };
    pv.th.add(root);
    paintBc(bid);
    const ri = $(`.bc[data-bc="${bid}"] .bc-rin`);
    if (ri) { ri.focus({ preventScroll: true }); ri.scrollIntoView({ block: "nearest" }); }
  }
  async function shareComment(id, btn) {
    const c = findComment(id), url = commentUrl(id);
    track("comment_share", null, { event: pv.ev.id, comment: id });
    if (navigator.share && matchMedia("(pointer:coarse)").matches) {
      try { await navigator.share({ title: `${pv.ev.name}｜FIGHT BOOK`, text: c && c.body ? `「${c.body.slice(0, 60)}」` : "", url }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("コメントのリンクをコピーしました"); } catch (e) { prompt("このURLをコピーしてください", url); }
  }
  // ?c=ID で開いたとき：そのコメントのある試合・スレッドを開いて移動し、少しの間ハイライトする
  function focusPermalink() {
    const id = +new URLSearchParams(location.search).get("c"); if (!id || pv.permaDone) return;
    pv.permaDone = true;
    const c = findComment(id);
    if (!c) { toast("このコメントは削除されたか、見つかりませんでした。"); return; }
    const { roots } = threadsOf(c.bout), root = c.parent || c.id;
    if (roots.findIndex(r => r.id === root) >= PREVIEW_N) pv.open.add(c.bout);
    if (c.parent) pv.th.add(root);
    paintBc(c.bout);
    const el = $(`#ec${id}`); if (!el) return;
    el.classList.add("bc-focus");
    requestAnimationFrame(() => el.scrollIntoView({ block: "center" }));
    setTimeout(() => el.classList.remove("bc-focus"), 4000);
  }
  // ?bout=ID で開いたとき（ホームの「理由をコメントしよう」から）：その試合のコメント欄へ移動
  function focusBoutParam() {
    const bid = +new URLSearchParams(location.search).get("bout"); if (!bid || pv.boutDone) return;
    pv.boutDone = true;
    const li = $(`.pv-bout[data-bid="${bid}"]`); if (!li) return;
    const bc = li.querySelector(".bc");
    requestAnimationFrame(() => (bc || li).scrollIntoView({ block: "start" }));
    li.classList.add("bc-focus"); setTimeout(() => li.classList.remove("bc-focus"), 2500);
    const inp = li.querySelector(".bc-in");
    if (inp && !matchMedia("(pointer:coarse)").matches) setTimeout(() => inp.focus({ preventScroll: true }), 400);   // スマホでは急にキーボードを出さない
  }
  async function sendBoutComment(f) {
    const reply = f.classList.contains("bc-rform");
    const bid = +f.dataset.bid, inp = f.querySelector(reply ? ".bc-rin" : ".bc-in"), body = inp.value.trim();
    const ni = $("#pvNick"), nick = (ni ? ni.value : nickOf()).trim(), ne = nickErr(nick);
    if (ne) { toast(ne); if (ni) { ni.focus(); ni.scrollIntoView({ block: "center" }); } return; }
    if (!body) { inp.focus(); return; }
    const btn = f.querySelector(".bc-send"); if (btn.disabled) return; const label = btn.textContent; btn.disabled = true; btn.textContent = "送信中";
    try {
      await ensureUser(nick);
      const r = await rpc("add_bout_comment", reply ? { bid, body, reply_to: pv.reply.to } : { bid, body });
      if (reply) { pv.th.add(pv.reply.root); pv.reply = null; } else inp.value = "";
      if (!r.duplicate) track(reply ? "bout_reply" : "bout_comment", null, { event: pv.ev.id, bout: bid });
      await loadBoutComments(false);
      paintBc(bid);
    } catch (e) {
      toast(esc(e.message));
      if (e.code === "REPLY_GONE") { pv.reply = null; loadBoutComments(true); }
    }
    finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = label; } }
  }

  /* ---------- 「私の予想」画像（端末内で作る。サーバーには送らない） ---------- */
  async function shareImage() {
    const ev = pv.ev; if (!ev) return;
    const picks = ev.bouts.filter(b => b.me).slice().reverse();
    if (!picks.length) return;
    try { await document.fonts.load('900 40px "Noto Sans JP"'); } catch (e) {}
    const W = 1080, TOP = 290, rowH = picks.length > 8 ? 74 : picks.length > 5 ? 96 : 120, H = Math.max(1080, TOP + picks.length * rowH + 200);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#1F2715"); grd.addColorStop(1, "#11140D");
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(181,199,131,.08)"; g.lineWidth = 2;
    for (let x = -H; x < W; x += 56) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke(); g.beginPath(); g.moveTo(x + H, 0); g.lineTo(x, H); g.stroke(); }
    g.fillStyle = "#8FA35E"; g.fillRect(0, H - 14, W, 14);
    const font = (w, s) => `${w} ${s}px "Noto Sans JP","Hiragino Sans",sans-serif`;
    const fit = (t, w, s, max) => { let size = s; g.font = font(w, size); while (g.measureText(t).width > max && size > 18) { size -= 2; g.font = font(w, size); } return size; };
    g.fillStyle = "#E3CF8F"; g.font = font(900, 40); g.fillText("私の予想", 64, 110);
    g.fillStyle = "#F7F6F0"; fit(ev.name, 900, 58, W - 128); g.fillText(ev.name, 64, 190);
    g.fillStyle = "#C3C8B1"; g.font = font(700, 28); g.fillText(fmtWhen(ev.starts_at), 64, 240);
    // 選んだ試合を上から並べる（余白が多いときは中央に寄せる）
    const listH = picks.length * rowH, top = TOP + Math.max(0, (H - 200 - TOP - listH) / 2);
    g.textBaseline = "middle";
    picks.forEach((b, i) => {
      const y0 = top + i * rowH, cy = y0 + (rowH - 14) / 2;
      const win = fname(b, b.me.pick), lose = fname(b, b.me.pick === "a" ? "b" : "a");
      g.fillStyle = "rgba(255,255,255,.06)"; g.fillRect(56, y0, W - 112, rowH - 14);
      g.fillStyle = b.me.pick === "a" ? "#D06A52" : "#6F95C4"; g.fillRect(56, y0, 8, rowH - 14);
      const meth = b.me.method ? `（${METH[b.me.method]}）` : "";
      g.fillStyle = "#F7F6F0"; fit(`◎ ${win}${meth}`, 900, rowH > 100 ? 44 : rowH > 80 ? 38 : 30, 640); g.fillText(`◎ ${win}${meth}`, 88, cy);
      g.fillStyle = "#9DA38F"; g.font = font(700, rowH > 80 ? 26 : 20); const t2 = `vs ${lose}`;
      g.fillText(t2, W - 84 - Math.min(g.measureText(t2).width, 300), cy, 300);
    });
    g.textBaseline = "alphabetic";
    g.fillStyle = "#B5C783"; g.font = font(900, 34); g.fillText("あなたの予想は？", 64, H - 92);
    g.fillStyle = "#F7F6F0"; g.font = font(900, 34); const site = "FIGHT BOOK  fightbook-jp.com"; g.fillText(site, W - 64 - g.measureText(site).width, H - 92);
    const blob = await new Promise(r => cv.toBlob(r, "image/png"));
    const url = location.origin + evUrl(ev.id) + "?ref=x_share";
    const text = `${ev.name}、私の予想はこれ！🥊 みんなはどう予想する？\n#RIZIN #FIGHTBOOK`;
    const file = new File([blob], `fightbook-predict-${ev.id}.png`, { type: "image/png" });
    track("predict_share", null, { event: ev.id, n: picks.length });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: `${text}\n${url}` }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    // PC など：画像を保存して、X の投稿画面を開く（画像は投稿画面で添付）
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
    showSharePanel(text, url, a.href);
  }
  function showSharePanel(text, url, img) {
    let d = $("#pvShareDlg");
    if (!d) { d = document.createElement("dialog"); d.id = "pvShareDlg"; d.className = "picker small"; document.body.appendChild(d); }
    d.innerHTML = `<div class="pk-head"><div><small>SHARE</small><h3>私の予想を共有</h3></div><button class="pk-close" onclick="this.closest('dialog').close()" aria-label="閉じる">×</button></div>
      <div class="pv-dlg"><img src="${img}" alt="私の予想の画像"><p>画像を保存しました。Xの投稿画面で画像を添付して投稿してください。</p>
      <a class="btn primary big" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&via=fightbookjp" target="_blank" rel="noopener">Xの投稿画面を開く</a></div>`;
    d.showModal();
  }

  /* ---------- 管理：大会と対戦カードの登録・結果入力 ---------- */
  const adm = { ev: null };
  async function loadAdminEvents() {
    const box = $("#admEvents"); if (!box) return;
    try {
      const list = await rpc("list_fight_events");
      box.innerHTML = `<form id="admEvForm" class="adm-form">
          <b>大会を登録・更新</b>
          <label>ID（英小文字・数字・ハイフン。URLになります）<input name="eid" required pattern="[a-z0-9][a-z0-9\\-]{2,39}" placeholder="rizin-2026-12-31" value="${esc(adm.ev ? adm.ev.id : "")}"></label>
          <label>大会名<input name="name" required maxlength="80" value="${esc(adm.ev ? adm.ev.name : "")}" placeholder="RIZIN DECADE"></label>
          <label>開始日時（この時刻で予想を締め切ります）<input name="at" type="datetime-local" required value="${adm.ev ? localInput(adm.ev.starts_at) : ""}"></label>
          <label>会場（任意）<input name="venue" maxlength="80" value="${esc(adm.ev ? adm.ev.venue || "" : "")}"></label>
          <label>公式発表のURL（任意）<input name="src" maxlength="300" value="${esc(adm.ev ? adm.ev.source_url || "" : "")}" placeholder="https://"></label>
          <label>公開<select name="status"><option value="public">公開</option><option value="hidden" ${adm.ev && adm.ev.status === "hidden" ? "selected" : ""}>非公開（準備中）</option></select></label>
          <button class="btn primary" type="submit">保存</button></form>
        <ul class="adm-evs">${list.map(e => `<li><button class="fblink" data-admev="${esc(e.id)}">${esc(e.name)}</button> <small>${fmtWhen(e.starts_at)}・${e.bouts}試合</small> <a href="${evUrl(e.id)}">表示</a></li>`).join("") || "<li class='note'>まだ大会はありません</li>"}</ul>
        <div id="admBouts"></div>`;
      if (adm.ev) renderAdminBouts();
    } catch (e) { box.innerHTML = e.code && /function|schema/.test(e.message) ? `<p class="note">大会予想のデータベース設定がまだです（schema.sql を実行し直してください）。</p>` : failBox(e); }
  }
  const localInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  async function renderAdminBouts() {
    const box = $("#admBouts"); if (!box || !adm.ev) return;
    const ev = adm.ev = await rpc("get_fight_event", { eid: adm.ev.id });
    const opts = Object.values(S.profiles).filter(p => p.riz.total > 0).sort((a, b) => b.rating - a.rating).map(p => `<option value="${esc(p.key)}">${esc(S.nameOf(p.key))}</option>`).join("");
    box.innerHTML = `<h3 class="fb-h3">${esc(ev.name)} の対戦カード</h3>
      <div class="adm-phase">大会の状態（予想の締め切りとは別。コメントはいつでもできます）：
        ${[["", "開催前"], ["live", "試合中"], ["finished", "試合終了"]].map(([k, v]) => `<button class="fbchip" data-admphase="${k}" aria-pressed="${(ev.phase || "") === k}">${v}</button>`).join("")}
        <small>全試合の結果を入れると、自動で「試合終了」になります。</small></div>
      <datalist id="admFighters">${opts}</datalist>
      <form id="admBoutForm" class="adm-form">
        <b>試合を追加（メインイベントを最後に）</b>
        <label>選手A（一覧から選ぶか、名前を入力）<input name="a" list="admFighters" required maxlength="60" placeholder="選手名またはID"></label>
        <label>選手B<input name="b" list="admFighters" required maxlength="60"></label>
        <label>ルール<select name="rule">${Object.entries(RULES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}<option value="other">その他</option></select></label>
        <label>階級・契約（任意）<input name="weight" maxlength="40" placeholder="フェザー級"></label>
        <label class="toggle"><input type="checkbox" name="title"> タイトルマッチ</label>
        <button class="btn primary" type="submit">追加</button></form>
      <ol class="adm-bouts">${ev.bouts.map(b => `<li><b>${esc(fname(b, "a"))}</b> vs <b>${esc(fname(b, "b"))}</b> <small>${b.n}人が予想</small>
        <span class="adm-res">結果：<select data-res="${b.id}"><option value="">未入力</option><option value="a" ${b.winner === "a" ? "selected" : ""}>${esc(fname(b, "a"))}の勝ち</option><option value="b" ${b.winner === "b" ? "selected" : ""}>${esc(fname(b, "b"))}の勝ち</option><option value="draw" ${b.winner === "draw" ? "selected" : ""}>引き分け</option><option value="nc" ${b.winner === "nc" ? "selected" : ""}>無効試合</option></select>
        <select data-resm="${b.id}"><option value="">決着</option>${Object.entries(METH).map(([k, v]) => `<option value="${k}" ${b.method === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="btn small" data-ressave="${b.id}">結果を保存</button> <button class="btn small danger" data-admdelbout="${b.id}">削除</button></span></li>`).join("") || "<li class='note'>まだ試合がありません</li>"}</ol>`;
  }
  const keyOfName = v => { v = (v || "").trim(); if (valid(v)) return v; const hit = Object.values(S.profiles).find(p => S.nameOf(p.key) === v || S.enOf(p.key) === v); return hit ? hit.key : null; };

  function predictClick(e) {
    const t = e.target;
    const pb = t.closest(".pv-pick"); if (pb && !pb.disabled) { pick(pb); return true; }
    const mb = t.closest("[data-meth]"); if (mb) { pick(mb, mb.dataset.meth); return true; }
    if (t.closest("[data-gocomment]")) { goComment(); return true; }
    const hk = t.closest("[data-hpick]"); if (hk) { homePick(hk); return true; }
    const hn = t.closest("[data-hpnext]"); if (hn) { homeNext(+hn.dataset.hpnext); return true; }
    const hc = t.closest(".hpb-cm"); if (hc && home.ev) track("home_to_comment", null, { event: home.ev.id, bout: +hc.dataset.bid, picked: !!(hc.closest(".done")) });
    if (t.closest("#pvShare")) { shareImage().catch(err => toast("画像を作れませんでした。")); return true; }
    const dl = t.closest("[data-ecdel]");
    if (dl) {
      if (!confirm("このコメントを削除しますか？")) return true;
      const id = +dl.dataset.ecdel, bid = +dl.dataset.bid;
      rpc("delete_event_comment", { mid: id }).then(() => { if (pv.reply && pv.reply.to === id) pv.reply = null; loadBoutComments(true); toast("コメントを削除しました"); }).catch(err => toast(esc(err.message)));
      return true;
    }
    const lk = t.closest("[data-bclike]"); if (lk) { likeComment(+lk.dataset.bclike); return true; }
    const rp = t.closest("[data-bcreply]"); if (rp) { startReply(+rp.dataset.bcreply, +rp.dataset.bid); return true; }
    const sh = t.closest("[data-bcshare]"); if (sh) { shareComment(+sh.dataset.bcshare, sh); return true; }
    if (t.closest("[data-bcrcancel]")) { const bid = pv.reply && pv.reply.bid; pv.reply = null; if (bid) paintBc(bid); return true; }
    const tm = t.closest("[data-bcthread]"); if (tm) { pv.th.add(+tm.dataset.bcthread); paintBc(+tm.dataset.bid); return true; }
    const pm = t.closest("[data-bcperma]");
    if (pm && !e.metaKey && !e.ctrlKey) { e.preventDefault(); history.replaceState(history.state, "", pm.getAttribute("href")); pv.permaDone = false; focusPermalink(); return true; }
    const mo = t.closest("[data-bcmore]");
    if (mo) {
      const bid = +mo.dataset.bcmore, opening = !pv.open.has(bid);
      if (opening) pv.open.add(bid); else pv.open.delete(bid);
      paintBc(bid);
      if (!opening) { const el = $(`.bc[data-bc="${bid}"]`); if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" }); }
      if (opening) track("bout_comments_open", null, { event: pv.ev.id, bout: bid });
      return true;
    }
    const ae = t.closest("[data-admev]"); if (ae) { rpc("get_fight_event", { eid: ae.dataset.admev }).then(ev => { adm.ev = ev; loadAdminEvents(); }); return true; }
    const ph = t.closest("[data-admphase]");
    if (ph) { rpc("admin_set_phase", { eid: adm.ev.id, phase: ph.dataset.admphase || null }).then(() => { toast("大会の状態を変更しました"); renderAdminBouts(); }).catch(err => toast(esc(err.message))); return true; }
    const rs = t.closest("[data-ressave]");
    if (rs) { const id = rs.dataset.ressave; rpc("admin_set_result", { bid: +id, winner: $(`[data-res="${id}"]`).value || null, method: $(`[data-resm="${id}"]`).value || null }).then(() => { toast("結果を保存しました"); renderAdminBouts(); }).catch(err => toast(esc(err.message))); return true; }
    const db = t.closest("[data-admdelbout]");
    if (db) { if (confirm("この試合を削除しますか？（集まった予想も消えます）")) rpc("admin_delete_bout", { bid: +db.dataset.admdelbout }).then(renderAdminBouts).catch(err => toast(esc(err.message))); return true; }
    return false;
  }
  function predictSubmit(e) {
    const f = e.target;   // 注意：フォーム内に name="id" の入力欄を置くと f.id が上書きされる
    if (f.classList.contains("bc-form") || f.classList.contains("bc-rform")) { e.preventDefault(); sendBoutComment(f); return true; }
    if (f.id === "admEvForm") {
      e.preventDefault();
      const v = n => f.elements[n].value;
      rpc("admin_upsert_event", { eid: v("eid"), name: v("name"), starts_at: new Date(v("at")).toISOString(), venue: v("venue") || null, source_url: v("src") || null, status: v("status") })
        .then(ev => { adm.ev = ev; toast("大会を保存しました"); loadAdminEvents(); }).catch(err => toast(esc(err.message)));
      return true;
    }
    if (f.id === "admBoutForm") {
      e.preventDefault();
      const v = n => f.elements[n].value.trim(), ka = keyOfName(v("a")), kb = keyOfName(v("b"));
      rpc("admin_add_bout", { eid: adm.ev.id, fa_name: ka ? S.nameOf(ka) : v("a"), fb_name: kb ? S.nameOf(kb) : v("b"), fa: ka, fb: kb, rule: v("rule"), weight: v("weight") || null, title: f.elements.title.checked, ord: null })
        .then(() => { toast("試合を追加しました"); renderAdminBouts(); }).catch(err => toast(esc(err.message)));
      return true;
    }
    return false;
  }

  function click(e) {
    if (predictClick(e)) return true;
    const t = e.target;
    const a = t.closest("a[data-src]"); if (a) { navSrc = a.dataset.src; ss.set("fb_navsrc", a.dataset.src); if (a.dataset.why) track("related_click", det.id, { why: a.dataset.why, to: (a.closest("[data-card]") || {}).dataset && a.closest("[data-card]").dataset.card }); }
    const xs = t.closest("[data-xshare]"); if (xs) { track("share_click", xs.dataset.xshare, { where: "after_vote" }); return true; }
    const rb = t.closest("[data-act]"); if (rb && rb.tagName === "BUTTON") { e.preventDefault(); react(rb); return true; }
    if (t.closest("[data-login]")) { e.preventDefault(); login(null); return true; }
    const sp = t.closest("[data-showpw]");
    if (sp) { const i = sp.parentElement.querySelector("input"), show = i.type === "password"; i.type = show ? "text" : "password"; sp.textContent = show ? "隠す" : "表示"; sp.setAttribute("aria-label", show ? "パスワードを隠す" : "パスワードを表示"); return true; }
    if (t.closest("[data-logout]")) { logout(); return true; }
    const rt = t.closest("[data-retry]"); if (rt) { H.rerender(); return true; }
    // 一覧
    const ht = t.closest("#fbHomeTab .tab"); if (ht) { home.tab = ht.dataset.tab; $$("#fbHomeTab .tab").forEach(b => { b.setAttribute("aria-pressed", b === ht); b.setAttribute("aria-selected", b === ht); }); loadHomeList(); return true; }
    const lt = t.closest("#fbListTab .tab"); if (lt) { list.tab = lt.dataset.tab; $$("#fbListTab .tab").forEach(b => { b.setAttribute("aria-pressed", b === lt); b.setAttribute("aria-selected", b === lt); }); loadList(); return true; }
    if (t.closest("#fbMore")) { loadList(true); return true; }
    // 詳細
    const so = t.closest("#fbSort .tab"); if (so) { det.sort = so.dataset.sort; $$("#fbSort .tab").forEach(b => b.setAttribute("aria-pressed", b === so)); loadComments(); return true; }
    const hn = t.closest(".fb-hints [data-hint]");
    if (hn) {
      const f = hn.closest("form"), on = hn.getAttribute("aria-pressed") !== "true";
      f.querySelectorAll("[data-hint]").forEach(x => x.setAttribute("aria-pressed", "false"));
      hn.setAttribute("aria-pressed", on); f.dataset.hint = on ? hn.dataset.hint : "";
      const ta = f.querySelector("textarea"); ta.placeholder = on ? `${HINT_T[hn.dataset.hint]}（書き出しのヒントです。自由に書けます）` : "一言でもOK。あなたの意見を書いてください（300字まで）"; ta.focus();
      return true;
    }
    const rp = t.closest("[data-reply]");
    if (rp) {
      const li = $(`#cm${rp.dataset.reply}`), slotEl = li.querySelector(".fb-reply-slot");
      if (!slotEl.innerHTML) { slotEl.innerHTML = composer(+rp.dataset.reply); slotEl.querySelector("textarea").focus(); }
      return true;
    }
    if (t.closest("[data-cancel-reply]")) { t.closest(".fb-reply-slot").innerHTML = ""; return true; }
    const ed = t.closest("[data-edit]");
    if (ed) {
      const id = ed.dataset.edit, p = $(`#body_${id}`); if (!p) return true;
      const cur = p.textContent;
      p.outerHTML = `<form class="fb-edit" data-edit-id="${id}"><label class="sr" for="ed_${id}">コメントを編集</label><textarea id="ed_${id}" rows="3" maxlength="300">${esc(cur)}</textarea><div class="fb-comp-foot"><button type="button" class="btn small ghost" data-edit-cancel>やめる</button><button class="btn primary small" type="submit">保存</button></div></form>`;
      return true;
    }
    if (t.closest("[data-edit-cancel]")) { loadComments(); return true; }
    const dl = t.closest("[data-del]");
    if (dl) { if (confirm("このコメントを削除しますか？（返信はそのまま残ります）")) rpc("delete_comment", { mid: +dl.dataset.del }).then(() => { toast("削除しました"); loadComments(); return rpc("get_card", { cid: det.id }).then(paintCounts); }).catch(err => toast(esc(err.message))); return true; }
    const rpt = t.closest("[data-report]"); if (rpt) { doReport(rpt.dataset.report, rpt.dataset.target); return true; }
    const ah = t.closest("[data-admin-hide]");
    if (ah) { if (ah.dataset.hidden === "true" && !confirm(ah.dataset.adminHide === "card" ? "このカードを削除しますか？（一覧や共有ページから消えます。あとで取り消せます）" : "このコメントを削除しますか？（あとで取り消せます）")) return true;
      rpc("admin_set_hidden", { target_type: ah.dataset.adminHide, target_id: String(ah.dataset.target), hidden: ah.dataset.hidden === "true" }).then(() => { toast(ah.dataset.hidden === "true" ? "削除しました" : "元に戻しました"); H.rerender(); }).catch(err => toast(esc(err.message))); return true; }
    const cd = t.closest("[data-ctdone]"); if (cd) { rpc("admin_contact_done", { cid: +cd.dataset.ctdone }).then(loadAdmin).catch(err => toast(esc(err.message))); return true; }
    const dm = t.closest("[data-dismiss]"); if (dm) { rpc("admin_dismiss", { target_type: dm.dataset.dismiss, target_id: String(dm.dataset.target) }).then(loadAdmin).catch(err => toast(esc(err.message))); return true; }
    const sv = t.closest("#fbSave");
    if (sv) {
      const id = sv.dataset.id, on = sv.getAttribute("aria-pressed") !== "true";
      ensureUser().then(() => rpc("set_save", { cid: id, on })).then(() => { sv.setAttribute("aria-pressed", on); sv.textContent = on ? "✓ 保存済み" : "保存"; toast(on ? "保存しました（マイページで見られます）" : "保存を外しました"); if (on) track("save", id, {}); }).catch(err => toast(esc(err.message)));
      return true;
    }
    if (t.closest("#fbShareBtn")) {
      const w = $("#fbShareWrap"), b = t.closest("#fbShareBtn"), open = w.hidden;
      if (open) w.innerHTML = sharePanel(det.card); w.hidden = !open; b.setAttribute("aria-expanded", open);
      return true;
    }
    if (t.closest("#fbShareGo")) { track("share_click", det.id, { where: "detail", with_reason: !!($("#fbShareReason") && $("#fbShareReason").checked) }); return true; }
    const cp = t.closest("#fbCopy"); if (cp) { copy(cp.dataset.url, cp); return true; }
    const nx = t.closest("[data-next]");
    if (nx) {
      if (nx.dataset.next === "write") { const ta = $("#cm_main"); if (ta) { ta.scrollIntoView({ block: "center" }); ta.focus(); } }
      if (nx.dataset.next === "related") { const r = $("#related"); if (r) r.scrollIntoView(); }
      track("next_action", det.id, { action: nx.dataset.next });
      return true;
    }
    // 作成
    const sl = t.closest(".fb-slot"); if (sl) { openPick(sl.dataset.slot); return true; }
    const pi = t.closest("[data-pk]");
    if (pi && !pi.disabled) { cr[pk.corner] = pi.dataset.pk; $("#fbPicker").close(); refreshCreate(); return true; }
    if (t.closest("[data-pkclose]")) { $("#fbPicker").close(); return true; }
    if (t.id === "fbPicker" || t.id === "fbReq") { t.close(); return true; }
    if (t.closest("[data-reqclose]")) { $("#fbReq").close(); return true; }
    if (t.closest("#fbReqOpen") || t.closest("#fbReqOpen2")) { openReq(); return true; }
    const ru = t.closest("[data-rule]"); if (ru) { cr.rule = ru.dataset.rule; refreshCreate(); return true; }
    const co = t.closest("[data-cond]"); if (co) { cr.cond = co.dataset.cond; refreshCreate(); return true; }
    const ch = t.closest("[data-chint]"); if (ch) { cr.hint = cr.hint === ch.dataset.chint ? null : ch.dataset.chint; refreshCreate(); return true; }
    return false;
  }
  function submit(e) {
    if (predictSubmit(e)) return true;
    const f = e.target;
    if (f.id === "fbAuth") { e.preventDefault(); submitAuth(f); return true; }
    if (f.id === "fbContact") { e.preventDefault(); submitContact(f); return true; }
    if (f.id === "fbReset") { e.preventDefault(); submitReset(f); return true; }
    if (f.id === "fbNameForm") {
      e.preventDefault();
      rpc("set_display_name", { name: $("#fbNameIn").value }).then(async () => { ls.set(NICK, $("#fbNameIn").value.trim()); who = await rpc("whoami"); toast("表示名を変更しました"); H.rerender(); }).catch(err => toast(esc(err.message)));
      return true;
    }
    if (f.id === "fbCreate") { e.preventDefault(); publish(); return true; }
    if (f.classList.contains("fb-comp")) { e.preventDefault(); submitComment(f); return true; }
    if (f.classList.contains("fb-edit")) {
      e.preventDefault();
      const body = f.querySelector("textarea").value.trim();
      rpc("edit_comment", { mid: +f.dataset.editId, body }).then(() => { toast("保存しました"); loadComments(); }).catch(err => toast(esc(err.message)));
      return true;
    }
    if (f.id === "fbReqForm") {
      e.preventDefault();
      ensureUser().then(() => rpc("request_fighter", { name: $("#fbReqName").value, note: $("#fbReqNote").value || null })
        ).then(() => { $("#fbReq").close(); toast("リクエストを受け付けました。運営が確認します。"); }).catch(err => toast(esc(err.message)));
      return true;
    }
    return false;
  }
  function input(e) {
    const t = e.target;
    if (t.classList && t.classList.contains("bc-rin")) { if (pv.reply) pv.reply.text = t.value; return true; }
    if (t.id === "pvNick") { const v = t.value.trim(); if (!nickErr(v)) ls.set(NICK, v); return true; }
    if (t.id === "fbReason") { cr.reason = t.value; refreshCreate("text"); return true; }
    if (t.id === "fbPkQ") { pk.q = t.value; $("#fbPkList").innerHTML = pickList(); return true; }
    if (t.matches(".fb-comp textarea")) {
      const f = t.closest("form"); ls.set(`fb_draft_cm_${det.id}_${f.dataset.cid}`, t.value);
      const n = f.querySelector(".fb-count"); if (n) n.textContent = `${t.value.length}/300`;
      return true;
    }
    if (t.id === "fbShareText") { const c = det.card; $("#fbShareGo").href = xIntent(c, t.value); return true; }
    return false;
  }
  function change(e) {
    const t = e.target;
    if (t.id === "fbHomeRule") { home.rule = t.value; loadHomeList(); return true; }
    if (t.id === "fbListRule") { list.rule = t.value; loadList(); return true; }
    if (t.id === "fbPkActive") { pk.active = t.checked; $("#fbPkList").innerHTML = pickList(); return true; }
    if (t.id === "fbShareReason") { const c = det.card, txt = shareText(c, t.checked); $("#fbShareText").value = txt; $("#fbShareGo").href = xIntent(c, txt); return true; }
    return false;
  }
  document.addEventListener("submit", e => { if (e.target.closest("#view")) submit(e); });

  // ページを表示し終えた後に、データを読み込む
  function after(page, parts) {
    paintMe();
    if (page === "" || page === undefined) loadHome();
    else if (page === "cards") loadList();
    else if (page === "c") loadCard();
    else if (page === "create") { ready().then(() => { paintMe(); refreshCreate(); }); }
    else if (page === "me") loadMe();
    else if (page === "admin") loadAdmin();
    else if (page === "predict") loadPredictList();
    else if (page === "pevent") loadPredict();
    else if (page === "login") { ready().then(() => { paintMe(); if (isAdmin() && parts[1] !== "forgot") location.href = "/admin/"; }); }
    else if (page === "reset") { ready().then(() => { paintMe(); if (loggedIn() && !$("#fbReset")) H.rerender(); }); }
    else if (page === "fighter") loadFighter(parts[1]);
    else ready().then(paintMe);
    if (page === "about" || page === "privacy" || page === "contact") ready().then(paintMe);
  }

  { const f = ss.get("fb_flash"); if (f) { ss.set("fb_flash", ""); setTimeout(() => toast(f), 300); } }

  // 接続前は、メニューの「見たい対戦」をこれまでのデータ比較ページへ
  if (!ENABLED) $$('a[href="/cards/"]').forEach(a => { a.href = "/compare/"; if (a.dataset.r) a.dataset.r = "matchups"; });
  if (!ENABLED) $$('.site-foot a[href="/me/"]').forEach(a => a.remove());

  // 起動：1日1回の訪問を記録し、ログインから戻った場合は元の画面へ
  if (ENABLED) {
    ready().then(async () => {
      paintMe();
      track("daily_visit", null, { logged_in: loggedIn(), ref: new URLSearchParams(location.search).get("ref") || "" }, `dv:${anon}:${today()}`);
      await afterAuthReturn();
    }).catch(() => {});
  }

  return {
    enabled: ENABLED, homeTop, fighterPanel, after, click, input, change,
    view(page, parts) {
      if (page === "cards") return viewCards();
      if (page === "c") return viewCard(parts[1], parts[2]);
      if (page === "create") return viewCreate(parts[1], parts[2]);
      if (page === "me") return viewMe(parts[1]);
      if (page === "admin") return viewAdmin();
      if (page === "login") return viewLogin(parts[1]);
      if (page === "reset") return viewReset();
      if (page === "about") return viewAbout();
      if (page === "predict") return viewPredictList();
      if (page === "pevent") return viewPredict(parts[1]);
      if (page === "privacy") return viewPrivacy();
      if (page === "contact") return viewContact();
      return null;
    },
    title(page) { return { cards: "ファンの見たい対戦", create: "見たい対戦を作る", me: "マイページ", admin: "管理", login: "管理者ログイン", reset: "パスワードの再設定", about: "FIGHT BOOKについて", predict: "大会予想", pevent: "大会予想", privacy: "プライバシーポリシー", contact: "お問い合わせ" }[page]; },
  };
};
