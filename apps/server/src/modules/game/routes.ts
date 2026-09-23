import { Hono } from 'hono';

import { AppError, authOf, type AppContext, type AppEnv } from '../../http/appError';
import { respondOk } from '../../http/envelope';
import { parseStrictJson } from '../../http/validation';
import { getDb } from '../../infra/db/client';
import {
  abandonExplorationSchema,
  allocateDaoInsightRequestSchema,
  assignRequestSchema,
  breakthroughRequestSchema,
  challengeRequestSchema,
  chooseRealmExploreSchema,
  claimJourneyRequestSchema,
  craftPillRequestSchema,
  createSectRequestSchema,
  daoDebateRequestSchema,
  expelDiscipleRequestSchema,
  exploreRequestSchema,
  raceBetRequestSchema,
  journeyPreviewQuerySchema,
  recruitRequestSchema,
  renameDiscipleRequestSchema,
  renameSectRequestSchema,
  setDefenseLineupSchema,
  setDiscipleAvatarFrameRequestSchema,
  setDiscipleNoteRequestSchema,
  shopBuyRequestSchema,
  sendChatMessageRequestSchema,
  shopSellPillRequestSchema,
  shopSellRequestSchema,
  startJourneyRequestSchema,
  startRealmExploreSchema,
  upgradeBuildingRequestSchema,
  usePillRequestSchema,
  wheelSpinRequestSchema,
} from './schema';
import {
  abandonRealmExplore,
  allocateDaoInsight,
  assignDisciple,
  breakthrough,
  challengeSect,
  chooseRealmExplore,
  claimJourney,
  craftPill,
  createSect,
  daoDebate,
  listDebateHistory,
  listDiscipleLeaderboard,
  expelDisciple,
  exploreSectRealm,
  getActiveExploration,
  getPublicSect,
  getSectState,
  getRaceHistory,
  getRaceState,
  placeRaceBet,
  listChallengeHistory,
  listLeaderboard,
  listRecentEvents,
  listSecretRealms,
  previewJourney,
  previewRecruit,
  recruitDisciple,
  refreshRecruit,
  renameDisciple,
  renameSect,
  setDefenseLineup,
  setDiscipleAvatarFrame,
  setDiscipleNote,
  shopBuy,
  shopSell,
  shopSellPill,
  startJourney,
  startRealmExplore,
  upgradeBuilding,
  upgradeSect,
  usePill,
  listChatMessages,
  sendChatMessage,
  wheelReset,
  wheelSpin,
} from './service';
import type { SectStateView } from './view';
import type { Multiplier, WheelTier } from './gambling';

/**
 * 游戏接口（一次性可玩版本，任务卡第二节）。
 *
 * - 全部要求已登录（写请求的 401/CSRF/Origin 由 middleware 统一处理）；
 * - 每个写操作先结算再执行命令（结算逻辑在 service.ts / settle.ts）；
 * - 返回统一的 `{ state }`：前端拿到状态后整体刷新，不做增量合并。
 *
 * 说明：本版本没有幂等键与版本号（任务卡明确「不搞幂等、不搞乐观锁」），
 * 重复提交同一个写请求会重复生效。
 */
