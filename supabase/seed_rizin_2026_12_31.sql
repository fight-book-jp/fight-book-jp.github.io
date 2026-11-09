-- ① RIZIN.55 の試合結果を登録して「終了」にする
-- ② 大晦日（超RIZIN.6 師走の尾張名古屋下剋上祭り）を公開し、発表済みの対戦カードを登録する
-- Supabase の SQL Editor に全部貼り付けて「Run」を押してください。何度実行しても結果は同じです。
--
-- 出典
--   RIZIN.55 結果：RIZIN公式「『abc presents RIZIN.55』試合結果一覧」 https://jp.rizinff.com/_ct/17874942
--   大晦日カード ：RIZIN公式「大晦日大会タイトル＆第1弾対戦カード発表」 https://jp.rizinff.com/_ct/17874147（2026/11/4）
--                  にわか格闘技ファン「RIZIN 大晦日 2026」対戦カード一覧（2026/11/5 更新）
--   winner：'a'＝左側（fa_name）、'b'＝右側（fb_name）、'nc'＝ノーコンテスト
--   method：'ko'＝KO・TKO、'sub'＝一本（テクニカルサブミッションを含む）、'dec'＝判定

-- ① RIZIN.55 の結果
update public.fight_bouts b set winner = r.winner, method = r.method
  from (values
    ('井上舜矢',                     'マイティ・saw',           'b',  'dec'),  -- 2R 判定 0-3
    ('松本尚大',                     '髙橋正親',                'b',  'ko'),   -- 1R 0:25 TKO（グラウンドパンチ）
    ('濱田巧',                       '関原翔',                  'a',  'ko'),   -- 3R 4:56 TKO（グラウンドパンチ）
    ('力也',                         '木村琉音',                'a',  'dec'),  -- 3R 判定 3-0
    ('中島太一',                     '溝口司',                  'b',  'sub'),  -- 1R 0:22 テクニカルサブミッション（リアネイキッドチョーク）
    ('雑賀“ヤン坊”達也',             '倉本大悟',                'a',  'ko'),   -- 1R 1:38 TKO（グラウンドパンチ）
    ('キム・ギョンピョ',             'ヌルハン・ズマガジー',     'b',  'ko'),   -- 1R 3:34 TKO（グラウンドパンチ）
    ('牛久絢太郎',                   'リー・カイウェン',         'a',  'dec'),  -- 3R 判定 3-0
    ('鈴木博昭',                     '千春',                    'b',  'ko'),   -- 2R 4:41 TKO（グラウンドでの肘打撃）
    ('アバイジャ・カレオ・メヘウラ', '相本宗輝',                'nc', null),   -- 2R 4:58 ノーコンテスト（メヘウラの体重超過）
    ('鹿志村仁之介',                 '太田忍',                  'a',  'sub'),  -- 3R 1:51 一本（エゼキエルチョーク）
    ('福田龍彌',                     'キム・スーチョル',         'a',  'dec'),  -- 3R 判定 3-0
    ('井上直樹',                     'イリスベク・ティレノフ',   'b',  'dec'),  -- 3R 判定 0-3
    ('神龍誠',                       'トニー・ララミー',         'b',  'dec')   -- 3R 判定 1-2（ララミーが新王者）
  ) as r(fa_name, fb_name, winner, method)
 where b.event_id = 'rizin-55' and b.fa_name = r.fa_name and b.fb_name = r.fb_name;

update public.fight_events set phase = 'finished' where id = 'rizin-55';

-- ② 大晦日：大会を公開
insert into public.fight_events (id, name, starts_at, venue, source_url, status)
values ('rizin-2026-12-31', '超RIZIN.6 師走の尾張名古屋下剋上祭り', '2026-12-31 13:00:00+09', 'バンテリンドーム ナゴヤ（愛知・名古屋）',
        'https://jp.rizinff.com/_ct/17874147', 'public')
on conflict (id) do update set name = excluded.name, starts_at = excluded.starts_at, venue = excluded.venue,
                               source_url = excluded.source_url, status = 'public', phase = null;

-- まだ誰も予想していない仮の試合があれば消してから、発表済みのカードを登録（同じ組み合わせは二重に入れない）
delete from public.fight_bouts b
 where b.event_id = 'rizin-2026-12-31' and not exists (select 1 from public.predictions p where p.bout_id = b.id);

insert into public.fight_bouts (event_id, ord, fa, fb, fa_name, fb_name, rule, weight, title)
select 'rizin-2026-12-31', t.ord, t.fa, t.fb, t.fa_name, t.fb_name, 'mma', t.weight, t.title
  from (values
    (1,  null,               null,                 '松尾クリスチャンアキラ',       '金子蒼空',                'バンタム級（RIZIN甲子園 決勝・5分2R）', false),
    (2,  'daichi-tomizawa',  null,                 '冨澤大智',                     'ドンマイ川端',            '59.0kg契約', false),
    (3,  'hinotori',         'tatsuki-shinotsuka', '火の鳥',                       '篠塚辰樹',                'フライ級 57.0kg', false),
    (4,  null,               'joe-hiramoto',       'ヒロヤ',                       '平本丈',                  'フライ級 57.0kg', false),
    (5,  'yutaro-muramoto',  null,                 '村元友太郎',                   '山本アーセン',            'フライ級 57.0kg', false),
    (6,  'suzuki',           'ya-man',             '鈴木千裕',                     'YA-MAN',                  'フェザー級 66.0kg', false),
    (7,  'tsuyoshi-sudario', 'king-edokpolo',      'スダリオ剛',                   'エドポロキング',          'ヘビー級（GP JAPAN 決勝）', false),
    (8,  'saori-oshima',     'natalia-kuziutina',  '大島沙緒里',                   'ナターシャ・クジュティナ', '女子スーパーアトム級', true),
    (9,  'gustavo',          'asakura',            'ルイス・グスタボ',             '朝倉未来',                'ライト級 71.0kg', false),
    (10, 'shaydullaev',      'akimoto',            'ラジャブアリ・シェイドゥラエフ', '秋元強真',              'フェザー級 66.0kg', true)
  ) as t(ord, fa, fb, fa_name, fb_name, weight, title)
 where not exists (select 1 from public.fight_bouts b
                    where b.event_id = 'rizin-2026-12-31' and b.fa_name = t.fa_name and b.fb_name = t.fb_name);

-- 確認用
select e.id, e.name, e.phase, e.status,
       (select count(*) from public.fight_bouts b where b.event_id = e.id) as bouts,
       (select count(*) from public.fight_bouts b where b.event_id = e.id and b.winner is null) as no_result
  from public.fight_events e where e.id in ('rizin-55', 'rizin-2026-12-31');
