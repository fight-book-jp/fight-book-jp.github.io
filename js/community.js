/* =====================================================================
   ファン参加機能（見たい対戦カード・投票・コメント・ログイン・計測）
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
  const SITE = (CFG.siteUrl || "https://fight-book-jp.github.io").replace(/\/$/, "");
  const RULES = { mma: "MMA", kickboxing: "キックボクシング", grappling: "グラップリング", boxing: "ボクシング" };
  const CONDS = { standard: "通常", title: "タイトル戦", catchweight: "契約体重", openweight: "無差別級" };
  const HINTS = [
    { k: "why", t: "見たい理由は？" }, { k: "key", t: "この試合の分かれ目は？" },
    { k: "other", t: "別の相手なら誰を見たい？" }, { k: "rule", t: "このルールならどうなる？" }];
  const HINT_T = Object.fromEntries(HINTS.map(h => [h.k, h.t]));
  const WHY = { same_fighter: "同じ選手の対戦案", same_class: "同じ階級で見たい数が多い", fresh: "まだ反応が少ない新着", editorial: "編集部の提案" };
  const TABS = [{ id: "trending", t: "急上昇" }, { id: "weekly", t: "週間" }, { id: "new", t: "新着" }, { id: "total", t: "累計" }];
  const ERR = {
    LOGIN_REQUIRED: "ログインが必要です。", BANNED: "このアカウントでは投稿できません。", NOT_FOUND: "カードが見つからないか、非公開になりました。",
    TOO_FAST: "続けて投稿するときは15秒ほど待ってください。", RATE_LIMIT: "今日の投稿数の上限に達しました。明日また参加してください。",
    TOO_LONG: "文字数が多すぎます。", EMPTY: "本文を入力してください。", SAME_FIGHTER: "同じ選手どうしは選べません。",
    FORBIDDEN: "この操作の権限がありません。", BAD_LENGTH: "文字数を確認してください。", BAD_NAME: "表示名にメールアドレスやURLは使えません。", PROFILE_MISSING: "ログイン情報を確認できませんでした。もう一度ログインしてください。",
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

  // ログイン後に戻る画面と、続けたい操作を覚えておく（下書きは別に保存）
  function rememberReturn(pending) {
    // 共有URL（/matchups/{id}/）で開いていた場合も、同じカードへ戻れるようにハッシュの形で覚える
    const pm = location.pathname.match(/\/matchups\/([A-Za-z0-9]{6,20})\/?$/);
    const cur = location.hash && location.hash !== "#" ? location.hash : pm ? `#/c/${pm[1]}` : "#/";
    if (/^#\/(login|reset)/.test(cur)) return;
    ls.set("fb_return", { hash: cur, pending: pending || null, t: Date.now() });
  }
  function login(pending) {
    rememberReturn(pending);
    track("login_start", pending && pending.card, { action: pending ? pending.type : "menu" });
    location.hash = "#/login";
  }
  async function logout() {
    if (CFG.testAuth) CFG.testAuth.logout(); else if (sb) await sb.auth.signOut();
    who = null; paintMe(); toast("ログアウトしました"); location.hash = "#/";
  }
  // ログインできたら：元の画面へ戻し、押そうとしていた操作（見たい・面白い・保存）を続ける
  async function finishLogin(how) {
    try { who = await rpc("whoami"); } catch (e) { who = null; }
    if (!who) { toast(ERR.PROFILE_MISSING); return; }
    const back = ls.get("fb_return", null); ls.del("fb_return");
    paintMe();
    toast(`ログインしました（${esc(who.name)}）`);
    track("login_success", null, { action: back && back.pending ? back.pending.type : "menu", how });
    const p = back && back.pending;
    if (p && p.card && (p.type === "want" || p.type === "fun")) { try { const c = await rpc("set_reaction", { cid: p.card, kind: p.type, on: true }); cache[c.id] = c; track("vote", c.id, { kind: p.type, on: true, where: "after_login" }); } catch (e) {} }
    if (p && p.card && p.type === "save") { try { await rpc("set_save", { cid: p.card, on: true }); } catch (e) {} }
    const to = back && back.hash && Date.now() - back.t < 86400000 ? back.hash : "#/me";
    if (location.hash !== to) location.hash = to; else H.rerender();
  }
  // メール内のリンク（登録の確認・パスワード再設定）から戻ってきたとき
  async function afterAuthReturn() {
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error") && !q.has("error_description")) return;
    const reset = q.get("fb") === "reset";
    history.replaceState(null, "", location.pathname + (location.hash || "#/"));
    if (q.has("error") || q.has("error_description")) {
      toast("リンクが無効か、有効期限が切れています。もう一度お試しください。");
      track("login_fail", null, { reason: "link" });
      location.hash = "#/login"; return;
    }
    if (!loggedIn()) {
      toast("リンクを確認できませんでした。登録・再設定をしたのと同じ端末・ブラウザで開いてください。");
      track("login_fail", null, { reason: "link_session" });
      location.hash = "#/login"; return;
    }
    if (reset) { location.hash = "#/reset"; return; }
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
    auth.mode = ["login", "signup", "forgot"].includes(mode) ? mode : "login";
    if (!ENABLED) return H.pageHero("Login", "") + `<div class="wrap"><section class="section">${offBox()}</section></div>`;
    const m = auth.mode;
    const T = { login: "ログイン", signup: "新規登録", forgot: "パスワードを忘れたとき" };
    return H.pageHero("Login", "カードの作成・「見たい！」・コメント・保存にはログインが必要です。閲覧はログインなしでできます。") + `<div class="wrap">
      <div class="fb-auth">
        ${m === "forgot" ? "" : `<div class="tabs" role="tablist"><a class="tab" href="#/login" role="tab" aria-pressed="${m === "login"}">ログイン</a><a class="tab" href="#/login/signup" role="tab" aria-pressed="${m === "signup"}">新規登録</a></div>`}
        <form id="fbAuth" data-mode="${m}" novalidate>
          <h2>${T[m]}</h2>
          ${m === "signup" ? `<label>表示名（公開されます・30字まで）<input id="fbName" name="name" maxlength="30" autocomplete="nickname" required placeholder="例：格闘技好きのこや"></label>
            <p class="note">表示名はコメントやカードに表示されます。本名やメールアドレスは入れないでください。</p>` : ""}
          <label>メールアドレス<input id="fbEmail" name="email" type="email" autocomplete="email" required inputmode="email"></label>
          ${m === "forgot" ? "" : `<label>パスワード${m === "signup" ? "（8文字以上）" : ""}<span class="fb-pw"><input id="fbPass" name="password" type="password" minlength="8" autocomplete="${m === "signup" ? "new-password" : "current-password"}" required><button type="button" class="fblink" data-showpw aria-label="パスワードを表示">表示</button></span></label>`}
          <div id="fbAuthMsg" class="fb-auth-msg" role="alert" aria-live="assertive"></div>
          <button class="btn primary big" type="submit">${m === "login" ? "ログイン" : m === "signup" ? "登録する" : "再設定メールを送る"}</button>
          ${m === "login" ? `<p class="note"><a href="#/login/forgot">パスワードを忘れた場合</a></p>` : ""}
          ${m === "signup" ? `<p class="note">登録すると確認メールが届きます。メール内のリンクを、<b>登録したのと同じ端末・ブラウザ</b>で開くと登録が完了します。メールアドレスは公開されず、ログインとお知らせ以外には使いません。</p>` : ""}
          ${m === "forgot" ? `<p class="note">登録したメールアドレスに、パスワード再設定のリンクを送ります。<a href="#/login">ログインに戻る</a></p>` : ""}
        </form>
      </div></div>`;
  }
  function viewReset() {
    return H.pageHero("Password", "新しいパスワードを設定します。") + `<div class="wrap"><div class="fb-auth">
      ${loggedIn() ? `<form id="fbReset" novalidate><h2>新しいパスワード</h2>
        <label>新しいパスワード（8文字以上）<span class="fb-pw"><input id="fbNewPass" type="password" minlength="8" autocomplete="new-password" required><button type="button" class="fblink" data-showpw aria-label="パスワードを表示">表示</button></span></label>
        <div id="fbAuthMsg" class="fb-auth-msg" role="alert"></div>
        <button class="btn primary big" type="submit">変更する</button></form>`
      : `<p>再設定のリンクを確認できませんでした。<a href="#/login/forgot">もう一度メールを送る</a></p>`}
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
      toast("パスワードを変更しました"); location.hash = "#/me";
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
    b.href = loggedIn() ? "#/me" : "#/login";
    if (!ENABLED) { b.hidden = true; return; }
    b.hidden = false;
    b.innerHTML = loggedIn() ? `${who.avatar ? `<img src="${esc(who.avatar)}" alt="" width="26" height="26" referrerpolicy="no-referrer">` : "👤"}<span class="me-name">マイページ</span><i class="me-dot" hidden></i>` : `<span>ログイン</span>`;
    b.setAttribute("aria-label", loggedIn() ? "マイページ" : "ログイン");
    if (loggedIn()) rpc("unread_count").then(n => { const d = b.querySelector(".me-dot"); if (d && n > 0) { d.hidden = false; d.textContent = n > 9 ? "9+" : n; b.setAttribute("aria-label", `マイページ（未読${n}件）`); } }).catch(() => {});
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
    const me = c.me || {}, href = `#/c/${encodeURIComponent(c.id)}`;
    const reason = c.reason && c.reason.body;
    const label = o.label ? `<div class="fc-label">${esc(o.label)}</div>` : "";
    return `<article class="fc ${o.big ? "fc-big" : ""}" data-card="${esc(c.id)}">
      ${label}
      <a class="fc-link" href="${href}" data-src="${esc(o.src || "list")}"${o.why ? ` data-why="${esc(o.why)}"` : ""}>
        <div class="fc-meta"><span class="fc-rule">${esc(ruleLbl(c))}</span><span class="fc-status">${statusLbl(c)}</span>${isRematch(c) ? '<span class="fc-re">再戦希望</span>' : ""}</div>
        <div class="fc-vs">
          <div class="fc-side red">${av(c.fa, o.big ? "l" : "m")}<b>${nm(c.fa)}</b><small>${esc(div(c.fa))}</small></div>
          <span class="fc-x" aria-hidden="true">VS</span>
          <div class="fc-side blue">${av(c.fb, o.big ? "l" : "m")}<b>${nm(c.fb)}</b><small>${esc(div(c.fb))}</small></div>
        </div>
        ${reason ? `<p class="fc-reason">${esc(reason)}<small>— ${esc(c.creator ? c.creator.name : "退会したユーザー")}</small></p>` : ""}
        ${o.period ? `<div class="fc-period">${esc(o.period)}</div>` : ""}
      </a>
      ${o.preview ? "" : actions(c)}
      <div class="fc-next" hidden></div>
    </article>`;
  }
  function actions(c) {
    const me = c.me || {};
    return `<div class="fc-acts">
      <button class="fb-want" data-act="want" data-id="${esc(c.id)}" aria-pressed="${!!me.want}" aria-label="この対戦を見たい（現在${c.want}人）"><span class="ic" aria-hidden="true">${me.want ? "★" : "☆"}</span>見たい！<b>${c.want}</b></button>
      <button class="fb-fun" data-act="fun" data-id="${esc(c.id)}" aria-pressed="${!!me.fun}" aria-label="組み合わせが面白い（現在${c.fun}人）">面白い<b>${c.fun}</b></button>
      <a class="fb-cmlink" href="#/c/${encodeURIComponent(c.id)}/comments" data-src="comment_link" aria-label="コメント${c.comments}件">💬<b>${c.comments}</b></a>
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
    return `自分はこの一戦が見たい。${S.nameOf(c.fa)} vs ${S.nameOf(c.fb)}（${ruleLbl(c)}）、みんなはどう思う？${r}\n#FIGHTBOOK`;
  }
  const xIntent = (c, text) => `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(cardUrl(c.id) + "?ref=x_share")}`;
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

  /* ---------- ホーム ---------- */
  const home = { tab: null, rule: "" };
  function homeTop() {
    if (!ENABLED) return "";     // 接続前は、これまでのホームのまま（空の参加画面は出さない）
    return `<section class="fan-hero"><div class="in">
      <div class="kicker">FAN MATCHMAKING</div>
      <h1>次に見たい一戦を、<br class="sp">ファンで語ろう。</h1>
      <p>あなたの「見たい！」が、みんなの声になる。<small>※ファンによる提案です。実際の対戦を決めるものではありません。</small></p>
      <div class="cta"><a class="btn primary big" href="#/create" data-src="home_cta">＋ 見たい対戦を作る</a><a class="btn ghost-light" href="#/cards">みんなのカードを見る</a></div>
    </div></section>
    <div class="wrap fan-home">
      <section class="section" id="fbFeatured" aria-live="polite">${ENABLED ? loading() : offBox()}</section>
      ${ENABLED ? `<section class="section">
        <div class="sec-head"><h2>Fan Cards<small>ファンの見たい対戦</small></h2><a href="#/cards">すべて見る ›</a></div>
        <div class="fb-tools">${tabBar("fbHomeTab", home.tab || "trending")}${ruleSelect("fbHomeRule", home.rule)}</div>
        <div id="fbHomeList">${loading()}</div>
      </section>
      <section class="section" id="fbTheme" hidden></section>` : ""}
    </div>`;
  }
  const tabBar = (id, cur) => `<div class="tabs" id="${id}" role="tablist">${TABS.map(t => `<button class="tab" role="tab" aria-selected="${t.id === cur}" aria-pressed="${t.id === cur}" data-tab="${t.id}">${t.t}</button>`).join("")}</div>`;
  const ruleSelect = (id, cur) => `<label class="fb-sel"><span class="sr">ルールで絞り込み</span><select id="${id}"><option value="">すべてのルール</option>${Object.entries(RULES).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
  const periodText = (tab, c) => tab === "trending" ? `直近48時間で${c.period_n}人が「見たい！」` : tab === "weekly" ? `今週${c.period_n}人が「見たい！」` : "";
  const EMPTY_TAB = {
    trending: "急上昇の条件（直近48時間に3人以上が「見たい！」）を満たすカードは、まだありません。",
    weekly: "この7日間に「見たい！」が付いたカードは、まだありません。",
    total: "「見たい！」が付いたカードは、まだありません。",
    new: "まだカードがありません。最初の1枚を作ってみませんか？",
  };
  async function loadHome() {
    if (!ENABLED) return;
    await ready();
    paintMe();
    // 注目カード：お題 → 急上昇1位 → 週間1位 → 新着（どれも実際のデータ。無ければ作成への案内）
    try {
      const [theme, tr, wk, nw] = await Promise.all([rpc("current_theme"), rpc("list_cards", { tab: "trending", lim: 6 }), rpc("list_cards", { tab: "weekly", lim: 1 }), rpc("list_cards", { tab: "new", lim: 6 })]);
      remember(tr.cards); remember(wk.cards); remember(nw.cards);
      let feat = null, label = "";
      if (theme && theme.cards && theme.cards[0]) { feat = theme.cards[0]; label = `今週のお題：${theme.title}`; remember(theme.cards); }
      else if (tr.cards[0]) { feat = tr.cards[0]; label = "急上昇 1位"; }
      else if (wk.cards[0]) { feat = wk.cards[0]; label = "今週もっとも「見たい！」が集まったカード"; }
      else if (nw.cards[0]) { feat = nw.cards[0]; label = "新着カード"; }
      const box = $("#fbFeatured");
      if (box) box.innerHTML = feat ? `<div class="sec-head"><h2>Pick Up<small>いま参加してほしいカード</small></h2></div>${cardHtml(feat, { big: true, label, src: "home_featured" })}`
        : `<div class="fb-empty"><b>まだカードがありません</b><p>最初のカードを作ってみませんか？ 選手を2人選ぶだけで作れます。</p><a class="btn primary" href="#/create">＋ 見たい対戦を作る</a>${exampleCard()}</div>`;
      if (!home.tab) home.tab = tr.cards.length ? "trending" : "new";
      $$("#fbHomeTab .tab").forEach(b => { const on = b.dataset.tab === home.tab; b.setAttribute("aria-selected", on); b.setAttribute("aria-pressed", on); });
      const th = $("#fbTheme");
      if (th && theme) { th.hidden = false; th.innerHTML = `<div class="sec-head"><h2>Weekly Theme<small>今週のお題（編集部）</small></h2></div><div class="fb-theme"><b>${esc(theme.title)}</b>${theme.body ? `<p>${esc(theme.body)}</p>` : ""}<small>${hhmm(theme.starts_at)} 〜 ${hhmm(theme.ends_at)}</small><a class="btn small" href="#/create" data-src="theme">このお題でカードを作る</a></div>${grid(theme.cards.slice(1, 4), { src: "theme" })}`; }
      await loadHomeList();
    } catch (e) { const box = $("#fbFeatured"); if (box) box.innerHTML = failBox(e, "home"); }
  }
  async function loadHomeList() {
    const box = $("#fbHomeList"); if (!box) return;
    box.innerHTML = loading();
    try {
      const r = await rpc("list_cards", { tab: home.tab || "new", rule_f: home.rule || null, lim: 6 });
      remember(r.cards);
      let html = grid(r.cards, c => ({ src: "home_" + r.tab, period: periodText(r.tab, c) }));
      if (!html) html = `<p class="note">${EMPTY_TAB[r.tab]}</p>`;
      // 人気だけで埋もれないよう、反応がまだ少ない新着を1枚添える
      if (r.tab !== "new") {
        const f = await rpc("list_cards", { tab: "new", rule_f: home.rule || null, lim: 8 });
        const shown = new Set(r.cards.map(c => c.id)), fresh = f.cards.find(c => !shown.has(c.id) && c.want < 3);
        if (fresh) { remember([fresh]); html += `<div class="fb-fresh"><div class="fb-fresh-h">まだ反応が少ない新着</div>${cardHtml(fresh, { src: "home_fresh" })}</div>`; }
      }
      box.innerHTML = html + `<p class="fb-asof">${TABS.find(t => t.id === r.tab).t}・${hhmm(r.as_of)} 時点</p>`;
    } catch (e) { box.innerHTML = failBox(e, "homelist"); }
  }
  // カードが1枚も無いときの作成例（投票できない見本であることを明示）
  function exampleCard() {
    const fw = S.ranked.filter(p => p.active && p.division === "フェザー級");
    if (fw.length < 2) return "";
    return `<div class="fb-example"><div class="fb-example-h">作成例（見本です。投票はできません）</div>${cardHtml({ id: "example", fa: fw[0].key, fb: fw[1].key, rule: "mma", cond: "standard", origin: "fan", want: 0, fun: 0, comments: 0 }, { preview: true, src: "example" }).replace('href="#/c/example"', `href="#/create/${encodeURIComponent(fw[0].key)}/${encodeURIComponent(fw[1].key)}"`)}</div>`;
  }

  /* ---------- 一覧 ---------- */
  const list = { tab: "trending", rule: "", off: 0, items: [] };
  function viewCards() {
    return H.pageHero("Fan Cards", "ファンが「見たい！」と声を上げた対戦カード。実際の対戦を決めるものではありません。") + `
    <div class="wrap">
      ${ENABLED ? `<section class="section">
        <div class="fb-tools">${tabBar("fbListTab", list.tab)}${ruleSelect("fbListRule", list.rule)}<a class="btn primary small" href="#/create">＋ カードを作る</a></div>
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
      box.innerHTML = (grid(list.items, c => ({ src: "list_" + list.tab, period: periodText(list.tab, c) })) || `<div class="fb-empty"><p>${EMPTY_TAB[list.tab]}</p><a class="btn primary" href="#/create">＋ 見たい対戦を作る</a></div>`)
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
      if (!c) { box.innerHTML = `<div class="fb-empty"><b>カードが見つかりません</b><p>URLが間違っているか、削除された可能性があります。</p><a class="btn" href="#/cards">カード一覧へ</a></div>`; setMeta(null); return; }
      if (c.status !== "public" && !(who && who.admin)) { box.innerHTML = `<div class="fb-empty"><b>このカードは非公開になりました</b><p>運営の判断により非公開になっています。</p><a class="btn" href="#/cards">カード一覧へ</a></div>`; setMeta(null, true); return; }
      if (!valid(c.fa) || !valid(c.fb)) { box.innerHTML = `<div class="fb-empty"><b>選手データを確認中のカードです</b></div>`; return; }
      det.card = c; cache[c.id] = c;
      box.innerHTML = detailHtml(c);
      setMeta(c);
      const ref = new URLSearchParams(location.search).get("ref");
      track("card_view", c.id, { src: navSrc || (ref ? "share" : "direct"), logged_in: loggedIn() }, `cv:${anon}:${c.id}:${today()}`);
      if (ref === "x_share" && !ss.get("sl:" + c.id)) { ss.set("sl:" + c.id, "1"); track("share_landing", c.id, {}, `sl:${anon}:${c.id}`); }
      navSrc = null;
      loadComments(); loadRelated(c);
      if (det.focus === "comments") setTimeout(() => { const el = $("#comments"); if (el) el.scrollIntoView(); }, 60);
      if (ss.get("fb_new") === c.id) { ss.set("fb_new", ""); const sp = $("#fbShareWrap"); if (sp) { sp.innerHTML = sharePanel(c); sp.hidden = false; } }
    } catch (e) { box.innerHTML = failBox(e, "card"); }
  }
  function detailHtml(c) {
    const a = c.fa, b = c.fb, met = H.meetings(a, b), me = c.me || {};
    const hidden = c.status !== "public" ? `<div class="fb-warn">非公開中（管理者のみ表示）</div>` : "";
    return `${hidden}
    <nav class="crumb"><a href="#/cards">ファンの見たい対戦</a> › <span>${nm(a)} vs ${nm(b)}</span></nav>
    <section class="fb-board" data-card="${esc(c.id)}">
      <div class="fb-board-meta"><span class="fc-rule">${esc(ruleLbl(c))}</span><span class="fc-status">${statusLbl(c)}</span>${met.length ? `<span class="fc-re">再戦希望（実際の対戦 ${met.length}回）</span>` : '<span class="fc-re">初対戦</span>'}</div>
      <h1 class="fb-title"><a href="#/fighter/${encodeURIComponent(a)}" class="red">${av(a, "l")}<span>${nm(a)}</span></a><span class="vs" aria-label="対">VS</span><a href="#/fighter/${encodeURIComponent(b)}" class="blue"><span>${nm(b)}</span>${av(b, "l")}</a></h1>
      ${c.reason ? `<blockquote class="fb-reason"><p>${esc(c.reason.body)}</p><cite>${c.creator ? `${c.creator.avatar ? `<img src="${esc(c.creator.avatar)}" alt="" width="20" height="20" referrerpolicy="no-referrer">` : ""}${esc(c.creator.name)}` : "退会したユーザー"} さんの提案理由</cite></blockquote>`
        : `<p class="fb-reason none">${c.creator ? `${esc(c.creator.name)} さん` : c.origin === "editorial" ? "編集部" : "退会したユーザー"}の提案です。</p>`}
      ${actions(c)}
      <div class="fc-next" hidden></div>
      <div class="fb-tools2">
        <button class="btn small" id="fbSave" data-id="${esc(c.id)}" aria-pressed="${!!me.saved}">${me.saved ? "✓ 保存済み" : "保存"}</button>
        <button class="btn small" id="fbShareBtn" aria-expanded="false" aria-controls="fbShareWrap">Xで共有</button>
        <button class="btn small" id="fbCopy" data-url="${esc(cardUrl(c.id))}">URLをコピー</button>
        <button class="btn small ghost" data-report="card" data-target="${esc(c.id)}">通報</button>
        ${who && who.admin ? `<button class="btn small ghost" data-admin-hide="card" data-target="${esc(c.id)}" data-hidden="${c.status === "public"}">${c.status === "public" ? "非公開にする" : "公開に戻す"}</button>` : ""}
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
      <div class="sec-head"><h2>Tale of the Tape<small>データ比較（RIZIN・確認済みの記録）</small></h2><a href="#/matchups/${encodeURIComponent(a)}~${encodeURIComponent(b)}">詳しい比較 ›</a></div>
      <div class="cmp">${H.compareRows(a, b)}</div>
      ${met.length ? `<h3 class="fb-h3">実際の対戦記録</h3><div class="tbl-wrap"><table class="tbl"><thead><tr><th>日付</th><th>勝者</th><th>決着</th><th>大会</th></tr></thead><tbody>${met.map(f => `<tr><td class="num">${H.fmtDate(f.date)}</td><td class="opp">${f.outcome === "W" ? H.link(f.winner) : (f.outcome === "D" ? "引き分け" : "無効試合")}</td><td>${esc(H.METHOD_JA[f.cat] || "")}${f.round ? `<span class="ev">　${esc(f.round)}R ${esc(f.time)}</span>` : ""}</td><td class="ev">${esc(f.event)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="note">RIZINでの対戦記録はありません。</p>`}
    </section>`;
  }
  function composer(parent) {
    const id = parent ? `r${parent}` : "main";
    const draft = ls.get(`fb_draft_cm_${det.id}_${id}`, "");
    return `<form class="fb-comp" data-parent="${parent || ""}" data-cid="${id}">
      ${parent ? "" : `<div class="fb-hints" role="group" aria-label="書き出しのヒント（任意）">${HINTS.map(h => `<button type="button" class="fbchip" data-hint="${h.k}" aria-pressed="false">${h.t}</button>`).join("")}</div>`}
      <label class="sr" for="cm_${id}">${parent ? "返信を書く" : "コメントを書く"}</label>
      <textarea id="cm_${id}" rows="${parent ? 2 : 3}" maxlength="300" placeholder="${parent ? "返信を書く（300字まで）" : "一言でもOK。あなたの意見を書いてください（300字まで）"}">${esc(draft)}</textarea>
      <div class="fb-comp-foot"><span class="fb-count" aria-live="polite">${draft.length}/300</span>
        ${parent ? `<button type="button" class="btn small ghost" data-cancel-reply>やめる</button>` : ""}
        <button class="btn primary small" type="submit">${loggedIn() ? (parent ? "返信する" : "投稿する") : "ログインして投稿"}</button></div>
      <p class="fb-rules">「見たくない」「この条件では難しい」などの反対意見も歓迎です。選手や他のファンへの侮辱・差別は削除します。</p>
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
    const body = dead ? `<p class="fb-dead">${m.status === "hidden" ? "このコメントは運営により非表示になりました" : "このコメントは削除されました"}</p>${who && who.admin && m.body ? `<p class="fb-admin-body">${esc(m.body)}</p>` : ""}`
      : `<p class="fb-body" id="body_${m.id}">${esc(m.body)}</p>`;
    const head = dead ? "" : `<div class="fb-cm-h">${m.user && m.user.avatar ? `<img src="${esc(m.user.avatar)}" alt="" width="24" height="24" referrerpolicy="no-referrer" loading="lazy">` : '<span class="fb-noav" aria-hidden="true"></span>'}<b>${esc(m.user ? m.user.name : "退会したユーザー")}</b>${m.reason ? '<span class="fbtag">提案理由</span>' : ""}${m.hint ? `<span class="fbtag soft">${esc(HINT_T[m.hint] || "")}</span>` : ""}<time datetime="${esc(m.created_at)}">${ago(m.created_at)}</time>${m.edited_at ? '<span class="edited">（編集済み）</span>' : ""}</div>`;
    const tools = dead ? (who && who.admin && m.status === "hidden" ? `<div class="fb-cm-tools"><button class="fblink" data-admin-hide="comment" data-target="${m.id}" data-hidden="false">表示に戻す</button></div>` : "")
      : `<div class="fb-cm-tools">${isReply ? "" : `<button class="fblink" data-reply="${m.id}">返信</button>`}${m.mine ? `<button class="fblink" data-edit="${m.id}">編集</button><button class="fblink" data-del="${m.id}">削除</button>` : `<button class="fblink" data-report="comment" data-target="${m.id}">通報</button>`}${who && who.admin ? `<button class="fblink" data-admin-hide="comment" data-target="${m.id}" data-hidden="true">非表示</button>` : ""}</div>`;
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
        + (sugg.length ? `<div class="fb-sugg"><div class="fb-fresh-h">別の相手で考える（同じ階級でレートが近い現役選手）</div><div class="fb-sugg-row">${sugg.map(([x, y]) => `<a class="fbchip" href="#/create/${encodeURIComponent(x)}/${encodeURIComponent(y)}" data-src="suggest">${nm(x)} vs ${nm(y)}</a>`).join("")}</div></div>` : "");
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
        : `<a class="fbchip" href="#/c/${encodeURIComponent(c.id)}/comments" data-src="after_vote">理由を一言書く</a><a class="fbchip" href="#/c/${encodeURIComponent(c.id)}" data-src="after_vote">みんなの意見を見る</a>`}
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
          <button class="btn primary big" type="submit" id="fbPublish" ${canPublish() ? "" : "disabled"}>${loggedIn() || !ENABLED ? "公開する" : "ログインして公開する"}</button>
          <p class="note">公開すると誰でも見られます。ファンの提案であり、実際の対戦を決めるものではありません。入力内容はこの端末に下書きとして残ります。</p>
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
      reason: cr.reason.trim() ? { body: cr.reason.trim() } : null, creator: who ? { name: who.name } : { name: "あなた" } }, { preview: true }).replace(/href="#\/c\/preview"/, 'href="javascript:void(0)" tabindex="-1"');
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
    const b = $("#fbPublish"); if (b) { b.disabled = !canPublish(); b.textContent = cr.busy ? "公開中…" : (loggedIn() || !ENABLED ? "公開する" : "ログインして公開する"); }
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
      <button class="btn primary" type="submit">${loggedIn() ? "送信する" : "ログインして送信"}</button></form>`;
    dlg.showModal();
  }
  async function publish() {
    if (!canPublish()) return;
    if (!loggedIn()) { saveDraft(); login({ type: "create" }); return; }
    cr.busy = true; refreshCreate("text");
    try {
      const c = await rpc("create_card", { a: cr.a, b: cr.b, rule: cr.rule, cond: cr.cond, reason: cr.reason.trim() || null, hint: cr.reason.trim() ? cr.hint : null, editorial: false });
      cr.busy = false;
      track("card_publish", c.id, { existed: !!c.existed, with_reason: !!cr.reason.trim() });
      ls.del(DRAFT); Object.assign(cr, { a: null, b: null, rule: "mma", cond: "standard", reason: "", hint: null, dup: null });
      if (c.existed) toast("同じカードがすでにあったので、そちらに案内しました。");
      else { toast("公開しました！"); ss.set("fb_new", c.id); }
      navSrc = c.existed ? "dup" : "created";
      location.hash = `#/c/${encodeURIComponent(c.id)}`;
    } catch (e) { cr.busy = false; refreshCreate("text"); toast(esc(e.message)); if (e.code === "LOGIN_REQUIRED") login({ type: "create" }); }
  }

  /* ---------- マイページ ---------- */
  const mp = { tab: "notice" };
  function viewMe(tab) {
    if (tab) mp.tab = tab;
    if (!ENABLED) return H.pageHero("My Page", "") + `<div class="wrap"><section class="section">${offBox()}</section></div>`;
    return H.pageHero("My Page", "あなたが作ったカード・参加したカード・届いた反応") + `<div class="wrap" id="fbMe">${loading()}</div>`;
  }
  async function loadMe() {
    const box = $("#fbMe"); if (!box) return;
    await ready(); paintMe();
    if (!loggedIn()) {
      box.innerHTML = `<div class="fb-login"><b>ログインすると、作ったカードや返信を確認できます</b>
        <p>閲覧はログインなしでできます。カードの作成・「見たい！」・コメント・保存のときにログインが必要です。</p>
        <a class="btn primary big" href="#/login" data-login>ログイン</a> <a class="btn big" href="#/login/signup">新規登録</a></div>`;
      return;
    }
    try {
      const [d, n] = await Promise.all([rpc("my_page"), rpc("my_notifications", { lim: 30 })]);
      remember(d.created); remember(d.joined); remember(d.saved);
      const unread = n.items.filter(i => i.unread).length;
      const T = [["notice", `お知らせ${unread ? `（${unread}）` : ""}`], ["created", `作った（${d.created.length}）`], ["joined", `参加した（${d.joined.length}）`], ["saved", `保存（${d.saved.length}）`]];
      const body = mp.tab === "notice" ? noticeHtml(n.items) : grid(d[mp.tab].map(c => c.status === "public" ? c : { ...c, _hidden: true }), c => ({ src: "me_" + mp.tab, label: c._hidden ? "非公開になりました" : "" })) || `<p class="note">${{ created: "まだカードを作っていません。", joined: "まだ参加したカードはありません。", saved: "保存したカードはありません。" }[mp.tab]}</p>`;
      box.innerHTML = `<div class="fb-me-head">${d.profile.avatar ? `<img src="${esc(d.profile.avatar)}" alt="" width="48" height="48" referrerpolicy="no-referrer">` : ""}<div><b>${esc(d.profile.name)}</b>${d.profile.username ? `<small>@${esc(d.profile.username)}</small>` : ""}</div>
          <div class="fb-me-acts">${d.profile.admin ? '<a class="btn small" href="#/admin">通報の確認</a>' : ""}<button class="btn small ghost" data-logout>ログアウト</button></div></div>
        <details class="fb-def fb-acct"><summary>アカウント設定</summary>
          <form id="fbNameForm" class="fb-name-form"><label>表示名（公開）<input id="fbNameIn" maxlength="30" value="${esc(d.profile.name)}" required></label><button class="btn small primary" type="submit">変更</button></form>
          <p class="note"><a href="#/reset">パスワードを変更する</a>・メールアドレスは他の人には表示されません。</p></details>
        <div class="tabs" id="fbMeTabs">${T.map(([k, t]) => `<a class="tab" href="#/me/${k}" aria-pressed="${k === mp.tab}">${t}</a>`).join("")}</div>
        <div class="fb-me-body">${body}</div>`;
      if (mp.tab === "notice" && unread) { rpc("mark_notifications_seen").then(paintMe).catch(() => {}); track("notif_open", null, { unread }); }
    } catch (e) { box.innerHTML = failBox(e, "me"); }
  }
  function noticeHtml(items) {
    if (!items.length) return `<p class="note">まだお知らせはありません。あなたのコメントへの返信や、作ったカードへの反応がここに届きます。</p>`;
    const line = i => {
      const c = cache[i.card_id]; const pair = c && valid(c.fa) ? `${nm(c.fa)} vs ${nm(c.fb)}` : "カード";
      const txt = i.type === "reply" ? `<b>${esc(i.who || "退会したユーザー")}</b> さんがあなたのコメントに返信しました：「${esc(i.body)}」`
        : i.type === "comment_on_my_card" ? `<b>${esc(i.who || "退会したユーザー")}</b> さんがあなたのカードにコメントしました：「${esc(i.body)}」`
        : `あなたのカードに、この30日間で${i.n}人が「見たい！」を送りました`;
      return `<li class="${i.unread ? "unread" : ""}"><a href="#/c/${encodeURIComponent(i.card_id)}${i.type === "wants_on_my_card" ? "" : "/comments"}" data-src="notice">${i.unread ? '<span class="fbtag">未読</span>' : ""}${txt}<small>${pair}・${ago(i.at)}</small></a></li>`;
    };
    return `<ul class="fb-notice">${items.map(line).join("")}</ul>`;
  }

  /* ---------- 管理（通報の確認） ---------- */
  function viewAdmin() { return H.pageHero("Admin", "通報の確認（管理者のみ）") + `<div class="wrap" id="fbAdmin">${ENABLED ? loading() : offBox()}</div>`; }
  async function loadAdmin() {
    const box = $("#fbAdmin"); if (!box || !ENABLED) return;
    await ready(); paintMe();
    if (!who || !who.admin) { box.innerHTML = `<p class="note">このページは管理者だけが使えます。</p>`; return; }
    try {
      const r = await rpc("admin_reports");
      const RS = { abuse: "侮辱・差別", spam: "宣伝・連投", wrong: "誤情報", other: "その他" };
      box.innerHTML = r.length ? `<table class="tbl"><thead><tr><th>対象</th><th>内容</th><th>理由</th><th>件数</th><th></th></tr></thead><tbody>${r.map(x => `<tr>
        <td>${x.target_type === "card" ? "カード" : "コメント"}</td><td><a href="#/c/${encodeURIComponent(x.card_id || "")}">${esc(x.preview || "（削除済み）")}</a></td>
        <td>${(x.reasons || []).map(k => RS[k] || k).join("・")}</td><td class="num">${x.n}</td>
        <td><button class="btn small" data-admin-hide="${x.target_type}" data-target="${esc(x.target_id)}" data-hidden="true">非表示</button> <button class="btn small ghost" data-dismiss="${x.target_type}" data-target="${esc(x.target_id)}">対応不要</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="note">未対応の通報はありません。</p>`;
    } catch (e) { box.innerHTML = failBox(e, "admin"); }
  }

  /* ---------- 選手ページの「次に見たい相手」 ---------- */
  function fighterPanel(k) {
    if (!ENABLED) return "";
    return `<section class="section fb-fighter" id="fbFighter" data-key="${esc(k)}">
      <div class="sec-head"><h2>Next Opponent<small>${nm(k)}の次に見たい相手（ファンの声）</small></h2><a class="btn primary small" href="#/create/${encodeURIComponent(k)}" data-src="fighter_cta">＋ 次の相手を提案する</a></div>
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
      if (!tot.cards.length && !fresh.length) { box.innerHTML = `<div class="fb-empty"><p>まだ${nm(k)}の対戦提案はありません。最初の1枚を作ってみませんか？</p><a class="btn primary" href="#/create/${encodeURIComponent(k)}" data-src="fighter_empty">＋ 次の相手を提案する</a></div>`; return; }
      const opp = c => c.fa === k ? c.fb : c.fa;
      box.innerHTML = (tot.cards.length ? `<ol class="fb-opp">${tot.cards.map((c, i) => `<li><span class="rk">${i + 1}</span><a href="#/c/${encodeURIComponent(c.id)}" data-src="fighter_rank">${av(opp(c))}<b>${nm(opp(c))}</b><small>${esc(ruleLbl(c))}</small></a><span class="n">見たい ${c.want}人</span></li>`).join("")}</ol><p class="fb-asof">現在有効な「見たい！」の数・${hhmm(tot.as_of)} 時点</p>` : "")
        + (fresh.length ? `<div class="fb-fresh-h">新しい提案</div>${grid(fresh, { src: "fighter_new" })}` : "");
    } catch (e) { box.innerHTML = failBox(e); }
  }

  /* ---------- 操作 ---------- */
  const busy = new Set();
  async function react(btn) {
    const id = btn.dataset.id, kind = btn.dataset.act, on = btn.getAttribute("aria-pressed") !== "true";
    if (!ENABLED) return;
    if (!loggedIn()) { login({ type: kind, card: id }); return; }
    if (busy.has(id + kind)) return;
    busy.add(id + kind);
    // 先に見た目を変え、結果で上書きする
    const n = btn.querySelector("b"), before = +n.textContent;
    btn.setAttribute("aria-pressed", on); n.textContent = before + (on ? 1 : -1);
    try {
      const c = await rpc("set_reaction", { cid: id, kind, on });
      cache[id] = c; paintCounts(c);
      const where = btn.closest(".fb-board") ? "detail" : "list";
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
    if (!loggedIn()) { ls.set(key, ta.value); login({ type: "comment", card: det.id }); return; }
    const b = form.querySelector('[type="submit"]'); if (b.disabled) return;
    b.disabled = true; b.textContent = "送信中…";
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
    if (!loggedIn()) { login({ type: "report", card: det.id }); return; }
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

  function click(e) {
    const t = e.target;
    const a = t.closest("a[data-src]"); if (a) { navSrc = a.dataset.src; if (a.dataset.why) track("related_click", det.id, { why: a.dataset.why, to: (a.closest("[data-card]") || {}).dataset && a.closest("[data-card]").dataset.card }); }
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
    if (ah) { rpc("admin_set_hidden", { target_type: ah.dataset.adminHide, target_id: String(ah.dataset.target), hidden: ah.dataset.hidden === "true" }).then(() => { toast("更新しました"); H.rerender(); }).catch(err => toast(esc(err.message))); return true; }
    const dm = t.closest("[data-dismiss]"); if (dm) { rpc("admin_dismiss", { target_type: dm.dataset.dismiss, target_id: String(dm.dataset.target) }).then(loadAdmin).catch(err => toast(esc(err.message))); return true; }
    const sv = t.closest("#fbSave");
    if (sv) {
      const id = sv.dataset.id, on = sv.getAttribute("aria-pressed") !== "true";
      if (!loggedIn()) { login({ type: "save", card: id }); return true; }
      rpc("set_save", { cid: id, on }).then(() => { sv.setAttribute("aria-pressed", on); sv.textContent = on ? "✓ 保存済み" : "保存"; toast(on ? "保存しました（マイページで見られます）" : "保存を外しました"); if (on) track("save", id, {}); }).catch(err => toast(esc(err.message)));
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
    const f = e.target;
    if (f.id === "fbAuth") { e.preventDefault(); submitAuth(f); return true; }
    if (f.id === "fbReset") { e.preventDefault(); submitReset(f); return true; }
    if (f.id === "fbNameForm") {
      e.preventDefault();
      rpc("set_display_name", { name: $("#fbNameIn").value }).then(async () => { who = await rpc("whoami"); toast("表示名を変更しました"); H.rerender(); }).catch(err => toast(esc(err.message)));
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
      if (!loggedIn()) { saveDraft(); login({ type: "request" }); return true; }
      rpc("request_fighter", { name: $("#fbReqName").value, note: $("#fbReqNote").value || null })
        .then(() => { $("#fbReq").close(); toast("リクエストを受け付けました。運営が確認します。"); }).catch(err => toast(esc(err.message)));
      return true;
    }
    return false;
  }
  function input(e) {
    const t = e.target;
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
    else if (page === "login") { ready().then(() => { paintMe(); if (loggedIn() && parts[1] !== "forgot") loadMe(); else { const i = $("#fbName") || $("#fbEmail"); if (i && matchMedia("(min-width:561px)").matches) i.focus(); } }); }
    else if (page === "reset") { ready().then(() => { paintMe(); if (loggedIn() && !$("#fbReset")) H.rerender(); }); }
    else if (page === "fighter") loadFighter(parts[1]);
    else ready().then(paintMe);
  }

  // 接続前は、メニューの「見たい対戦」をこれまでのデータ比較ページへ
  if (!ENABLED) $$('a[href="#/cards"]').forEach(a => { a.href = "#/matchups"; if (a.dataset.r) a.dataset.r = "matchups"; });
  if (!ENABLED) $$('.site-foot a[href="#/me"]').forEach(a => a.remove());

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
      if (page === "login") return loggedIn() && parts[1] !== "forgot" ? viewMe() : viewLogin(parts[1]);
      if (page === "reset") return viewReset();
      return null;
    },
    title(page) { return { cards: "ファンの見たい対戦", create: "見たい対戦を作る", me: "マイページ", admin: "通報の確認", login: "ログイン", reset: "パスワードの再設定" }[page]; },
  };
};
