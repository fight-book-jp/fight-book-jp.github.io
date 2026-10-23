/* =====================================================================
   選手名簿データ（ここを編集・追加するだけでOK）
   key      : 選手ID（英小文字）。data-src/<key>.txt の戦績ファイル名と同じにする
   division : "フライ級" "バンタム級" "フェザー級" "ライト級" "女子"
   status   : "champion"（現王者） / "former"（元王者） / ""（なし）
   record / recordType : 名簿カードに出す戦績（試合データがあれば自動計算が優先）
   photo    : 使用許可のある写真のURL。空ならシルエット
   igPost   : カードに埋め込むInstagram投稿のURL
   sns      : x / instagram / youtube / tiktok のURL
   ===================================================================== */
window.FIGHTERS = [
  // ---------------- フライ級 ----------------
  { key:"shinryu", name:"神龍 誠", en:"Makoto Shinryu", nick:"", division:"フライ級", status:"champion",
    country:"日本", born:"2000年7月5日", hometown:"宮城県仙台市", height:"165cm", team:"パラエストラ松戸",
    record:[23,5,1], nc:1, recordType:"プロ通算",
    note:"2026年6月、扇久保博正に判定勝ちしRIZINフライ級王座を獲得。",
    sns:{ x:"https://twitter.com/makoto0705mma", instagram:"https://www.instagram.com/makoto2000mma/", youtube:"https://www.youtube.com/channel/UCmfh-87a6MXbwpht28pyroA" }, photo:"",
    igPost:"https://www.instagram.com/p/DZPpRi1OSFy/" },
  { key:"ougikubo", name:"扇久保 博正", en:"Hiromasa Ougikubo", nick:"", division:"フライ級", status:"former",
    country:"日本", born:"1987年4月1日", hometown:"岩手県久慈市", height:"160cm", team:"THE BLACKBELT JAPAN",
    record:[30,9,2], nc:0, recordType:"プロ通算",
    note:"元RIZINフライ級王者。2026年6月の防衛戦で神龍誠に敗れ王座を失う。",
    sns:{ x:"https://twitter.com/hiromasa0401", instagram:"https://www.instagram.com/hiromonster0401/", youtube:"https://www.youtube.com/channel/UC7vKmzcPgsVUJXtHWsGVq-A" }, photo:"" },

  // ---------------- バンタム級 ----------------
  { key:"sabatello", name:"ダニー・サバテロ", en:"Danny Sabatello", nick:"The Italian Gangster", division:"バンタム級", status:"champion",
    country:"アメリカ", born:"1993年3月31日", hometown:"アメリカ・イリノイ州シカゴ", height:"178cm", team:"American Top Team",
    record:[19,4,1], nc:0, recordType:"プロ通算",
    note:"RIZINバンタム級王者。2026年4月に後藤丈治、7月に鹿志村仁之介を退け防衛。",
    sns:{ x:"https://twitter.com/ShockThisWorld", instagram:"https://www.instagram.com/shockthisworld/" }, photo:"" },
  { key:"inoue", name:"井上 直樹", en:"Naoki Inoue", nick:"", division:"バンタム級", status:"former",
    country:"日本", born:"1997年6月14日", hometown:"愛知県豊橋市", height:"173cm", team:"",
    record:[21,5,0], nc:0, recordType:"プロ通算",
    note:"元RIZINバンタム級王者。2026年5月にはPFLの大会でも勝利。",
    sns:{ x:"https://twitter.com/NaokiInoueMMA", instagram:"https://www.instagram.com/naokiinouemma/", youtube:"https://www.youtube.com/channel/UCuLHbp1vovgv2JUdXdot_DA" }, photo:"" },
  { key:"motoya", partial:true, name:"元谷 友貴", en:"Yuki Motoya", nick:"", division:"バンタム級", status:"",
    country:"日本", born:"", hometown:"石川県加賀市", height:"", team:"",
    record:[14,10,0], nc:0, recordType:"RIZIN",
    note:"RIZIN最多出場クラスのベテラン。何度もタイトルに挑戦してきた実力者。",
    sns:{ x:"https://twitter.com/yuki_motoya", instagram:"https://www.instagram.com/yuki.motoya/" }, photo:"" },
  { key:"goto", name:"後藤 丈治", en:"Joji Goto", nick:"", division:"バンタム級", status:"",
    country:"日本", born:"", hometown:"北海道", height:"", team:"",
    record:[6,1,0], nc:0, recordType:"RIZIN",
    note:"2026年4月、サバテロの持つバンタム級王座に挑戦。",
    sns:{ x:"https://twitter.com/George0634", instagram:"https://www.instagram.com/george.135/" }, photo:"" },

  // ---------------- フェザー級 ----------------
  { key:"shaydullaev", name:"ラジャブアリ・シェイドゥラエフ", en:"Razhabali Shaydullaev", nick:"", division:"フェザー級", status:"champion",
    country:"キルギス", born:"2000年10月11日", hometown:"タジキスタン・ジェルゲタウ村", height:"170cm", team:"Ihlas",
    record:[19,0,0], nc:0, recordType:"プロ通算",
    note:"無敗のRIZINフェザー級王者。2026年9月のSUPER RIZIN 5でAJ・マッキーに判定勝ちし、PFL王座も獲得。",
    sns:{ instagram:"https://www.instagram.com/rajabali__shaidullaev/" }, photo:"" },
  { key:"asakura", name:"朝倉 未来", en:"Mikuru Asakura", nick:"", division:"フェザー級", status:"",
    country:"日本", born:"1992年7月15日", hometown:"愛知県豊橋市", height:"178cm", team:"JAPAN TOP TEAM",
    record:[20,6,0], nc:1, recordType:"プロ通算",
    note:"RIZINの顔の一人。2026年9月のSUPER RIZIN 5で青木真也に1R TKO勝ち。",
    sns:{ x:"https://twitter.com/Mikuruasakura_", instagram:"https://www.instagram.com/mikuruasakura/", youtube:"https://www.youtube.com/channel/UCJZVj2iBrdvbNc416i0V-UA", tiktok:"https://www.tiktok.com/@mikuruasakura" }, photo:"" },
  { key:"koike", name:"クレベル・コイケ", en:"Kleber Koike Erbst", nick:"", division:"フェザー級", status:"former",
    country:"日本（ブラジル出身）", born:"1989年10月16日", hometown:"ブラジル・サンパウロ州サンパウロ", height:"178cm", team:"ボンサイ柔術",
    record:[35,10,1], nc:1, recordType:"プロ通算",
    note:"元RIZINフェザー級王者。一本勝ち29回を誇る柔術の名手。",
    sns:{ x:"https://twitter.com/KoikeKleber", instagram:"https://www.instagram.com/kleber_koike/", youtube:"https://www.youtube.com/channel/UC2yf1R3Z48xe7faHhvhaVQA" }, photo:"" },
  { key:"akimoto", name:"秋元 強真", en:"Kyoma Akimoto", nick:"The Hunter", division:"フェザー級", status:"",
    country:"日本", born:"", hometown:"千葉県旭市", height:"178cm", team:"JAPAN TOP TEAM",
    record:[13,1,0], nc:0, recordType:"プロ通算",
    note:"10代でRIZINの主役候補に躍り出た新星。2026年はパッチー・ミックス、クレベル・コイケに連勝。",
    sns:{ x:"https://x.com/kyoma_mma", instagram:"https://www.instagram.com/kyoma_mma/", youtube:"https://www.youtube.com/@kyoma.mma38" }, photo:"" },
  { key:"suzuki", name:"鈴木 千裕", en:"Chihiro Suzuki", nick:"", division:"フェザー級", status:"former",
    country:"日本", born:"1999年5月14日", hometown:"東京都三鷹市", height:"173cm", team:"クロスポイント吉祥寺",
    record:[13,6,0], nc:1, recordType:"プロ通算",
    note:"元RIZINフェザー級王者。キックボクシングでも王座を持つ打撃の強者。",
    sns:{ x:"https://twitter.com/Chihiro__0514", instagram:"https://www.instagram.com/suzuki.chihiro0514/", youtube:"https://www.youtube.com/channel/UCqGGEgRROwOFdagbsKsh5OA" }, photo:"" },
  { key:"hiramoto", name:"平本 蓮", en:"Ren Hiramoto", nick:"", division:"フェザー級", status:"",
    country:"日本", born:"1998年6月27日", hometown:"東京都足立区", height:"173cm", team:"",
    record:[5,3,0], nc:0, recordType:"RIZIN",
    note:"K-1出身のストライカー。2026年9月にカルシャガ・ダウトベックにスプリット判定勝ち。",
    sns:{ x:"https://twitter.com/RENGODHIRAMOTO", instagram:"https://www.instagram.com/ren___k1/", youtube:"https://www.youtube.com/channel/UCmddHtZJvNrFdKJ9GBO401w" }, photo:"" },
  { key:"karamov", name:"ヴガール・ケラモフ", en:"Vugar Karamov", nick:"", division:"フェザー級", status:"former",
    country:"アゼルバイジャン", born:"", hometown:"", height:"", team:"",
    record:[22,7,0], nc:0, recordType:"プロ通算",
    note:"元RIZINフェザー級王者。2026年9月に高木凌に判定勝ち。",
    sns:{ x:"https://twitter.com/vugar_karamov", instagram:"https://www.instagram.com/vugar_karamov/" }, photo:"" },
  { key:"dautbek", name:"カルシャガ・ダウトベック", en:"Karshyga Dautbek", nick:"", division:"フェザー級", status:"",
    country:"カザフスタン", born:"", hometown:"", height:"", team:"",
    record:null, nc:0, recordType:"",
    note:"2025年3月に鈴木千裕を破りRIZINで存在感を示した実力者。",
    sns:{ instagram:"https://www.instagram.com/d.karshiga/" }, photo:"" },

  // ---------------- ライト級 ----------------
  { key:"gustavo", name:"ルイス・グスタボ", en:"Luiz Gustavo", nick:"", division:"ライト級", status:"champion",
    country:"ブラジル", born:"", hometown:"ブラジル・パラナ州クリチバ", height:"", team:"",
    record:[8,4,0], nc:0, recordType:"RIZIN",
    note:"第3代RIZINライト級王者。2026年5月、イルホム・ノジモフを1R KOで下し戴冠。",
    sns:{ instagram:"https://www.instagram.com/luiz_killer/" }, photo:"" },
  { key:"satoshi", name:"ホベルト・サトシ・ソウザ", en:"Roberto Satoshi Souza", nick:"", division:"ライト級", status:"former",
    country:"ブラジル（日系）", born:"1989年9月19日", hometown:"ブラジル・サンパウロ州サンパウロ", height:"180cm", team:"ボンサイ柔術",
    record:[21,4,0], nc:0, recordType:"プロ通算",
    note:"長くライト級に君臨した元王者。一本勝ち13回の柔術家。2026年9月に野村駿太に判定勝ち。",
    sns:{ x:"https://twitter.com/ToshiJJ", instagram:"https://www.instagram.com/robertosatoshi/", youtube:"https://www.youtube.com/user/toshi6268" }, photo:"" },
  { key:"nozimov", name:"イルホム・ノジモフ", en:"Ilkhom Nozimov", nick:"", division:"ライト級", status:"former",
    country:"ウズベキスタン", born:"1995年3月27日", hometown:"ロシア・マグニトゴルスク", height:"180cm", team:"Tiger Muay Thai",
    record:[13,4,0], nc:0, recordType:"プロ通算",
    note:"2025年大晦日にサトシを13秒KOし王座獲得。2026年5月にグスタボに敗れ王座を失う。",
    sns:{ instagram:"https://www.instagram.com/ilxom_nazimov/" }, photo:"" },

  // ---------------- 女子 ----------------
  { key:"izawa", name:"伊澤 星花", en:"Seika Izawa", nick:"Supernova", division:"女子", status:"former",
    country:"日本", born:"1997年11月1日", hometown:"栃木県宇都宮市", height:"160cm", team:"高本道場",
    record:[18,0,0], nc:0, recordType:"プロ通算",
    note:"無敗の女王。2026年4月にRIZIN女子スーパーアトム級王座を返上し、現在は休養中。",
    sns:{ x:"https://twitter.com/starflower2525", instagram:"https://www.instagram.com/starflower.1101/", youtube:"https://www.youtube.com/channel/UCDXe3wEy3AfZOyMbIwXW9rw" }, photo:"" }
];
