/* =====================================================================
   RIZINの試合記録がまだない選手（初参戦など）の選手ページ用データ
   "選手キー（n-で始める）": { name:"公式発表の表記", next:{ 次の試合 } }
   ・国籍・出身地などは、確かな出典が確認できるまで書かない（推測で埋めない）
   ・RIZINの試合記録が入ったら、ここから外して NEWCOMERS_MOVED に「旧キー → 新キー」を書く（古いURLを転送する）
   画像は data/photos.js の PHOTOS_BY_NAME（登録名で一致）を使う
   ===================================================================== */
window.NEWCOMERS = {
  "n-donmai-kawabata": {"name": "ドンマイ川端", "next": {"event": "超RIZIN.6 師走の尾張名古屋下剋上祭り", "eventId": "rizin-2026-12-31", "date": "2026-12-31", "bout": "59.0kg契約", "weight": "59.0kg契約", "opp": "冨澤大智", "oppKey": "daichi-tomizawa"}}
};
// RIZIN.55（2026/11/8）で試合記録が入った選手
window.NEWCOMERS_MOVED = {
  "n-chiharu": "chiharu",
  "n-aimoto": "muneki-aimoto",
  "n-mizoguchi": "tsukasa-mizoguchi",
  "n-rikiya": "rikiya",
  "n-kimura-rune": "rune-kimura",
  "n-matsumoto-naohiro": "naohiro-matsumoto",
  "n-hamada-takumi": "takumi-hamada",
  "n-takahashi-masachika": "masachika-takahashi",
  "n-inoue-shunya": "shunya-inoue",
  "n-mighty-saw": "mighty-saw"
};
