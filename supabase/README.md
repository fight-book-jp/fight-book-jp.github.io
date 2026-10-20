# ファン参加機能（見たい対戦カード）の設定手順

投票・コメント・ログインのデータは **Supabase（無料プラン）** に保存します。
サイト本体は今までどおり GitHub Pages のままで、URL も変わりません。

`js/community-config.js` の `url` と `anonKey` が空のあいだは、ファン参加機能の画面は出ません（これまでのサイトのまま）。

---

## こやさんの作業（約30分）

### 1. Supabase のプロジェクトを作る
1. https://supabase.com で無料登録（GitHub アカウントで登録可）
2. 「New project」を押し、次のように入力して作成します。
   - 名前：`fight-book`
   - Region：`Northeast Asia (Tokyo)`
   - Database Password：自動生成のまま（メモ不要）

### 2. データベースを作る
1. 左メニュー **SQL Editor** → **New query**
2. このフォルダの `schema.sql` の中身をすべて貼り付け、**Run**
3. 「Success. No rows returned」と出れば完了です（何度実行しても壊れません）

### 3. 参加の設定（ログイン不要）
一般の参加者はメールアドレスもパスワードも不要で、ニックネームだけで投票・コメント・カード作成ができます。
ブラウザごとに見えない「匿名ユーザー」を自動で作り、1人1票や「自分の投稿だけ編集・削除できる」仕組みに使います。

左メニュー **Authentication → Sign In / Providers** で次をONにします。
- **Allow new users to sign up**：ON
- **Allow anonymous sign-ins**：ON

管理者だけは、メールアドレス＋パスワードでログインします（`https://fight-book-jp.github.io/#/admin`）。
そのため **Email** プロバイダーもONのままにしておきます。管理者アカウントは作成済みなので、メール送信（SMTP）の設定は不要です。

> 匿名ユーザーは、ブラウザのデータを消したり別の端末を使ったりすると別人扱いになります（以前の投稿は編集できなくなる）。
> いたずらの大量投稿は、1人あたりの投稿数制限と、Supabase の同じ IP からの作成数制限（初期値：1時間30件）で抑えます。目立つ場合は Authentication → Attack Protection で CAPTCHA（Cloudflare Turnstile・無料）を追加できます。

### 5. 接続先を教えてください
**Project Settings → API Keys**（または Data API）で、次の2つをチャットに貼ってください。私が `js/community-config.js` に設定して公開します。
- Project URL（`https://xxxx.supabase.co`）
- **anon / public** キー（`eyJ…` または `sb_publishable_…`）

> **service_role / secret キーは絶対に貼らないでください。** これは管理者用の鍵で、公開すると誰でも全データを書き換えられます。

### 6. 自分を管理者にする
管理者アカウント（メールアドレス＋パスワードで作成済みのもの）について、SQL Editor で次を実行します。
```sql
update public.profiles set is_admin = true
 where id = (select id from auth.users where email = 'あなたのメールアドレス');
```
管理者になると、`#/admin` からログインして、カードやコメントを削除（あとで取り消し可能）でき、通報の一覧も確認できます。

---

## 運営の作業

### 週替わりのお題を登録する（SQL Editor）
```sql
insert into public.themes (title, body, starts_at, ends_at, card_ids)
values ('次の挑戦者、誰を見たい？', 'フェザー級王者への挑戦者を提案してください。',
        '2026-10-26 00:00+09', '2026-11-02 00:00+09', '{}');
```
`card_ids` に編集部のカードの ID を入れると、ホームに一緒に並びます。編集部のカードはサイト上で作成後、
`update public.cards set origin = 'editorial' where id = 'カードID';` で「編集部提案」と表示されます。

### 選手追加リクエストを見る
```sql
select * from public.fighter_requests where status = 'open' order by created_at;
```
確認して選手データに追加したら `status` を `added`（見送りは `rejected`）に変更します。

### 指標を見る
`metrics.sql` を SQL Editor に貼り、見たいブロックを選んで実行します。

---

## 仕組み（開発者向け）
- `schema.sql`：テーブル・権限・関数。テーブルは直接読み書きできず、すべて関数（RPC）経由。権限はデータベース側で確認します。
- 共有ページ：`.github/workflows/community-pages.yml` が約10分ごとに公開データを読み、`/matchups/{id}/`（Open Graph・X カード付きの HTML と共有画像）と `sitemap.xml` を作ります。
- テスト：`PGDSN=postgresql://… python3 supabase/tests/test_schema.py`（GitHub Actions の Community check でも実行）
- 無料プランの注意：Supabase の無料プロジェクトは「1週間アクセスがないと一時停止」します。共有ページの自動更新が10分ごとにデータを読むため、通常は止まらない見込みですが、止まった場合はダッシュボードから再開できます。
