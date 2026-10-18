# FIGHT BOOK（RIZIN選手データベース）

公開URL: https://fight-book-jp.github.io/

## ファイル構成
- `index.html` … ページの枠組み
- `css/style.css` … デザイン
- `js/stats.js` … レーティング（Elo）・戦績・連勝・統計の計算
- `js/app.js` … 各ページの表示（トップ／ランキング／選手一覧／選手詳細／王者／大会一覧／統計）
- `data/fighters.js` … 名簿（プロフィール・SNS・Instagram投稿URLなど）
- `data/fights.js` … 試合データ（自動生成、直接編集しない）
- `data-src/events/*.txt` … RIZIN全大会のMMA試合結果（年ごと）
- `data-src/<key>.txt` … 注目選手のプロ全戦績（RIZIN外の試合を補う）
- `data/names-ja.js` … 英語名→日本語名の辞書
- `data/entrance.js` … 入場曲（選手key → 曲名・アーティスト・YouTube動画ID）
- `tools/build_fights.py` … `data-src` から `data/fights.js` を作るスクリプト

## 試合結果を追加するとき（新しい大会）
1. `data-src/events/2026.txt` に1試合1行で追加
   `大会名|YYYY-MM-DD|階級|国コード 勝者|国コード 敗者|W(またはD/NC)|決着方法|R|時間|メモ`
   （タイトル戦はメモに `Won the Rizin Featherweight Championship.` のように書く）
2. `python3 tools/build_fights.py` を実行
3. レーティング（RIZINの試合のみで計算）・連勝・統計はページを開いたときに自動で再計算されます

## 選手を追加するとき
1. `data/fighters.js` に1人分を追加（`key` を決める）
2. `tools/build_fights.py` の `ROSTER` に `"key":"英語名"` を追加
3. `data-src/<key>.txt` に戦績表を作成して、スクリプトを実行

## 入場曲を追加するとき
`data/entrance.js` に1行追加します（選手keyは選手ページURLの `#/fighter/` の後ろ）。
`"akimoto": [{ title:"曲名", artist:"アーティスト", yt:"YouTube動画ID" }],`

## SOCIAL UPDATES（YouTube 最新動画）

- 選手詳細の「SOCIAL UPDATES」に、登録済み YouTube チャンネルの最新動画を3件表示します。
- 取得は GitHub Actions（`.github/workflows/social.yml`）が **毎時17分** に実行し、結果を `data/social.json` に保存します。ブラウザから外部APIへは直接アクセスしません。
  - 頻度の変更：workflow の `cron` を編集（例 `"17,47 * * * *"` で30分ごと）。`tools/social/config.json` の `intervalMinutes` も合わせて変更。
- 取得方法：既定は YouTube 公式の新着フィード（RSS・キー不要・無料）。
  リポジトリの Settings → Secrets → Actions に `YOUTUBE_API_KEY`（Google Cloud の無料枠）を登録すると YouTube Data API v3 に切り替わり、非公開・年齢制限・埋め込み不可の動画を除外します。キーはコードに書かないでください。
- 失敗時は直前に正常取得した動画を表示し続け、エラーは `data/social-log.json`（直近50件）と Actions のログに残ります。
- X（旧Twitter）は公式APIが有料のため投稿取得は行わず、アカウントへのリンクのみ表示します。
- テスト：`node --test tools/social/fetch.test.mjs`

### 選手データの項目（`data/fighters.js`）

- `ringName`：詳細ヘッダー背景に大きく表示する名前（`data/profiles.js` のキャッチコピーが優先。どちらも無ければ英語名→日本語名）
- `sns.x / instagram / youtube / tiktok / site`：登録された項目だけアイコン表示（`site` は公式サイト）
- `youtubeChannelId`：`UC…` で始まるチャンネルID（任意。未指定なら `sns.youtube` のURLから判定）

### 追加プロフィール（`data/profiles.js`）

- `CATCHPHRASE`：選手キー → キャッチコピー（参考：data-mma.com/nickname）。選手詳細ヘッダーの背景に表示。
- `SNS_EXTRA`：選手キー → SNSリンク。名簿外の選手にも使え、`youtube` を入れると SOCIAL UPDATES の自動取得対象になります（本人の公式チャンネルのみ登録）。

## 週次データ更新（毎週月曜 5:00・日本時間）

`.github/workflows/weekly-update.yml` が外部データを確認し、変更があれば **Pull Request** を作ります。マージすると GitHub Pages に反映されます。
手動で実行するときは Actions → Weekly data update → Run workflow。

