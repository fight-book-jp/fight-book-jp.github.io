-- =====================================================================
-- FIGHT BOOK ファン参加機能：指標の確認用クエリ
-- Supabase の SQL Editor に貼り、見たいブロックだけ選択して実行します（読み取りのみ）。
--
-- 計測の考え方
--  * 「参加」は画面のクリックではなく、データベースに残った事実（見たい・面白い・コメント・カード作成）で数える。
--  * 閲覧は events.card_view（同じ端末×同じカード×同じ日は 1 回だけ記録）。再読み込み・自動更新で水増しされない。
--  * X 共有は share_click（投稿画面を開いた回数）で、X に投稿されたかどうかは分からない。投稿完了としては数えない。
--  * 端末 ID（anon_id）は端末・ブラウザごと。同じ人の別端末は別に数えられる。
--
-- 記録しているイベント（js/community.js の track）
--  daily_visit      1日1回の訪問            {logged_in, ref}        重複キー dv:端末:日付
--  card_view        カード詳細を表示          {src, logged_in}        重複キー cv:端末:カード:日付
--  share_landing    X共有リンクから到着       {}                      重複キー sl:端末:カード
--  vote             見たい/面白いの操作成功   {kind, on, where}
--  comment_post     コメント投稿（再送は除く） {hint}
--  reply_post       返信投稿（再送は除く）     {hint}
--  create_start     作成画面を開いた（1セッション1回） {prefilled}
--  card_publish     公開ボタンの結果           {existed, with_reason}   existed=true は既存カードへ案内
--  dup_guided       作成中に重複カードを案内   {}                      重複キー dup:端末:カード:日付
--  related_click    関連カードのクリック       {why, to}
--  next_action      投票後の次の行動           {action}
--  share_click      X投稿画面を開く            {where, with_reason}
--  copy_url / save / report / notif_open
--  login_start / login_success {how} / login_fail {reason} / signup_start / signup_confirmed
-- =====================================================================

-- 【中心指標】1週間に、見たい・面白い・コメント・カード作成のいずれかで参加したユニークユーザー数（週ごと）
with p as (
  select user_id, first_at as at from want_first
  union all select user_id, created_at from reactions where kind = 'fun'
  union all select user_id, created_at from comments where user_id is not null
  union all select creator, created_at from cards where creator is not null
)
select date_trunc('week', at)::date as week, count(distinct user_id) as participating_users
from p group by 1 order by 1 desc limit 12;

-- 【初回参加率】その週にカードを見た端末のうち、その週に初めて参加した端末の割合
--  分母：その週に card_view があった端末  分子：そのうち、初めての vote/comment/reply/publish がその週にある端末
with first_join as (
  select anon_id, min(created_at) at from events
  where name in ('vote', 'comment_post', 'reply_post', 'card_publish') group by 1
), viewers as (
  select date_trunc('week', created_at)::date week, anon_id from events where name = 'card_view' group by 1, 2
)
select v.week, count(*) viewers,
       count(*) filter (where date_trunc('week', f.at)::date = v.week) first_time_participants,
       round(100.0 * count(*) filter (where date_trunc('week', f.at)::date = v.week) / nullif(count(*), 0), 1) as rate_pct
from viewers v left join first_join f using (anon_id) group by 1 order by 1 desc;

-- 【ログイン】開始 → 成功（端末単位・週ごと）
select date_trunc('week', created_at)::date week,
       count(distinct anon_id) filter (where name = 'login_start') started,
       count(distinct anon_id) filter (where name = 'login_success') succeeded,
       count(distinct anon_id) filter (where name = 'signup_start') signup_started,
       count(distinct anon_id) filter (where name = 'signup_confirmed') signup_confirmed
from events group by 1 order by 1 desc;

-- 【作成】作成画面を開いた → 新しいカードを公開／既存カードへ案内
select date_trunc('week', created_at)::date week,
       count(*) filter (where name = 'create_start') started,
       count(*) filter (where name = 'card_publish' and props->>'existed' = 'false') published_new,
       count(*) filter (where name = 'card_publish' and props->>'existed' = 'true') merged_into_existing,
       count(*) filter (where name = 'dup_guided') duplicate_guided
