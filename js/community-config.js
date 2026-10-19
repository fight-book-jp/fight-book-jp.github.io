/* ファン参加機能の接続先（Supabase）
   url と anonKey は「公開してよい値」です（anon key はブラウザに渡す前提の鍵で、
   データの保護はデータベース側の権限設定で行います）。
   service_role キー（secret キー）は、絶対にここへ書かないでください。
   どちらかが空のあいだは、ファン投票の画面は表示されず、これまでのサイトのままです。
   ログイン方法：メールアドレス＋パスワード（Supabase Auth の Email）。 */
window.FB_COMMUNITY = {
  url: "",            // 例: https://xxxxxxxx.supabase.co
  anonKey: "",        // Supabase の Project Settings → API Keys → anon（public）
};
