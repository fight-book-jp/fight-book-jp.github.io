-- 大晦日のカードで、選手キーが空だった2人（ヒロヤ・山本アーセン）に選手ページのキーを入れる
-- Supabase の SQL Editor に貼り付けて「Run」。何度実行しても同じ結果になります
update public.fight_bouts set fa = 'hiroya-kondo'   where event_id = 'rizin-2026-12-31' and fa_name = 'ヒロヤ';
update public.fight_bouts set fb = 'erson-yamamoto' where event_id = 'rizin-2026-12-31' and fb_name = '山本アーセン';
select ord, fa, fa_name, fb, fb_name from public.fight_bouts where event_id = 'rizin-2026-12-31' order by ord;
