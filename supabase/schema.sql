-- =====================================================================
-- FIGHT BOOK コミュニティ（見たい対戦カード）データベース
-- Supabase の SQL Editor に貼り付けて 1 回実行します（何度実行しても壊れません）。
--
-- 方針
--  * テーブルは直接読み書きさせない（RLS 有効・ポリシーなし＝全拒否）。
--    読み書きはすべて下の関数（RPC）経由。関数の中で auth.uid() により権限を確認する。
--  * 「見たい」「面白い」は “押す/外す” ではなく “この状態にする” で送る（冪等）。
--    連打・通信の再送・同時操作でも票は増えない（主キーで一意）。
--  * 急上昇・週間は「そのユーザーが初めてそのカードを見たいと言った時刻」で数える。
--    取り消して押し直しても時刻は更新されないので、再投票で順位を稼げない。
--  * 架空のユーザー・票・コメントは作らない。運営のカードは origin='editorial' で明示。
-- =====================================================================

-- ---------- プロフィール（auth.users と 1 対 1） ----------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'ファン',
  username      text,                       -- 予備（現在のメールログインでは使わない）。本人の同一性は id で判断
  avatar_url    text,
  is_admin      boolean not null default false,
  is_banned     boolean not null default false,
  notif_seen_at timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create or replace function public.sync_profile() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, username, avatar_url)
  values (new.id,
          -- 表示名は登録時に本人が入力したもの。メールアドレスは表示名に使わない
          left(coalesce(nullif(case when m->>'name' ~ '@' then '' else m->>'name' end, ''), 'ファン'), 30),
          left(coalesce(nullif(m->>'user_name',''), nullif(m->>'preferred_username','')), 50),
          left(nullif(m->>'avatar_url',''), 500))
  on conflict (id) do nothing;     -- 登録後の表示名の変更は set_display_name で行う
  return new;
end $$;

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed after insert on auth.users
  for each row execute function public.sync_profile();

