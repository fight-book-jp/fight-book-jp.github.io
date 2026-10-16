# FIGHT BOOK（RIZIN選手データベース）

公開URL: https://fishboy88.github.io/fight-book/

## ファイル構成
- `index.html` … ページの枠組み
- `css/style.css` … デザイン
- `js/stats.js` … レーティング（Elo）・戦績・連勝・統計の計算
- `js/app.js` … 各ページの表示（トップ／ランキング／選手一覧／選手詳細／王者／大会一覧／統計）
- `data/fighters.js` … 名簿（プロフィール・SNS・Instagram投稿URLなど）
- `data/fights.js` … 試合データ（自動生成、直接編集しない）
- `data-src/<key>.txt` … 選手ごとの戦績表（試合データの元）
- `tools/build_fights.py` … `data-src` から `data/fights.js` を作るスクリプト

## 試合結果を追加するとき
1. `data-src/<選手key>.txt` の先頭に1行追加
   `Win|記録|対戦相手|決着方法|大会名|YYYY-MM-DD|R|時間|メモ`
2. `python3 tools/build_fights.py` を実行
3. レーティング・連勝・統計はページを開いたときに自動で再計算されます

## 選手を追加するとき
1. `data/fighters.js` に1人分を追加（`key` を決める）
2. `tools/build_fights.py` の `ROSTER` に `"key":"英語名"` を追加
3. `data-src/<key>.txt` に戦績表を作成して、スクリプトを実行
