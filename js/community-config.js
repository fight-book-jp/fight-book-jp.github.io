/* ファン参加機能の接続先（Supabase）
   url と anonKey（publishable キー）は「公開してよい値」です。
   データの保護はデータベース側の権限設定で行います。
   secret キー（sb_secret_…）や service_role キーは、絶対にここへ書かないでください。
   public: false のあいだは一般の訪問者には表示されず、URL に ?preview=1 を付けて開いた端末だけで表示されます。
   ログイン方法：メールアドレス＋パスワード（Supabase Auth の Email）。 */
window.FB_COMMUNITY = {
  url: "https://wcdiofpkgjrupcjzytmf.supabase.co",
  anonKey: "sb_publishable_k0XNIAvsiGU3pECWBRtTYQ_mgyYyKfY",
  public: false,      // メール送信（Brevo）の設定と動作確認が終わったら true にして公開
};