-- ---------- 対戦カード ----------
-- 同じ 2 人 × 同じルール × 同じ条件 = 1 枚（A対B と B対A は同じ。fa < fb に並べ替えて保存）
-- ルールまたは条件が違えば別カード。
create table if not exists public.cards (
  id            text primary key,
  fa            text not null check (fa ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  fb            text not null check (fb ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  rule          text not null check (rule in ('mma','kickboxing','grappling','boxing')),
  cond          text not null default 'standard' check (cond in ('standard','title','catchweight','openweight')),
  origin        text not null default 'fan' check (origin in ('fan','editorial')),
  creator       uuid references public.profiles(id) on delete set null,
  status        text not null default 'public' check (status in ('public','hidden')),
  want_count    int not null default 0,
  fun_count     int not null default 0,
  comment_count int not null default 0,
  created_at    timestamptz not null default now(),
  constraint cards_order check (fa < fb),
  constraint cards_unique unique (fa, fb, rule, cond)
);
create index if not exists cards_fa on public.cards(fa);
create index if not exists cards_fb on public.cards(fb);
create index if not exists cards_created on public.cards(created_at desc);

-- ---------- 反応（見たい / 面白い） ----------
create table if not exists public.reactions (
  card_id    text not null references public.cards(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('want','fun')),
  created_at timestamptz not null default now(),
  primary key (card_id, user_id, kind)
);
create index if not exists reactions_user on public.reactions(user_id);

-- 初めて「見たい」と言った時刻（取り消しても消さない → 再投票で急上昇を稼げない）
create table if not exists public.want_first (
  card_id  text not null references public.cards(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  first_at timestamptz not null default now(),
  primary key (card_id, user_id)
);
create index if not exists want_first_at on public.want_first(first_at desc);

-- ---------- コメント（返信は 1 階層まで） ----------
create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  card_id    text not null references public.cards(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  parent_id  bigint references public.comments(id) on delete cascade,
  is_reason  boolean not null default false,       -- 「見たい理由」として書かれたもの
  hint       text check (hint is null or hint in ('why','key','other','rule')),
  body       text not null,
  status     text not null default 'visible' check (status in ('visible','deleted','hidden')),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  constraint comments_body check (status <> 'visible' or char_length(body) between 1 and 300)
);
create index if not exists comments_card on public.comments(card_id, created_at);
create index if not exists comments_user on public.comments(user_id, created_at desc);
create index if not exists comments_parent on public.comments(parent_id);

-- ---------- 保存・通報 ----------
create table if not exists public.saves (
  card_id    text not null references public.cards(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (card_id, user_id)
);
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  target_type text not null check (target_type in ('card','comment')),
  target_id   text not null,
  user_id     uuid references public.profiles(id) on delete set null,
  reason      text not null check (reason in ('abuse','spam','wrong','other')),
  note        text check (note is null or char_length(note) <= 300),
  status      text not null default 'open' check (status in ('open','done')),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  unique (target_type, target_id, user_id)
);

-- ---------- 選手追加リクエスト（運営が確認してから選手データに追加。自動では追加しない） ----------
create table if not exists public.fighter_requests (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  name       text not null check (char_length(name) between 1 and 60),
  note       text check (note is null or char_length(note) <= 200),
  status     text not null default 'open' check (status in ('open','added','rejected')),
  created_at timestamptz not null default now()
);

-- ---------- お問い合わせ（管理者だけが読める） ----------
create table if not exists public.contacts (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('opinion','delete','correct','other')),
  name       text check (name is null or char_length(name) <= 50),
  email      text check (email is null or (char_length(email) <= 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  url        text check (url is null or char_length(url) <= 300),
  body       text not null check (char_length(body) between 5 and 2000),
  user_id    uuid,
  status     text not null default 'open' check (status in ('open','done')),
  created_at timestamptz not null default now()
);

-- ---------- 週替わりのお題（運営が SQL Editor で登録） ----------
create table if not exists public.themes (
  id        bigint generated always as identity primary key,
  title     text not null,
  body      text,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  card_ids  text[] not null default '{}'
);

-- ---------- 計測イベント ----------
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  name       text not null,
  anon_id    text not null check (char_length(anon_id) between 8 and 64),
  user_id    uuid,
  card_id    text,
  props      jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists events_name_time on public.events(name, created_at);
create index if not exists events_anon on public.events(anon_id, created_at);

-- ---------- テーブルは直接触らせない ----------
alter table public.profiles   enable row level security;
alter table public.cards      enable row level security;
alter table public.reactions  enable row level security;
alter table public.want_first enable row level security;
alter table public.comments   enable row level security;
alter table public.saves      enable row level security;
alter table public.reports    enable row level security;
alter table public.themes     enable row level security;
alter table public.fighter_requests enable row level security;
alter table public.contacts enable row level security;
alter table public.events     enable row level security;
revoke all on public.profiles, public.cards, public.reactions, public.want_first, public.comments,
              public.saves, public.reports, public.themes, public.events, public.fighter_requests, public.contacts from anon, authenticated;

-- =====================================================================
-- 件数の整合（同じトランザクション内で増減するので、ずれない）
-- =====================================================================
create or replace function public.trg_reaction_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update cards set want_count = want_count + (new.kind='want')::int, fun_count = fun_count + (new.kind='fun')::int where id = new.card_id;
  else
    update cards set want_count = want_count - (old.kind='want')::int, fun_count = fun_count - (old.kind='fun')::int where id = old.card_id;
  end if;
  return null;
end $$;
drop trigger if exists reaction_count on public.reactions;
create trigger reaction_count after insert or delete on public.reactions for each row execute function public.trg_reaction_count();

create or replace function public.trg_comment_count() returns trigger
language plpgsql security definer set search_path = public as $$
declare was boolean; now_ boolean;
begin
  was  := tg_op <> 'INSERT' and old.status = 'visible';
  now_ := tg_op <> 'DELETE' and new.status = 'visible';
  if was <> now_ then
    update cards set comment_count = comment_count + (case when now_ then 1 else -1 end)
     where id = coalesce(new.card_id, old.card_id);
  end if;
  return null;
end $$;
drop trigger if exists comment_count on public.comments;
create trigger comment_count after insert or update of status or delete on public.comments for each row execute function public.trg_comment_count();

-- 退会時：コメント本文は消し、返信の文脈だけ残す
create or replace function public.trg_profile_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update comments set status = 'deleted', body = '' where user_id = old.id and status = 'visible';
  update event_comments set status = 'deleted', body = '' where user_id = old.id and status = 'visible';
  return old;
end $$;
drop trigger if exists profile_deleted on public.profiles;
create trigger profile_deleted before delete on public.profiles for each row execute function public.trg_profile_deleted();

-- =====================================================================
-- 共通の小さな関数
-- =====================================================================
create or replace function public._me() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); b boolean;
begin
  if u is null then raise exception 'LOGIN_REQUIRED' using errcode = 'P0001'; end if;
  select is_banned into b from profiles where id = u;
  if b is null then raise exception 'PROFILE_MISSING' using errcode = 'P0001'; end if;
  if b then raise exception 'BANNED' using errcode = 'P0001'; end if;
  return u;
end $$;

create or replace function public._is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create or replace function public._new_id() returns text language sql volatile as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)
$$;

-- カード 1 枚を画面用の JSON に（呼び出し元ユーザーの状態つき）
create or replace function public._card_json(c public.cards, extra jsonb default '{}'::jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'fa', c.fa, 'fb', c.fb, 'rule', c.rule, 'cond', c.cond, 'origin', c.origin,
    'status', c.status, 'created_at', c.created_at,
    'want', c.want_count, 'fun', c.fun_count, 'comments', c.comment_count,
    'creator', (select jsonb_build_object('id', p.id, 'name', p.display_name, 'username', p.username, 'avatar', p.avatar_url)
                  from profiles p where p.id = c.creator),
    'reason', (select jsonb_build_object('id', m.id, 'body', m.body)
                 from comments m where m.card_id = c.id and m.user_id = c.creator and m.is_reason
                  and m.status = 'visible' and m.parent_id is null order by m.created_at limit 1),
    'me', case when auth.uid() is null then null else jsonb_build_object(
      'want',  exists(select 1 from reactions r where r.card_id = c.id and r.user_id = auth.uid() and r.kind = 'want'),
      'fun',   exists(select 1 from reactions r where r.card_id = c.id and r.user_id = auth.uid() and r.kind = 'fun'),
      'saved', exists(select 1 from saves s where s.card_id = c.id and s.user_id = auth.uid()),
      'mine',  c.creator = auth.uid()) end
  ) || extra
$$;

-- =====================================================================
-- 読み取り（未ログインでも可）
-- =====================================================================

-- 一覧：tab = total（累計）/ weekly（7日）/ trending（48時間・3人以上）/ new（新着）
create or replace function public.list_cards(tab text default 'new', fighter text default null, rule_f text default null,
                                             lim int default 20, off int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb; win interval; min_n int;
begin
  lim := least(greatest(coalesce(lim, 20), 1), 50); off := greatest(coalesce(off, 0), 0);
  if tab in ('weekly', 'trending') then
    win   := case when tab = 'weekly' then interval '7 days' else interval '48 hours' end;
    min_n := case when tab = 'weekly' then 1 else 3 end;
    select coalesce(jsonb_agg(public._card_json(c, jsonb_build_object('period_n', t.n)) order by t.ord), '[]') into res
      from (select r.card_id, count(*) n,
                   row_number() over (order by count(*) desc, max(f.first_at) desc) ord
              from reactions r join want_first f on f.card_id = r.card_id and f.user_id = r.user_id
              join cards c0 on c0.id = r.card_id
             where r.kind = 'want' and f.first_at >= now() - win and c0.status = 'public'
               and (fighter is null or fighter in (c0.fa, c0.fb)) and (rule_f is null or c0.rule = rule_f)
             group by r.card_id having count(*) >= min_n
             order by 3 limit lim offset off) t
      join cards c on c.id = t.card_id;
  elsif tab = 'total' then
    select coalesce(jsonb_agg(public._card_json(c) order by c.want_count desc, c.created_at desc), '[]') into res from (
      select * from cards c where c.status = 'public' and c.want_count > 0
        and (fighter is null or fighter in (c.fa, c.fb)) and (rule_f is null or c.rule = rule_f)
      order by c.want_count desc, c.created_at desc limit lim offset off) c;
  else
    select coalesce(jsonb_agg(public._card_json(c) order by c.created_at desc), '[]') into res from (
      select * from cards c where c.status = 'public'
        and (fighter is null or fighter in (c.fa, c.fb)) and (rule_f is null or c.rule = rule_f)
      order by c.created_at desc limit lim offset off) c;
  end if;
  return jsonb_build_object('tab', tab, 'as_of', now(), 'cards', res);
end $$;

create or replace function public.get_card(cid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c cards;
begin
  select * into c from cards where id = cid;
  if not found then return null; end if;
  if c.status <> 'public' and not public._is_admin() then
    return jsonb_build_object('id', c.id, 'status', c.status);
  end if;
  return public._card_json(c);
end $$;

-- 作成前の重複確認：同じ 2 人のカード（ルール違いも含む）
create or replace function public.find_cards(a text, b text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(public._card_json(c) order by c.want_count desc), '[]')
    from cards c where c.fa = least(a, b) and c.fb = greatest(a, b) and c.status = 'public'
$$;

-- コメント：sort = new（新着）/ old（古い順）。削除・非表示は本文を返さず枠だけ残す
create or replace function public.list_comments(cid text, sort text default 'new') returns jsonb
language sql stable security definer set search_path = public as $$
  with v as (
    select m.*, p.display_name, p.username, p.avatar_url
      from comments m left join profiles p on p.id = m.user_id
      join cards c on c.id = m.card_id
     where m.card_id = cid and (c.status = 'public' or public._is_admin())
  ),
  j as (
    select v.id, v.parent_id, v.created_at, jsonb_build_object(
      'id', v.id, 'parent', v.parent_id, 'reason', v.is_reason, 'hint', v.hint, 'status', v.status,
      'body', case when v.status = 'visible' or public._is_admin() then v.body else null end,
      'created_at', v.created_at, 'edited_at', v.edited_at,
      'user', case when v.status = 'visible' and v.user_id is not null then
                jsonb_build_object('id', v.user_id, 'name', v.display_name, 'username', v.username, 'avatar', v.avatar_url) end,
      'mine', v.user_id is not null and v.user_id = auth.uid()) o
    from v
  )
  select coalesce(jsonb_agg(t.o || jsonb_build_object('replies',
            coalesce((select jsonb_agg(r.o order by r.created_at) from j r where r.parent_id = t.id), '[]'))
         order by case when sort = 'old' then extract(epoch from t.created_at) else -extract(epoch from t.created_at) end), '[]')
    from j t
   where t.parent_id is null
     -- 返信のない削除済みコメントは出さない
     and (t.o->>'status' = 'visible' or exists(select 1 from j r where r.parent_id = t.id and r.o->>'status' = 'visible'))
$$;

-- 関連カード：理由が説明できるものだけ（行動履歴にもとづく「おすすめ」ではない）
--   same_fighter : 同じ選手を含む別のカード（見たい数順）
--   same_class   : 同じ階級の選手どうしのカード（階級は公開データ側で判定し、選手キーを渡す）
--   fresh        : まだ反応が少ない新着
--   editorial    : 編集部のカード
create or replace function public.related_cards(cid text, class_keys text[] default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c cards; res jsonb := '[]'; seen text[];
begin
  select * into c from cards where id = cid;
  if not found then return '[]'; end if;
  seen := array[cid];
  select coalesce(jsonb_agg(public._card_json(x, jsonb_build_object('why', 'same_fighter'))), '[]'), seen || coalesce(array_agg(x.id), '{}')
    into res, seen from (select * from cards x where x.status = 'public' and x.id <> all(seen)
                          and (x.fa in (c.fa, c.fb) or x.fb in (c.fa, c.fb)) order by x.want_count desc, x.created_at desc limit 2) x;
  if coalesce(array_length(class_keys, 1), 0) > 0 then
    select res || coalesce(jsonb_agg(public._card_json(x, jsonb_build_object('why', 'same_class'))), '[]'), seen || coalesce(array_agg(x.id), '{}')
      into res, seen from (select * from cards x where x.status = 'public' and x.id <> all(seen) and x.want_count > 0
                            and x.fa = any(class_keys) and x.fb = any(class_keys) order by x.want_count desc limit 1) x;
  end if;
  select res || coalesce(jsonb_agg(public._card_json(x, jsonb_build_object('why', 'fresh'))), '[]'), seen || coalesce(array_agg(x.id), '{}')
    into res, seen from (select * from cards x where x.status = 'public' and x.id <> all(seen) and x.want_count < 3
                          and x.created_at > now() - interval '14 days' order by x.created_at desc limit 1) x;
  select res || coalesce(jsonb_agg(public._card_json(x, jsonb_build_object('why', 'editorial'))), '[]')
    into res from (select * from cards x where x.status = 'public' and x.id <> all(seen) and x.origin = 'editorial'
                    order by x.created_at desc limit 1) x;
  return res;
end $$;

create or replace function public.current_theme() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', t.id, 'title', t.title, 'body', t.body, 'starts_at', t.starts_at, 'ends_at', t.ends_at,
           'cards', coalesce((select jsonb_agg(public._card_json(c)) from cards c where c.id = any(t.card_ids) and c.status = 'public'), '[]'))
    from themes t where now() between t.starts_at and t.ends_at order by t.starts_at desc limit 1
$$;

-- 共有ページ生成用（GitHub Actions が公開キーで読む）：公開・非公開の別とプレビューに必要な最小限
create or replace function public.export_cards(since timestamptz default '2000-01-01') returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'fa', c.fa, 'fb', c.fb, 'rule', c.rule, 'cond', c.cond,
           'origin', c.origin, 'status', c.status, 'created_at', c.created_at,
           'reason', case when c.status = 'public' then (select m.body from comments m where m.card_id = c.id and m.user_id = c.creator
                      and m.is_reason and m.status = 'visible' and m.parent_id is null order by m.created_at limit 1) end)
         order by c.created_at), '[]')
    from cards c
$$;

-- =====================================================================
-- 書き込み（ログイン必須・本人確認はここで行う）
-- =====================================================================

-- カード作成：既にあれば新しく作らず、既存カードの id を返す（existed=true）
create or replace function public.create_card(a text, b text, rule text, cond text default 'standard',
                                              reason text default null, hint text default null, editorial boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); x text := least(a, b); y text := greatest(a, b); cid text; c cards; n int;
begin
  if a is null or b is null or a = b then raise exception 'SAME_FIGHTER' using errcode = 'P0001'; end if;
  if editorial and not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  reason := nullif(btrim(coalesce(reason, '')), '');
  if reason is not null and char_length(reason) > 140 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;

  select * into c from cards where fa = x and fb = y and cards.rule = create_card.rule and cards.cond = coalesce(create_card.cond, 'standard');
  if found then
    return public._card_json(c, jsonb_build_object('existed', true));
  end if;

  select count(*) into n from cards where creator = u and created_at > now() - interval '1 day';
  if n >= 10 and not public._is_admin() then raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;

  loop
    cid := public._new_id();
    begin
      insert into cards (id, fa, fb, rule, cond, origin, creator)
      values (cid, x, y, create_card.rule, coalesce(create_card.cond, 'standard'), case when editorial then 'editorial' else 'fan' end, u);
      exit;
    exception when unique_violation then
      -- id の衝突ならやり直し。組み合わせが同時に作られた場合は既存を返す
      select * into c from cards where fa = x and fb = y and cards.rule = create_card.rule and cards.cond = coalesce(create_card.cond, 'standard');
      if found then return public._card_json(c, jsonb_build_object('existed', true)); end if;
    end;
  end loop;

  if reason is not null then
    insert into comments (card_id, user_id, is_reason, hint, body) values (cid, u, true, hint, reason);
  end if;
  -- 作った本人は「見たい」側（実際の 1 票として数える）
  insert into reactions (card_id, user_id, kind) values (cid, u, 'want') on conflict do nothing;
  insert into want_first (card_id, user_id) values (cid, u) on conflict do nothing;

  select * into c from cards where id = cid;
  return public._card_json(c, jsonb_build_object('existed', false));
end $$;

-- 反応：on=true でその状態に、false で外す（何度送っても同じ結果）
create or replace function public.set_reaction(cid text, kind text, "on" boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); c cards;
begin
  if kind not in ('want', 'fun') then raise exception 'BAD_KIND' using errcode = 'P0001'; end if;
  select * into c from cards where id = cid and status = 'public';
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if "on" then
    insert into reactions (card_id, user_id, kind) values (cid, u, set_reaction.kind) on conflict do nothing;
    if kind = 'want' then insert into want_first (card_id, user_id) values (cid, u) on conflict do nothing; end if;
  else
    delete from reactions r where r.card_id = cid and r.user_id = u and r.kind = set_reaction.kind;
  end if;
  select * into c from cards where id = cid;
  return public._card_json(c);
end $$;

create or replace function public.set_save(cid text, "on" boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  if not exists(select 1 from cards where id = cid) then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if "on" then insert into saves (card_id, user_id) values (cid, u) on conflict do nothing;
  else delete from saves where card_id = cid and user_id = u; end if;
  return "on";
end $$;

-- コメント：本文 1〜300 字、返信は 1 階層、15 秒に 1 回・1 日 40 件まで。
-- client_key で同じ送信の再送を 1 件にまとめる
create or replace function public.add_comment(cid text, body text, parent bigint default null, reason boolean default false,
                                              hint text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); p comments; last_at timestamptz; n int; new_id bigint;
begin
  body := btrim(coalesce(body, ''));
  if char_length(body) < 1 then raise exception 'EMPTY' using errcode = 'P0001'; end if;
  if char_length(body) > 300 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  if not exists(select 1 from cards where id = cid and status = 'public') then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if parent is not null then
    select * into p from comments where id = parent;
    if not found or p.card_id <> cid then raise exception 'BAD_PARENT' using errcode = 'P0001'; end if;
    if p.parent_id is not null then parent := p.parent_id; end if;   -- 返信への返信は同じスレッドに並べる（1 階層）
    reason := false;
  end if;
  -- 同じ本文の連続送信（再送・二度押し）は 1 件として扱う
  select id into new_id from comments m where m.user_id = u and m.card_id = cid and m.body = add_comment.body
     and m.parent_id is not distinct from parent and m.created_at > now() - interval '2 minutes' and m.status = 'visible' limit 1;
  if new_id is not null then return jsonb_build_object('id', new_id, 'duplicate', true); end if;
  select max(created_at), count(*) filter (where created_at > now() - interval '1 day') into last_at, n
    from comments where user_id = u and not is_reason;   -- カード作成時の理由は数えない（作成数で別に制限）
  if last_at > now() - interval '15 seconds' then raise exception 'TOO_FAST' using errcode = 'P0001'; end if;
  if n >= 40 then raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into comments (card_id, user_id, parent_id, is_reason, hint, body)
  values (cid, u, parent, coalesce(reason, false), case when hint in ('why','key','other','rule') then hint end, body)
  returning id into new_id;
  return jsonb_build_object('id', new_id, 'duplicate', false);
end $$;

create or replace function public.edit_comment(mid bigint, body text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  body := btrim(coalesce(body, ''));
  if char_length(body) not between 1 and 300 then raise exception 'BAD_LENGTH' using errcode = 'P0001'; end if;
  update comments m set body = edit_comment.body, edited_at = now()
   where m.id = mid and m.user_id = u and m.status = 'visible' and m.body <> edit_comment.body;
  if not found and not exists(select 1 from comments where id = mid and user_id = u and status = 'visible') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return true;
end $$;

create or replace function public.delete_comment(mid bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  update comments set status = 'deleted', body = '' where id = mid and user_id = u and status = 'visible';
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return true;
end $$;

create or replace function public.report(target_type text, target_id text, reason text, note text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  insert into reports (target_type, target_id, user_id, reason, note)
  values (target_type, target_id, u, reason, nullif(btrim(coalesce(note, '')), ''))
  on conflict do nothing;
  return true;
end $$;

create or replace function public.request_fighter(name text, note text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  name := btrim(coalesce(name, ''));
  if char_length(name) not between 1 and 60 then raise exception 'BAD_LENGTH' using errcode = 'P0001'; end if;
  if (select count(*) from fighter_requests f where f.user_id = u and f.created_at > now() - interval '1 day') >= 5 then
    raise exception 'RATE_LIMIT' using errcode = 'P0001';
  end if;
  insert into fighter_requests (user_id, name, note) values (u, name, nullif(btrim(coalesce(note, '')), ''));
  return true;
end $$;

-- =====================================================================
-- マイページ・通知
-- =====================================================================
create or replace function public.my_page() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public._me();
begin
  return jsonb_build_object(
    'profile', (select jsonb_build_object('id', id, 'name', display_name, 'username', username, 'avatar', avatar_url,
                                          'admin', is_admin, 'notif_seen_at', notif_seen_at) from profiles where id = u),
    'created', (select coalesce(jsonb_agg(public._card_json(c) order by c.created_at desc), '[]') from cards c where c.creator = u),
    'joined',  (select coalesce(jsonb_agg(public._card_json(c) order by c.created_at desc), '[]') from cards c
                 where c.status = 'public' and c.creator is distinct from u and (
                   exists(select 1 from reactions r where r.card_id = c.id and r.user_id = u)
                   or exists(select 1 from comments m where m.card_id = c.id and m.user_id = u and m.status = 'visible'))),
    'saved',   (select coalesce(jsonb_agg(public._card_json(c) order by s.created_at desc), '[]') from saves s join cards c on c.id = s.card_id
                 where s.user_id = u and c.status = 'public'),
    -- 自分のコメント（大会予想の試合ごとのコメント＋見たいカードへのコメント）。新しい順に200件まで
    'comments', (select coalesce(jsonb_agg(x.j order by x.at desc), '[]') from (
                  (select m.created_at at, jsonb_build_object('kind', 'event', 'id', m.id, 'body', m.body, 'at', m.created_at,
                          'event_id', m.event_id, 'event_name', e.name, 'bout', b.fa_name || ' vs ' || b.fb_name,
                          'reply_name', (select coalesce(rp.display_name, '退会したユーザー') from event_comments r left join profiles rp on rp.id = r.user_id where r.id = m.reply_to),
                          'likes', (select count(*) from event_comment_likes l where l.comment_id = m.id),
                          'replies', (select count(*) from event_comments k where k.reply_to = m.id and k.status = 'visible')) j
                     from event_comments m join fight_events e on e.id = m.event_id left join fight_bouts b on b.id = m.bout_id
                    where m.user_id = u and m.status = 'visible' and e.status = 'public')
                  union all
                  (select m.created_at, jsonb_build_object('kind', 'card', 'id', m.id, 'body', m.body, 'at', m.created_at,
                          'card_id', m.card_id, 'fa', c.fa, 'fb', c.fb)
                     from comments m join cards c on c.id = m.card_id
                    where m.user_id = u and m.status = 'visible' and c.status = 'public')
                  order by 1 desc limit 200) x),
    -- 自分の勝敗予想（大会ごと）
    'predictions', (select coalesce(jsonb_agg(ev.j order by ev.at desc), '[]') from (
                  select e.starts_at at, jsonb_build_object('event_id', e.id, 'event_name', e.name, 'starts_at', e.starts_at,
                          'locked', now() >= e.starts_at,
                          'picks', jsonb_agg(jsonb_build_object('bout', b.fa_name || ' vs ' || b.fb_name, 'title', b.title,
                                     'pick', case when p.pick = 'a' then b.fa_name else b.fb_name end, 'method', p.method,
                                     'winner', b.winner, 'hit', case when b.winner in ('a','b') then b.winner = p.pick end,
                                     'mhit', case when b.winner in ('a','b') and b.winner = p.pick and p.method is not null then p.method = b.method end)
                                   order by b.ord desc)) j
                    from predictions p join fight_bouts b on b.id = p.bout_id join fight_events e on e.id = b.event_id
                   where p.user_id = u and e.status = 'public'
                   group by e.id) ev));
end $$;

-- 自分に関係のある事実だけ：自分のコメントへの返信／自分のカードへのコメント／自分のカードへの「見たい」
-- 大会予想：自分のコメントへの返信（ec_reply）／自分のコメントへのいいね（ec_likes：コメントごとに30日分をまとめる）
create or replace function public.my_notifications(lim int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u uuid := public._me(); seen timestamptz;
begin
  select notif_seen_at into seen from profiles where id = u;
  return jsonb_build_object('seen_at', seen, 'items', (
    select coalesce(jsonb_agg(q.x order by q.at desc), '[]') from (
      select * from (
        select m.created_at at, jsonb_build_object('type', 'reply', 'card_id', m.card_id, 'comment_id', m.id, 'parent', m.parent_id,
                 'who', p.display_name, 'body', left(m.body, 80), 'at', m.created_at, 'unread', m.created_at > seen) x
          from comments m join comments mine on mine.id = m.parent_id and mine.user_id = u
          left join profiles p on p.id = m.user_id
         where m.user_id is distinct from u and m.status = 'visible'
        union all
        select m.created_at, jsonb_build_object('type', 'comment_on_my_card', 'card_id', m.card_id, 'comment_id', m.id,
                 'who', p.display_name, 'body', left(m.body, 80), 'at', m.created_at, 'unread', m.created_at > seen)
          from comments m join cards c on c.id = m.card_id and c.creator = u
          left join profiles p on p.id = m.user_id
         where m.user_id is distinct from u and m.status = 'visible' and m.parent_id is null
        union all
        select max(f.first_at), jsonb_build_object('type', 'wants_on_my_card', 'card_id', c.id, 'n', count(*), 'at', max(f.first_at),
                 'unread', max(f.first_at) > seen)
          from cards c join want_first f on f.card_id = c.id
          join reactions r on r.card_id = f.card_id and r.user_id = f.user_id and r.kind = 'want'
         where c.creator = u and f.user_id <> u and f.first_at > now() - interval '30 days'
         group by c.id
        union all
        select m.created_at, jsonb_build_object('type', 'ec_reply', 'event_id', m.event_id, 'event_name', e.name, 'comment_id', m.id,
                 'bout', b.fa_name || ' vs ' || b.fb_name, 'who', p.display_name, 'body', left(m.body, 80), 'mine_body', left(t.body, 40),
                 'at', m.created_at, 'unread', m.created_at > seen)
          from event_comments m join event_comments t on t.id = m.reply_to and t.user_id = u
          join fight_events e on e.id = m.event_id left join fight_bouts b on b.id = m.bout_id
          left join profiles p on p.id = m.user_id
         where m.user_id is distinct from u and m.status = 'visible' and e.status = 'public'
        union all
        select max(l.created_at), jsonb_build_object('type', 'ec_likes', 'event_id', t.event_id, 'event_name', max(e.name), 'comment_id', t.id,
                 'bout', max(b.fa_name || ' vs ' || b.fb_name), 'n', count(*), 'mine_body', left(max(t.body), 40),
                 'at', max(l.created_at), 'unread', max(l.created_at) > seen)
          from event_comments t join event_comment_likes l on l.comment_id = t.id
          join fight_events e on e.id = t.event_id left join fight_bouts b on b.id = t.bout_id
         where t.user_id = u and l.user_id <> u and t.status = 'visible' and e.status = 'public' and l.created_at > now() - interval '30 days'
         group by t.id, t.event_id
      ) all_ order by at desc limit lim) q));
end $$;

create or replace function public.set_display_name(name text) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  name := btrim(coalesce(name, ''));
  if char_length(name) not between 1 and 30 then raise exception 'BAD_LENGTH' using errcode = 'P0001'; end if;
  if name ~* '(@|https?://)' then raise exception 'BAD_NAME' using errcode = 'P0001'; end if;
  update profiles set display_name = name where id = u;
  return true;
end $$;

create or replace function public.whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'name', display_name, 'username', username, 'avatar', avatar_url,
                            'admin', is_admin, 'banned', is_banned)
    from profiles where id = auth.uid()
$$;

create or replace function public.unread_count() returns int
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid(); seen timestamptz; n int;
begin
  if u is null then return 0; end if;
  select notif_seen_at into seen from profiles where id = u;
  select count(*) into n from comments m
   where m.status = 'visible' and m.user_id is distinct from u and m.created_at > seen
     and (exists(select 1 from comments mine where mine.id = m.parent_id and mine.user_id = u)
          or (m.parent_id is null and exists(select 1 from cards c where c.id = m.card_id and c.creator = u)));
  n := n + (select count(*) from event_comments m join event_comments t on t.id = m.reply_to and t.user_id = u
             where m.status = 'visible' and m.user_id is distinct from u and m.created_at > seen)
         + (select count(distinct t.id) from event_comments t join event_comment_likes l on l.comment_id = t.id
             where t.user_id = u and t.status = 'visible' and l.user_id <> u and l.created_at > seen);
  return n;
end $$;

create or replace function public.mark_notifications_seen() returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  update profiles set notif_seen_at = now() where id = u;
  return true;
end $$;

-- =====================================================================
-- 管理（is_admin のユーザーのみ）
-- =====================================================================
create or replace function public.admin_reports() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('target_type', target_type, 'target_id', target_id, 'n', n,
            'reasons', reasons, 'first_at', first_at,
            'preview', case when target_type = 'comment' then (select left(body, 120) from comments where id::text = target_id)
                            when target_type = 'event_comment' then (select left(body, 120) from event_comments where id::text = target_id)
                            else (select fa || ' vs ' || fb from cards where id = target_id) end,
            'card_id', case when target_type = 'comment' then (select card_id from comments where id::text = target_id)
                            when target_type = 'event_comment' then null else target_id end,
            'event_id', case when target_type = 'event_comment' then (select event_id from event_comments where id::text = target_id) end)
          order by n desc, first_at), '[]')
    from (select target_type, target_id, count(*) n, array_agg(distinct reason) reasons, min(created_at) first_at
            from reports where status = 'open' group by 1, 2) t);
end $$;

create or replace function public.admin_set_hidden(target_type text, target_id text, hidden boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if target_type = 'card' then
    update cards set status = case when hidden then 'hidden' else 'public' end where id = target_id;
  elsif target_type = 'comment' then
    update comments set status = case when hidden then 'hidden' else 'visible' end
     where id = target_id::bigint and status <> 'deleted';
  elsif target_type = 'event_comment' then
    update event_comments set status = case when hidden then 'hidden' else 'visible' end
     where id = target_id::bigint and status <> 'deleted';
  else raise exception 'BAD_TARGET' using errcode = 'P0001'; end if;
  update reports r set status = 'done', handled_at = now()
   where r.target_type = admin_set_hidden.target_type and r.target_id = admin_set_hidden.target_id and r.status = 'open';
  return true;
end $$;

create or replace function public.admin_dismiss(target_type text, target_id text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  update reports r set status = 'done', handled_at = now()
   where r.target_type = admin_dismiss.target_type and r.target_id = admin_dismiss.target_id and r.status = 'open';
  return true;
end $$;

-- お問い合わせ：ログインなしで送れる。いたずら対策として全体で10分に30件まで
create or replace function public.submit_contact(kind text, body text, name text default null, email text default null, url text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  body := btrim(coalesce(body, ''));
  if char_length(body) < 5 then raise exception 'TOO_SHORT' using errcode = 'P0001'; end if;
  if char_length(body) > 2000 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  if (select count(*) from contacts where created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'RATE_LIMIT' using errcode = 'P0001';
  end if;
  insert into contacts (kind, body, name, email, url, user_id)
  values (case when kind in ('opinion','delete','correct','other') then kind else 'other' end, body,
          nullif(left(btrim(coalesce(name, '')), 50), ''), nullif(btrim(coalesce(email, '')), ''), nullif(left(btrim(coalesce(url, '')), 300), ''), auth.uid());
  return true;
end $$;

create or replace function public.admin_contacts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]') from (select * from contacts where status = 'open' order by created_at desc limit 100) c);
end $$;

create or replace function public.admin_contact_done(cid bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  update contacts set status = 'done' where id = cid;
  return true;
end $$;

-- =====================================================================
-- 計測（未ログインでも記録。dedupe_key で二重記録を防ぐ。1 端末 1 日 500 件まで）
-- =====================================================================
create or replace function public.log_event(name text, anon_id text, card_id text default null,
                                            props jsonb default '{}'::jsonb, dedupe_key text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if name !~ '^[a-z_]{2,40}$' then return false; end if;
  if (select count(*) from events e where e.anon_id = log_event.anon_id and e.created_at > now() - interval '1 day') >= 500 then
    return false;
  end if;
  insert into events (name, anon_id, user_id, card_id, props, dedupe_key)
  values (name, anon_id, auth.uid(), left(card_id, 20), coalesce(props, '{}'::jsonb) - 'email', left(dedupe_key, 120))
  on conflict on constraint events_dedupe_key_key do nothing;
  return true;
end $$;


-- =====================================================================
-- 大会の勝敗予想と、大会ごとの雑談スレッド
--  * 大会と対戦カードは、公式発表をもとに管理者が登録する（架空のカードは作らない）
--  * 予想は大会の開始時刻（starts_at）で締め切り。それまでは何度でも変えられる
--  * みんなの予想の割合は、自分が予想した試合か、締め切り後にだけ見せる（先に見ると予想が偏るため）
--  * 得点：勝者が的中で1点、決着方法（KO・一本・判定）も的中でさらに1点
-- =====================================================================
create table if not exists public.fight_events (
  id         text primary key check (id ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  name       text not null check (char_length(name) between 1 and 80),
  starts_at  timestamptz not null,
  venue      text check (venue is null or char_length(venue) <= 80),
  source_url text check (source_url is null or source_url ~ '^https://'),
  status     text not null default 'public' check (status in ('public','hidden')),
  created_at timestamptz not null default now()
);
create table if not exists public.fight_bouts (
  id         bigint generated always as identity primary key,
  event_id   text not null references public.fight_events(id) on delete cascade,
  ord        int not null default 0,
  fa         text check (fa is null or fa ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  fb         text check (fb is null or fb ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  fa_name    text not null check (char_length(fa_name) between 1 and 60),
  fb_name    text not null check (char_length(fb_name) between 1 and 60),
  rule       text not null default 'mma' check (rule in ('mma','kickboxing','grappling','boxing','other')),
  weight     text check (weight is null or char_length(weight) <= 40),
  title      boolean not null default false,
  winner     text check (winner is null or winner in ('a','b','draw','nc')),
  method     text check (method is null or method in ('ko','sub','dec','other')),
  created_at timestamptz not null default now()
);
create index if not exists fight_bouts_event on public.fight_bouts(event_id, ord);
-- 大会の進行状態（管理者が切り替える）。空＝開催前。予想の締め切り（starts_at）とは別に扱う
alter table public.fight_events add column if not exists phase text check (phase is null or phase in ('live','finished'));
create table if not exists public.predictions (
  bout_id    bigint not null references public.fight_bouts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  pick       text not null check (pick in ('a','b')),
  method     text check (method is null or method in ('ko','sub','dec')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bout_id, user_id)
);
create index if not exists predictions_user on public.predictions(user_id);
create table if not exists public.event_comments (
  id         bigint generated always as identity primary key,
  event_id   text not null references public.fight_events(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  body       text not null,
  status     text not null default 'visible' check (status in ('visible','deleted','hidden')),
  created_at timestamptz not null default now(),
  constraint event_comments_body check (status <> 'visible' or char_length(body) between 1 and 200)
);
create index if not exists event_comments_event on public.event_comments(event_id, id);
-- 試合ごとのコメント（bout_id が空なら大会全体の雑談）
alter table public.event_comments add column if not exists bout_id bigint references public.fight_bouts(id) on delete cascade;
create index if not exists event_comments_bout on public.event_comments(bout_id, id);
-- 返信（Xと同じ）：parent_id はスレッドの先頭のコメント、reply_to は直接返信したコメント
alter table public.event_comments add column if not exists parent_id bigint references public.event_comments(id) on delete cascade;
alter table public.event_comments add column if not exists reply_to bigint references public.event_comments(id) on delete set null;
create index if not exists event_comments_parent on public.event_comments(parent_id);
-- コメントへのいいね（1人1回）
create table if not exists public.event_comment_likes (
  comment_id bigint not null references public.event_comments(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.event_comment_likes enable row level security;
revoke all on public.event_comment_likes from anon, authenticated;
alter table public.fight_events   enable row level security;
alter table public.fight_bouts    enable row level security;
alter table public.predictions    enable row level security;
alter table public.event_comments enable row level security;
revoke all on public.fight_events, public.fight_bouts, public.predictions, public.event_comments from anon, authenticated;
-- 通報の対象に「大会の雑談」を追加
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('card','comment','event_comment'));

create or replace function public._bout_json(bt public.fight_bouts, locked boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  with c as (select count(*) filter (where p.pick = 'a') ca, count(*) filter (where p.pick = 'b') cb,
                    count(*) filter (where p.method = 'ko') cko, count(*) filter (where p.method = 'sub') csub,
                    count(*) filter (where p.method = 'dec') cdec, count(*) cn
               from predictions p where p.bout_id = bt.id),
       m as (select p.pick, p.method from predictions p where p.bout_id = bt.id and p.user_id = auth.uid())
  select jsonb_build_object('id', bt.id, 'ord', bt.ord, 'fa', bt.fa, 'fb', bt.fb, 'fa_name', bt.fa_name, 'fb_name', bt.fb_name,
           'rule', bt.rule, 'weight', bt.weight, 'title', bt.title, 'winner', bt.winner, 'method', bt.method,
           'n', (select cn from c),
           'ncm', (select count(*) from event_comments k where k.bout_id = bt.id and k.status = 'visible'),
           'counts', case when locked or exists(select 1 from m) or public._is_admin()
                          then (select jsonb_build_object('a', ca, 'b', cb, 'ko', cko, 'sub', csub, 'dec', cdec) from c) end,
           'me', (select jsonb_build_object('pick', m.pick, 'method', m.method) from m))
$$;

create or replace function public.list_fight_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'upcoming')::boolean desc,
           case when (x->>'upcoming')::boolean then x->>'starts_at' end asc, x->>'starts_at' desc), '[]')
    from (select jsonb_build_object('id', e.id, 'name', e.name, 'starts_at', e.starts_at, 'venue', e.venue,
                   'locked', now() >= e.starts_at, 'upcoming', e.starts_at > now() - interval '1 day', 'phase', e.phase,
                   'bouts', (select count(*) from fight_bouts b where b.event_id = e.id),
                   'predictors', (select count(distinct p.user_id) from predictions p join fight_bouts b on b.id = p.bout_id where b.event_id = e.id),
                   'comments', (select count(*) from event_comments c where c.event_id = e.id and c.status = 'visible')) x
            from fight_events e where e.status = 'public' or public._is_admin()
            order by e.starts_at desc limit 30) t
$$;

create or replace function public.get_fight_event(eid text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e fight_events; locked boolean;
begin
  select * into e from fight_events where id = eid;
  if not found or (e.status <> 'public' and not public._is_admin()) then return null; end if;
  locked := now() >= e.starts_at;
  return jsonb_build_object('id', e.id, 'name', e.name, 'starts_at', e.starts_at, 'venue', e.venue, 'source_url', e.source_url,
    'status', e.status, 'locked', locked, 'now', now(),
    -- 試合の状態：管理者の設定。全試合に結果が入っていれば「終了」とみなす
    'phase', case when e.phase is not null then e.phase
                  when exists(select 1 from fight_bouts b where b.event_id = e.id)
                   and not exists(select 1 from fight_bouts b where b.event_id = e.id and b.winner is null) then 'finished' end,
    'bouts', coalesce((select jsonb_agg(public._bout_json(b, locked) order by b.ord, b.id) from fight_bouts b where b.event_id = e.id), '[]'),
    'predictors', (select count(distinct p.user_id) from predictions p join fight_bouts b on b.id = p.bout_id where b.event_id = e.id));
end $$;

-- 予想する／変える（締め切り前だけ）。method は任意
create or replace function public.set_prediction(bid bigint, pick text, method text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); b fight_bouts; e fight_events;
begin
  if pick not in ('a','b') or (method is not null and method not in ('ko','sub','dec')) then raise exception 'BAD_PICK' using errcode = 'P0001'; end if;
  select * into b from fight_bouts where id = bid;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select * into e from fight_events where id = b.event_id;
  if e.status <> 'public' then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if now() >= e.starts_at or b.winner is not null then raise exception 'LOCKED' using errcode = 'P0001'; end if;
  insert into predictions (bout_id, user_id, pick, method) values (bid, u, set_prediction.pick, set_prediction.method)
  on conflict (bout_id, user_id) do update set pick = excluded.pick, method = excluded.method, updated_at = now();
  return public._bout_json(b, false);
end $$;

create or replace function public.clear_prediction(bid bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); b fight_bouts; e fight_events;
begin
  select * into b from fight_bouts where id = bid;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select * into e from fight_events where id = b.event_id;
  if now() >= e.starts_at or b.winner is not null then raise exception 'LOCKED' using errcode = 'P0001'; end if;
  delete from predictions where bout_id = bid and user_id = u;
  return public._bout_json(b, false);
end $$;

-- 的中ランキング（結果が入った試合だけで計算）
create or replace function public.event_ranking(eid text) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (
    select p.user_id, count(*) filter (where p.pick = b.winner) hit,
           count(*) filter (where p.pick = b.winner and p.method is not null and p.method = b.method) mhit,
           count(*) decided
      from predictions p join fight_bouts b on b.id = p.bout_id
      join fight_events e on e.id = b.event_id
     where b.event_id = eid and b.winner in ('a','b') and (e.status = 'public' or public._is_admin())
     group by p.user_id),
  r as (select s.*, hit + mhit pts, rank() over (order by hit + mhit desc, hit desc) rk from s)
  select jsonb_build_object(
    'decided', (select count(*) from fight_bouts where event_id = eid and winner in ('a','b')),
    'top', coalesce((select jsonb_agg(jsonb_build_object('rank', r.rk, 'name', coalesce(pr.display_name, '退会したユーザー'),
                       'pts', r.pts, 'hit', r.hit, 'mhit', r.mhit, 'decided', r.decided, 'mine', r.user_id = auth.uid()) order by r.rk, r.hit desc)
                       from (select * from r order by rk limit 30) r left join profiles pr on pr.id = r.user_id), '[]'),
    'me', (select jsonb_build_object('rank', rk, 'pts', pts, 'hit', hit, 'mhit', mhit, 'decided', decided, 'of', (select count(*) from r)) from r where user_id = auth.uid()))
$$;

-- 雑談スレッド（返信なしの1列。10秒に1回・1日100件まで）
create or replace function public.add_event_comment(eid text, body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); last_at timestamptz; n int; nid bigint;
begin
  body := btrim(coalesce(body, ''));
  if char_length(body) < 1 then raise exception 'EMPTY' using errcode = 'P0001'; end if;
  if char_length(body) > 200 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  if not exists(select 1 from fight_events where id = eid and status = 'public') then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  select id into nid from event_comments c where c.user_id = u and c.event_id = eid and c.body = add_event_comment.body
     and c.created_at > now() - interval '2 minutes' and c.status = 'visible' limit 1;
  if nid is not null then return jsonb_build_object('id', nid, 'duplicate', true); end if;
  select max(created_at), count(*) filter (where created_at > now() - interval '1 day') into last_at, n from event_comments where user_id = u;
  if last_at > now() - interval '10 seconds' then raise exception 'TOO_FAST' using errcode = 'P0001'; end if;
  if n >= 100 then raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into event_comments (event_id, user_id, body) values (eid, u, body) returning id into nid;
  return jsonb_build_object('id', nid, 'duplicate', false);
end $$;

-- after_id より新しいものを古い順に（自動更新用）。after_id = 0 なら全件（最新1000件まで）。ログインしていない人も読める
-- 書いた人がその試合でどちらを予想しているか（pick）、返信先、いいね数も返す
-- 削除されたコメントでも、表示中の返信が付いていれば「削除されました」として残す（会話が途切れないように）
create or replace function public.list_event_comments(eid text, after_id bigint default 0) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'bout', c.bout_id, 'parent', c.parent_id,
           'deleted', c.status <> 'visible',
           'body', case when c.status = 'visible' then c.body else '' end, 'created_at', c.created_at,
           'name', case when c.status = 'visible' then coalesce(p.display_name, '退会したユーザー') else '' end,
           'mine', c.status = 'visible' and c.user_id = auth.uid(),
           'reply_to', c.reply_to,
           'to_me', c.status = 'visible' and c.user_id is distinct from auth.uid() and exists(select 1 from event_comments r where r.id = c.reply_to and r.user_id = auth.uid()),
           'reply_name', (select coalesce(rp.display_name, '退会したユーザー') from event_comments r left join profiles rp on rp.id = r.user_id where r.id = c.reply_to),
           'likes', (select count(*) from event_comment_likes l where l.comment_id = c.id),
           'liked', exists(select 1 from event_comment_likes l where l.comment_id = c.id and l.user_id = auth.uid()),
           'pick', case when c.status = 'visible' then (select pr.pick from predictions pr where pr.bout_id = c.bout_id and pr.user_id = c.user_id) end) order by c.id), '[]')
    from (select * from event_comments c
           where c.event_id = eid and c.id > coalesce(after_id, 0)
             and (c.status = 'visible' or (c.parent_id is null and exists(select 1 from event_comments k where k.parent_id = c.id and k.status = 'visible')))
             and exists(select 1 from fight_events e where e.id = eid and (e.status = 'public' or public._is_admin()))
           order by c.id desc limit 1000) c
    left join profiles p on p.id = c.user_id
$$;

-- 自動更新用：いいね数の変化だけをまとめて返す（{"コメントID": [数, 自分が押したか]}）
create or replace function public.event_comment_likes(eid text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(x.comment_id::text, jsonb_build_array(x.n, x.mine)), '{}')
    from (select l.comment_id, count(*) n, bool_or(l.user_id = auth.uid()) mine
            from event_comment_likes l join event_comments c on c.id = l.comment_id
           where c.event_id = eid and c.status = 'visible' group by l.comment_id) x
$$;

create or replace function public.like_event_comment(mid bigint, on_ boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  if not exists(select 1 from event_comments c join fight_events e on e.id = c.event_id where c.id = mid and c.status = 'visible' and e.status = 'public') then
    raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if on_ then insert into event_comment_likes (comment_id, user_id) values (mid, u) on conflict do nothing;
  else delete from event_comment_likes where comment_id = mid and user_id = u; end if;
  return jsonb_build_object('likes', (select count(*) from event_comment_likes where comment_id = mid), 'liked', on_);
end $$;

-- 試合ごとのコメント（雑談と同じ制限：10秒に1回・1日100件まで）。reply_to を付けると返信になる
drop function if exists public.add_bout_comment(bigint, text);
create or replace function public.add_bout_comment(bid bigint, body text, reply_to bigint default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me(); eid text; last_at timestamptz; n int; nid bigint; root bigint; tgt event_comments;
begin
  body := btrim(coalesce(body, ''));
  if char_length(body) < 1 then raise exception 'EMPTY' using errcode = 'P0001'; end if;
  if char_length(body) > 200 then raise exception 'TOO_LONG' using errcode = 'P0001'; end if;
  select b.event_id into eid from fight_bouts b join fight_events e on e.id = b.event_id where b.id = bid and e.status = 'public';
  if eid is null then raise exception 'NOT_FOUND' using errcode = 'P0001'; end if;
  if add_bout_comment.reply_to is not null then
    select * into tgt from event_comments c where c.id = add_bout_comment.reply_to;
    if tgt.id is null or tgt.status <> 'visible' or tgt.bout_id is distinct from bid then raise exception 'REPLY_GONE' using errcode = 'P0001'; end if;
    root := coalesce(tgt.parent_id, tgt.id);
  end if;
  select id into nid from event_comments c where c.user_id = u and c.bout_id = bid and c.body = add_bout_comment.body
     and c.created_at > now() - interval '2 minutes' and c.status = 'visible' limit 1;
  if nid is not null then return jsonb_build_object('id', nid, 'duplicate', true); end if;
  select max(created_at), count(*) filter (where created_at > now() - interval '1 day') into last_at, n from event_comments where user_id = u;
  if last_at > now() - interval '10 seconds' then raise exception 'TOO_FAST' using errcode = 'P0001'; end if;
  if n >= 100 then raise exception 'RATE_LIMIT' using errcode = 'P0001'; end if;
  insert into event_comments (event_id, bout_id, user_id, body, parent_id, reply_to) values (eid, bid, u, body, root, add_bout_comment.reply_to) returning id into nid;
  return jsonb_build_object('id', nid, 'duplicate', false);
end $$;

create or replace function public.delete_event_comment(mid bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare u uuid := public._me();
begin
  update event_comments set status = 'deleted', body = '' where id = mid and user_id = u and status = 'visible';
  if not found then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  return true;
end $$;

-- 管理者：大会と対戦カードの登録・結果の入力
create or replace function public.admin_upsert_event(eid text, name text, starts_at timestamptz, venue text default null,
                                                     source_url text default null, status text default 'public') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  insert into fight_events (id, name, starts_at, venue, source_url, status)
  values (eid, btrim(name), starts_at, nullif(btrim(coalesce(venue, '')), ''), nullif(btrim(coalesce(source_url, '')), ''), coalesce(status, 'public'))
  on conflict (id) do update set name = excluded.name, starts_at = excluded.starts_at, venue = excluded.venue,
    source_url = excluded.source_url, status = excluded.status;
  return public.get_fight_event(eid);
end $$;

create or replace function public.admin_add_bout(eid text, fa_name text, fb_name text, fa text default null, fb text default null,
                                                 rule text default 'mma', weight text default null, title boolean default false, ord int default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  insert into fight_bouts (event_id, ord, fa, fb, fa_name, fb_name, rule, weight, title)
  values (eid, coalesce(ord, (select coalesce(max(b.ord), 0) + 1 from fight_bouts b where b.event_id = eid)),
          nullif(fa, ''), nullif(fb, ''), btrim(fa_name), btrim(fb_name), coalesce(rule, 'mma'), nullif(btrim(coalesce(weight, '')), ''), coalesce(title, false))
  returning id into nid;
  return nid;
end $$;

create or replace function public.admin_set_phase(eid text, phase text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  if phase is not null and phase not in ('live','finished') then raise exception 'BAD_PHASE' using errcode = 'P0001'; end if;
  update fight_events e set phase = nullif(admin_set_phase.phase, '') where e.id = eid;
  return true;
end $$;

create or replace function public.admin_delete_bout(bid bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  delete from fight_bouts where id = bid;
  return true;
end $$;

create or replace function public.admin_set_result(bid bigint, winner text, method text default null) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public._is_admin() then raise exception 'FORBIDDEN' using errcode = 'P0001'; end if;
  update fight_bouts b set winner = nullif(admin_set_result.winner, ''), method = nullif(admin_set_result.method, '') where b.id = bid;
  return true;
end $$;

-- 共有ページ生成用（公開キーで読む）
create or replace function public.export_fight_events() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'starts_at', e.starts_at, 'venue', e.venue, 'status', e.status,
           'bouts', coalesce((select jsonb_agg(jsonb_build_object('fa', b.fa, 'fb', b.fb, 'fa_name', b.fa_name, 'fb_name', b.fb_name, 'title', b.title) order by b.ord, b.id)
                              from fight_bouts b where b.event_id = e.id), '[]')) order by e.starts_at), '[]')
    from fight_events e
$$;

-- ---------- 実行権限 ----------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.list_cards(text, text, text, int, int), public.get_card(text), public.find_cards(text, text),
  public.list_comments(text, text), public.related_cards(text, text[]), public.current_theme(), public.export_cards(timestamptz),
  public.unread_count(), public.whoami(), public.log_event(text, text, text, jsonb, text),
  public.submit_contact(text, text, text, text, text),
  public.list_fight_events(), public.get_fight_event(text), public.event_ranking(text), public.list_event_comments(text, bigint), public.event_comment_likes(text),
  public.export_fight_events()
  to anon, authenticated;
grant execute on function public.create_card(text, text, text, text, text, text, boolean), public.set_reaction(text, text, boolean),
  public.set_save(text, boolean), public.add_comment(text, text, bigint, boolean, text), public.edit_comment(bigint, text),
  public.delete_comment(bigint), public.report(text, text, text, text), public.my_page(), public.my_notifications(int),
  public.mark_notifications_seen(), public.request_fighter(text, text), public.set_display_name(text), public.admin_reports(), public.admin_set_hidden(text, text, boolean), public.admin_dismiss(text, text),
  public.admin_contacts(), public.admin_contact_done(bigint),
  public.set_prediction(bigint, text, text), public.clear_prediction(bigint), public.add_event_comment(text, text), public.add_bout_comment(bigint, text, bigint), public.like_event_comment(bigint, boolean), public.delete_event_comment(bigint),
  public.admin_upsert_event(text, text, timestamptz, text, text, text), public.admin_add_bout(text, text, text, text, text, text, text, boolean, int),
  public.admin_delete_bout(bigint), public.admin_set_result(bigint, text, text), public.admin_set_phase(text, text)
  to authenticated;