from events group by 1 order by 1 desc;

-- 【初めて反応が付くまでの時間】カード公開から、作成者以外の最初の「見たい」かコメントまで（中央値）
with firsts as (
  select c.id, c.created_at,
         least((select min(f.first_at) from want_first f where f.card_id = c.id and f.user_id is distinct from c.creator),
               (select min(m.created_at) from comments m where m.card_id = c.id and m.user_id is distinct from c.creator)) as first_other
  from cards c where c.origin = 'fan'
)
select date_trunc('week', created_at)::date week, count(*) cards,
       count(first_other) cards_with_reaction,
       percentile_cont(0.5) within group (order by extract(epoch from first_other - created_at) / 3600) as median_hours
from firsts group by 1 order by 1 desc;

-- 【回遊】1訪問（端末×日）あたりの、異なるカードの閲覧数
select date_trunc('week', d)::date week, round(avg(n), 2) avg_distinct_cards, percentile_cont(0.5) within group (order by n) median
from (select anon_id, created_at::date d, count(distinct card_id) n from events where name = 'card_view' group by 1, 2) t
group by 1 order by 1 desc;

-- 【関連カード・共有】カード閲覧に対するクリック率（端末単位）
select date_trunc('week', created_at)::date week,
       count(distinct anon_id) filter (where name = 'card_view') viewers,
       count(distinct anon_id) filter (where name = 'related_click') related_clickers,
       count(distinct anon_id) filter (where name = 'share_click') share_clickers,
       count(distinct anon_id) filter (where name = 'share_landing') arrived_from_share
from events group by 1 order by 1 desc;

-- 【共有経由の参加】X共有リンクから来た端末のうち、7日以内に参加した割合
with land as (select anon_id, min(created_at) at from events where name = 'share_landing' group by 1)
select count(*) arrived,
       count(*) filter (where exists (select 1 from events e where e.anon_id = l.anon_id
                        and e.name in ('vote', 'comment_post', 'reply_post', 'card_publish')
                        and e.created_at between l.at and l.at + interval '7 days')) participated
from land l;

-- 【再参加】ある日に参加したユーザーが、翌日／7日以内に再び参加した割合
with p as (
  select user_id, first_at::date d from want_first
  union select user_id, created_at::date from comments where user_id is not null
  union select creator, created_at::date from cards where creator is not null
), base as (select distinct user_id, d from p where d < current_date - 7)
select date_trunc('week', d)::date week, count(*) user_days,
       round(100.0 * count(*) filter (where exists (select 1 from p q where q.user_id = b.user_id and q.d = b.d + 1)) / count(*), 1) next_day_pct,
       round(100.0 * count(*) filter (where exists (select 1 from p q where q.user_id = b.user_id and q.d between b.d + 1 and b.d + 7)) / count(*), 1) within_7d_pct
from base b group by 1 order by 1 desc;

-- 【返信を受けた人の再訪】返信を受けてから7日以内に訪問（ログイン状態の daily_visit）した割合
with got as (
  select mine.user_id, min(m.created_at) at
  from comments m join comments mine on mine.id = m.parent_id
  where m.user_id is distinct from mine.user_id and mine.user_id is not null group by 1
)
select count(*) received_reply,
       count(*) filter (where exists (select 1 from events e where e.user_id = g.user_id and e.name = 'daily_visit'
                        and e.created_at between g.at and g.at + interval '7 days')) came_back
from got g;

-- 【健全性】通報率と対応時間
with r as (select date_trunc('week', created_at)::date week, count(*) n,
                  avg(extract(epoch from handled_at - created_at) / 3600) h, count(*) filter (where status = 'open') still_open
             from reports group by 1),
     m as (select date_trunc('week', created_at)::date week, count(*) n from comments group by 1)
select r.week, r.n reports, round(100.0 * r.n / nullif(m.n, 0), 2) per_100_comments,
       round(r.h::numeric, 1) avg_hours_to_handle, r.still_open
from r left join m using (week) order by 1 desc;

