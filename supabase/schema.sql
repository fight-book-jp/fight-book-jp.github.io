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
alter table public.events     enable row level security;
revoke all on public.profiles, public.cards, public.reactions, public.want_first, public.comments,
              public.saves, public.reports, public.themes, public.events, public.fighter_requests from anon, authenticated;

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
                 where s.user_id = u and c.status = 'public'));
end $$;

-- 自分に関係のある事実だけ：自分のコメントへの返信／自分のカードへのコメント／自分のカードへの「見たい」
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
                            else (select fa || ' vs ' || fb from cards where id = target_id) end,
            'card_id', case when target_type = 'comment' then (select card_id from comments where id::text = target_id) else target_id end)
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

-- ---------- 実行権限 ----------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.list_cards(text, text, text, int, int), public.get_card(text), public.find_cards(text, text),
  public.list_comments(text, text), public.related_cards(text, text[]), public.current_theme(), public.export_cards(timestamptz),
  public.unread_count(), public.whoami(), public.log_event(text, text, text, jsonb, text)
  to anon, authenticated;
grant execute on function public.create_card(text, text, text, text, text, text, boolean), public.set_reaction(text, text, boolean),
  public.set_save(text, boolean), public.add_comment(text, text, bigint, boolean, text), public.edit_comment(bigint, text),
  public.delete_comment(bigint), public.report(text, text, text, text), public.my_page(), public.my_notifications(int),
  public.mark_notifications_seen(), public.request_fighter(text, text), public.set_display_name(text), public.admin_reports(), public.admin_set_hidden(text, text, boolean), public.admin_dismiss(text, text)
  to authenticated;
