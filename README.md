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
