-- Migration number: 0015 	 Name: realm_explorations
--
-- 交互式秘境探索（docs/V6-秘境探索重构.md）：
--   realm_explorations <- 进行中的探索（关卡进度 + 当前遭遇 + 已得奖励）
--
-- 说明：
--   - 这是「速通」之外的新玩法：进场后逐关给遭遇，玩家每次选择都调一次决策模型判定结果，
--     所以需要一条**跨请求存活**的进行中记录（前端刷新 / 断线后靠 GET /game/realm-explore/active 续上）。
--     旧的 explorations 表（0006）只记「一次性判定」的最终结果，承载不了中间状态，故另建本表。
--   - 时间统一为 UTC 整数毫秒（03 第 1 节）：created_at / updated_at 都是绝对时间戳，
--     不依赖浏览器计时器或 Cron；本玩法没有到期时间，进度只由玩家的 choose 推进。
--   - 为什么用 JSON 列：party / current_encounter / used_encounters / rewards_collected 都是
--     每次请求整体读出的**受控小结构**（弟子 id 数组 / 一个遭遇 + 选项 / 已用场景 id / 累计奖励），
--     与 event_log.effects、disciple_journeys.reward_resources 同一做法：不做关联查询、不按字段筛，
--     写成 JSON 文本即可；脏数据由读取侧（parse 失败退化为空值）兜底，不让整个 state 读取失败。
--     current_encounter 可空：NULL 表示这一局已经结束（completed / failed），不再有等待玩家的选择。
--   - 为什么编号是 0015 而不是 0014：0014 已被弟子历练（disciple_journeys）占用，按编号顺序前进。
--   - 每宗门同时最多一条 in_progress：业务规则在 service 层判定，并发由下面那个部分唯一索引兜底。
--   - 不建 status 的 CHECK：状态机（in_progress → completed / failed，终态不可逆）在 service 层判定，
--     迁移只保证列存在与默认值（与 0006 的 explorations 一致，避免升级旧行时被约束卡住）。
--   - 不设 party 的外键：探索记录是历史，弟子被驱逐后仍需可读（与 disciple_journeys 同一考虑）。

CREATE TABLE realm_explorations (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  realm_id TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '[]',
  total_stages INTEGER NOT NULL,
  current_stage INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'in_progress',
  current_encounter TEXT,
  used_encounters TEXT NOT NULL DEFAULT '[]',
  rewards_collected TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX realm_explorations_sect_idx
  ON realm_explorations (sect_id, status, created_at DESC);

-- 每宗门同时只能有一场进行中的探索。
-- service 层的「查一次有没有 in_progress」是读后写：两个并发「开始」请求都会通过。
-- 这个部分唯一索引让第二个提交拿到 UNIQUE 失败，整批回滚并被映射成业务错误，
-- 保证数据库里永远不会有两条 in_progress（与 challenge_log 的唯一部分索引同一思路）。
CREATE UNIQUE INDEX realm_explorations_active_uniq
  ON realm_explorations (sect_id) WHERE status = 'in_progress';
