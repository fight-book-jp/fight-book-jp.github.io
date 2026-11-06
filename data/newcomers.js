/* =====================================================================
   RIZINの試合記録がまだない選手（初参戦など）の選手ページ用データ
   "選手キー（n-で始める）": { name:"公式発表の表記", next:{ 次の試合 } }
   ・国籍・出身地などは、確かな出典が確認できるまで書かない（推測で埋めない）
   ・RIZINの試合記録が入ったら、ここから外して通常の選手データに移す
   画像は data/photos.js の PHOTOS_BY_NAME（登録名で一致）を使う
   ===================================================================== */
window.NEWCOMERS = {
  "n-inoue-shunya": {"name": "井上舜矢", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第1試合（オープニングファイト）", "weight": "61.0kg", "opp": "マイティ・saw", "oppKey": "n-mighty-saw"}},
  "n-mighty-saw": {"name": "マイティ・saw", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第1試合（オープニングファイト）", "weight": "61.0kg", "opp": "井上舜矢", "oppKey": "n-inoue-shunya"}},
  "n-matsumoto-naohiro": {"name": "松本尚大", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第2試合（オープニングファイト）", "weight": "66.0kg", "opp": "髙橋正親", "oppKey": "n-takahashi-masachika"}},
  "n-takahashi-masachika": {"name": "髙橋正親", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第2試合（オープニングファイト）", "weight": "66.0kg", "opp": "松本尚大", "oppKey": "n-matsumoto-naohiro"}},
  "n-hamada-takumi": {"name": "濱田巧", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第3試合", "weight": "57.0kg", "opp": "関原翔", "oppKey": "sho-sekihara"}},
  "n-rikiya": {"name": "力也", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第4試合", "weight": "57.0kg", "opp": "木村琉音", "oppKey": "n-kimura-rune"}},
  "n-kimura-rune": {"name": "木村琉音", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第4試合", "weight": "57.0kg", "opp": "力也", "oppKey": "n-rikiya"}},
  "n-mizoguchi": {"name": "溝口司", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第5試合", "weight": "61.0kg", "opp": "中島太一", "oppKey": "taichi-nakajima"}},
  "n-chiharu": {"name": "千春", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第9試合", "weight": "66.0kg", "opp": "鈴木博昭", "oppKey": "hiroaki-suzuki"}},
  "n-aimoto": {"name": "相本宗輝", "next": {"event": "abc presents RIZIN.55", "eventId": "rizin-55", "date": "2026-11-08", "bout": "第10試合", "weight": "66.0kg", "opp": "アバイジャ・カレオ・メヘウラ", "oppKey": "abijah-kaleo-meheula"}}
};
