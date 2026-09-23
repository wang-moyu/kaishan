-- Migration number: 0014 	 Name: disciple_journeys
--
-- 弟子单人历练（docs/弟子历练开发计划.md）：
--   disciple_journeys <- 历练记录（出发 / 返程 / 领取三段状态 + 出发时快照的结果）
--
-- 说明：
--   - 单人、定时、挂机决策：出发时按弟子属性快照抽出结果并落库，到期后按服务器时间归队，
--     资源在玩家领取时一次性入账；不做取消 / 加速 / 组队 / 掉落道具。
--   - 时间统一为 UTC 整数毫秒（03 第 1 节）；started_at / ends_at / completed_at / claimed_at
--     都是绝对时间戳，不依赖浏览器计时器或 Cron。
--   - disciple_id **不**建外键：历史记录在弟子被驱逐后仍要保留姓名与结果；
--     只允许「已领取后驱逐」（service 层在野状态校验里把关）。
--   - disciple_name 是出发时的姓名快照，驱逐后历史仍可读。
--   - original_assignment 记录出发前的岗位快照；disciples.assignment 保持不变，
--     在外期间由结算与状态视图暂时屏蔽产出（不往岗位配置里插假岗位）。
--   - reward_cultivation / reward_resources / extra_harvest / injured / injury_chance_bp 是
--     出发时确定、到期前**不向前端公开**的结果快照；cultivation_awarded 是返程时按当时
--     突破门槛实际入账的修为（未处理返程为 NULL，与 completed_at 同生共死）。
--   - reward_resources 是受控 JSON（resourceId -> 最小单位整数），与 event_log.effects 同一做法。
--   - 唯一部分索引（disciple_id WHERE claimed_at IS NULL）从数据库层堵住同一弟子重复出发：
--     每名弟子最多一条未领取记录（在外中 + 待领取合计一条）；已领取的历史不受限。
--   - CHECK 约束是最后一道兜底，业务错误一律在 service 层先抛（不泄露 SQL）。

CREATE TABLE disciple_journeys (
  id TEXT PRIMARY KEY,
  sect_id TEXT NOT NULL REFERENCES sects (id),
  -- 不设外键：历史记录必须能在弟子被驱逐后留存
  disciple_id TEXT NOT NULL,
  -- 出发时的姓名快照
  disciple_name TEXT NOT NULL,
  -- 方向：访道 / 采集
  direction TEXT NOT NULL CHECK (direction IN ('daoSeeking', 'gathering')),
  -- 时长白名单：2 小时 / 6 小时
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds IN (7200, 21600)),
  -- 出发前的岗位快照（disciples.assignment 本身不改）
  original_assignment TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  -- 逻辑返程时间：isJourneyAway 的判定基准，与玩家何时上线无关
  ends_at INTEGER NOT NULL,
  -- 已处理返程（修为/伤势入账）的时刻；NULL = 尚未归队结算
  completed_at INTEGER,
  -- 资源已入账的时刻；NULL = 尚未领取。重复领取必须失败（唯一部分索引 + 条件更新双保险）
  claimed_at INTEGER,
  -- 出发时快照：计划修为（保底 + 额外收获，未按返程门槛截断）
  reward_cultivation INTEGER NOT NULL CHECK (reward_cultivation >= 0),
  -- 出发时快照：各项资源（保底 + 额外收获），受控 JSON
  reward_resources TEXT NOT NULL DEFAULT '{}',
  -- 额外收获 / 受伤结果（0/1；与上面两项同属「到期前不公开」的结果快照）
  extra_harvest INTEGER NOT NULL DEFAULT 0 CHECK (extra_harvest IN (0, 1)),
  injured INTEGER NOT NULL DEFAULT 0 CHECK (injured IN (0, 1)),
  -- 实际受伤概率（基点，已按出发时战力下调并 clamp）
  injury_chance_bp INTEGER NOT NULL CHECK (injury_chance_bp >= 0 AND injury_chance_bp <= 10000),
  -- 返程时实际入账的修为（受返程门槛封顶）；未处理返程为 NULL
  cultivation_awarded INTEGER CHECK (cultivation_awarded IS NULL OR cultivation_awarded >= 0),
  created_at INTEGER NOT NULL,
  -- 时长必须为正；返程不可能早于出发
  CHECK (ends_at > started_at),
  -- 完成与领取的顺序：没完成不可能已领取
  CHECK (claimed_at IS NULL OR completed_at IS NOT NULL)
);

-- 每名弟子最多一条未领取记录（在外中或待领取）；已领取的历史不参与唯一性
CREATE UNIQUE INDEX disciple_journeys_active_disciple_idx
  ON disciple_journeys (disciple_id)
  WHERE claimed_at IS NULL;

-- 按宗门加载「未领取记录（active + ready）」：sect_id + claimed_at
CREATE INDEX disciple_journeys_sect_open_idx
  ON disciple_journeys (sect_id, claimed_at);

-- 按宗门取最近历史（新的在前）
CREATE INDEX disciple_journeys_sect_started_idx
  ON disciple_journeys (sect_id, started_at DESC);

-- 单弟子的历史（驱逐前的归属核对与「未领取记录」判定）
CREATE INDEX disciple_journeys_disciple_idx
  ON disciple_journeys (disciple_id);
