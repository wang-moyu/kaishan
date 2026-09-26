import { ParamRepository, type ParameterizedQuery } from '../../infra/db/repository';

import type { PillAttribute } from './alchemy';
import { EQUIPMENT_QUALITIES } from './equipment';
import type { BettableAttribute } from './gambling';

/**
 * 游戏仓储（一次性可玩版本）。
 *
 * 说明：本版本「读状态 → 算结果 → 写回去」，写操作由 service 组装成**一次** D1 batch。
 * 因此这里除了读方法（await），还提供纯函数形式的语句构造器（`...Statement`）——
 * batch 需要的是 D1PreparedStatement，而不是已 await 的结果。
 */

export interface SectRow {
  id: string;
  user_id: string;
  name: string;
  level: number;
  vein_level: number;
  /** 声望（V3 切磋胜利 +10）；排行榜排序与顶栏展示用。 */
  reputation: number;
  last_settled_at: number;
  recruit_date_key: string;
  recruit_count: number;
  /** V5.2 招贤刷新：上次授予额度的宗门等级（与 level 不一致即视为重置）。 */
  recruit_refresh_level: number;
  /** V5.2 招贤刷新：该等级已用的刷新次数（升级重置，不累积）。 */
  recruit_refresh_used: number;
  /** V5 守擂阵容：3 个弟子 id 的 JSON 数组字符串；null = 未设置（不可被挑战）。 */
  defense_lineup: string | null;
  /** 0012 挑战优化：当日已受理场次的 UTC+8 日期键；'' = 尚无新口径计数（迁移前宗门）。 */
  challenge_date_key: string;
  /** 0012 挑战优化：challenge_date_key 对应日期内已受理的挑战场次。 */
  challenge_count: number;
  /** 0019 赌坊：当日论道次数对应的 UTC+8 日期键；'' = 尚无本口径计数（迁移前宗门）。 */
  debate_date_key: string;
  /** 0019 赌坊：debate_date_key 对应日期内已受理的论道次数。 */
  debate_count: number;
  /**
   * 0020 天机轮：转盘格局种子。格局不落库，由 sect_id + wheel_seed 确定性生成
   * （见 gambling.ts 的 wheelLayoutSeed）；每次重置 +1，只有它变，格局才变。
   */
  wheel_seed: number;
  created_at: number;
}

export interface DiscipleRow {
  id: string;
  sect_id: string;
  name: string;
  gender: string;
  aptitude: number;
  /** V4 战斗属性（1~100）与天赋 id；战力与产出加成来源。 */
  attack: number;
  defense: number;
  speed: number;
  /** 幸运（1~100，0016）：只影响单人定时历练的额外收获概率。 */
  luck: number;
  /** 体魄（1~100，0016）：只影响单人定时历练的受伤概率。 */
  physique: number;
  /**
   * 0028 装备加成（冗余列，见 equipment.ts）：该弟子当前穿戴装备的加成之和。
   * **战斗计算只读这 5 列**，不在战斗时查装备表；每次穿戴 / 卸下 / 驱逐都在同一个 batch 里
   * 按装备表重新求和写回（refreshDiscipleGearStatement），避免内存加减累积误差。
   */
  gear_attack: number;
  gear_defense: number;
  gear_speed: number;
  gear_luck: number;
  gear_physique: number;
  /** 0032 装备战力加成（基点）：身上装备按品质的战力加成之和，与上面 5 列同一套写回。 */
  gear_power_bp: number;
  talent: string;
  realm_id: string;
  stage: number;
  cultivation: number;
  cultivation_remainder: number;
  assignment: string;
  injured_until: number | null;
  /** 二期阶段一：重伤到期时间（UTC 毫秒）；null = 未重伤。 */
  severe_injured_until: number | null;
  /** 已服用淬体丹次数（上限 BODY_TEMPERING_MAX_USES，见 alchemy.ts）。 */
  body_tempering_count: number;
  /** 0013 掌门私有备注（单行纯文本，≤60 字；只进登录玩家自己的视图）。 */
  note: string;
  /** 0017 头像框 id（'classic' 或 'frame01'…'frame20'；掌门私有外观，只进自己的视图）。 */
  avatar_frame_id: string;
  created_at: number;
  /** 0019 赌坊：当前可用悟道值余额（非负整数；本版本只能通过论道赌局获得）。 */
  dao_insight: number;
  /** 0019 赌坊：累计已分配的悟道值（上限 DAO_INSIGHT_CAP = 50）。 */
  dao_insight_used: number;
}

export interface BuildingRow {
  id: string;
  sect_id: string;
  def_id: string;
  level: number;
  created_at: number;
}

export interface ResourceBalanceRow {
  id: string;
  sect_id: string;
  resource_id: string;
  balance: number;
  remainder: number;
  updated_at: number;
}

export interface EventLogRow {
  id: string;
  sect_id: string;
  event_id: string;
  description: string;
  /** JSON：resourceId -> 带符号的最小单位数量字符串。 */
  effects: string;
  created_at: number;
}

export interface ExplorationRow {
  id: string;
  sect_id: string;
  realm_id: string;
  /** JSON 数组字符串：本次派遣的弟子 id。 */
  party: string;
  /** 0=失败，1=成功。 */
  success: number;
  /** JSON 对象字符串：成功时的实际奖励（resourceId -> 最小单位数量字符串）。 */
  rewards: string;
  created_at: number;
}

/** 切磋记录行（V3 第四节）；result 从攻方视角：'win' | 'lose' | 'draw'。 */
export interface SparringLogRow {
  id: string;
  attacker_sect_id: string;
  defender_sect_id: string;
  attacker_disciple_id: string;
  defender_disciple_id: string;
  attacker_power: number;
  defender_power: number;
  result: string;
  reputation_gained: number;
  created_at: number;
}

/**
 * 挑战记录行（V5 第三节）；result 从攻方视角：'win' | 'lose'。
 * attacker_lineup / defender_lineup / rounds 是 JSON 字符串快照（见 0009 迁移）。
 * 0012 起新增可空快照列（双方等级 / 奖励档位 / 守擂方式 / 日期键）；旧行这些列为 NULL。
 */
export interface ChallengeLogRow {
  id: string;
  attacker_sect_id: string;
  defender_sect_id: string;
  attacker_lineup: string;
  defender_lineup: string;
  rounds: string;
  result: string;
  reputation_gained: number;
  spirit_stone_gained: number;
  /** 开战时攻方宗门等级；旧记录为 null。 */
  attacker_level: number | null;
  /** 开战时守方宗门等级；旧记录为 null。 */
  defender_level: number | null;
  /** 开战时的奖励档位标识（challenge.ts 的 RewardTier）；旧记录为 null。 */
  reward_tier: string | null;
  /** 'configured' | 'automatic'；旧记录为 null。 */
  defense_mode: string | null;
  /** 本场对应的 UTC+8 日期键；旧记录为 null。 */
  challenge_date_key: string | null;
  created_at: number;
}

/**
 * 论道赌局记录行（0019 迁移）。
 *
 * 第一版没有前端历史面板（计划 2.4），这张表只作为审计与回溯来源：每次论道写一行，
 * stake_detail / reward_detail 是当场快照 JSON（弟子与资源后续会变化，记录要能独立读）。
 * 写入语句构造器见文件末尾的「赌坊」一节。
 */
export interface DaoDebateLogRow {
  id: string;
  sect_id: string;
  disciple_id: string;
  disciple_name: string;
  /** 'preset_spirit_stone' | 'free_resource' | 'attribute'。 */
  bet_mode: string;
  multiplier: number;
  /** 赌注详情 JSON：{ resourceId, amount } 或 { attribute, points }。 */
  stake_detail: string;
  /** 'win' | 'lose'。 */
  result: string;
  /** 奖励详情 JSON：{ type: 'resource'|'insight', resourceId?, amount?, insight? }。 */
  reward_detail: string;
  /** jev 返回的原始胜率（0~1 小数）；本地降级判定时为 null。 */
  win_probability: number | null;
  created_at: number;
}

export class SectRepository extends ParamRepository {
  async findByUserId(userId: string): Promise<SectRow | null> {
    return this.one<SectRow>({
      sql: `SELECT id, user_id, name, level, vein_level, reputation, last_settled_at, recruit_date_key, recruit_count, recruit_refresh_level, recruit_refresh_used, created_at, defense_lineup, challenge_date_key, challenge_count, debate_date_key, debate_count, wheel_seed
            FROM sects WHERE user_id = ?`,
      params: [userId],
    });
  }

  /** 排行榜用：全部宗门，按综合榜顺序（等级 DESC → 声望 DESC → 创建时间 ASC）。 */
  async findAll(): Promise<SectRow[]> {
    return this.all<SectRow>({
      sql: `SELECT id, user_id, name, level, vein_level, reputation, last_settled_at,
                   recruit_date_key, recruit_count, recruit_refresh_level, recruit_refresh_used, created_at, defense_lineup, challenge_date_key, challenge_count, debate_date_key, debate_count, wheel_seed
            FROM sects ORDER BY level DESC, reputation DESC, created_at ASC`,
      params: [],
    });
  }

  /** 公开档案 / 切磋用：按 id 查单个宗门。 */
  async findById(sectId: string): Promise<SectRow | null> {
    return this.one<SectRow>({
      sql: `SELECT id, user_id, name, level, vein_level, reputation, last_settled_at,
                   recruit_date_key, recruit_count, recruit_refresh_level, recruit_refresh_used, created_at, defense_lineup, challenge_date_key, challenge_count, debate_date_key, debate_count, wheel_seed
            FROM sects WHERE id = ?`,
      params: [sectId],
    });
  }

  /**
   * 0021 宗门名占用检查：返回占用这个名字的宗门 id（没人用返回 null）。
   * 只服务读路径（给友好文案）；并发抢名由 sects_name_uniq 唯一索引兜底。
   */
  async findIdByName(name: string): Promise<string | null> {
    const row = await this.one<{ id: string }>({
      sql: 'SELECT id FROM sects WHERE name = ?',
      params: [name],
    });
    return row?.id ?? null;
  }
}

export class DiscipleRepository extends ParamRepository {
  async findBySectId(sectId: string): Promise<DiscipleRow[]> {
    return this.all<DiscipleRow>({
      sql: `SELECT id, sect_id, name, gender, aptitude, attack, defense, speed, luck, physique, talent,
                   gear_attack, gear_defense, gear_speed, gear_luck, gear_physique, gear_power_bp,
                   realm_id, stage, cultivation, cultivation_remainder,
                   assignment, injured_until, severe_injured_until, body_tempering_count, note, avatar_frame_id, dao_insight, dao_insight_used, created_at
            FROM disciples WHERE sect_id = ? ORDER BY created_at ASC, id ASC`,
      params: [sectId],
    });
  }

  async findById(discipleId: string): Promise<DiscipleRow | null> {
    return this.one<DiscipleRow>({
      sql: `SELECT id, sect_id, name, gender, aptitude, attack, defense, speed, luck, physique, talent,
                   gear_attack, gear_defense, gear_speed, gear_luck, gear_physique, gear_power_bp,
                   realm_id, stage, cultivation, cultivation_remainder,
                   assignment, injured_until, severe_injured_until, body_tempering_count, note, avatar_frame_id, dao_insight, dao_insight_used, created_at
            FROM disciples WHERE id = ?`,
      params: [discipleId],
    });
  }

  async countBySectId(sectId: string): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM disciples WHERE sect_id = ?',
      params: [sectId],
    });
    return Number(row?.total ?? 0);
  }
}

export class BuildingRepository extends ParamRepository {
  async findBySectId(sectId: string): Promise<BuildingRow[]> {
    return this.all<BuildingRow>({
      sql: 'SELECT id, sect_id, def_id, level, created_at FROM buildings WHERE sect_id = ? ORDER BY created_at ASC, id ASC',
      params: [sectId],
    });
  }
}

export class ResourceBalanceRepository extends ParamRepository {
  async findBySectId(sectId: string): Promise<ResourceBalanceRow[]> {
    return this.all<ResourceBalanceRow>({
      sql: `SELECT id, sect_id, resource_id, balance, remainder, updated_at
            FROM resource_balances WHERE sect_id = ? ORDER BY resource_id ASC`,
      params: [sectId],
    });
  }
}

/**
 * 丹药库存行（0011 迁移）：同一宗门同一 pill_id 只有一行（UNIQUE 约束）。
 * quantity 是非负整数，没有行视为 0；pill_id 是代码常量（alchemy.ts），不建外键。
 */
export interface PillInventoryRow {
  id: string;
  sect_id: string;
  pill_id: string;
  quantity: number;
  updated_at: number;
}

export class PillInventoryRepository extends ParamRepository {
  async findBySectId(sectId: string): Promise<PillInventoryRow[]> {
    return this.all<PillInventoryRow>({
      sql: `SELECT id, sect_id, pill_id, quantity, updated_at
            FROM pill_inventories WHERE sect_id = ? ORDER BY pill_id ASC`,
      params: [sectId],
    });
  }
}

