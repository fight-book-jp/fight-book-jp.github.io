# FIGHT BOOK（RIZIN選手データベース）

公開URL: https://fishboy88.github.io/fight-book/

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
