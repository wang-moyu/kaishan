import { describe, expect, it } from 'vitest';

import { severeInjuryChance } from '../../apps/server/src/modules/game/worldBoss';
import { severeRiskPercent } from '../../apps/web/src/utils/worldBossRisk';

describe('讨伐重伤概率：前端显示与服务端判定同口径', () => {
  it('所有疲劳次数 × 体魄 × 狂暴 组合都一致', () => {
    for (let count = 0; count <= 7; count += 1) {
      for (const physique of [1, 30, 50, 60, 80, 100]) {
        for (const berserk of [false, true]) {
          expect(severeRiskPercent(count, physique, berserk)).toBe(
            Math.round(severeInjuryChance(count, physique, berserk) * 100),
          );
        }
      }
    }
  });
});
