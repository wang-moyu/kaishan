-- Migration number: 0018 	Name: disciple_avatar_frame_extend
--
-- 弟子头像框扩到 20 张素材（掌门私有外观）：
--   disciples <- 放宽 avatar_frame_id 的 CHECK：'classic' + 'frame01'…'frame10'
--                扩为 'classic' + 'frame01'…'frame20'（新增 frame11–frame20 十张素材）
--
-- 为什么是重建表：
--   - SQLite 不能就地修改已有的 CHECK（DDL 没有这个能力），只能建同构新表 + 搬运数据。
--     0001–0017 都只有 ADD COLUMN / CREATE TABLE，这是仓库里第一个重建表的迁移。
--
-- 语句顺序是刻意排的（先改名备份，最后才删）：
--     1. ALTER TABLE disciples RENAME TO disciples_0018_old;  -- 旧表整体改名为备份，正式表名空出来
--     2. CREATE TABLE disciples (...);                        -- 新结构占用正式表名
--     3. INSERT INTO disciples SELECT ... FROM disciples_0018_old;
--     4. DROP TABLE disciples_0018_old;                       -- 到这里才丢备份
--   - 这样无论哪一条失败，**原始数据都还在**（在 disciples 或 disciples_0018_old 里），
--     最坏情况是多出一张备份表要人工改名，而不是数据丢失；
--     反过来的顺序（先建新表、DROP 旧表、再 RENAME）在 DROP 与 RENAME 之间失败时
--     会出现「disciples 不存在、数据在临时表里」的坏态，所以不采用。
--   - 注意索引：disciples_sect_id_idx 跟着旧表一起被改名占用，因此必须在第 4 步之后才重建，
--     否则会撞「index disciples_sect_id_idx already exists」。
--   - D1 正常会把单个迁移文件当一次事务执行，失败整体回滚；上面这套顺序是不依赖该前提的兜底。
--   - 远程 D1 没有自动备份（CI 是无值守 apply），正式执行前建议先 `wrangler d1 export`，
--     或先在一个 staging D1 上跑一遍——本地 miniflare 成功只证明本地 SQLite 接受这套 DDL。
--
-- 结构与数据的等价性：
--   - 新表与 0017 之后的实际结构逐列一致：列名、顺序、类型、NOT NULL、DEFAULT 全部保留，
--     body_tempering_count / note / luck / physique 各自的 CHECK 也原样保留；
--     唯一的差异是 avatar_frame_id 的候选值多了 frame11…frame20。
--   - 不执行任何 UPDATE、不重掷：资质、攻/防/速、天赋、境界、修为、修为余量、淬体次数、
--     备注，以及玩家已经选好的头像框（'classic' 或 frame01–frame10）全部逐行原样保留。
--   - 第 3 步的 INSERT 显式列了 21 列：**本迁移必须排在本次发布里其它 disciples 加列迁移之后**，
--     否则那一列会被静默丢掉（测试里那份同源硬编码的列清单拦不住这种情况）。
--   - 没有其他表用 FOREIGN KEY 指向 disciples（0001–0017 里的外键都指向 sects / users，
--     disciple_journeys / explorations / challenge_log 等只存 id 快照、不建外键），
--     所以改名与 DROP 不会级联删行、也不会留下孤儿行；
--     disciples.sect_id REFERENCES sects (id) 这条出向外键照旧保留。
--   - 重跑注意：如果上一次执行失败并留下了 disciples_0018_old，直接重跑会在第 1 步报
--     「table disciples_0018_old already exists」——先确认 disciples 里是完整数据，再手工删掉备份表。
--
-- 白名单口径（三处必须一致，都是 21 个值）：
--   - 本迁移的 CHECK；
--   - apps/server/src/modules/game/schema.ts 的 AVATAR_FRAME_IDS；
--   - apps/web/src/utils/avatarFrames.ts 的 AVATAR_FRAME_IDS。
--   再加素材时，这三处 + tests/web/avatar-frame.test.ts 的素材断言要一起改。

ALTER TABLE disciples RENAME TO disciples_0018_old;

CREATE TABLE disciples (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  name TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'male',
  aptitude INTEGER NOT NULL,
  realm_id TEXT NOT NULL DEFAULT 'qiRefining',
  stage INTEGER NOT NULL DEFAULT 1,
  cultivation INTEGER NOT NULL DEFAULT 0,
  cultivation_remainder INTEGER NOT NULL DEFAULT 0,
  assignment TEXT NOT NULL DEFAULT 'idle',
  injured_until INTEGER,
  created_at INTEGER NOT NULL,
  attack INTEGER NOT NULL DEFAULT 50,
  defense INTEGER NOT NULL DEFAULT 50,
  speed INTEGER NOT NULL DEFAULT 50,
  talent TEXT NOT NULL DEFAULT 'none',
  body_tempering_count INTEGER NOT NULL DEFAULT 0
    CHECK (body_tempering_count >= 0),
  note TEXT NOT NULL DEFAULT ''
    CHECK (length(note) <= 60),
  luck INTEGER NOT NULL DEFAULT 50
    CHECK (luck BETWEEN 1 AND 100),
  physique INTEGER NOT NULL DEFAULT 50
    CHECK (physique BETWEEN 1 AND 100),
  avatar_frame_id TEXT NOT NULL DEFAULT 'classic'
    CHECK (avatar_frame_id IN (
      'classic',
      'frame01', 'frame02', 'frame03', 'frame04', 'frame05',
      'frame06', 'frame07', 'frame08', 'frame09', 'frame10',
      'frame11', 'frame12', 'frame13', 'frame14', 'frame15',
      'frame16', 'frame17', 'frame18', 'frame19', 'frame20'
    ))
);

INSERT INTO disciples (
  id, sect_id, name, gender, aptitude, realm_id, stage, cultivation, cultivation_remainder,
  assignment, injured_until, created_at, attack, defense, speed, talent,
  body_tempering_count, note, luck, physique, avatar_frame_id
)
SELECT
  id, sect_id, name, gender, aptitude, realm_id, stage, cultivation, cultivation_remainder,
  assignment, injured_until, created_at, attack, defense, speed, talent,
  body_tempering_count, note, luck, physique, avatar_frame_id
FROM disciples_0018_old;

DROP TABLE disciples_0018_old;

CREATE INDEX disciples_sect_id_idx ON disciples (sect_id);
