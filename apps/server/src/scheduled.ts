import { processWorldBoss, settleCurrentRound } from './modules/game/service';

/**
 * 每 10 分钟一次的定时任务（Workers Cron 与 Node 版的计时器共用这一份）。
 * 0024 灵兽竞逐结算与 0025 世界 Boss（出现 / 逃走 / 发奖）各自兜错，互不影响。
 */
export async function runScheduledTasks(db: D1Database, now: number): Promise<void> {
  try {
    await settleCurrentRound(db, now);
  } catch (error) {
    console.warn(`settle_current_round_failed error=${String(error)}`);
  }
  try {
    await processWorldBoss(db, now);
  } catch (error) {
    console.warn(`process_world_boss_failed error=${String(error)}`);
  }
}