export class EventLogRepository extends ParamRepository {
  /** 最近触发的事件（新的在前）；name 由事件定义按 event_id 反查。 */
  async findRecentBySectId(sectId: string, limit: number): Promise<EventLogRow[]> {
    return this.all<EventLogRow>({
      sql: `SELECT id, sect_id, event_id, description, effects, created_at
            FROM event_log WHERE sect_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      params: [sectId, limit],
    });
  }
}

export class ExplorationRepository extends ParamRepository {
  /** 今日（UTC+8 自然日窗口，created_at >= dayStartMs）该宗门在指定秘境的探索次数。 */
  async countTodayBySectAndRealm(
    sectId: string,
    realmId: string,
    dayStartMs: number,
  ): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM explorations WHERE sect_id = ? AND realm_id = ? AND created_at >= ?',
      params: [sectId, realmId, dayStartMs],
    });
    return Number(row?.total ?? 0);
  }

  /** 最近探索记录（新的在前）。 */
  async findRecentBySectId(sectId: string, limit: number): Promise<ExplorationRow[]> {
    return this.all<ExplorationRow>({
      sql: `SELECT id, sect_id, realm_id, party, success, rewards, created_at
            FROM explorations WHERE sect_id = ? ORDER BY created_at DESC LIMIT ?`,
      params: [sectId, limit],
    });
  }
}

/** 切磋记录（V3 第四节）：只做每日限次的窗口统计与写入，排行/展示不读它。 */
export class SparringRepository extends ParamRepository {
  /** 今日（UTC+8 自然日窗口，created_at >= dayStartMs）该宗门作为攻方的切磋次数。 */
  async countTodayByAttacker(sectId: string, dayStartMs: number): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM sparring_log WHERE attacker_sect_id = ? AND created_at >= ?',
      params: [sectId, dayStartMs],
    });
    return Number(row?.total ?? 0);
  }

  /** 今日该攻方对同一防方的切磋次数（同目标每日 1 次）。 */
  async countTodayByPair(
    attackerSectId: string,
    defenderSectId: string,
    dayStartMs: number,
  ): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM sparring_log WHERE attacker_sect_id = ? AND defender_sect_id = ? AND created_at >= ?',
      params: [attackerSectId, defenderSectId, dayStartMs],
    });
    return Number(row?.total ?? 0);
  }

  /** 该宗门参与的切磋记录（攻/守都算），新的在前。 */
  async findBySectId(sectId: string, limit: number): Promise<SparringLogRow[]> {
    return this.all<SparringLogRow>({
      sql: `SELECT id, attacker_sect_id, defender_sect_id, attacker_disciple_id, defender_disciple_id,
                   attacker_power, defender_power, result, reputation_gained, created_at
            FROM sparring_log
            WHERE attacker_sect_id = ? OR defender_sect_id = ?
            ORDER BY created_at DESC LIMIT ?`,
      params: [sectId, sectId, limit],
    });
  }

  /** 该宗门的胜负统计（作为攻方的战绩）。 */
  async statsBySectId(sectId: string): Promise<{ wins: number; losses: number; draws: number }> {
    const rows = await this.all<{ result: string; cnt: number }>({
      sql: `SELECT result, COUNT(*) AS cnt FROM sparring_log
            WHERE attacker_sect_id = ? GROUP BY result`,
      params: [sectId],
    });
    let wins = 0, losses = 0, draws = 0;
    for (const row of rows) {
      if (row.result === 'win') wins = Number(row.cnt);
      else if (row.result === 'lose') losses = Number(row.cnt);
      else draws = Number(row.cnt);
    }
    return { wins, losses, draws };
  }
}

/**
 * 挑战记录（V5 第三节）：每日限次的窗口统计、演武录展示与胜负统计。
 *
 * 与旧 SparringRepository 的区别：每日限次只按攻方（挑战发起方）统计；
 * 胜负统计要把「被挑战」的记录从守方视角翻转。
 */
export class ChallengeRepository extends ParamRepository {
  /**
   * 该宗门今日（UTC+8）已受理的挑战场次，兼容 0012 迁移前的旧记录：
   * 新记录带 challenge_date_key，旧记录只有 created_at —— 两种口径都算「今天」。
   * 只在宗门行的日期键不是今天时作为兼容核对使用（正常路径读 sects.challenge_count）。
   */
  async countTodayByAttacker(sectId: string, dateKey: string, dayStartMs: number): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: `SELECT COUNT(*) AS total FROM challenge_log
            WHERE attacker_sect_id = ?
              AND (challenge_date_key = ? OR (challenge_date_key IS NULL AND created_at >= ?))`,
      params: [sectId, dateKey, dayStartMs],
    });
    return Number(row?.total ?? 0);
  }

  /** 今日是否已挑战过指定目标（同一攻方对同一守方每天最多 1 场；兼容旧记录日窗口）。 */
  async hasChallengedTargetToday(
    attackerSectId: string,
    defenderSectId: string,
    dateKey: string,
    dayStartMs: number,
  ): Promise<boolean> {
    const row = await this.one<{ total: number }>({
      sql: `SELECT COUNT(*) AS total FROM challenge_log
            WHERE attacker_sect_id = ? AND defender_sect_id = ?
              AND (challenge_date_key = ? OR (challenge_date_key IS NULL AND created_at >= ?))`,
      params: [attackerSectId, defenderSectId, dateKey, dayStartMs],
    });
    return Number(row?.total ?? 0) > 0;
  }

  /** 该宗门参与的挑战记录（攻/守都算），新的在前。 */
  async findBySectId(sectId: string, limit: number): Promise<ChallengeLogRow[]> {
    return this.all<ChallengeLogRow>({
      sql: `SELECT * FROM challenge_log
            WHERE attacker_sect_id = ? OR defender_sect_id = ?
            ORDER BY created_at DESC LIMIT ?`,
      params: [sectId, sectId, limit],
    });
  }

  /** 该宗门的胜负统计（从自身视角；被挑战的记录要翻转结果）。 */
  async statsBySectId(sectId: string): Promise<{ wins: number; losses: number }> {
    const atkRows = await this.all<{ result: string; cnt: number }>({
      sql: 'SELECT result, COUNT(*) AS cnt FROM challenge_log WHERE attacker_sect_id = ? GROUP BY result',
      params: [sectId],
    });
    const defRows = await this.all<{ result: string; cnt: number }>({
      sql: 'SELECT result, COUNT(*) AS cnt FROM challenge_log WHERE defender_sect_id = ? GROUP BY result',
      params: [sectId],
    });
    let wins = 0;
    let losses = 0;
    for (const row of atkRows) {
      if (row.result === 'win') wins += Number(row.cnt);
      else losses += Number(row.cnt);
    }
    for (const row of defRows) {
      // 守方：攻方 win = 我方 lose，攻方 lose = 我方 win。
      if (row.result === 'win') losses += Number(row.cnt);
      else wins += Number(row.cnt);
    }
    return { wins, losses };
  }
}

export interface NewDisciple {
  id: string;
  sectId: string;
  name: string;
  gender: string;
  aptitude: number;
  attack: number;
  defense: number;
  speed: number;
  /** 幸运（1~100）：新弟子由生成器显式给出，不依赖数据库默认值（0016）。 */
  luck: number;
  /** 体魄（1~100）：同上（0016）。 */
  physique: number;
  talent: string;
  realmId: string;
  stage: number;
  assignment: string;
  /** 淬体丹服用次数；新建弟子一律传 0。 */
  bodyTemperingCount: number;
  now: number;
}

export interface NewBuilding {
  id: string;
  sectId: string;
  defId: string;
  level: number;
  now: number;
}

export interface NewResourceBalance {
  id: string;
  sectId: string;
  resourceId: string;
  balance: number;
  remainder: number;
  now: number;
}

export interface NewEventLog {
  id: string;
  sectId: string;
  eventId: string;
  description: string;
  /** JSON：resourceId -> 带符号的最小单位数量字符串。 */
  effects: string;
  now: number;
}

export function insertSectStatement(row: {
  id: string;
  userId: string;
  name: string;
  level: number;
  veinLevel: number;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO sects (id, user_id, name, level, vein_level, last_settled_at, recruit_date_key, recruit_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, '', 0, ?)`,
    params: [row.id, row.userId, row.name, row.level, row.veinLevel, row.now, row.now],
  };
}

export function insertDiscipleStatement(row: NewDisciple): ParameterizedQuery {
  return {
    sql: `INSERT INTO disciples
            (id, sect_id, name, gender, aptitude, attack, defense, speed, luck, physique, talent,
             realm_id, stage, cultivation, cultivation_remainder, assignment, injured_until,
             severe_injured_until, body_tempering_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, NULL, ?, ?)`,
    params: [
      row.id,
      row.sectId,
      row.name,
      row.gender,
      row.aptitude,
      row.attack,
      row.defense,
      row.speed,
      row.luck,
      row.physique,
      row.talent,
      row.realmId,
      row.stage,
      row.assignment,
      row.bodyTemperingCount,
      row.now,
    ],
  };
}

export function insertBuildingStatement(row: NewBuilding): ParameterizedQuery {
  return {
    sql: `INSERT INTO buildings (id, sect_id, def_id, level, created_at) VALUES (?, ?, ?, ?, ?)`,
    params: [row.id, row.sectId, row.defId, row.level, row.now],
  };
}

export function insertResourceBalanceStatement(row: NewResourceBalance): ParameterizedQuery {
  return {
    sql: `INSERT INTO resource_balances (id, sect_id, resource_id, balance, remainder, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [row.id, row.sectId, row.resourceId, row.balance, row.remainder, row.now],
  };
}

export function insertEventLogStatement(row: NewEventLog): ParameterizedQuery {
  return {
    sql: `INSERT INTO event_log (id, sect_id, event_id, description, effects, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    params: [row.id, row.sectId, row.eventId, row.description, row.effects, row.now],
  };
}

export function insertExplorationStatement(row: {
  id: string;
  sectId: string;
  realmId: string;
  /** JSON 数组字符串。 */
  party: string;
  success: boolean;
  /** JSON 对象字符串：成功时的实际奖励。 */
  rewards: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO explorations (id, sect_id, realm_id, party, success, rewards, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    params: [row.id, row.sectId, row.realmId, row.party, row.success ? 1 : 0, row.rewards, row.now],
  };
}

/** 结算写回：宗门最后结算时间 + 招募计数（计数为 null 时不变）。 */
export function updateSectSettledStatement(
  sectId: string,
  lastSettledAt: number,
  recruit?: { dateKey: string; count: number },
): ParameterizedQuery {
  if (recruit === undefined) {
    return {
      sql: 'UPDATE sects SET last_settled_at = ? WHERE id = ?',
      params: [lastSettledAt, sectId],
    };
  }
  return {
    sql: 'UPDATE sects SET last_settled_at = ?, recruit_date_key = ?, recruit_count = ? WHERE id = ?',
    params: [lastSettledAt, recruit.dateKey, recruit.count, sectId],
  };
}

/** 宗门升级写回：只改等级（条件判定与容量重算在 service/view 层）。 */
export function updateSectLevelStatement(sectId: string, level: number): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET level = ? WHERE id = ?',
    params: [level, sectId],
  };
}

/** 结算写回：资源余额与余数。 */
export function updateResourceSettledStatement(
  row: ResourceBalanceRow,
  balance: number,
  remainder: number,
  now: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE resource_balances SET balance = ?, remainder = ?, updated_at = ? WHERE id = ?',
    params: [balance, remainder, now, row.id],
  };
}

/** 结算写回：弟子修为与余数。 */
export function updateDiscipleCultivationStatement(
  discipleId: string,
  cultivation: number,
  remainder: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET cultivation = ?, cultivation_remainder = ? WHERE id = ?',
    params: [cultivation, remainder, discipleId],
  };
}

/**
 * 普通结算也必须先核对快照，避免迟到的 sync 覆盖已领取的资源或新的弟子进度。
 * D1 单条语句最多绑定 100 个参数；满编宗门有 35 名弟子，每人 8 项校验，
 * 因此把校验拆成同一次 batch 内的多条守卫，任一失败都回滚整批。
 * options.pill：坊市售丹把「这条丹药库存仍是读到的数量」也并进守卫（绝对值写回必须核对）。
 */
