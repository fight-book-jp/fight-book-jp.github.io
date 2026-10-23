-- abc presents RIZIN.55（2026年11月8日・LaLa arena TOKYO-BAY）の大会と対戦カードを登録
-- 出典：RIZIN公式サイトの大会ページ（https://jp.rizinff.com/_ct/17852466）と、ABEMA TIMES の対戦カード一覧（2026年10月13日時点）
-- 予想の締め切りは、オープニングファイトの開始予定 13:00 にしています（本戦は14:00開始予定）
-- 何度実行しても、試合が二重に登録されることはありません
insert into public.fight_events (id, name, starts_at, venue, source_url, status)
values ('rizin-55', 'abc presents RIZIN.55', '2026-11-08 13:00:00+09', 'LaLa arena TOKYO-BAY（千葉・船橋）',
        'https://jp.rizinff.com/_ct/17852466', 'public')
on conflict (id) do update set name = excluded.name, starts_at = excluded.starts_at, venue = excluded.venue, source_url = excluded.source_url;

insert into public.fight_bouts (event_id, ord, fa, fb, fa_name, fb_name, rule, weight, title)
select 'rizin-55', ord, fa, fb, fa_name, fb_name, 'mma', weight, title
  from (values
    (1,  null,                 null,                '井上舜矢',                     'マイティ・saw',           '61.0kg（オープニングファイト）', false),
    (2,  null,                 null,                '松本尚大',                     '髙橋正親',                '66.0kg（オープニングファイト）', false),
    (3,  null,                 'sho-sekihara',      '濱田巧',                       '関原翔',                  '57.0kg', false),
    (4,  null,                 null,                '力也',                         '木村琉音',                '57.0kg', false),
    (5,  'taichi-nakajima',    null,                '中島太一',                     '溝口司',                  '61.0kg', false),
    (6,  'tatsuya-saika',      'daigo-kuramoto',    '雑賀“ヤン坊”達也',             '倉本大悟',                '71.0kg', false),
    (7,  'kim-kyung-pyo',      'nurkhan-zhumagazy', 'キム・ギョンピョ',             'ヌルハン・ズマガジー',     '71.0kg', false),
    (8,  'juntaro-ushiku',     'li-kaiwen',         '牛久絢太郎',                   'リー・カイウェン',         '66.0kg', false),
    (9,  'hiroaki-suzuki',     null,                '鈴木博昭',                     '千春',                    '66.0kg', false),
    (10, 'abijah-kaleo-meheula', null,             'アバイジャ・カレオ・メヘウラ', '相本宗輝',                '66.0kg', false),
    (11, 'jinnosuke-kashimura','shinobu-ota',       '鹿志村仁之介',                 '太田忍',                  '61.0kg', false),
    (12, 'ryuya-fukuda',       'soo-chul-kim',      '福田龍彌',                     'キム・スーチョル',         '61.0kg', false),
    (13, 'inoue',              'yrysbek-tilenov',   '井上直樹',                     'イリスベク・ティレノフ',   '61.0kg', false),
    (14, 'shinryu',            'tony-laramie',      '神龍誠',                       'トニー・ララミー',         'フライ級 57.0kg', true)
  ) as t(ord, fa, fb, fa_name, fb_name, weight, title)
 where not exists (select 1 from public.fight_bouts where event_id = 'rizin-55');

select b.ord, b.fa_name, b.fb_name, b.weight, b.title from public.fight_bouts b where b.event_id = 'rizin-55' order by b.ord;
