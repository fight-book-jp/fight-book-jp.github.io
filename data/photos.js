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
  "sho-sekihara": { src:"img/fighters/sho-sekihara.webp", face:"img/fighters/sho-sekihara-face.webp" },
  "daigo-kuramoto": { src:"img/fighters/daigo-kuramoto.webp", face:"img/fighters/daigo-kuramoto-face.webp" },
  "taichi-nakajima": { src:"img/fighters/taichi-nakajima.webp", face:"img/fighters/taichi-nakajima-face.webp" },
  "dautbek": { src:"img/fighters/dautbek.webp?v=2", face:"img/fighters/dautbek-face.webp?v=2" },
  "koike": { src:"img/fighters/koike.webp?v=2", face:"img/fighters/koike-face.webp?v=2" },
  "sabatello": { src:"img/fighters/sabatello.webp?v=2", face:"img/fighters/sabatello-face.webp?v=2" },
  "gustavo": { src:"img/fighters/gustavo.webp?v=2", face:"img/fighters/gustavo-face.webp?v=2" },
  "akimoto": { src:"img/fighters/akimoto.webp?v=2", face:"img/fighters/akimoto-face.webp?v=2" },
  "hiramoto": { src:"img/fighters/hiramoto.webp?v=2", face:"img/fighters/hiramoto-face.webp?v=2" },
  "kyoji-horiguchi": { src:"img/fighters/kyoji-horiguchi.webp?v=2", face:"img/fighters/kyoji-horiguchi-face.webp?v=2" },
  "suzuki": { src:"img/fighters/suzuki.webp?v=2", face:"img/fighters/suzuki-face.webp?v=2" },
};

/* 選手データ（RIZINの試合記録）がまだない選手の画像。大会予想の対戦カードで、登録名が一致したときに使う */
window.PHOTOS_BY_NAME = {
  "千春": { src:"img/fighters/n-chiharu.webp", face:"img/fighters/n-chiharu-face.webp" },
  "相本宗輝": { src:"img/fighters/n-aimoto.webp", face:"img/fighters/n-aimoto-face.webp" },
  "溝口司": { src:"img/fighters/n-mizoguchi.webp", face:"img/fighters/n-mizoguchi-face.webp" },
  "力也": { src:"img/fighters/n-rikiya.webp", face:"img/fighters/n-rikiya-face.webp" },
  "木村琉音": { src:"img/fighters/n-kimura-rune.webp", face:"img/fighters/n-kimura-rune-face.webp" },
  "松本尚大": { src:"img/fighters/n-matsumoto-naohiro.webp", face:"img/fighters/n-matsumoto-naohiro-face.webp" },
  "濱田巧": { src:"img/fighters/n-hamada-takumi.webp", face:"img/fighters/n-hamada-takumi-face.webp" },
  "髙橋正親": { src:"img/fighters/n-takahashi-masachika.webp", face:"img/fighters/n-takahashi-masachika-face.webp" },
  "井上舜矢": { src:"img/fighters/n-inoue-shunya.webp", face:"img/fighters/n-inoue-shunya-face.webp" },
  "マイティ・saw": { src:"img/fighters/n-mighty-saw.webp", face:"img/fighters/n-mighty-saw-face.webp" },
  "アバイジャ・カレオ・メヘウラ": { src:"img/fighters/abijah-kaleo-meheula.webp", face:"img/fighters/abijah-kaleo-meheula-face.webp" },
};