export function settlementSnapshotGuardStatements(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    disciples: readonly DiscipleRow[];
  },
  options: { checkRecruitState?: boolean; pill?: { pillId: string; quantity: number } } = {},
): { guards: ParameterizedQuery[]; cleanup: ParameterizedQuery[] } {
  const { sect, balances, disciples } = snapshot;
  const checks = [
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?)',
    '(SELECT COUNT(*) FROM disciples WHERE sect_id = ?) = ?',
  ];
  const params: (string | number | null)[] = [
    commandId, sect.id, sect.level, sect.last_settled_at, sect.id, disciples.length,
  ];
  if (options.checkRecruitState) {
    checks.push(`EXISTS (SELECT 1 FROM sects WHERE id = ? AND recruit_date_key = ?
      AND recruit_count = ? AND recruit_refresh_level = ? AND recruit_refresh_used = ?)`);
    params.push(
      sect.id, sect.recruit_date_key, sect.recruit_count,
      sect.recruit_refresh_level, sect.recruit_refresh_used,
    );
  }
  for (const row of balances) {
    checks.push('EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)');
    params.push(row.id, sect.id, row.balance, row.remainder);
  }

  if (options.pill !== undefined) {
    // 坊市售丹：库存是**绝对值**写回（UPDATE ... SET quantity = ?），
    // 与炼丹守卫同一口径 —— 这条库存必须仍是读到的数量，否则整批回滚。
    checks.push(
      'COALESCE((SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?), 0) = ?',
    );
    params.push(sect.id, options.pill.pillId, options.pill.quantity);
  }

  const guardIds = [commandId];
  const guards: ParameterizedQuery[] = [
    {
      sql: `INSERT INTO mutation_guards (command_id, valid)
            SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
      params,
    },
  ];
  const DISCIPLES_PER_GUARD = 10;
  for (let start = 0; start < disciples.length; start += DISCIPLES_PER_GUARD) {
    const guardId = `${commandId}:disciples:${String(start)}`;
    const memberChecks: string[] = [];
    const memberParams: (string | number | null)[] = [guardId];
    for (const row of disciples.slice(start, start + DISCIPLES_PER_GUARD)) {
      memberChecks.push(`EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ? AND realm_id = ? AND stage = ?
        AND cultivation = ? AND cultivation_remainder = ? AND assignment = ? AND injured_until IS ?)`);
      memberParams.push(row.id, sect.id, row.realm_id, row.stage, row.cultivation,
        row.cultivation_remainder, row.assignment, row.injured_until);
    }
    guardIds.push(guardId);
    guards.push({
      sql: `INSERT INTO mutation_guards (command_id, valid)
            SELECT ?, CASE WHEN ${memberChecks.join(' AND ')} THEN 1 ELSE 0 END`,
      params: memberParams,
    });
  }
  return {
    guards,
    cleanup: guardIds.map((id) => ({
      sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
      params: [id],
    })),
  };
}

/** 资源增减（消耗用负数），只用于已经检查过余额的场景。 */
export function resourceDeltaStatement(
  sectId: string,
  resourceId: string,
  delta: number,
  now: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE resource_balances SET balance = balance + ?, updated_at = ? WHERE sect_id = ? AND resource_id = ?',
    params: [delta, now, sectId, resourceId],
  };
}

/**
 * 加资源但不超过容量（讨伐发奖用）：新余额 = min(余额 + 数量, max(余额, 容量))。
 * 在 SQL 里夹，不依赖读到的旧余额（发奖与该宗门自己的结算可能交错）；
 * 余额本来就高于容量（探索奖励允许顶过上限）时保持不变，不会被往下压。
 */
export function resourceCreditCappedStatement(
  sectId: string,
  resourceId: string,
  amount: number,
  capacity: number,
  now: number,
): ParameterizedQuery {
  return {
    sql: `UPDATE resource_balances SET balance = MIN(balance + ?, MAX(balance, ?)), updated_at = ?
          WHERE sect_id = ? AND resource_id = ?`,
    params: [amount, capacity, now, sectId, resourceId],
  };
}

export function updateDiscipleAssignmentStatement(discipleId: string, assignment: string): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET assignment = ? WHERE id = ?',
    params: [assignment, discipleId],
  };
}

export function updateBuildingLevelStatement(buildingId: string, level: number): ParameterizedQuery {
  return {
    sql: 'UPDATE buildings SET level = ? WHERE id = ?',
    params: [level, buildingId],
  };
}

/** 突破结果写回：境界/阶段/修为/余数/伤势冷却。 */
export function updateDiscipleProgressStatement(
  discipleId: string,
  progress: {
    realmId: string;
    stage: number;
    cultivation: number;
    remainder: number;
    injuredUntil: number | null;
  },
): ParameterizedQuery {
  return {
    sql: `UPDATE disciples
          SET realm_id = ?, stage = ?, cultivation = ?, cultivation_remainder = ?, injured_until = ?
          WHERE id = ?`,
    params: [
      progress.realmId,
      progress.stage,
      progress.cultivation,
      progress.remainder,
      progress.injuredUntil,
      discipleId,
    ],
  };
}

/**
 * 探索失败写回：只改伤势冷却，**不**碰境界/阶段/修为（与突破写回区分开）。
 * 传 null 表示清除伤势（回春丹），与设置冷却共用同一条 UPDATE。
 */
export function updateDiscipleInjuryStatement(
  discipleId: string,
  injuredUntil: number | null,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET injured_until = ? WHERE id = ?',
    params: [injuredUntil, discipleId],
  };
}

/** 二期阶段一：重伤到期时间写回（世界 Boss 把弟子打成重伤时调用）。 */
export function setDiscipleSevereInjuryStatement(
  discipleId: string,
  severeInjuredUntil: number | null,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET severe_injured_until = ? WHERE id = ?',
    params: [severeInjuredUntil, discipleId],
  };
}

/** 招募计数写回（每日次数按 UTC+8 自然日重置）。 */
export function updateSectRecruitCounterStatement(
  sectId: string,
  dateKey: string,
  count: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET recruit_date_key = ?, recruit_count = ? WHERE id = ?',
    params: [dateKey, count, sectId],
  };
}
 
/**
 * 招贤刷新写回（V5.2）：记录「本次授予额度的宗门等级 + 该等级已用刷新次数」。
 * 升级后 level 变化即视为重置（归一化在 service 层），这里只写新的等级与已用次数。
 */
export function updateSectRecruitRefreshStatement(
  sectId: string,
  level: number,
  used: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET recruit_refresh_level = ?, recruit_refresh_used = ? WHERE id = ?',
    params: [level, used, sectId],
  };
}

/** 切磋记录写入（V3 第四节）。 */
export function insertSparringLogStatement(row: {
  id: string;
  attackerSectId: string;
  defenderSectId: string;
  attackerDiscipleId: string;
  defenderDiscipleId: string;
  attackerPower: number;
  defenderPower: number;
  result: string;
  reputationGained: number;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO sparring_log (id, attacker_sect_id, defender_sect_id, attacker_disciple_id,
            defender_disciple_id, attacker_power, defender_power, result, reputation_gained, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.id,
      row.attackerSectId,
      row.defenderSectId,
      row.attackerDiscipleId,
      row.defenderDiscipleId,
      row.attackerPower,
      row.defenderPower,
      row.result,
      row.reputationGained,
      row.now,
    ],
  };
}

/** 声望增减（切磋胜利 +10）；与资源写回同一 batch。 */
export function updateSectReputationStatement(sectId: string, delta: number): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET reputation = reputation + ? WHERE id = ?',
    params: [delta, sectId],
  };
}

/**
 * 守擂阵容写回（V5 2.2 / 0013）：defense_lineup 是弟子 id 数组的 JSON 字符串；
 * 传 null = 清空阵容（驱逐守擂成员时与删除弟子同一 batch 写入）。
 */
export function updateSectDefenseLineupStatement(
  sectId: string,
  lineupJson: string | null,
): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET defense_lineup = ? WHERE id = ?',
    params: [lineupJson, sectId],
  };
}

/**
 * 0021 宗门改名：只更新 name 一列（服务层已 trim 并校验为 2-12 个码点的单行纯文本）。
 * sects 只有主键可用，所以这里是单条件更新：并发保护靠 commit() 的 mutation_guards 快照守卫
 * （守卫核对 level / last_settled_at），同时也保证改名不会写出半行。
 */
export function updateSectNameStatement(sectId: string, name: string): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET name = ? WHERE id = ?',
    params: [name, sectId],
  };
}

/**
 * 0013 备注写回：note 已在服务层 trim 并校验（≤60 字、单行、无控制字符）。
 * 与驱逐删除保持一致用 `id + sect_id` 双条件：身份写错行时影响 0 行（批内快照守卫再兜一层）。
 */
export function updateDiscipleNoteStatement(
  discipleId: string,
  sectId: string,
  note: string,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET note = ? WHERE id = ? AND sect_id = ?',
    params: [note, discipleId, sectId],
  };
}

/**
 * 0017 头像框写回：只更新 avatar_frame_id 一列（frameId 已由 schema 的 21 值白名单把关）。
 * 与备注一致用 `id + sect_id` 双条件：身份写错行时影响 0 行（批内快照守卫再兜一层）。
 */
export function updateDiscipleAvatarFrameStatement(
  discipleId: string,
  sectId: string,
  frameId: string,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET avatar_frame_id = ? WHERE id = ? AND sect_id = ?',
    params: [frameId, discipleId, sectId],
  };
}

/**
 * 0021 弟子改名：只更新 name 一列（服务层已 trim 并校验为 2-6 个码点的单行纯文本）。
 * 与备注 / 头像框一致用 `id + sect_id` 双条件：身份写错行时影响 0 行（批内快照守卫再兜一层）。
 *
 * 历史表里的 disciple_name（0014 历练、0019 赌坊记录）是出发 / 开局时的姓名快照，
 * 改名**不回填**——旧记录继续显示当时的名字（见 0014 迁移注释）。
 */
export function updateDiscipleNameStatement(
  discipleId: string,
  sectId: string,
  name: string,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET name = ? WHERE id = ? AND sect_id = ?',
    params: [name, discipleId, sectId],
  };
}

/** 0013 驱逐：id + sect_id 双条件删除；弟子已不属于本宗时影响 0 行（配合快照守卫兜底）。 */
export function deleteDiscipleStatement(discipleId: string, sectId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM disciples WHERE id = ? AND sect_id = ?',
    params: [discipleId, sectId],
  };
}

/**
 * 挑战记录写入（V5 第三节）：阵容与每轮结果都是 JSON 字符串快照。
 * 0012 起同时写入开战快照（双方等级 / 奖励档位 / 守擂方式 / 日期键）。
 */
export function insertChallengeLogStatement(row: {
  id: string;
  attackerSectId: string;
  defenderSectId: string;
  attackerLineup: string;
  defenderLineup: string;
  rounds: string;
  result: string;
  reputationGained: number;
  spiritStoneGained: number;
  /** 开战快照：攻方宗门等级。 */
  attackerLevel: number;
  /** 开战快照：守方宗门等级。 */
  defenderLevel: number;
  /** 开战快照：奖励档位标识（challenge.ts 的 RewardTier）。 */
  rewardTier: string;
  /** 开战快照：守擂方式（'configured' | 'automatic'）。 */
  defenseMode: string;
  /** 本场 UTC+8 日期键（唯一部分索引据此防同日重复目标）。 */
  challengeDateKey: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO challenge_log (id, attacker_sect_id, defender_sect_id, attacker_lineup,
            defender_lineup, rounds, result, reputation_gained, spirit_stone_gained,
            attacker_level, defender_level, reward_tier, defense_mode, challenge_date_key, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.id,
      row.attackerSectId,
      row.defenderSectId,
      row.attackerLineup,
      row.defenderLineup,
      row.rounds,
      row.result,
      row.reputationGained,
      row.spiritStoneGained,
      row.attackerLevel,
      row.defenderLevel,
      row.rewardTier,
      row.defenseMode,
      row.challengeDateKey,
      row.now,
    ],
  };
}

/**
 * 挑战计数写回（0012）：受理一场战斗时把攻方的日期键归一到今天、计数 +1。
 * 条件判断在 mutation_guards 快照语句里完成（batch 首条），这里只负责写入。
 */
export function updateSectChallengeCounterStatement(
  sectId: string,
  dateKey: string,
  count: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET challenge_date_key = ?, challenge_count = ? WHERE id = ?',
    params: [dateKey, count, sectId],
  };
}

/**
 * 挑战 batch 的首条语句（与炼丹的 alchemySnapshotGuardStatement 同一模式）：
 * 快照过期时插入 valid=0 触发 mutation_guards 的 CHECK，让同批的结算、计数、奖励、
 * 日志一起回滚。校验攻方宗门行（等级/声望/结算时间/挑战日期键/计数）、全部资源余额、
 * 攻方出战弟子仍属于本宗，以及守方宗门的等级与守擂阵容；双方出战弟子
 * 都必须仍在宗门内且未在外历练，避免读完阵容后守方出发造成幽灵出战。
 */
export function challengeSnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    members: readonly { id: string }[];
    target: {
      id: string;
      level: number;
      defenseLineup: string | null;
    };
    defenderIds: readonly string[];
    now: number;
  },
): ParameterizedQuery {
  const { sect, balances, members, target } = snapshot;
  const checks = [
    `EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND reputation = ?
      AND last_settled_at = ? AND challenge_date_key = ? AND challenge_count = ?)`,
    `EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND defense_lineup IS ?)`,
  ];
  const params: (string | number | null)[] = [
    commandId,
    sect.id, sect.level, sect.reputation,
    sect.last_settled_at, sect.challenge_date_key, sect.challenge_count,
    target.id, target.level, target.defenseLineup,
  ];

  for (const row of balances) {
    checks.push(
      'EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)',
    );
    params.push(row.id, sect.id, row.balance, row.remainder);
  }
  for (const member of members) {
    checks.push('EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ?)');
    params.push(member.id, sect.id);
  }

  for (const member of members) {
    checks.push(`NOT EXISTS (SELECT 1 FROM disciple_journeys
      WHERE disciple_id = ? AND claimed_at IS NULL AND ends_at > ?)`);
    params.push(member.id, snapshot.now);
  }
  for (const defenderId of snapshot.defenderIds) {
    checks.push('EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ?)');
    params.push(defenderId, target.id);
    checks.push(`NOT EXISTS (SELECT 1 FROM disciple_journeys
      WHERE disciple_id = ? AND claimed_at IS NULL AND ends_at > ?)`);
    params.push(defenderId, snapshot.now);
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

export function deleteChallengeSnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

/* ---------- 丹药系统（0011 迁移 + alchemy.ts） ---------- */

/**
 * 库存 upsert：首次炼制创建行；同一 (sect_id, pill_id) 重复炼制复用同一行
 * （UNIQUE 冲突时改写 quantity / updated_at），保证每宗门每丹药只有一条库存记录。
 */
export function upsertPillInventoryStatement(
  sectId: string,
  pillId: string,
  quantity: number,
  now: number,
): ParameterizedQuery {
  return {
    sql: `INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (sect_id, pill_id)
          DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
    params: [crypto.randomUUID(), sectId, pillId, quantity, now],
  };
}

/** 库存数量写回（服用后减 1）；只用于库存行已存在且数量已检查过的场景。 */
export function updatePillInventoryQuantityStatement(
  row: PillInventoryRow,
  quantity: number,
  now: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE pill_inventories SET quantity = ?, updated_at = ? WHERE id = ?',
    params: [quantity, now, row.id],
  };
}

/**
 * 淬体丹写回：只更新补短板的那一个属性列 + 服用次数。
 * 列名来自 PillAttribute 的固定映射（不拼用户输入），一次只改一列。
 */
export function updateDiscipleBodyTemperingStatement(
  discipleId: string,
  attribute: PillAttribute,
  attributeValue: number,
  bodyTemperingCount: number,
): ParameterizedQuery {
  const column =
    attribute === 'attack' ? 'attack' : attribute === 'defense' ? 'defense' : 'speed';
  return {
    sql: `UPDATE disciples SET ${column} = ?, body_tempering_count = ? WHERE id = ?`,
    params: [attributeValue, bodyTemperingCount, discipleId],
  };
}

/**
 * 炼丹 batch 的首条语句：快照过期时插入 valid=0，触发 mutation_guards 的 CHECK，
 * 让同批的结算、资源扣减、库存和弟子更新一起回滚。
 */
