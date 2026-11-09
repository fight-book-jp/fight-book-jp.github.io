/* =====================================================================
   RIZINの試合記録がまだない選手（初参戦など）の選手ページ用データ
   "選手キー（n-で始める）": { name:"公式発表の表記", next:{ 次の試合 } }
   ・国籍・出身地などは、確かな出典が確認できるまで書かない（推測で埋めない）
   ・RIZINの試合記録が入ったら、ここから外して NEWCOMERS_MOVED に「旧キー → 新キー」を書く（古いURLを転送する）
   画像は data/photos.js の PHOTOS_BY_NAME（登録名で一致）を使う
   ===================================================================== */
window.NEWCOMERS = {
  "n-donmai-kawabata": {"name": "ドンマイ川端", "nick": "柔道家・YouTuber", "next": {"event": "超RIZIN.6 師走の尾張名古屋下剋上祭り", "eventId": "rizin-2026-12-31", "date": "2026-12-31", "bout": "59.0kg契約", "weight": "59.0kg契約", "opp": "冨澤大智", "oppKey": "daichi-tomizawa", "note": "プロMMAデビュー戦。過去に組まれた冨澤大智戦の仕切り直し"}, "profile": {"本名": "川端 龍（かわばた りょう）", "生年月日": "1989年11月29日", "出身": "大阪府", "身長": "166cm", "体重": "59.0kg", "所属": "JAPAN TOP TEAM", "柔道": "二段・60kg級"}, "career": ["5歳で柔道を始める", "高校2年でインターハイ60kg級3位", "国士舘大学時代の2009年、全日本学生体重別選手権で優勝", "2011年 講道館杯 全日本柔道体重別選手権で優勝", "2013年 全日本選抜柔道体重別選手権 60kg級で優勝", "2014年 ヨーロッパオープン（オーバーヴァルト）で優勝", "2019年 柔道をテーマにしたYouTubeチャンネルを開設", "2023年5月 BreakingDown 8 でヒロヤとMMAルールで対戦し、延長の末に判定負け", "36歳で朝倉海の勧めをきっかけにMMAの練習を始め、JAPAN TOP TEAMに所属"], "sources": [["RIZIN公式 選手ページ", "https://jp.rizinff.com/_tags/%E3%83%89%E3%83%B3%E3%83%9E%E3%82%A4%E5%B7%9D%E7%AB%AF"], ["RIZIN公式 大晦日第1弾カード発表", "https://jp.rizinff.com/_ct/17874147"]]}
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