export function createGameRoutes(): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();

  routes.get('/game/sync', async (c) => {
    const userId = requireUserId(c);
    const state = await getSectState(getDb(c.env), userId, Date.now());
    return respondOk(c, { state });
  });

  // P3：事件历史（最近 20 条，新的在前）；只查库，不做结算。
  routes.get('/game/events', async (c) => {
    const userId = requireUserId(c);
    const events = await listRecentEvents(getDb(c.env), userId);
    return respondOk(c, { events });
  });

  // V2-2：秘境列表（只读：不结算、不写库）。
  routes.get('/game/realms', async (c) => {
    const userId = requireUserId(c);
    const realms = await listSecretRealms(getDb(c.env), c.env, userId, Date.now());
    return respondOk(c, { realms });
  });

  routes.post('/game/create-sect', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(createSectRequestSchema, c);
    const state = await createSect(getDb(c.env), userId, body.name, Date.now());
    return respondOk(c, { state });
  });

  // V4：招募预览（只读：不结算、不写库；候选人由服务端按确定性 seed 生成）。
  routes.get('/game/recruit-preview', async (c) => {
    const userId = requireUserId(c);
    const preview = await previewRecruit(getDb(c.env), userId, Date.now());
    return respondOk(c, preview);
  });

  // V4：招募三选一（body 的 choice = 0~2，batch = 预览下发的批次标识）；
  // 0016：批次不一致（跨天 / 刷新 / 已招过一次 / 版本变化 / 旧客户端）由 service 拒绝为 EXPIRED。
  routes.post('/game/recruit', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(recruitRequestSchema, c);
    const result = await recruitDisciple(
      getDb(c.env),
      userId,
      body.choice,
      body.batch,
      Date.now(),
    );
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });
 
  // 招贤台刷新（免费换一批候选人；每个宗门境界 3 次，升级重置）。请求体为空，不解析 JSON。
  routes.post('/game/recruit-refresh', async (c) => {
    const userId = requireUserId(c);
    const result = await refreshRecruit(getDb(c.env), userId, Date.now());
    return respondOk(c, { state: result.state, preview: result.preview });
  });

  routes.post('/game/assign', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(assignRequestSchema, c);
    const state: SectStateView = await assignDisciple(
      getDb(c.env),
      userId,
      body.discipleId,
      body.assignment,
      Date.now(),
    );
    return respondOk(c, { state });
  });

  routes.post('/game/upgrade-building', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(upgradeBuildingRequestSchema, c);
    const state = await upgradeBuilding(getDb(c.env), userId, body.defId, Date.now());
    return respondOk(c, { state });
  });

  routes.post('/game/breakthrough', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(breakthroughRequestSchema, c);
    const result = await breakthrough(getDb(c.env), userId, body.discipleId, Date.now());
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });

  // 宗门升级没有请求体参数（条件全部由服务端判定），不挂 Zod schema。
  routes.post('/game/upgrade-sect', async (c) => {
    const userId = requireUserId(c);
    const state = await upgradeSect(getDb(c.env), userId, Date.now());
    return respondOk(c, { state });
  });

  // V2-2：探索秘境（结算 → 校验 → 扣入场费 → 出结果，写回一次 batch）。
  routes.post('/game/explore', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(exploreRequestSchema, c);
    const result = await exploreSectRealm(
      getDb(c.env),
      userId,
      body.realmId,
      body.discipleIds,
      Date.now(),
    );
    return respondOk(c, { state: result.state, result: result.result });
  });

  // V3：江湖榜（只读：不结算、不写库）；没有宗门时 entries 为空（未创建宗门的用户不报错）。
  routes.get('/game/leaderboard', async (c) => {
    const userId = requireUserId(c);
    const entries = await listLeaderboard(getDb(c.env), userId);
    return respondOk(c, { entries });
  });

  // 弟子榜单（只读：不结算、不写库）：战力 top 10 + 综合分 top 10。
  routes.get('/game/disciple-leaderboard', async (c) => {
    const userId = requireUserId(c);
    const data = await listDiscipleLeaderboard(getDb(c.env), userId);
    return respondOk(c, data);
  });

  // V3：公开档案（只读：不结算、不写库；只返回安全字段，宗门不存在 404）。
  // 0012：传入当前用户与时间，挑战预览相对观看者计算。
  routes.get('/game/sect/:sectId', async (c) => {
    const userId = requireUserId(c);
    const sect = await getPublicSect(getDb(c.env), c.req.param('sectId'), userId, Date.now());
    return respondOk(c, { sect });
  });

  // 挑战历史（只读：最近 20 条 + 自身视角胜负统计）。
  routes.get('/game/challenge-history', async (c) => {
    const userId = requireUserId(c);
    const history = await listChallengeHistory(getDb(c.env), userId);
    return respondOk(c, history);
  });

  // V5：设置守擂阵容（结算 → 校验归属 → 写回，一次 batch）。
  routes.post('/game/set-defense-lineup', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(setDefenseLineupSchema, c);
    const state = await setDefenseLineup(getDb(c.env), userId, body.discipleIds, Date.now());
    return respondOk(c, { state });
  });

  // V5：挑战（结算 → 校验 → 3v3 逐对决斗 → 奖励 + 挑战记录，一次 batch 写回）。
  routes.post('/game/challenge', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(challengeRequestSchema, c);
    const result = await challengeSect(
      getDb(c.env),
      userId,
      body.targetSectId,
      body.discipleIds,
      Date.now(),
      c.env,
    );
    return respondOk(c, { state: result.state, result: result.result });
  });

  // 丹药：炼制（结算 → 解锁/配方/资源校验 → 扣资源 + 库存 +quantity，一次 batch）。
  routes.post('/game/craft-pill', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(craftPillRequestSchema, c);
    const result = await craftPill(getDb(c.env), userId, body.pillId, body.quantity, Date.now());
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });

  // 丹药：服用（结算 → 解锁/配方/归属/状态校验 → 扣库存 1 + 效果写回，一次 batch）。
  routes.post('/game/use-pill', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(usePillRequestSchema, c);
    const result = await usePill(getDb(c.env), userId, body.pillId, body.discipleId, Date.now());
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });

  // 0013：保存弟子私有备注（结算 → 归属校验 → 归一化 → 单列写回，一次受保护 batch）。
  routes.post('/game/set-disciple-note', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(setDiscipleNoteRequestSchema, c);
    const state = await setDiscipleNote(getDb(c.env), userId, body.discipleId, body.note, Date.now());
    return respondOk(c, { state });
  });

  // 0017：设置弟子头像框（结算 → 归属校验 → 单列写回，一次受保护 batch；相同值显式早退）。
  routes.post('/game/set-disciple-avatar-frame', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(setDiscipleAvatarFrameRequestSchema, c);
    const state = await setDiscipleAvatarFrame(
      getDb(c.env),
      userId,
      body.discipleId,
      body.frameId,
      Date.now(),
    );
    return respondOk(c, { state });
  });

  // 0021：宗门改名（结算 → 名称归一化 → 扣 500 灵石 → 单列写回，一次受保护 batch；同名早退不扣费）。
  routes.post('/game/rename-sect', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(renameSectRequestSchema, c);
    const state = await renameSect(getDb(c.env), userId, body.name, Date.now());
    return respondOk(c, { state });
  });

  // 0021：弟子改名（同上，扣 50 灵石；在外历练期间也允许改，历史快照不回填）。
  routes.post('/game/rename-disciple', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(renameDiscipleRequestSchema, c);
    const state = await renameDisciple(
      getDb(c.env),
      userId,
      body.discipleId,
      body.name,
      Date.now(),
    );
    return respondOk(c, { state });
  });

  // 0013：驱逐弟子（结算 + 删除 + 守擂阵容清理同一原子 batch；历史快照原样保留）。
  routes.post('/game/expel-disciple', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(expelDiscipleRequestSchema, c);
    const result = await expelDisciple(getDb(c.env), userId, body.discipleId, Date.now());
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });

  // 0014：历练预览（只读，不结算、不写库；最终资格以 POST /game/start-journey 为准）。
  routes.get('/game/journey-preview', async (c) => {
    const userId = requireUserId(c);
    const query = journeyPreviewQuerySchema.safeParse({ discipleId: c.req.query('discipleId') });
    if (!query.success) {
      throw new AppError('VALIDATION_ERROR', '缺少或非法的 discipleId');
    }
    const preview = await previewJourney(getDb(c.env), userId, query.data.discipleId, Date.now());
    return respondOk(c, preview);
  });

  // 0014：出发历练（结算 → 资格校验 → 出发时抽结果并落库 → 受保护 batch）。
  routes.post('/game/start-journey', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(startJourneyRequestSchema, c);
    const state = await startJourney(
      getDb(c.env),
      userId,
      body.discipleId,
      body.direction,
      body.durationSeconds,
      Date.now(),
    );
    return respondOk(c, { state });
  });

  // 0014：领取历练收获（结算 → 到期归队 → 资源一次性入账 → 标记已领取，同一原子 batch）。
  routes.post('/game/claim-journey', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(claimJourneyRequestSchema, c);
    const result = await claimJourney(getDb(c.env), userId, body.journeyId, Date.now());
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });

  // V6：交互式秘境探索（迁移 0015）。四个接口都在 /game/realm-explore/ 前缀下。
  // 查询当前进行中的探索（只读：不结算、不写库；没有就返回 null，用于刷新后恢复）。
  routes.get('/game/realm-explore/active', async (c) => {
    const userId = requireUserId(c);
    const exploration = await getActiveExploration(getDb(c.env), userId, Date.now());
    return respondOk(c, { exploration });
  });

  // 开始交互探索（结算 → 校验 → 扣入场费 → 建记录 + 占坑，一次受保护 batch）。
  routes.post('/game/realm-explore/start', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(startRealmExploreSchema, c);
    const result = await startRealmExplore(
      getDb(c.env),
      c.env,
      userId,
      body.realmId,
      body.discipleIds,
      Date.now(),
    );
    return respondOk(c, { state: result.state, exploration: result.exploration });
  });

  // 提交一次选择（Decisions 判定，失败自动降级为本地随机；奖励在整场结束时入账）。
  routes.post('/game/realm-explore/choose', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(chooseRealmExploreSchema, c);
    const result = await chooseRealmExplore(
      getDb(c.env),
      c.env,
      userId,
      body.explorationId,
      body.choiceId,
      Date.now(),
    );
    return respondOk(c, { state: result.state, result: result.result });
  });

  // 放弃探索（已获奖励照常入账，不退入场费）。
  routes.post('/game/realm-explore/abandon', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(abandonExplorationSchema, c);
    const result = await abandonRealmExplore(getDb(c.env), userId, body.explorationId, Date.now());
    return respondOk(c, { state: result.state });
  });

  // 0019 赌坊：论道赌局（结算 → 解锁/次数/弟子/赌注校验 → jev 判定 → 发奖或扣赌注，
  // 计数与记录同一个受保护 batch；胜负由服务端判定，前端只展示）。
  routes.post('/game/dao-debate', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(daoDebateRequestSchema, c);
    const result = await daoDebate(
      getDb(c.env),
      userId,
      {
        discipleId: body.discipleId,
        betMode: body.betMode,
        // schema 已把 multiplier 限制为 1~3，这里收窄到 Multiplier 常量类型。
        multiplier: body.multiplier as Multiplier,
        rewardType: body.rewardType,
        resourceId: body.resourceId,
        amount: body.amount,
        attribute: body.attribute,
      },
      Date.now(),
      c.env,
    );
    return respondOk(c, { state: result.state, result: result.result });
  });

  // 0019 赌坊：详细记录（只读：不结算、不写库；分页查询 dao_debate_log）。
  routes.get('/game/debate-history', async (c) => {
    const userId = requireUserId(c);
    const page = Math.max(1, Number(c.req.query('page')) || 1);
    const history = await listDebateHistory(getDb(c.env), userId, page);
    return respondOk(c, history);
  });

  // 0019 赌坊：悟道值加点（结算 → 归属/余额/上限校验 → 属性 + 悟道值同批写回）。
  routes.post('/game/allocate-dao-insight', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(allocateDaoInsightRequestSchema, c);
    const result = await allocateDaoInsight(
      getDb(c.env),
      userId,
      body.discipleId,
      body.attribute,
      body.points,
      Date.now(),
    );
    return respondOk(c, { state: result.state, outcome: result.outcome });
  });

  // 0020 天机轮：转动（结算 → 解锁/次数/余额校验 → 服务端选格结算 → 扣费、发奖、记录同批提交）。
  routes.post('/game/wheel-spin', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(wheelSpinRequestSchema, c);
    // schema 已把 tier 收窄到 1~5，这里再收窄到 WheelTier 常量类型。
    const result = await wheelSpin(getDb(c.env), userId, body.tier as WheelTier, Date.now());
    return respondOk(c, { state: result.state, result: result.result });
  });

  // 0020 天机轮：重置格局（扣重置费、wheel_seed + 1、不消耗每日次数）。请求体为空，不解析 JSON。
  routes.post('/game/wheel-reset', async (c) => {
    const userId = requireUserId(c);
    const result = await wheelReset(getDb(c.env), userId, Date.now());
    return respondOk(c, { state: result.state });
  });

  // 0024 灵兽竞逐：获取当前轮次状态（投注池、倍率、阶段、倒计时）。
  routes.get('/game/race-state', async (c) => {
    const userId = requireUserId(c);
    const result = await getRaceState(getDb(c.env), userId, Date.now());
    return respondOk(c, { state: result.state, race: result.race });
  });

  // 0024 灵兽竞逐：下注（验证阶段 + 灵石余额 + 写投注 + 更新池）。
  routes.post('/game/race-bet', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(raceBetRequestSchema, c);
    const result = await placeRaceBet(getDb(c.env), userId, body, Date.now());
    return respondOk(c, { state: result.state, race: result.race });
  });

  routes.get('/game/race-history', async (c) => {
    const page = Math.max(1, Math.floor(Number(c.req.query('page') ?? '1')) || 1);
    const result = await getRaceHistory(getDb(c.env), page);
    return respondOk(c, result);
  });

  // 坊市：买入材料（结算 → 白名单 / 灵石余额 / 材料容量校验 → 扣灵石、加材料，一次受保护 batch）。
  routes.post('/game/shop-buy', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(shopBuyRequestSchema, c);
    const result = await shopBuy(getDb(c.env), userId, body.resourceId, body.amount, Date.now());
    return respondOk(c, { state: result.state, result: result.result });
  });

  // 坊市：卖出材料（结算 → 白名单 / 材料库存校验 → 扣材料、加灵石，一次受保护 batch）。
  routes.post('/game/shop-sell', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(shopSellRequestSchema, c);
    const result = await shopSell(getDb(c.env), userId, body.resourceId, body.amount, Date.now());
    return respondOk(c, { state: result.state, result: result.result });
  });

  // 坊市：售丹（结算 → 丹方 / 回收价 / 库存校验 → 扣丹药、加灵石；守卫核对那条库存）。
  routes.post('/game/shop-sell-pill', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(shopSellPillRequestSchema, c);
    const result = await shopSellPill(getDb(c.env), userId, body.pillId, body.quantity, Date.now());
    return respondOk(c, { state: result.state, result: result.result });
  });
  // 全服聊天
  routes.get('/game/chat', async (c) => {
    const userId = requireUserId(c);
    const afterId = c.req.query('after') ?? undefined;
    const messages = await listChatMessages(getDb(c.env), userId, afterId);
    return respondOk(c, { messages });
  });

  routes.post('/game/chat', async (c) => {
    const userId = requireUserId(c);
    const body = await parseStrictJson(sendChatMessageRequestSchema, c);
    const messages = await sendChatMessage(getDb(c.env), userId, body.content, Date.now());
    return respondOk(c, { messages });
  });

  return routes;
}

/** 取当前登录用户；未登录抛 401（GET 请求没有 CSRF 中间件挡在前面）。 */
function requireUserId(c: AppContext): string {
  const auth = authOf(c);
  if (auth === null) {
    throw new AppError('UNAUTHENTICATED');
  }
  return auth.userId;
}