export function alchemySnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    buildings: readonly BuildingRow[];
    pillId: string;
    pillQuantity: number;
    /** 服药目标（批量疗伤时是多人）：每人的修为 / 属性 / 伤势 / 岗位都要仍与快照一致。 */
    disciples?: readonly DiscipleRow[];
  },
): ParameterizedQuery {
  const { sect, balances, buildings, pillId, pillQuantity, disciples = [] } = snapshot;
  const checks = [
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?)',
    'COALESCE((SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?), 0) = ?',
  ];
  const params: (string | number | null)[] = [
    commandId,
    sect.id, sect.level, sect.last_settled_at,
    sect.id, pillId, pillQuantity,
  ];

  for (const row of balances) {
    checks.push('EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)');
    params.push(row.id, sect.id, row.balance, row.remainder);
  }
  for (const row of buildings) {
    checks.push('EXISTS (SELECT 1 FROM buildings WHERE id = ? AND sect_id = ? AND level = ?)');
    params.push(row.id, sect.id, row.level);
  }
  for (const disciple of disciples) {
    checks.push(`EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ?
      AND realm_id = ? AND stage = ? AND cultivation = ? AND cultivation_remainder = ?
      AND attack = ? AND defense = ? AND speed = ? AND body_tempering_count = ?
      AND injured_until IS ? AND assignment = ?)`);
    params.push(
      disciple.id, sect.id, disciple.realm_id, disciple.stage,
      disciple.cultivation, disciple.cultivation_remainder,
      disciple.attack, disciple.defense, disciple.speed, disciple.body_tempering_count,
      disciple.injured_until, disciple.assignment,
    );
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

export function deleteAlchemySnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

/* ---------- 弟子管理（0013 迁移：备注 / 驱逐 / 布阵的快照守卫） ---------- */

/**
 * 弟子命令 batch 的首条语句（与炼丹/挑战守卫同一模式）：快照过期时插入 valid=0，
 * 触发 mutation_guards 的 CHECK，让同批的结算写回与命令写入一起回滚。
 *
 * 校验：
 * - 宗门行（等级/结算时间）与全部资源余额：防止与任何并发命令双重结算；
 * - members 每名弟子仍属于本宗：备注/驱逐/布阵提交时的成员有效性核对，
 *   驱逐与服药/布阵/挑战交错时不会出现幽灵成功或失效手动阵容；
 * - defenseLineup（可选）：读到的守擂阵容快照在提交时未变（驱逐守擂成员用，
 *   阵容若被并发改动，「是否需要清空阵容」的判断就不再可靠，整批回滚）。
 */
export function discipleSnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    members: readonly { id: string }[];
    /** 判定「尚未到期的历练」的时刻（调用方的 now）。 */
    now: number;
    /**
     * 0014：是否要求每名成员在此刻都没有「尚未到期的历练」。
     * 出发 / 驱逐 / 派工 / 服药 / 布阵 / 探索 / 挑战都要 true；
     * 保存私有备注按计划必须在外期间也能用，所以那条路径传 false。
     */
    rejectAwayMembers?: boolean;
    /**
     * 二期阶段一：是否要求每名成员在此刻都没有「重伤卧床」。
     * 与 rejectAwayMembers 同一口径 —— 改名 / 备注 / 头像框 / 驱逐，以及晋升的资格判定
     * （重伤弟子仍是本宗门的、境界不变）传 false，其余路径一律 true。
     */
    rejectSevereMembers?: boolean;
    defenseLineup?: string | null;
  },
): ParameterizedQuery {
  const { sect, balances, members, now, rejectAwayMembers, rejectSevereMembers, defenseLineup } =
    snapshot;
  const checks = [
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?)',
  ];
  const params: (string | number | null)[] = [commandId, sect.id, sect.level, sect.last_settled_at];

  for (const row of balances) {
    checks.push(
      'EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)',
    );
    params.push(row.id, sect.id, row.balance, row.remainder);
  }
  pushMemberChecks(checks, params, sect.id, members, now, rejectAwayMembers === true, rejectSevereMembers === true);
  if (defenseLineup !== undefined) {
    checks.push('EXISTS (SELECT 1 FROM sects WHERE id = ? AND defense_lineup IS ?)');
    params.push(sect.id, defenseLineup);
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

/**
 * 成员校验（弟子快照守卫与成员分片守卫共用）：每名成员仍属本宗；
 * rejectAwayMembers 时还要求此刻没有「尚未到期的历练」。
 */
function pushMemberChecks(
  checks: string[],
  params: (string | number | null)[],
  sectId: string,
  members: readonly { id: string }[],
  now: number,
  rejectAwayMembers: boolean,
  rejectSevereMembers: boolean,
): void {
  for (const member of members) {
    checks.push('EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ?)');
    params.push(member.id, sectId);
    if (rejectAwayMembers) {
      /**
       * 0014：目标弟子在此刻也不得仍处于「尚未到期的历练」。
       *
       * 读取快照时的在野校验（requireNotAway）只是友好报错；这一条是批内复核：出发与
       * 驱逐 / 派工 / 服药 / 布阵 / 探索 / 挑战并发时，晚提交的一方整批回滚，不会出现
       * 「弟子被驱逐了，但他的历练记录还挂着未领取」这种谁都不再处理的悬空行
       * （那会让后续 sync 的归队与「留守人数」口径互相打架）。
       */
      checks.push(
        'NOT EXISTS (SELECT 1 FROM disciple_journeys WHERE disciple_id = ? AND claimed_at IS NULL AND ends_at > ?)',
      );
      params.push(member.id, now);
    }
    if (rejectSevereMembers) {
      /**
       * 二期阶段一：目标弟子在此刻也不得重伤卧床。
       * 与上面那条同理，只是批内复核：与讨伐（一次出手可能把弟子打成重伤）并发时，
       * 晚提交的一方整批回滚，不会出现「弟子刚被打成重伤，却还是被派了工 / 破了境」。
       */
      checks.push(
        'NOT EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ? AND severe_injured_until IS NOT NULL AND severe_injured_until > ?)',
      );
      params.push(member.id, sectId, now);
    }
  }
}

/**
 * 批量弟子命令的成员分片守卫：D1 单条语句最多绑定 100 个参数，每名成员占 2~4 个，
 * 所以超出首条守卫的成员按片另起守卫行（口径与 discipleSnapshotGuardStatement 的成员部分一致）。
 */
export function discipleMembersGuardStatement(
  guardId: string,
  sectId: string,
  members: readonly { id: string }[],
  now: number,
  rejectAwayMembers: boolean,
  rejectSevereMembers: boolean,
): ParameterizedQuery {
  const checks: string[] = [];
  const params: (string | number | null)[] = [guardId];
  pushMemberChecks(
    checks,
    params,
    sectId,
    members,
    now,
    rejectAwayMembers,
    rejectSevereMembers,
  );
  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}
export function deleteDiscipleSnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

// ---------- 弟子历练（0014 迁移：记录 / 返程 / 领取 / 快照守卫） ----------

/**
 * 历练记录行（0014 迁移）。
 *
 * 三段状态用三个可空时间戳表达：
 * - `completed_at` 为 NULL：还没处理返程（在外中或尚未被任何请求看到）；
 * - `completed_at` 非 NULL、`claimed_at` 为 NULL：已归队待领取（修为/伤势已入账，资源未发）；
 * - 两个都非 NULL：已领取结束，进入历史。
 *
 * 奖励快照列在到期前**不**向前端公开（view 层按 `ends_at <= now` 把关）。
 */
export interface DiscipleJourneyRow {
  id: string;
  sect_id: string;
  /** 不设外键：弟子被驱逐后历史仍保留（只允许已领取后驱逐）。 */
  disciple_id: string;
  /** 出发时的姓名快照。 */
  disciple_name: string;
  direction: string;
  duration_seconds: number;
  /** 出发前的岗位快照；disciples.assignment 本身不变。 */
  original_assignment: string;
  started_at: number;
  ends_at: number;
  completed_at: number | null;
  claimed_at: number | null;
  /** 出发时快照：计划修为（保底 + 额外收获，未按返程门槛截断）。 */
  reward_cultivation: number;
  /** 出发时快照：各项资源（JSON：resourceId -> 最小单位整数）。 */
  reward_resources: string;
  extra_harvest: number;
  injured: number;
  injury_chance_bp: number;
  /** 返程实际入账修为；未处理返程为 NULL。 */
  cultivation_awarded: number | null;
  created_at: number;
}

/** 历练表的完整列清单（避免 SELECT * 与将来加列时的静默漂移）。 */
const JOURNEY_COLUMNS = `id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
       original_assignment, started_at, ends_at, completed_at, claimed_at,
       reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
       cultivation_awarded, created_at`;

export class DiscipleJourneyRepository extends ParamRepository {
  /**
   * 宗门**未领取**的历练记录（在外中 + 待领取），新的在前。
   * 结算屏蔽、名额统计、状态视图都从这一份数据派生，避免多处各查一次。
   */
  async findOpenBySectId(sectId: string): Promise<DiscipleJourneyRow[]> {
    return this.all<DiscipleJourneyRow>({
      sql: `SELECT ${JOURNEY_COLUMNS} FROM disciple_journeys
            WHERE sect_id = ? AND claimed_at IS NULL
            ORDER BY started_at DESC, id DESC`,
      params: [sectId],
    });
  }

  /** 最近历练记录（含已领取，新的在前）：历史摘要用。 */
  async findRecentBySectId(sectId: string, limit: number): Promise<DiscipleJourneyRow[]> {
    return this.all<DiscipleJourneyRow>({
      sql: `SELECT ${JOURNEY_COLUMNS} FROM disciple_journeys
            WHERE sect_id = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
      params: [sectId, limit],
    });
  }

  /** 单条记录（领取时按 id + 宗门取，跨宗 id 一律 NOT_FOUND）。 */
  async findByIdForSect(journeyId: string, sectId: string): Promise<DiscipleJourneyRow | null> {
    return this.one<DiscipleJourneyRow>({
      sql: `SELECT ${JOURNEY_COLUMNS} FROM disciple_journeys WHERE id = ? AND sect_id = ?`,
      params: [journeyId, sectId],
    });
  }

  /** 某宗门当前尚未到期（在外）的人数；已到期待领取不占名额。 */
  async countActiveBySectId(sectId: string, now: number): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: `SELECT COUNT(*) AS total FROM disciple_journeys
            WHERE sect_id = ? AND claimed_at IS NULL AND ends_at > ?`,
      params: [sectId, now],
    });
    return Number(row?.total ?? 0);
  }
}

/**
 * 出发写入（0014）：奖励快照与随机结果在出发时一次性落库，之后不再重抽。
 * 同一弟子重复出发由唯一部分索引（disciple_id WHERE claimed_at IS NULL）兜底。
 */
export function insertDiscipleJourneyStatement(row: {
  id: string;
  sectId: string;
  discipleId: string;
  discipleName: string;
  direction: string;
  durationSeconds: number;
  originalAssignment: string;
  startedAt: number;
  endsAt: number;
  rewardCultivation: number;
  /** JSON 字符串：resourceId -> 最小单位整数。 */
  rewardResources: string;
  extraHarvest: boolean;
  injured: boolean;
  injuryChanceBp: number;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO disciple_journeys
            (id, sect_id, disciple_id, disciple_name, direction, duration_seconds,
             original_assignment, started_at, ends_at, completed_at, claimed_at,
             reward_cultivation, reward_resources, extra_harvest, injured, injury_chance_bp,
             cultivation_awarded, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL, ?)`,
    params: [
      row.id,
      row.sectId,
      row.discipleId,
      row.discipleName,
      row.direction,
      row.durationSeconds,
      row.originalAssignment,
      row.startedAt,
      row.endsAt,
      row.rewardCultivation,
      row.rewardResources,
      row.extraHarvest ? 1 : 0,
      row.injured ? 1 : 0,
      row.injuryChanceBp,
      row.now,
    ],
  };
}

/**
 * 返程入账的弟子写回（修为 + 余数 + 伤势一次写完）。
 * 条件 `completed_at IS NULL` 让并发下只生效一次：另一个请求已归队时本句是 no-op，
 * 而它的绝对写回值更新（见 service 的说明），不会出现重复发奖。
 */
export function updateDiscipleJourneyReturnStatement(
  journeyId: string,
  discipleId: string,
  sectId: string,
  progress: { cultivation: number; remainder: number; injuredUntil: number | null },
): ParameterizedQuery {
  return {
    sql: `UPDATE disciples
          SET cultivation = ?, cultivation_remainder = ?, injured_until = ?
          WHERE id = ? AND sect_id = ?
            AND EXISTS (SELECT 1 FROM disciple_journeys
                        WHERE id = ? AND disciple_id = ? AND claimed_at IS NULL AND completed_at IS NULL)`,
    params: [
      progress.cultivation,
      progress.remainder,
      progress.injuredUntil,
      discipleId,
      sectId,
      journeyId,
      discipleId,
    ],
  };
}

/** 完成标记（含实际入账修为）；重复同步 / 并发完成都不再改写已完成的行。 */
export function completeDiscipleJourneyStatement(
  journeyId: string,
  discipleId: string,
  completedAt: number,
  cultivationAwarded: number,
): ParameterizedQuery {
  return {
    sql: `UPDATE disciple_journeys SET completed_at = ?, cultivation_awarded = ?
          WHERE id = ? AND disciple_id = ? AND completed_at IS NULL AND claimed_at IS NULL`,
    params: [completedAt, cultivationAwarded, journeyId, discipleId],
  };
}

/**
 * 领取标记：条件更新（`claimed_at IS NULL`）保证「只领一次」，
 * 不依赖「先 SELECT 再无条件 UPDATE」。与资源入账同批，失败整批回滚。
 */
export function claimDiscipleJourneyStatement(
  journeyId: string,
  sectId: string,
  claimedAt: number,
): ParameterizedQuery {
  return {
    sql: `UPDATE disciple_journeys SET claimed_at = ?
          WHERE id = ? AND sect_id = ? AND completed_at IS NOT NULL AND claimed_at IS NULL`,
    params: [claimedAt, journeyId, sectId],
  };
}

/**
 * 出发 batch 的首条语句（与炼丹 / 挑战 / 弟子命令守卫同一模式）：快照过期时插入 valid=0，
 * 触发 mutation_guards 的 CHECK，让同批的结算写回与历练记录一起回滚。
 *
 * 复核内容（计划第 3 节「堵住不同弟子并发出发绕过两人上限」）：
 * - 宗门行（等级 / 结算时间 / 守擂阵容原值）：防与任何并发命令双重结算或边布阵边出发；
 * - 全部资源余额：与既有守卫一致；
 * - 本宗尚未到期人数与不在外人数仍与读取快照一致：两人上限与「至少留 3 人」不可能被并发绕过；
 * - 目标弟子的境界 / 阶段 / 修为 / 伤势 / 岗位仍与快照一致，且仍属本宗；
 * - 该弟子没有未领取记录（唯一部分索引在数据库层的第二道保险）。
 */
export function journeyStartSnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    disciple: DiscipleRow;
    /** 读取快照时尚未到期的在外人数。 */
    activeCount: number;
    /** 读取快照时不在外的弟子数（含目标弟子本人）。 */
    atHomeCount: number;
    /** 判定基准：快照读取时刻。 */
    now: number;
  },
): ParameterizedQuery {
  const { sect, balances, disciple, activeCount, atHomeCount, now } = snapshot;
  const checks = [
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?)',
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND defense_lineup IS ?)',
    `(SELECT COUNT(*) FROM disciple_journeys
       WHERE sect_id = ? AND claimed_at IS NULL AND ends_at > ?) = ?`,
    `(SELECT COUNT(*) FROM disciples d WHERE d.sect_id = ?
       AND NOT EXISTS (SELECT 1 FROM disciple_journeys j
                       WHERE j.disciple_id = d.id AND j.claimed_at IS NULL AND j.ends_at > ?)) = ?`,
    `EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ? AND realm_id = ? AND stage = ?
       AND cultivation = ? AND cultivation_remainder = ? AND injured_until IS ? AND assignment = ?)`,
    'NOT EXISTS (SELECT 1 FROM disciple_journeys WHERE disciple_id = ? AND claimed_at IS NULL)',
  ];
  const params: (string | number | null)[] = [
    commandId,
    sect.id, sect.level, sect.last_settled_at,
    sect.id, sect.defense_lineup,
    sect.id, now, activeCount,
    sect.id, now, atHomeCount,
    disciple.id, sect.id, disciple.realm_id, disciple.stage,
    disciple.cultivation, disciple.cultivation_remainder, disciple.injured_until, disciple.assignment,
    disciple.id,
  ];

  for (const row of balances) {
    checks.push(
      'EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)',
    );
    params.push(row.id, sect.id, row.balance, row.remainder);
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

export function deleteJourneyStartSnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

/**
 * 领取 batch 的首条语句：领取是唯一真正发放资源的命令，必须由数据库保证只成功一次。
 *
 * 复核内容：
 * - 记录仍然属于本宗、仍未领取，且完成状态 / 奖赏快照与读取时完全一致
 *   （并发领取或并发完成都会让它回滚，而不是各发一份）；
 * - 宗门行（等级 / 结算时间）与全部资源余额：与既有守卫一致；
 * - 若本批同时承担「归队入账」（尚未完成的记录被直接领取），还要核对弟子行未被并发改动。
 */
export function journeyClaimSnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    journey: DiscipleJourneyRow;
    /** 本批同时归队入账时提供：弟子行读取快照。 */
    disciple?: DiscipleRow;
  },
): ParameterizedQuery {
  const { sect, balances, journey, disciple } = snapshot;
  const checks = [
    `EXISTS (SELECT 1 FROM disciple_journeys
       WHERE id = ? AND sect_id = ? AND claimed_at IS NULL
         AND completed_at IS ? AND cultivation_awarded IS ?
         AND reward_cultivation = ? AND reward_resources = ?)`,
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?)',
  ];
  const params: (string | number | null)[] = [
    commandId,
    journey.id, sect.id, journey.completed_at, journey.cultivation_awarded,
    journey.reward_cultivation, journey.reward_resources,
    sect.id, sect.level, sect.last_settled_at,
  ];

  for (const row of balances) {
    checks.push(
      'EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)',
    );
    params.push(row.id, sect.id, row.balance, row.remainder);
  }

  if (disciple !== undefined) {
    checks.push(`EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ? AND realm_id = ? AND stage = ?
      AND cultivation = ? AND cultivation_remainder = ? AND injured_until IS ? AND assignment = ?)`);
    params.push(
      disciple.id, sect.id, disciple.realm_id, disciple.stage,
      disciple.cultivation, disciple.cultivation_remainder, disciple.injured_until, disciple.assignment,
    );
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

export function deleteJourneyClaimSnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

// ---------- 交互式秘境探索（0015 迁移：进行中的探索 / 阶段推进 / 快照守卫） ----------

/**
 * 交互式探索记录行（0015 迁移）。
 *
 * 与「速通」的 explorations（0006）不同：这里保存的是**跨请求存活的进行中状态** ——
 * 每关给出一个遭遇等玩家选择，每次选择都是一次新的命令，所以关卡进度、当前遭遇、
 * 用过的场景与已得奖励都要落库（前端刷新 / 断线后靠 GET /game/realm-explore/active 续上）。
 *
 * 0 关已完成的语义：`current_stage` 是**已完成**的关卡数（0 = 还没走完第一关），
 * 因此第 N 关的展示编号是 current_stage + 1。
 *
 * 四个 JSON 列都是受控小结构（与 event_log.effects 同一做法；读取侧解析失败退化为空值）：
 * - `party`：string[]（本次派遣的弟子 id）；
 * - `current_encounter`：`{ id, name, description, choices }`；NULL = 已结束（completed / failed）；
 * - `used_encounters`：string[]（本次已抽到过的场景 id，防同一局重复）；
 * - `rewards_collected`：Record<string, string>（累计已得奖励，最小单位整数字符串）。
 *
 * `status`：'in_progress' | 'completed' | 'failed'（终态不可逆，判定在 service 层）。
 */
export interface RealmExplorationRow {
  id: string;
  sect_id: string;
  realm_id: string;
  /** JSON: string[] */
  party: string;
  total_stages: number;
  current_stage: number;
  /** 'in_progress' | 'completed' | 'failed' */
  status: string;
  /** JSON: { id, name, description, choices }；null = 已结束 */
  current_encounter: string | null;
  /** JSON: string[] */
  used_encounters: string;
  /** JSON: Record<string, string> */
  rewards_collected: string;
  created_at: number;
  updated_at: number;
}

/** 交互式探索表的完整列清单（避免 SELECT * 与将来加列时的静默漂移）。 */
const REALM_EXPLORATION_COLUMNS = `id, sect_id, realm_id, party, total_stages, current_stage,
       status, current_encounter, used_encounters, rewards_collected, created_at, updated_at`;

export class RealmExplorationRepository extends ParamRepository {
  /** 该宗门当前进行中的探索（每宗门同时最多一个）；没有返回 null。 */
  async findActiveBySectId(sectId: string): Promise<RealmExplorationRow | null> {
    return this.one<RealmExplorationRow>({
      sql: `SELECT ${REALM_EXPLORATION_COLUMNS} FROM realm_explorations
            WHERE sect_id = ? AND status = 'in_progress'
            ORDER BY created_at DESC, id DESC LIMIT 1`,
      params: [sectId],
    });
  }

  /**
   * 单条记录：按 id **且** 属于该宗门查（跨宗 id 返回 null，绝不只按 id 查）。
   * 与 journey 的 findByIdForSect 同一约定：越权访问在这里就变成 NOT_FOUND。
   */
  async findByIdForSect(id: string, sectId: string): Promise<RealmExplorationRow | null> {
    return this.one<RealmExplorationRow>({
      sql: `SELECT ${REALM_EXPLORATION_COLUMNS} FROM realm_explorations
            WHERE id = ? AND sect_id = ?`,
      params: [id, sectId],
    });
  }
}

/**
 * 开局写入（0015）：记录建立时第 1 关的遭遇已经抽好（current_stage = 0，等待玩家第一次选择）。
 * 「每宗门同时最多一条 in_progress」由 service 在读取快照时把关（守卫再复核一次记录归属）。
 */
export function insertRealmExplorationStatement(args: {
  id: string;
  sectId: string;
  realmId: string;
  /** JSON 数组字符串。 */
  party: string;
  totalStages: number;
  /** JSON 对象字符串：第一关的遭遇。 */
  currentEncounter: string;
  /** JSON 数组字符串。 */
  usedEncounters: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO realm_explorations
            (id, sect_id, realm_id, party, total_stages, current_stage, status,
             current_encounter, used_encounters, rewards_collected, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, 'in_progress', ?, ?, '{}', ?, ?)`,
    params: [
      args.id,
      args.sectId,
      args.realmId,
      args.party,
      args.totalStages,
      args.currentEncounter,
      args.usedEncounters,
      args.now,
      args.now,
    ],
  };
}

/**
 * 推进一关（0015）：把「本关结果 + 下一关遭遇」（或终态）一次写回。
 * 参数固定 7 个（远低于 D1 单语句 100 个绑定参数的上限）。
 */
export function updateRealmExplorationStageStatement(args: {
  id: string;
  currentStage: number;
  status: string;
  /** JSON 对象字符串；null = 本局结束（与 status 的终态一起写）。 */
  currentEncounter: string | null;
  /** JSON 数组字符串。 */
  usedEncounters: string;
  /** JSON 对象字符串。 */
  rewardsCollected: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `UPDATE realm_explorations
          SET current_stage = ?, status = ?, current_encounter = ?, used_encounters = ?,
              rewards_collected = ?, updated_at = ?
          WHERE id = ?`,
    params: [
      args.currentStage,
      args.status,
      args.currentEncounter,
      args.usedEncounters,
      args.rewardsCollected,
      args.now,
      args.id,
    ],
  };
}

/**
 * 交互探索 batch 的首条语句（与 journey 的守卫同一模式）：快照过期时插入 valid=0，
 * 触发 mutation_guards 的 CHECK，让同批的阶段推进 / 奖励入账 / 记录写回一起回滚。
 *
 * 复核内容：
 * - 宗门行（等级 / 结算时间）：防与并发命令双重结算；
 * - 全部资源余额：与既有守卫一致（入场费与奖励都动资产）；
 * - 传了 exploration 时再复核这条记录本身：status / current_stage / current_encounter /
 *   rewards_collected 仍与读取时完全一致 —— 并发 choose 或 abandon 的晚提交方整批回滚，
 *   不会把同一关的奖励发两次，也不会在已被放弃的局上继续推进。
 *   `current_encounter IS ?` 用 IS 而不是 =（可空列，`= NULL` 永不成立）。
 *
 * 参数个数：1（command_id）+ 3（宗门）+ 6（记录，可选）+ 4 × 资源余额行数。
 * 生产配置只有 4 种资源（spiritStone / spiritualEnergy / herb / ore），即最多 26 个，
 * 远低于 D1 单语句 100 个绑定参数的上限。
 */
export function realmExploreSnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    /** 传了就在 batch 执行时复核这条记录没被并发推进 / 结束。 */
    exploration?: RealmExplorationRow;
    /**
     * 传了就在 batch 执行时复核这些弟子仍属于本宗（开始探索时传队伍成员：
     * 与「驱逐 / 派去历练」并发时不允许带着一个刚离开的弟子开局）。
     */
    members?: readonly { id: string }[];
  },
): ParameterizedQuery {
  const { sect, balances, exploration, members } = snapshot;
  const checks = [
    'EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?)',
  ];
  const params: (string | number | null)[] = [
    commandId,
    sect.id, sect.level, sect.last_settled_at,
  ];

  if (exploration !== undefined) {
    checks.push(`EXISTS (SELECT 1 FROM realm_explorations
       WHERE id = ? AND sect_id = ? AND status = ? AND current_stage = ?
         AND current_encounter IS ? AND rewards_collected = ?)`);
    params.push(
      exploration.id, sect.id, exploration.status, exploration.current_stage,
      exploration.current_encounter, exploration.rewards_collected,
    );
  }

  for (const member of members ?? []) {
    checks.push('EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ?)');
    params.push(member.id, sect.id);
  }

  for (const row of balances) {
    checks.push(
      'EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)',
    );
    params.push(row.id, sect.id, row.balance, row.remainder);
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

export function deleteRealmExploreSnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

/**
 * 旧的 explorations 表（0006）写回：交互探索开始时先占坑（success = 0，rewards = '{}'），
 * 结束时按真实结果回填 —— 这样「今日已探索次数」的统计（按 explorations 行数算）
 * 与速通共用同一口径，中途放弃 / 失败也照实消耗次数。
 * 条件 `id = ? AND sect_id = ?` 保证只能改到自己宗门的那一行。
 */
export function updateExplorationResultStatement(args: {
  explorationId: string;
  sectId: string;
  success: boolean;
  /** JSON 对象字符串：本局实际入账的奖励（最小单位数量字符串）。 */
  rewards: string;
}): ParameterizedQuery {
  return {
    sql: 'UPDATE explorations SET success = ?, rewards = ? WHERE id = ? AND sect_id = ?',
    params: [args.success ? 1 : 0, args.rewards, args.explorationId, args.sectId],
  };
}

/* ---------- 赌坊（0019 迁移 + gambling.ts） ---------- */

/**
 * 论道计数写回（0019）：受理一次论道时把宗门行的日期键归一到今天、计数 +1。
 * 条件判断在 mutation_guards 快照语句里完成（batch 首条），这里只负责写入。
 */
export function updateSectDebateCounterStatement(
  sectId: string,
  dateKey: string,
  count: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET debate_date_key = ?, debate_count = ? WHERE id = ?',
    params: [dateKey, count, sectId],
  };
}

/**
 * 天机轮重置写回（0020）：格局种子 +1。格局不落库，由 sect_id + wheel_seed 派生
 * （见 gambling.ts 的 wheelLayoutSeed），所以「重置」在库里就只是这一列 +1。
 * 扣重置费、种子只 +1、计数不动由同一次 batch 保证（守卫见 gamblingSnapshotGuardStatement）。
 */
export function updateSectWheelSeedStatement(sectId: string, wheelSeed: number): ParameterizedQuery {
  return {
    sql: 'UPDATE sects SET wheel_seed = ? WHERE id = ?',
    params: [wheelSeed, sectId],
  };
}

/** 论道记录写入（0019）；赌注与奖励详情由调用方序列化成 JSON 字符串。 */
export function insertDaoDebateLogStatement(row: {
  id: string;
  sectId: string;
  discipleId: string;
  discipleName: string;
  betMode: string;
  multiplier: number;
  stakeDetail: string;
  result: string;
  rewardDetail: string;
  winProbability: number | null;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO dao_debate_log (id, sect_id, disciple_id, disciple_name, bet_mode, multiplier,
                 stake_detail, result, reward_detail, win_probability, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.id,
      row.sectId,
      row.discipleId,
      row.discipleName,
      row.betMode,
      row.multiplier,
      row.stakeDetail,
      row.result,
      row.rewardDetail,
      row.winProbability,
      row.now,
    ],
  };
}

/** 弟子悟道值余额 / 累计已分配写回（发奖与加点都只改这两列，属性另算）。 */
export function updateDiscipleDaoInsightStatement(
  discipleId: string,
  daoInsight: number,
  daoInsightUsed: number,
): ParameterizedQuery {
  return {
    sql: 'UPDATE disciples SET dao_insight = ?, dao_insight_used = ? WHERE id = ?',
    params: [daoInsight, daoInsightUsed, discipleId],
  };
}

/**
 * 属性赌注输了的属性扣减（0019）：只改被押的那一列。
 * 列名来自 BETTABLE_ATTRIBUTES 的固定映射（绝不拼请求里的字符串）；下限 0（计划 3.3）。
 */
export function updateDiscipleAttributeStatement(
  discipleId: string,
  attribute: BettableAttribute,
  value: number,
): ParameterizedQuery {
  return {
    sql: `UPDATE disciples SET ${attributeColumnOf(attribute)} = ? WHERE id = ?`,
    params: [Math.max(0, value), discipleId],
  };
}

/**
 * 悟道值加点写回（0019）：目标属性 + dao_insight + dao_insight_used 一次写完
 * —— 三项必须同生共死，否则会留下「属性涨了但悟道值没扣」的脏状态。
 */
export function updateDiscipleInsightAllocateStatement(
  discipleId: string,
  attribute: BettableAttribute,
  attributeValue: number,
  daoInsight: number,
  daoInsightUsed: number,
): ParameterizedQuery {
  return {
    sql: `UPDATE disciples
          SET ${attributeColumnOf(attribute)} = ?, dao_insight = ?, dao_insight_used = ?
          WHERE id = ?`,
    params: [attributeValue, daoInsight, daoInsightUsed, discipleId],
  };
}

/** 可赌属性 → disciples 列名（白名单映射，SQL 里不出现请求传来的字符串）。 */
function attributeColumnOf(attribute: BettableAttribute): string {
  switch (attribute) {
    case 'attack':
      return 'attack';
    case 'defense':
      return 'defense';
    case 'speed':
      return 'speed';
    case 'aptitude':
      return 'aptitude';
    case 'luck':
      return 'luck';
    case 'physique':
      return 'physique';
  }
}

/**
 * 赌坊 batch 的首条语句（与炼丹/挑战守卫同一模式）：快照过期时插入 valid=0，
 * 触发 mutation_guards 的 CHECK，让同批的结算写回、资源/属性/悟道值更新、论道计数与
 * 记录一起回滚（计划 14.4）。
 *
 * 校验：
 * - 宗门行（等级 / 结算时间 / 论道日期键 / 论道计数）：每日 20 次上限（论道 + 天机轮共享）
 *   不会被并发请求越过，也不会与任何并发命令双重结算；
 * - `resourceId` 非空时核对**这一条**资源的余额（押注扣减的依据）；
 * - `pill` 非空时核对这条丹药库存仍是读到的数量（天机轮丹药格发奖的依据）；
 * - `checkWheelSeed` 为真时核对宗门行的 wheel_seed 未变（天机轮转动与重置）；
 * - `disciple` 非空时核对目标弟子仍属本宗、结算相关列未变、被押属性仍是读到的值、
 *   悟道值两列未变，以及（本次涉及属性时）被写的那一列仍是读到的值、（rejectAway 时）
 *   此刻没有「尚未到期的历练」。
 */
export function gamblingSnapshotGuardStatement(
  commandId: string,
  snapshot: {
    sect: SectRow;
    balances: readonly ResourceBalanceRow[];
    /** 赌注涉及的资源 id（灵石/药材/矿石）；不押资源时为 null。 */
    resourceId: string | null;
    /**
     * 涉事弟子（快照值来自读取时的行）；无弟子时为 undefined。
     * `attribute` 是本次写入涉及的属性：属性赌注与被加点时必填，只发悟道值奖励时可省略。
     */
    disciple?: { row: DiscipleRow; attribute?: BettableAttribute };
    /**
     * 天机轮丹药格中奖时涉及的丹药库存（快照值来自读取时的行）。
     * 发奖是按快照算好的绝对值写入，所以必须核对这一条。
     */
    pill?: { pillId: string; quantity: number };
    /**
     * 是否要求该弟子此刻没有「尚未到期的历练」
     * （论道要求：在外弟子不能参赌；悟道值加点不要求，计划 7.2 并未限制在外）。
     */
    rejectAway?: boolean;
    /**
     * 0020：是否核对宗门行的 wheel_seed。
     * 天机轮的格局与奖励都由 wheel_seed 派生，转动中途被重置过，这一转的结果就无意义了；
     * 重置自己改写这一列，也一样要核对（并发的两次重置只能成功一次）。
     */
    checkWheelSeed?: boolean;
    now: number;
  },
): ParameterizedQuery {
  const { sect, balances, resourceId, disciple } = snapshot;
  // 0020：只在需要时把 wheel_seed 并入宗门行校验 —— 论道不依赖转盘格局，不必白挨一次重试。
  const wheelSeedClause = snapshot.checkWheelSeed === true ? ' AND wheel_seed = ?' : '';
  const checks = [
    `EXISTS (SELECT 1 FROM sects WHERE id = ? AND level = ? AND last_settled_at = ?
      AND debate_date_key = ? AND debate_count = ?${wheelSeedClause})`,
  ];
  const params: (string | number | null)[] = [
    commandId,
    sect.id,
    sect.level,
    sect.last_settled_at,
    sect.debate_date_key,
    sect.debate_count,
  ];
  if (snapshot.checkWheelSeed === true) {
    params.push(sect.wheel_seed);
  }

  for (const row of balances) {
    checks.push(
      'EXISTS (SELECT 1 FROM resource_balances WHERE id = ? AND sect_id = ? AND balance = ? AND remainder = ?)',
    );
    params.push(row.id, sect.id, row.balance, row.remainder);
  }
  if (resourceId !== null) {
    // 与上面逐行校验重复一次也无害：这里显式表达「押的那一条资源仍是读到的余额」。
    const row = balances.find((item) => item.resource_id === resourceId);
    checks.push('EXISTS (SELECT 1 FROM resource_balances WHERE sect_id = ? AND resource_id = ? AND balance = ?)');
    params.push(sect.id, resourceId, row === undefined ? 0 : row.balance);
  }
  if (snapshot.pill !== undefined) {
    // 与炼丹守卫同一口径：这条丹药库存仍是读到的数量（没有行时视为 0）。
    // 丹药发奖走的是绝对值 upsert（不是 quantity = quantity + ?），
    // 不核对这一条就会被并发的炼制 / 服用悄悄覆盖。
    checks.push(
      'COALESCE((SELECT quantity FROM pill_inventories WHERE sect_id = ? AND pill_id = ?), 0) = ?',
    );
    params.push(sect.id, snapshot.pill.pillId, snapshot.pill.quantity);
  }
  if (disciple !== undefined) {
    // attribute 缺省时只校验弟子行本身（发悟道值奖励的路径也必须有这道守卫：
    // 否则并发加点改掉的 dao_insight / dao_insight_used 会被本批的绝对值写回覆盖，
    // 「累计 50」上限会被静默重置 —— 写谁就校验谁，与挑战 / 炼丹守卫同一口径）。
    const attributeClause =
      disciple.attribute === undefined ? '' : ` AND ${attributeColumnOf(disciple.attribute)} = ?`;
    checks.push(`EXISTS (SELECT 1 FROM disciples WHERE id = ? AND sect_id = ?
      AND realm_id = ? AND stage = ? AND cultivation = ? AND cultivation_remainder = ?
      AND injured_until IS ? AND assignment = ? AND dao_insight = ? AND dao_insight_used = ?${attributeClause})`);
    params.push(
      disciple.row.id,
      sect.id,
      disciple.row.realm_id,
      disciple.row.stage,
      disciple.row.cultivation,
      disciple.row.cultivation_remainder,
      disciple.row.injured_until,
      disciple.row.assignment,
      disciple.row.dao_insight,
      disciple.row.dao_insight_used,
    );
    if (disciple.attribute !== undefined) {
      params.push(disciple.row[disciple.attribute]);
    }
    if (snapshot.rejectAway === true) {
      checks.push(
        'NOT EXISTS (SELECT 1 FROM disciple_journeys WHERE disciple_id = ? AND claimed_at IS NULL AND ends_at > ?)',
      );
      params.push(disciple.row.id, snapshot.now);
    }
  }

  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

// ── 聊天消息 ──

export interface ChatMessageRow {
  id: string;
  user_id: string;
  sect_name: string;
  content: string;
  created_at: number;
}

export class ChatMessageRepository extends ParamRepository {
  async findRecent(limit: number): Promise<ChatMessageRow[]> {
    return this.all<ChatMessageRow>({
      sql: 'SELECT id, user_id, sect_name, content, created_at FROM chat_messages ORDER BY created_at DESC, id DESC LIMIT ?',
      params: [limit],
    });
  }

  async findAfterId(afterId: string, limit: number): Promise<ChatMessageRow[]> {
    return this.all<ChatMessageRow>({
      // 外层用 created_at >= 锚点 走 idx_chat_messages_created_at 做范围扫描；
      // 原来整条 WHERE 是 OR，SQLite 用不上索引，每次轮询都全表扫描。
      sql: `SELECT id, user_id, sect_name, content, created_at FROM chat_messages
            WHERE created_at >= (SELECT created_at FROM chat_messages WHERE id = ?)
              AND (created_at > (SELECT created_at FROM chat_messages WHERE id = ?) OR id > ?)
            ORDER BY created_at ASC, id ASC LIMIT ?`,
      params: [afterId, afterId, afterId, limit],
    });
  }

  async findLatestByUserId(userId: string): Promise<ChatMessageRow | null> {
    return this.one<ChatMessageRow>({
      sql: 'SELECT id, user_id, sect_name, content, created_at FROM chat_messages WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
      params: [userId],
    });
  }

  override async execute(query: ParameterizedQuery): Promise<D1Result> {
    return super.execute(query);
  }
}

export function insertChatMessageStatement(args: {
  id: string;
  userId: string;
  sectName: string;
  content: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: 'INSERT INTO chat_messages (id, user_id, sect_name, content, created_at) VALUES (?, ?, ?, ?, ?)',
    params: [args.id, args.userId, args.sectName, args.content, args.now],
  };
}

export function deleteGamblingSnapshotGuardStatement(commandId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM mutation_guards WHERE command_id = ?',
    params: [commandId],
  };
}

/* ---------- 灵兽竞逐（0024） ---------- */

export interface RaceRoundRow {
  id: string;
  round_key: string;
  beast_weights: string;
  status: string;
  winner_index: number | null;
  total_pool: number;
  settled_at: number | null;
  created_at: number;
}

export interface RaceBetRow {
  id: string;
  round_id: string;
  sect_id: string;
  beast_index: number;
  amount: number;
  created_at: number;
}

export class RaceRepository extends ParamRepository {
  async findRoundByKey(roundKey: string): Promise<RaceRoundRow | null> {
    return this.one<RaceRoundRow>({
      sql: 'SELECT * FROM race_rounds WHERE round_key = ?',
      params: [roundKey],
    });
  }

  async findBettingRoundsBefore(now: number): Promise<RaceRoundRow[]> {
    return this.all<RaceRoundRow>({
      sql: "SELECT * FROM race_rounds WHERE status = 'betting' AND created_at <= ?",
      params: [now],
    });
  }

  async betsByRound(roundId: string): Promise<RaceBetRow[]> {
    return this.all<RaceBetRow>({
      sql: 'SELECT * FROM race_bets WHERE round_id = ? ORDER BY created_at ASC',
      params: [roundId],
    });
  }

  async betsByRoundAndSect(roundId: string, sectId: string): Promise<RaceBetRow[]> {
    return this.all<RaceBetRow>({
      sql: 'SELECT * FROM race_bets WHERE round_id = ? AND sect_id = ? ORDER BY created_at ASC',
      params: [roundId, sectId],
    });
  }

  async betFeedByRound(roundId: string): Promise<{ sect_name: string; beast_index: number; amount: number; created_at: number }[]> {
    return this.all<{ sect_name: string; beast_index: number; amount: number; created_at: number }>({
      sql: `SELECT s.name as sect_name, b.beast_index, b.amount, b.created_at
            FROM race_bets b JOIN sects s ON s.id = b.sect_id
            WHERE b.round_id = ? ORDER BY b.created_at DESC`,
      params: [roundId],
    });
  }

  async beastPoolsByRound(roundId: string): Promise<{ beast_index: number; total: number }[]> {
    return this.all<{ beast_index: number; total: number }>({
      sql: 'SELECT beast_index, SUM(amount) as total FROM race_bets WHERE round_id = ? GROUP BY beast_index',
      params: [roundId],
    });
  }

  async hasBetInRound(roundId: string, sectId: string): Promise<boolean> {
    const row = await this.one<{ cnt: number }>({
      sql: 'SELECT COUNT(*) as cnt FROM race_bets WHERE round_id = ? AND sect_id = ?',
      params: [roundId, sectId],
    });
    return (row?.cnt ?? 0) > 0;
  }

  override async execute(query: ParameterizedQuery): Promise<D1Result> {
    return super.execute(query);
  }

  async countSettledRounds(): Promise<number> {
    const row = await this.one<{ cnt: number }>({
      sql: "SELECT COUNT(*) as cnt FROM race_rounds WHERE status = 'settled'",
      params: [],
    });
    return row?.cnt ?? 0;
  }

  async listSettledRounds(limit: number, offset: number): Promise<RaceRoundRow[]> {
    return this.all<RaceRoundRow>({
      sql: "SELECT * FROM race_rounds WHERE status = 'settled' ORDER BY settled_at DESC LIMIT ? OFFSET ?",
      params: [limit, offset],
    });
  }

  async beastWinCounts(): Promise<{ winner_index: number; cnt: number }[]> {
    return this.all<{ winner_index: number; cnt: number }>({
      sql: "SELECT winner_index, COUNT(*) as cnt FROM race_rounds WHERE status = 'settled' AND winner_index IS NOT NULL GROUP BY winner_index",
      params: [],
    });
  }

  async beastPoolsByRoundIds(roundIds: string[]): Promise<{ round_id: string; beast_index: number; total: number }[]> {
    if (roundIds.length === 0) return [];
    const placeholders = roundIds.map(() => '?').join(',');
    return this.all<{ round_id: string; beast_index: number; total: number }>({
      sql: `SELECT round_id, beast_index, SUM(amount) as total FROM race_bets WHERE round_id IN (${placeholders}) GROUP BY round_id, beast_index`,
      params: roundIds,
    });
  }
}

export function insertRaceRoundStatement(row: {
  id: string;
  roundKey: string;
  beastWeights: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: 'INSERT INTO race_rounds (id, round_key, beast_weights, status, total_pool, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    params: [row.id, row.roundKey, row.beastWeights, 'betting', row.now],
  };
}

export function insertRaceBetStatement(row: {
  id: string;
  roundId: string;
  sectId: string;
  beastIndex: number;
  amount: number;
  now: number;
}): ParameterizedQuery {
  return {
    sql: 'INSERT INTO race_bets (id, round_id, sect_id, beast_index, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    params: [row.id, row.roundId, row.sectId, row.beastIndex, row.amount, row.now],
  };
}

export function updateRaceRoundPoolStatement(roundId: string, delta: number): ParameterizedQuery {
  return {
    sql: 'UPDATE race_rounds SET total_pool = total_pool + ? WHERE id = ?',
    params: [delta, roundId],
  };
}

export function settleRaceRoundStatement(roundId: string, winnerIndex: number, now: number): ParameterizedQuery {
  return {
    sql: "UPDATE race_rounds SET status = 'settled', winner_index = ?, settled_at = ? WHERE id = ?",
    params: [winnerIndex, now, roundId],
  };
}

/* ---------- 0025/0027 世界 Boss（讨伐，二期） ---------- */

export interface WorldBossRow {
  id: string;
  /** UTC+8 日期键 'YYYY-MM-DD'；一天可以有多个关卡（连战）。 */
  day_key: string;
  /** 第几关（每天从 1 开始）。 */
  stage: number;
  /** 五只轮换 Boss 的下标（0~4）。 */
  boss_index: number;
  /** 随机词缀 id（见 worldBoss.ts 的 WORLD_BOSS_AFFIXES；迁移过来的旧行是 'none'）。 */
  affix: string;
  /** 生成第 1 关时算好的「一轮伤害」，后续关卡复用它算血量。 */
  round_damage: number;
  max_hp: number;
  hp: number;
  /** 'active' | 'killed' | 'fled'。 */
  status: string;
  /** 最后一击的宗门 id；未击杀为 null。 */
  killer_sect_id: string | null;
  /** 是否已广播过「血量不足一半」（0/1）。 */
  half_announced: number;
  /** 奖励发放完成时间；NULL = 未发。 */
  rewarded_at: number | null;
  created_at: number;
  ended_at: number | null;
}

export interface WorldBossHitRow {
  id: string;
  boss_id: string;
  sect_id: string;
  /** 冗余的宗门名（榜单与出手记录不用再 JOIN sects）。 */
  sect_name: string;
  /** 出战弟子名的 JSON 数组。 */
  disciple_names: string;
  /** 出战弟子 id 的 JSON 数组。 */
  disciple_ids: string;
  /** 本次受伤（普通）的弟子名 JSON 数组。 */
  injured_names: string;
  /** 本次被打成重伤的弟子名 JSON 数组。 */
  severe_names: string;
  /** 实际扣血。 */
  damage: number;
  is_crit: number;
  is_last_hit: number;
  created_at: number;
}

/** 本关伤害榜的一行（按宗门汇总）。 */
export interface WorldBossSectDamageRow {
  sect_id: string;
  sect_name: string;
  damage: number;
  attempts: number;
  /** 该宗门第一次出手的时间；并列时「先达到者」靠它排序。 */
  first_at: number;
  last_hit: number;
}

/** 历史最强一击（带 Boss 信息，用于展示名字）。 */
export interface WorldBossTopHitRow extends WorldBossHitRow {
  day_key: string;
  stage: number;
  boss_index: number;
}

/** 一名弟子在疲劳窗口内的出战次数。 */
export interface DiscipleBattleCountRow {
  disciple_id: string;
  cnt: number;
  /** 窗口内每次出战的时间（逗号分隔的毫秒数），给前端算「冒进冷却」。 */
  times: string | null;
}

export class WorldBossRepository extends ParamRepository {
  async findById(bossId: string): Promise<WorldBossRow | null> {
    return this.one<WorldBossRow>({
      sql: 'SELECT * FROM world_bosses WHERE id = ?',
      params: [bossId],
    });
  }

  /** 当天最新的一关（连战时就是当前关；已被打死的那关是上一条）。 */
  async findLatestByDayKey(dayKey: string): Promise<WorldBossRow | null> {
    return this.one<WorldBossRow>({
      sql: 'SELECT * FROM world_bosses WHERE day_key = ? ORDER BY stage DESC LIMIT 1',
      params: [dayKey],
    });
  }

  /** 指定关卡（day_key + stage 唯一，用来防重复生成）。 */
  async findByDayKeyAndStage(dayKey: string, stage: number): Promise<WorldBossRow | null> {
    return this.one<WorldBossRow>({
      sql: 'SELECT * FROM world_bosses WHERE day_key = ? AND stage = ?',
      params: [dayKey, stage],
    });
  }

  /** 今天已击杀的关数（面板「今日已连斩 N 只」）。 */
  async countKilledByDayKey(dayKey: string): Promise<number> {
    const row = await this.one<{ killed: number }>({
      sql: "SELECT COUNT(*) AS killed FROM world_bosses WHERE day_key = ? AND status = 'killed'",
      params: [dayKey],
    });
    return Number(row?.killed ?? 0);
  }

  /** 史上最高单日关数 = 历史上达成过的最高关卡（status = 'killed'）。 */
  async maxKilledStage(): Promise<number> {
    const row = await this.one<{ max_stage: number | null }>({
      sql: "SELECT MAX(stage) AS max_stage FROM world_bosses WHERE status = 'killed'",
      params: [],
    });
    return Number(row?.max_stage ?? 0);
  }

  /** 仍是 active 的 Boss（正常最多一条；Cron 漏跑时会留下隔夜的残留）。 */
  async findActiveBosses(): Promise<WorldBossRow[]> {
    return this.all<WorldBossRow>({
      sql: "SELECT * FROM world_bosses WHERE status = 'active' ORDER BY day_key ASC, stage ASC",
      params: [],
    });
  }

  /** 已结束但还没发奖的 Boss（Cron 发奖用）。 */
  async findUnrewardedEnded(): Promise<WorldBossRow[]> {
    return this.all<WorldBossRow>({
      sql: "SELECT * FROM world_bosses WHERE status IN ('killed', 'fled') AND rewarded_at IS NULL ORDER BY day_key ASC, stage ASC",
      params: [],
    });
  }

  /**
   * 「合格宗门」的第一优先口径：最近 N 天在 world_boss_hits 里出过手的宗门。
   * 两边都走索引（world_bosses 的 (day_key, stage) 唯一索引 + hits 的 (boss_id, created_at)）。
   */
  async sectsWithHitsSince(sinceDayKey: string): Promise<string[]> {
    const rows = await this.all<{ sect_id: string }>({
      sql: `SELECT DISTINCT h.sect_id AS sect_id
              FROM world_boss_hits h
              JOIN world_bosses b ON b.id = h.boss_id
             WHERE b.day_key >= ?`,
      params: [sinceDayKey],
    });
    return rows.map((row) => row.sect_id);
  }

  /** 合格宗门的兜底口径：last_settled_at 在阈值之后（活跃）的宗门。 */
  async activeSectsSince(thresholdMs: number): Promise<{ id: string; name: string; level: number }[]> {
    return this.all<{ id: string; name: string; level: number }>({
      sql: 'SELECT id, name, level FROM sects WHERE last_settled_at >= ? ORDER BY id',
      params: [thresholdMs],
    });
  }

  /** 参与宗门的等级/名字（发奖按各自产出计算时用）。 */
  async sectsByIds(sectIds: readonly string[]): Promise<{ id: string; name: string; level: number }[]> {
    if (sectIds.length === 0) return [];
    const placeholders = sectIds.map(() => '?').join(', ');
    return this.all<{ id: string; name: string; level: number }>({
      sql: `SELECT id, name, level FROM sects WHERE id IN (${placeholders})`,
      params: [...sectIds],
    });
  }

  /** 该宗门最近一条出手记录的时间（冷却判断；走 (sect_id, created_at DESC) 索引）。 */
  async lastHitAtBySect(sectId: string): Promise<number | null> {
    const row = await this.one<{ created_at: number | null }>({
      sql: 'SELECT created_at FROM world_boss_hits WHERE sect_id = ? ORDER BY created_at DESC LIMIT 1',
      params: [sectId],
    });
    return row?.created_at === null || row?.created_at === undefined ? null : Number(row.created_at);
  }

  /** 该宗门自 since 起的出手次数（每日出手上限用；走 (sect_id, created_at DESC) 索引）。 */
  async countHitsBySectSince(sectId: string, since: number): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM world_boss_hits WHERE sect_id = ? AND created_at >= ?',
      params: [sectId, since],
    });
    return Number(row?.total ?? 0);
  }

  /** 某只 Boss 的全部出手记录（发奖排名用）。 */
  async hitsByBoss(bossId: string): Promise<WorldBossHitRow[]> {
    return this.all<WorldBossHitRow>({
      sql: 'SELECT * FROM world_boss_hits WHERE boss_id = ? ORDER BY created_at ASC',
      params: [bossId],
    });
  }

  /** 出手记录（新的在前）。 */
  async recentHitsByBoss(bossId: string, limit: number): Promise<WorldBossHitRow[]> {
    return this.all<WorldBossHitRow>({
      sql: 'SELECT * FROM world_boss_hits WHERE boss_id = ? ORDER BY created_at DESC LIMIT ?',
      params: [bossId, limit],
    });
  }

  /** 本关伤害榜：按宗门汇总，伤害高的在前，并列取先达到者。 */
  async sectDamageRows(bossId: string): Promise<WorldBossSectDamageRow[]> {
    return this.all<WorldBossSectDamageRow>({
      sql: `SELECT sect_id,
                   MAX(sect_name) AS sect_name,
                   SUM(damage) AS damage,
                   COUNT(*) AS attempts,
                   MIN(created_at) AS first_at,
                   MAX(CASE WHEN is_last_hit = 1 THEN 1 ELSE 0 END) AS last_hit
              FROM world_boss_hits
             WHERE boss_id = ?
             GROUP BY sect_id
             ORDER BY damage DESC, first_at ASC`,
      params: [bossId],
    });
  }

  /**
   * 历史最强一击（全表）。
   * 先用 damage 索引取 MAX（只读 1 行），再按等值取同伤害里最早的那次；
   * 原来的「JOIN + ORDER BY damage DESC, created_at ASC」会全表扫描 + 排序，D1 读行数随出手次数线性增长。
   */
  async topHit(): Promise<WorldBossTopHitRow | null> {
    return this.one<WorldBossTopHitRow>({
      sql: `SELECT h.*, b.day_key, b.stage, b.boss_index
              FROM world_boss_hits h
              JOIN world_bosses b ON b.id = h.boss_id
             WHERE h.damage = (SELECT MAX(damage) FROM world_boss_hits)
             ORDER BY h.created_at ASC
             LIMIT 1`,
      params: [],
    });
  }

  /** 疲劳：本宗门每名弟子在窗口内的出战次数。 */
  async fatigueCountsBySect(sectId: string, sinceMs: number): Promise<DiscipleBattleCountRow[]> {
    return this.all<DiscipleBattleCountRow>({
      sql: `SELECT disciple_id, COUNT(*) AS cnt, GROUP_CONCAT(created_at) AS times
              FROM disciple_boss_battles
             WHERE sect_id = ? AND created_at >= ?
             GROUP BY disciple_id`,
      params: [sectId, sinceMs],
    });
  }

  /** 清掉窗口之外的老行（Cron 顺带调用，防止表无限增长）。 */
  async deleteBattlesBefore(thresholdMs: number): Promise<number> {
    const result = await this.execute({
      sql: 'DELETE FROM disciple_boss_battles WHERE created_at < ?',
      params: [thresholdMs],
    });
    return Number(result.meta.changes);
  }

  /** 出现：UNIQUE (day_key, stage)，已有则什么都不做；返回是否真的插入了。 */
  async insertBossIfAbsent(row: {
    id: string;
    dayKey: string;
    stage: number;
    bossIndex: number;
    affix: string;
    roundDamage: number;
    maxHp: number;
    now: number;
  }): Promise<boolean> {
    const result = await this.execute({
      sql: `INSERT INTO world_bosses
              (id, day_key, stage, boss_index, affix, round_damage, max_hp, hp, status, half_announced, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)
            ON CONFLICT (day_key, stage) DO NOTHING`,
      params: [
        row.id,
        row.dayKey,
        row.stage,
        row.bossIndex,
        row.affix,
        row.roundDamage,
        row.maxHp,
        row.maxHp,
        row.now,
      ],
    });
    return Number(result.meta.changes) > 0;
  }

  /** 单条写入（出现 / 逃走 / 半血标记 / 最后一击标记 / 清理疲劳）：与 ChatMessageRepository 同一处理。 */
  override async execute(query: ParameterizedQuery): Promise<D1Result> {
    return super.execute(query);
  }
}

/**
 * 出手扣血（一次条件 UPDATE，原子性由数据库保证）：
 * `WHERE status = 'active'` 让结束后的并发提交变成空操作；SET 里的表达式一律用**更新前**的
 * 行值求值，所以 `hp - ?` 就是「扣血前的血量」，最后一击/结束时间都由它判定。
 */
export function updateWorldBossHpStatement(
  bossId: string,
  damage: number,
  sectId: string,
  now: number,
): ParameterizedQuery {
  return {
    sql: `UPDATE world_bosses
             SET hp = MAX(0, hp - ?),
                 status = CASE WHEN hp - ? <= 0 THEN 'killed' ELSE status END,
                 killer_sect_id = CASE WHEN hp - ? <= 0 AND killer_sect_id IS NULL THEN ? ELSE killer_sect_id END,
                 ended_at = CASE WHEN hp - ? <= 0 THEN ? ELSE ended_at END
           WHERE id = ? AND status = 'active'`,
    params: [damage, damage, damage, sectId, damage, now, bossId],
  };
}

export function insertWorldBossHitStatement(row: {
  id: string;
  bossId: string;
  sectId: string;
  sectName: string;
  discipleNames: string;
  discipleIds: string;
  injuredNames: string;
  severeNames: string;
  damage: number;
  isCrit: boolean;
  now: number;
}): ParameterizedQuery {
  return {
    sql: `INSERT INTO world_boss_hits
            (id, boss_id, sect_id, sect_name, disciple_names, disciple_ids,
             injured_names, severe_names, damage, is_crit, is_last_hit, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    params: [
      row.id,
      row.bossId,
      row.sectId,
      row.sectName,
      row.discipleNames,
      row.discipleIds,
      row.injuredNames,
      row.severeNames,
      row.damage,
      row.isCrit ? 1 : 0,
      row.now,
    ],
  };
}

/** 疲劳记录：每名出战弟子每次写一行。 */
export function insertDiscipleBossBattleStatement(row: {
  id: string;
  discipleId: string;
  sectId: string;
  now: number;
}): ParameterizedQuery {
  return {
    sql: 'INSERT INTO disciple_boss_battles (id, disciple_id, sect_id, created_at) VALUES (?, ?, ?, ?)',
    params: [row.id, row.discipleId, row.sectId, row.now],
  };
}

/** 血量首次跌破一半的广播标记（条件更新：并发下只有一个请求抢到）。 */
export function markWorldBossHalfAnnouncedStatement(bossId: string): ParameterizedQuery {
  return {
    sql: 'UPDATE world_bosses SET half_announced = 1 WHERE id = ? AND half_announced = 0',
    params: [bossId],
  };
}

export function markWorldBossHitLastHitStatement(hitId: string): ParameterizedQuery {
  return {
    sql: 'UPDATE world_boss_hits SET is_last_hit = 1 WHERE id = ?',
    params: [hitId],
  };
}

/** 逃走（23:00 窗口结束仍未击杀）；只对仍 active 的行生效。 */
export function markWorldBossFledStatement(bossId: string, now: number): ParameterizedQuery {
  return {
    sql: "UPDATE world_bosses SET status = 'fled', ended_at = ? WHERE id = ? AND status = 'active'",
    params: [now, bossId],
  };
}

/** 发奖完成标记：条件更新 `rewarded_at IS NULL`，与写奖语句同批提交 → 只会发一次。 */
export function markWorldBossRewardedStatement(bossId: string, now: number): ParameterizedQuery {
  return {
    sql: 'UPDATE world_bosses SET rewarded_at = ? WHERE id = ? AND rewarded_at IS NULL',
    params: [now, bossId],
  };
}

/**
 * 丹药库存的**增量** upsert（0025）：与 upsertPillInventoryStatement 的绝对值写回不同，
 * 它可以在 Cron 里一次给多个宗门加同一味丹药，并且并发时不会互相覆盖。
 */
export function incrementPillInventoryStatement(
  sectId: string,
  pillId: string,
  delta: number,
  now: number,
): ParameterizedQuery {
  return {
    sql: `INSERT INTO pill_inventories (id, sect_id, pill_id, quantity, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (sect_id, pill_id)
          DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
    params: [crypto.randomUUID(), sectId, pillId, delta, now],
  };
}

/* ---------- 装备（0028 迁移：装备表 / 弟子 gear_ 冗余列 / 快照守卫） ---------- */

/**
 * 装备行（0028）：disciple_id 为 NULL = 在背包里，否则 = 穿在该弟子身上。
 * 属性（主/副）生成后不再变化，所以没有「修改装备」的语句。
 */
export interface EquipmentRow {
  id: string;
  sect_id: string;
  disciple_id: string | null;
  /** weapon | armor | artifact（见 equipment.ts 的 EQUIPMENT_SLOTS）。 */
  slot: string;
  /** common | spirit | treasure | immortal（见 EQUIPMENT_QUALITIES）。 */
  quality: string;
  name: string;
  main_attr: string;
  main_value: number;
  sub_attr: string;
  sub_value: number;
  /** forge | boss（一期的两个来源）。 */
  source: string;
  created_at: number;
}

export class EquipmentRepository extends ParamRepository {
  /** 本宗全部装备（背包 + 已穿戴）；新的在前，背包列表与弟子页共用这份数据。 */
  async findBySectId(sectId: string): Promise<EquipmentRow[]> {
    return this.all<EquipmentRow>({
      sql: `SELECT id, sect_id, disciple_id, slot, quality, name, main_attr, main_value,
                   sub_attr, sub_value, source, created_at
            FROM equipment WHERE sect_id = ? ORDER BY created_at DESC, id DESC`,
      params: [sectId],
    });
  }

  /** 某名弟子身上的装备（穿戴 / 卸下 / 驱逐 / 跨弟子转移用；走 equipment_disciple_slot_uniq）。 */
  async findByDiscipleId(discipleId: string): Promise<EquipmentRow[]> {
    return this.all<EquipmentRow>({
      sql: `SELECT id, sect_id, disciple_id, slot, quality, name, main_attr, main_value,
                   sub_attr, sub_value, source, created_at
            FROM equipment WHERE disciple_id = ? ORDER BY slot ASC, id ASC`,
      params: [discipleId],
    });
  }

  /** 天骄榜「装备榜」：几名弟子身上各部位的品质（只取榜上的人，不扫全表）。 */
  async findWornQualitiesByDiscipleIds(
    discipleIds: readonly string[],
  ): Promise<{ disciple_id: string; slot: string; quality: string }[]> {
    if (discipleIds.length === 0) {
      return [];
    }
    return this.all<{ disciple_id: string; slot: string; quality: string }>({
      sql: `SELECT disciple_id, slot, quality FROM equipment
            WHERE disciple_id IN (${discipleIds.map(() => '?').join(', ')})`,
      params: [...discipleIds],
    });
  }

  /** 背包件数（disciple_id IS NULL），走 equipment_sect_idx；背包上限判断用。 */
  async countBagBySectId(sectId: string): Promise<number> {
    const row = await this.one<{ total: number }>({
      sql: 'SELECT COUNT(*) AS total FROM equipment WHERE sect_id = ? AND disciple_id IS NULL',
      params: [sectId],
    });
    return Number(row?.total ?? 0);
  }
}

export interface NewEquipment {
  id: string;
  sectId: string;
  slot: string;
  quality: string;
  name: string;
  mainAttr: string;
  mainValue: number;
  subAttr: string;
  subValue: number;
  source: string;
  now: number;
}

/** 生成装备（炼器 / Boss 掉落）：新装备一律先落在背包里（disciple_id = NULL）。 */
export function insertEquipmentStatement(row: NewEquipment): ParameterizedQuery {
  return {
    sql: `INSERT INTO equipment
            (id, sect_id, disciple_id, slot, quality, name, main_attr, main_value,
             sub_attr, sub_value, source, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      row.id,
      row.sectId,
      row.slot,
      row.quality,
      row.name,
      row.mainAttr,
      row.mainValue,
      row.subAttr,
      row.subValue,
      row.source,
      row.now,
    ],
  };
}

/** 穿戴 / 卸下 / 跨弟子转移：只改归属人（NULL = 放回背包）。 */
export function updateEquipmentHolderStatement(
  equipmentId: string,
  sectId: string,
  discipleId: string | null,
): ParameterizedQuery {
  return {
    sql: 'UPDATE equipment SET disciple_id = ? WHERE id = ? AND sect_id = ?',
    params: [discipleId, equipmentId, sectId],
  };
}

/** 分解（只对背包里的行生效：穿在身上的删不掉）。 */
export function deleteBagEquipmentStatement(
  equipmentId: string,
  sectId: string,
): ParameterizedQuery {
  return {
    sql: 'DELETE FROM equipment WHERE id = ? AND sect_id = ? AND disciple_id IS NULL',
    params: [equipmentId, sectId],
  };
}

/**
 * 驱逐弟子时把背包放不下的那几件直接删掉（计划 1.5）。
 * 这里**不能**用上面的「只删背包行」：此刻它仍登记在被驱逐的弟子名下
 * （归属人是在同一批里被删掉的行，D1 的 batch 按数组顺序执行）。
 */
export function deleteEquipmentStatement(equipmentId: string, sectId: string): ParameterizedQuery {
  return {
    sql: 'DELETE FROM equipment WHERE id = ? AND sect_id = ?',
    params: [equipmentId, sectId],
  };
}

/**
 * 品质 → 战力加成（基点）的 SQL CASE 表达式：由 EQUIPMENT_QUALITIES 生成（常量，不含请求数据），
 * 0032 迁移里手写的是同一张表。
 */
const GEAR_POWER_BP_CASE =
  `CASE quality ${EQUIPMENT_QUALITIES.map((quality) => `WHEN '${quality.id}' THEN ${String(quality.powerBonusBp)}`).join(' ')} ELSE 0 END`;

/**
 * 按**装备表重新求和**写回这名弟子的 6 个冗余列（计划 2.2；0032 起多一列 gear_power_bp）。
 *
 * 不在内存里加减，避免多次穿戴 / 卸下把误差累积起来；必须与改动装备的语句放在同一个
 * batch 里，且排在它们**之后** —— D1 的 batch 按数组顺序执行，SUM 才看得到新归属。
 * 参数顺序：6 个 SET 子查询各一个 disciple_id，最后 WHERE 一个。
 */
export function refreshDiscipleGearStatement(discipleId: string): ParameterizedQuery {
  const sumOf = (attr: string): string =>
    `COALESCE((SELECT SUM(CASE WHEN main_attr = '${attr}' THEN main_value ELSE 0 END` +
    ` + CASE WHEN sub_attr = '${attr}' THEN sub_value ELSE 0 END)` +
    ` FROM equipment WHERE disciple_id = ?), 0)`;
  return {
    sql:
      `UPDATE disciples SET gear_attack = ${sumOf('attack')}, gear_defense = ${sumOf('defense')},` +
      ` gear_speed = ${sumOf('speed')}, gear_luck = ${sumOf('luck')}, gear_physique = ${sumOf('physique')},` +
      ` gear_power_bp = COALESCE((SELECT SUM(${GEAR_POWER_BP_CASE}) FROM equipment WHERE disciple_id = ?), 0)` +
      ` WHERE id = ?`,
    params: [discipleId, discipleId, discipleId, discipleId, discipleId, discipleId, discipleId],
  };
}

/**
 * 装备行的快照守卫（与弟子 / 丹药守卫同一模式）：快照过期时插入 valid=0，
 * 触发 mutation_guards 的 CHECK，让同批的装备改动 + gear 列写回一起回滚。
 *
 * 为什么需要它：同一件装备的两次并发操作（双击「穿戴」到两名不同弟子）读到的归属人一样，
 * 弟子守卫看不出来；少了这条就会出现「装备表归属是 B，但 A 的 gear 列还算着这件装备」。
 * 校验内容：这些装备行仍属本宗，且归属人仍是读快照时的那个（NULL = 仍在背包里）。
 */
export function equipmentGuardStatement(
  guardId: string,
  sectId: string,
  items: readonly { id: string; discipleId: string | null }[],
): ParameterizedQuery {
  const checks: string[] = [];
  const params: (string | number | null)[] = [guardId];
  for (const item of items) {
    checks.push('EXISTS (SELECT 1 FROM equipment WHERE id = ? AND sect_id = ? AND disciple_id IS ?)');
    params.push(item.id, sectId, item.discipleId);
  }
  return {
    sql: `INSERT INTO mutation_guards (command_id, valid)
          SELECT ?, CASE WHEN ${checks.length === 0 ? '1' : checks.join(' AND ')} THEN 1 ELSE 0 END`,
    params,
  };
}

/**
 * 每片装备守卫最多几件：D1 单条语句最多 100 个绑定参数，每件占 3 个（id / sect_id / 归属人），
 * 加 guardId 本身 1 个 → 30 件 91 个参数，留出余量（与 MEMBERS_PER_GUARD 同一口径）。
 *
 * 为什么必须切分：分解接口一次最多 50 件（背包容量），34 件就是 103 个参数，
 * 单条守卫会被 D1 直接拒绝（本地 miniflare 不一定拦，生产会）。
 */
export const EQUIPMENT_PER_GUARD = 30;

/**
 * 装备行守卫（按 EQUIPMENT_PER_GUARD 切片）；返回守卫语句与它们的 guardId，
 * 调用方必须把每个 guardId 的清理语句也放进同一批（见 deleteDiscipleSnapshotGuardStatement）。
 */
export function equipmentGuardStatements(
  commandId: string,
  sectId: string,
  items: readonly { id: string; discipleId: string | null }[],
): { guards: ParameterizedQuery[]; guardIds: string[] } {
  const guards: ParameterizedQuery[] = [];
  const guardIds: string[] = [];
  for (let start = 0; start < items.length; start += EQUIPMENT_PER_GUARD) {
    const guardId = `${commandId}:equipment:${String(start)}`;
    guardIds.push(guardId);
    guards.push(
      equipmentGuardStatement(
        guardId,
        sectId,
        items.slice(start, start + EQUIPMENT_PER_GUARD),
      ),
    );
  }
  return { guards, guardIds };
}
