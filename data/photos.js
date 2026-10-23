/* =====================================================================
   選手プロフィール画像（サイト全体で共通に使う）
   "選手キー": { src:"大きい画像", face:"顔まわりの正方形画像", pos:"大きい画像の表示位置" }
   ・選手キーは選手ページURLの #/fighter/ の後ろ
   ・src … 選手一覧のカード・選手詳細で使う（正方形 800px 程度の webp 推奨）
   ・face … ランキング・試合結果などの丸いアイコンで使う（正方形 240px 程度、顔が中央）
   ・pos  … src を枠に合わせて切り取るときの基準位置（省略時 "50% 20%" ＝上寄り）
   ・登録がない選手はシルエットを表示します（data/fighters.js の photo も使えます）
   ===================================================================== */
window.PHOTOS = {
  "shinryu": { src:"img/fighters/shinryu.webp?v=2", face:"img/fighters/shinryu-face.webp?v=2" },
  "inoue": { src:"img/fighters/inoue.webp", face:"img/fighters/inoue-face.webp" },
  "yrysbek-tilenov": { src:"img/fighters/yrysbek-tilenov.webp", face:"img/fighters/yrysbek-tilenov-face.webp" },
  "ryuya-fukuda": { src:"img/fighters/ryuya-fukuda.webp", face:"img/fighters/ryuya-fukuda-face.webp" },
  "soo-chul-kim": { src:"img/fighters/soo-chul-kim.webp", face:"img/fighters/soo-chul-kim-face.webp" },
  "jinnosuke-kashimura": { src:"img/fighters/jinnosuke-kashimura.webp", face:"img/fighters/jinnosuke-kashimura-face.webp" },
  "shinobu-ota": { src:"img/fighters/shinobu-ota.webp", face:"img/fighters/shinobu-ota-face.webp" },
  "tony-laramie": { src:"img/fighters/tony-laramie.webp", face:"img/fighters/tony-laramie-face.webp" },
};