-- 【作成者の継続】カードを作った人が、翌週も参加したか
with c as (select creator u, date_trunc('week', created_at)::date w from cards where creator is not null group by 1, 2),
p as (
  select user_id u, date_trunc('week', first_at)::date w from want_first
  union select user_id, date_trunc('week', created_at)::date from comments where user_id is not null
  union select creator, date_trunc('week', created_at)::date from cards where creator is not null
)
select c.w week, count(*) creators, count(*) filter (where exists (select 1 from p where p.u = c.u and p.w = c.w + 7)) active_next_week
from c group by 1 order by 1 desc;

-- =====================================================================
-- ホーム（v32〜）の参加の流れ
--  home_predict_view  ホームで受付中の対戦カードを表示（端末×大会×日で1回） {event, picked}
--  predict            予想の成功。ホームからは props.src = 'home'          {event, bout, change, src}
--  home_to_comment    ホームの「理由をコメント」「コメントを読む」を押した   {event, bout, picked}
--  home_next_bout     ホームの「次の試合を予想」                           {event, from, to}
--  bout_comment / bout_reply  大会ページでのコメント・返信
-- =====================================================================

-- 【ホーム→予想】受付中カードを見た端末のうち、同じ日にホームから予想した端末の割合（日ごと）
with v as (select distinct anon_id, created_at::date d from events where name = 'home_predict_view'),
     p as (select distinct anon_id, created_at::date d from events where name = 'predict' and props->>'src' = 'home' and coalesce((props->>'change')::boolean, false) = false)
select v.d, count(*) as viewers, count(p.anon_id) as predicted, round(100.0 * count(p.anon_id) / nullif(count(*), 0), 1) as rate_pct
from v left join p on p.anon_id = v.anon_id and p.d = v.d group by 1 order by 1 desc limit 30;

-- 【予想→コメント】ホームから予想した端末のうち、同じ日に試合のコメントを書いた端末の割合
with p as (select distinct anon_id, created_at::date d from events where name = 'predict' and props->>'src' = 'home'),
     c as (select distinct anon_id, created_at::date d from events where name in ('bout_comment', 'bout_reply'))
select p.d, count(*) as predicted, count(c.anon_id) as commented, round(100.0 * count(c.anon_id) / nullif(count(*), 0), 1) as rate_pct
from p left join c on c.anon_id = p.anon_id and c.d = p.d group by 1 order by 1 desc limit 30;

-- 【別の対戦へ】ホームから予想した端末のうち、2試合以上を予想した、または「次の試合」を押した端末の割合
with p as (select anon_id, created_at::date d, count(distinct props->>'bout') n from events where name = 'predict' group by 1, 2),
     h as (select distinct anon_id, created_at::date d from events where name = 'predict' and props->>'src' = 'home'),
     nx as (select distinct anon_id, created_at::date d from events where name = 'home_next_bout')
select h.d, count(*) as predicted_from_home,
       count(*) filter (where p.n >= 2 or nx.anon_id is not null) as went_to_another,
       round(100.0 * count(*) filter (where p.n >= 2 or nx.anon_id is not null) / nullif(count(*), 0), 1) as rate_pct
from h left join p on p.anon_id = h.anon_id and p.d = h.d left join nx on nx.anon_id = h.anon_id and nx.d = h.d
group by 1 order by 1 desc limit 30;

-- 【見たい一戦】ホームの見たい一戦からの反応と投稿（週ごと）
select date_trunc('week', created_at)::date as week,
       count(*) filter (where name = 'vote' and props->>'where' like 'home%') as votes_from_home,
       count(*) filter (where name = 'card_publish' and coalesce((props->>'existed')::boolean, false) = false) as new_cards
from events group by 1 order by 1 desc limit 12;

-- 【再訪率】その週に訪問した端末のうち、翌週も訪問した端末の割合
with w as (select distinct anon_id, date_trunc('week', created_at)::date wk from events where name = 'daily_visit')
select a.wk, count(*) as visitors, count(b.anon_id) as returned_next_week, round(100.0 * count(b.anon_id) / nullif(count(*), 0), 1) as rate_pct
from w a left join w b on b.anon_id = a.anon_id and b.wk = a.wk + 7 group by 1 order by 1 desc limit 12;