| 取得元 | 方法 | 使い道 |
|---|---|---|
| Wikipedia「YYYY in Rizin Fighting Federation」（今年・前年） | MediaWiki 公式API | 試合結果。既存に無い大会で曖昧な点が無いものだけ自動追加 |
| Wikidata | 公式API | プロフィール・SNS の**参考候補**（自動反映しない） |
| RIZIN公式 | 公開サイトマップの URL のみ（本文は取得しない） | 新着記事の手動確認リスト |
| Sherdog・Tapology・選手SNS | 使わない（利用規約・有料API） | — |

取得元ごとの利用条件は `tools/sync/sources.json` に記録しています。

- **自動で入るもの**：既存に無い大会の結果（選手名の照合がすべて確実なとき）→ `data-src/events/<年>.txt` に追記し、`tools/build_fights.py` で `data/fights.js` を再生成。
- **要確認リスト** `data-src/sync/review.json`：既存試合の訂正候補・空欄の補完候補・未登録の試合・選手名の照合が曖昧なもの・プロフィール/SNS候補。自動では反映しません。対応不要なものは ID を `data-src/sync/ignore.json` に追加。
- **承認済みデータの取り込み**
  - `data-src/sync/inbox/events.txt`：RIZIN公式などで確認した結果を大会ファイルと同じ形式で書くと、次回のバッチで重複チェックして取り込み。
  - `data-src/sync/inbox/sns.json`：本人確認済みの SNS を `verified: true` と根拠 `evidence` 付きで書くと `data/profiles.js` に反映。
- **変更履歴**：`data-src/sync/profile-sources.json`（Wikidata の値・情報源・初回確認日、変更履歴）。
- **安全策**：変更前後に `tools/sync/validate.py` で検証（二重登録・存在しない選手キー・日付形式・勝敗と決着方法の矛盾など）。失敗したら変更をすべて取り消し、PR は作りません。変更が無ければ PR を作らず、同じ内容の PR も重複して作りません。
- **レポート**：Actions の実行サマリー、PR 本文、artifact（`weekly-report-*`）。
- **Wikidata の照合**：同姓同名を避けるため、説明文が格闘家の候補が1件だけのときだけ採用。特定できない選手は `sources.json` の `wikidataPins` に `"key": "Q番号"` を書くと固定。

`.github/workflows/data-check.yml` は data-src を変更したときに検証・テストし、main では `data/fights.js` を再生成します。

テスト：`python3 -m unittest discover -s tools/sync/tests -v`（外部にはアクセスしません）
初回設定：Settings → Actions → General → Workflow permissions で「Allow GitHub Actions to create and approve pull requests」にチェック。

## 選手プロフィール画像（`data/photos.js`）

`"選手キー": { src:"img/fighters/xxx.webp", face:"img/fighters/xxx-face.webp" }` を書くと、その選手の画像がサイト全体（トップ・選手一覧・選手詳細・ランキング・大会結果・王者・統計・見たい対戦）に表示されます。
`src` は大きい画像（正方形 800px 程度）、`face` は丸いアイコン用の顔まわり（正方形 240px 程度）。登録の無い選手・読み込めない画像はシルエットになります。

## ジムデータベース（`#/gyms`・`#/gym/{id}`・`#/gyms/compare`）

- 所属情報：`tools/gyms/collect.py` が Wikipedia（日本語版・英語版）の選手記事の所属欄を公式APIで取得 → `data-src/gyms/wiki-affiliations.json`。記事本文に RIZIN の記述がある記事だけを使い、推測で所属を決めません。
- ジム台帳：`data-src/gyms/gyms.json`（表記ゆれ・旧名の統一、確認できた所在地・設立・代表と出典）。所属の手動修正は `data-src/gyms/overrides.json`。
- 生成：`python3 tools/gyms/build.py` → `data/gyms.js`（`GYMS`・`AFFIL`）。毎週の自動更新（weekly-update.yml）でも取り直します。
- 戦績：既存の試合データから集計。「現所属選手のRIZIN通算（参考値）」と「所属期間（年）が確認できた試合のみ」を区別して表示。
- Googleの評価・口コミ：Places API は有料で、取得結果の保存も規約上制限があるため取得せず、Googleマップへのリンクのみ表示。
- テスト：`python3 -m unittest discover -s tools/gyms -p 'test_*.py'`
