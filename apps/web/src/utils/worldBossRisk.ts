/**
 * 世界 Boss 讨伐：本次出手的重伤概率（整数百分比 0~100）。
 *
 * 口径与服务端 `apps/server/src/modules/game/worldBoss.ts` 的 severeInjuryChance 一致：
 * fatigueCount = 该弟子最近 60 分钟内已出战次数（不含本次）；
 * 3 次 → 30%、4 次 → 70%（这两档按体魄每高于 50 的 10 点下调 3 个百分点，最低 0）；≥5 次必定重伤；
 * 「狂暴」词缀再 ×2，封顶 100%。服务端改规则时这里要同步。
 */
export function severeRiskPercent(fatigueCount: number, physique: number, berserk: boolean): number {
  let chance = fatigueCount >= 5 ? 1 : fatigueCount === 4 ? 0.7 : fatigueCount === 3 ? 0.3 : 0;
  if (chance > 0 && chance < 1) {
    chance = Math.max(0, chance - (Math.max(0, physique - 50) / 10) * 0.03);
  }
  if (berserk) chance = Math.min(1, chance * 2);
  return Math.round(chance * 100);
}
