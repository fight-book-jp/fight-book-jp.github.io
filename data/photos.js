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
  "inoue": { src:"img/fighters/inoue.webp?v=2", face:"img/fighters/inoue-face.webp?v=2" },
  "yrysbek-tilenov": { src:"img/fighters/yrysbek-tilenov.webp", face:"img/fighters/yrysbek-tilenov-face.webp" },
  "ryuya-fukuda": { src:"img/fighters/ryuya-fukuda.webp", face:"img/fighters/ryuya-fukuda-face.webp" },
  "soo-chul-kim": { src:"img/fighters/soo-chul-kim.webp", face:"img/fighters/soo-chul-kim-face.webp" },
  "jinnosuke-kashimura": { src:"img/fighters/jinnosuke-kashimura.webp", face:"img/fighters/jinnosuke-kashimura-face.webp" },
  "shinobu-ota": { src:"img/fighters/shinobu-ota.webp", face:"img/fighters/shinobu-ota-face.webp" },
  "tony-laramie": { src:"img/fighters/tony-laramie.webp", face:"img/fighters/tony-laramie-face.webp" },
  "asakura": { src:"img/fighters/asakura.webp", face:"img/fighters/asakura-face.webp" },
  "li-kaiwen": { src:"img/fighters/li-kaiwen.webp", face:"img/fighters/li-kaiwen-face.webp" },
  "hiroaki-suzuki": { src:"img/fighters/hiroaki-suzuki.webp", face:"img/fighters/hiroaki-suzuki-face.webp" },
  "juntaro-ushiku": { src:"img/fighters/juntaro-ushiku.webp", face:"img/fighters/juntaro-ushiku-face.webp" },
  "nurkhan-zhumagazy": { src:"img/fighters/nurkhan-zhumagazy.webp", face:"img/fighters/nurkhan-zhumagazy-face.webp" },
  "tatsuya-saika": { src:"img/fighters/tatsuya-saika.webp", face:"img/fighters/tatsuya-saika-face.webp" },
  "shaydullaev": { src:"img/fighters/shaydullaev.webp", face:"img/fighters/shaydullaev-face.webp" },
  "motoya": { src:"img/fighters/motoya.webp", face:"img/fighters/motoya-face.webp" },
  "ougikubo": { src:"img/fighters/ougikubo.webp", face:"img/fighters/ougikubo-face.webp" },
  "abijah-kaleo-meheula": { src:"img/fighters/abijah-kaleo-meheula.webp", face:"img/fighters/abijah-kaleo-meheula-face.webp" },
  "goto": { src:"img/fighters/goto.webp", face:"img/fighters/goto-face.webp" },
  "kim-kyung-pyo": { src:"img/fighters/kim-kyung-pyo.webp", face:"img/fighters/kim-kyung-pyo-face.webp" },
};

/* 選手データ（RIZINの試合記録）がまだない選手の画像。大会予想の対戦カードで、登録名が一致したときに使う */
window.PHOTOS_BY_NAME = {
  "千春": { src:"img/fighters/n-chiharu.webp", face:"img/fighters/n-chiharu-face.webp" },
  "相本宗輝": { src:"img/fighters/n-aimoto.webp", face:"img/fighters/n-aimoto-face.webp" },
  "溝口司": { src:"img/fighters/n-mizoguchi.webp", face:"img/fighters/n-mizoguchi-face.webp" },
  "アバイジャ・カレオ・メヘウラ": { src:"img/fighters/abijah-kaleo-meheula.webp", face:"img/fighters/abijah-kaleo-meheula-face.webp" },
};
