-- 編集部提案のカードを8枚登録（何度実行しても重複しません）
-- 作成者は管理者アカウント。票やコメントは入れません（架空の反応は作らない）。
do $$
declare admin uuid; r record; cid text;
begin
  select id into admin from public.profiles where is_admin order by created_at limit 1;
  if admin is null then raise exception '管理者が見つかりません。先に管理者の設定をしてください'; end if;
  for r in select * from (values
    ('shinryu', 'kyoji-horiguchi', 'mma', 'フライ級の実力者同士。スピードと技術の頂上決戦が見たい。'),
    ('shaydullaev', 'akimoto', 'mma', '上位同士、打撃と組みがどう噛み合うのか見てみたい。'),
    ('sabatello', 'inoue', 'mma', 'バンタム級上位同士。組み技の攻防に注目したい。'),
    ('gustavo', 'satoshi', 'mma', 'ライト級の上位同士。寝技の展開になるかが見どころ。'),
    ('izawa', 'saori-oshima', 'mma', '女子の上位同士。グラップリングの攻防が見たい。'),
    ('tsuyoshi-sudario', 'alexander-soldatkin', 'mma', '重量級の迫力ある打ち合いが見たい。'),
    ('asakura', 'suzuki', 'kickboxing', 'MMAではなく立ち技ルールで、打撃の技術を比べてほしい。'),
    ('yuki-ito', 'ougikubo', 'mma', 'フライ級の上位争い。粘り強い攻防になりそう。')
  ) as t(a, b, rule, reason)
  loop
    if exists (select 1 from public.cards where fa = least(r.a, r.b) and fb = greatest(r.a, r.b) and rule = r.rule and cond = 'standard') then
      continue;
    end if;
    cid := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    insert into public.cards (id, fa, fb, rule, cond, origin, creator)
    values (cid, least(r.a, r.b), greatest(r.a, r.b), r.rule, 'standard', 'editorial', admin);
    insert into public.comments (card_id, user_id, is_reason, hint, body) values (cid, admin, true, 'why', r.reason);
  end loop;
end $$;
select id, fa, fb, rule, origin from public.cards where origin = 'editorial' order by created_at;
