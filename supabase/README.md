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

### 3. ログイン（メールアドレス＋パスワード）の設定
左メニュー **Authentication** を開いて、次のように設定します。

- **Sign In / Providers → Email**
  - Enable Email provider：ON
  - Confirm email：ON（推奨）
  - Minimum password length：`8`
- **URL Configuration**
  - Site URL：`https://fight-book-jp.github.io`
  - Redirect URLs：`https://fight-book-jp.github.io/**` を追加
- **Attack Protection**：「Prevent use of leaked passwords」が選べれば ON

### 4. メール送信（確認メール・パスワード再設定）
Supabase の標準のメール送信は、**プロジェクトのメンバー宛てにしか届かず、1時間に2通まで**です。一般のファンに確認メールを届けるには、外部の無料メール送信サービスの接続が必要です。

おすすめは **Brevo（無料：1日300通まで）** です。
1. https://www.brevo.com で無料登録
2. 送信者（Senders）に、送信元にするメールアドレスを登録して確認する
3. 「SMTP & API」で SMTP キーを作成する
4. Supabase の **Authentication → Emails → SMTP Settings** で Enable Custom SMTP を ON にし、次を入力する
   - Host：`smtp-relay.brevo.com`
   - Port：`587`
   - Username：Brevo の SMTP 画面に表示されるログイン名
   - Password：作成した SMTP キー
   - Sender email：手順2で確認したアドレス
   - Sender name：`FIGHT BOOK`

> メール送信を設定しない場合、選択肢は「Confirm email を OFF にする（確認なしで登録できる。ただし実在しないアドレスでも登録でき、パスワード再設定のメールも届かない）」だけになります。

**メール文面（日本語）**：Authentication → Emails → Templates で次のように変更します。

- Confirm signup（件名：`【FIGHT BOOK】メールアドレスの確認`）

  ```html
  <p>FIGHT BOOK にご登録ありがとうございます。</p>
  <p>下のリンクを、登録したのと同じ端末・ブラウザで開くと登録が完了します。</p>
  <p><a href="{{ .ConfirmationURL }}">メールアドレスを確認する</a></p>
  <p>心当たりがない場合は、このメールを破棄してください。</p>
  ```

- Reset Password（件名：`【FIGHT BOOK】パスワードの再設定`）

  ```html
  <p>パスワード再設定のリクエストを受け付けました。</p>
  <p>下のリンクを、再設定を申し込んだのと同じ端末・ブラウザで開いてください。</p>
  <p><a href="{{ .ConfirmationURL }}">新しいパスワードを設定する</a></p>
  <p>心当たりがない場合は、このメールを破棄してください。</p>
  ```

### 5. 接続先を教えてください
**Project Settings → API Keys**（または Data API）で、次の2つをチャットに貼ってください。私が `js/community-config.js` に設定して公開します。
- Project URL（`https://xxxx.supabase.co`）
- **anon / public** キー（`eyJ…` または `sb_publishable_…`）

> **service_role / secret キーは絶対に貼らないでください。** これは管理者用の鍵で、公開すると誰でも全データを書き換えられます。

### 6. 自分を管理者にする（公開後）
サイトで普通に新規登録したあと、SQL Editor で次を実行します（メールアドレスは自分のものに変更）。
```sql
update public.profiles set is_admin = true
 where id = (select id from auth.users where email = 'あなたのメールアドレス');
```
管理者になると、カードやコメントに「非公開にする」ボタンが出て、マイページから通報の一覧を確認できます。

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
