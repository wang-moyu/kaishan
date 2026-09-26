import { describe, expect, it } from 'vitest';

import {
  ARTIFACT_MAIN_ATTRS,
  BAG_CAPACITY,
  BOSS_DROP_CHANCE_OTHERS,
  BOSS_HIGH_DROP_FACTOR,
  EMPTY_ATTRS,
  EQUIPMENT_ATTRS,
  EQUIPMENT_QUALITIES,
  EQUIPMENT_SLOT_NAMES,
  EQUIPMENT_SLOTS,
  FORGE_COST,
  FORGE_LOCKED_REASON,
  FORGE_QUALITY,
  FORGE_UNLOCK_SECT_LEVEL,
  ORE_UNITS_PER_DISPLAY,
  attrNameOf,
  bagFullReason,
  bossDropDescription,
  bossDropQualities,
  bossHighDropChance,
  rollBossDrop,
  findQuality,
  forgeUnlockBlockedReason,
  gearBonusOf,
  gearBonusOfDisciple,
  gearPowerBonusBpOf,
  gearPowerBonusBpOfDisciple,
  generateEquipment,
  qualityPowerBonusBp,
  qualityColorOf,
  qualityNameOf,
  resolveMainAttr,
  salvageOreUnits,
  slotNameOf,
  withGear,
  type EquipmentAttr,
  type EquipmentQuality,
  bossXuantieFor,
  forgeFailRefund,
  forgeOddsOf,
  lowerQuality,
  rollForgeResult,
  forgeRecipeOf,
  forgeWorkshopUpgradeFrom,
  realmXuantieDrop,
  salvageXuantieUnits,
} from '../../apps/server/src/modules/game/equipment';
import { discipleCombatPower } from '../../apps/server/src/modules/game/realms';

/** 依次吐出给定随机值（用完之后固定 0.5），与其它规则测试同一写法。 */
function sequence(values: number[], fallback = 0.5): () => number {
  const queue = [...values];
  return () => (queue.length > 0 ? (queue.shift() as number) : fallback);
}

const QUALITY_IDS: EquipmentQuality[] = ['common', 'spirit', 'treasure', 'immortal'];

describe('装备规则 · 品质与部位（计划 1.1）', () => {
  it('四档品质的数值与计划表一致', () => {
    expect(EQUIPMENT_QUALITIES.map((q) => q.id)).toEqual(QUALITY_IDS);
    expect(EQUIPMENT_QUALITIES.map((q) => q.name)).toEqual(['凡品', '灵品', '宝品', '仙品']);
    expect(EQUIPMENT_QUALITIES.map((q) => q.mainValue)).toEqual([8, 16, 20, 24]);
    expect(EQUIPMENT_QUALITIES.map((q) => q.subMin)).toEqual([2, 4, 6, 8]);
    expect(EQUIPMENT_QUALITIES.map((q) => q.subMax)).toEqual([4, 8, 10, 16]);
    // 分解返还矿石（展示单位）：50 / 120 / 250 / 500。
    expect(EQUIPMENT_QUALITIES.map((q) => q.salvageOre)).toEqual([50, 120, 250, 500]);
    // 0032 装备战力加成（基点）：凡 2% / 灵 4% / 宝 7% / 仙 10%。
    expect(EQUIPMENT_QUALITIES.map((q) => q.powerBonusBp)).toEqual([200, 400, 700, 1000]);
  });

  it('三个装备格：兵器攻击 / 护甲防御 / 法器（身法或幸运）', () => {
    expect(EQUIPMENT_SLOTS.map((slot) => slot.id)).toEqual(['weapon', 'armor', 'artifact']);
    expect(EQUIPMENT_SLOTS.map((slot) => slot.mainAttr)).toEqual(['attack', 'defense', null]);
    expect(ARTIFACT_MAIN_ATTRS).toEqual(['speed', 'luck']);
    // 每个部位 5 个部位名，名称 = {品质名}·{部位名}。
    for (const slot of EQUIPMENT_SLOTS) {
      expect(EQUIPMENT_SLOT_NAMES[slot.id]).toHaveLength(5);
    }
  });

  it('名称 / 属性 / 部位的中文名换算', () => {
    expect(qualityNameOf('immortal')).toBe('仙品');
    expect(qualityNameOf('unknown')).toBe('unknown');
    expect(qualityColorOf('immortal')).toBe('#fbbf24');
    expect(slotNameOf('artifact')).toBe('法器');
    expect(attrNameOf('physique')).toBe('体魄');
    expect(findQuality('treasure')?.mainValue).toBe(20);
    expect(findQuality('nope')).toBeUndefined();
  });

  it('常量与计划一致：解锁 2 级、消耗矿石 150 + 灵石 80、背包 50、掉落概率 0.4', () => {
    expect(FORGE_UNLOCK_SECT_LEVEL).toBe(2);
    expect(FORGE_COST).toEqual({ ore: '150000', spiritStone: '80000' });
    expect(FORGE_QUALITY).toBe('common');
    expect(BAG_CAPACITY).toBe(50);
    expect(BOSS_DROP_CHANCE_OTHERS).toBe(0.4);
    expect(ORE_UNITS_PER_DISPLAY).toBe(1000);
  });

  it('炼器解锁判断与提示文案', () => {
    expect(forgeUnlockBlockedReason(1)).toBe(FORGE_LOCKED_REASON);
    expect(forgeUnlockBlockedReason(1)).toBe('炼器尚未开启，需要宗门 2 级');
    expect(forgeUnlockBlockedReason(2)).toBeNull();
    expect(forgeUnlockBlockedReason(9)).toBeNull();
    expect(bagFullReason(50)).toBe('背包已满（50/50），请先分解');
  });
});

describe('装备规则 · 主属性解析', () => {
  it('兵器固定攻击、护甲固定防御，且这两个部位不能指定主属性', () => {
    expect(resolveMainAttr('weapon', undefined, sequence([]))).toBe('attack');
    expect(resolveMainAttr('armor', undefined, sequence([]))).toBe('defense');
    // 指定了（哪怕是同一个属性）一律视为非法组合，由调用方报 VALIDATION_ERROR。
    expect(resolveMainAttr('weapon', 'attack', sequence([]))).toBeNull();
    expect(resolveMainAttr('armor', 'luck', sequence([]))).toBeNull();
  });

  it('法器由玩家二选一；不给时随机抽一个', () => {
    expect(resolveMainAttr('artifact', 'speed', sequence([]))).toBe('speed');
    expect(resolveMainAttr('artifact', 'luck', sequence([]))).toBe('luck');
    expect(resolveMainAttr('artifact', 'attack', sequence([]))).toBeNull();
    expect(resolveMainAttr('artifact', undefined, sequence([0]))).toBe('speed');
    expect(resolveMainAttr('artifact', undefined, sequence([0.99]))).toBe('luck');
  });
});

describe('装备规则 · 生成装备（计划 1.1）', () => {
  it('名称格式为 {品质名}·{部位名}，主属性数值取品质表', () => {
    // 随机顺序：① 部位名 → ② 副属性种类 → ③ 副属性数值。
    const item = generateEquipment({
      slot: 'weapon',
      quality: 'treasure',
      mainAttr: 'attack',
      random: sequence([0, 0, 0]),
    });
    expect(item.name).toBe('宝品·青锋剑');
    expect(item.mainAttr).toBe('attack');
    expect(item.mainValue).toBe(20);
    // 副属性候选里不含主属性：random 0 → 第一项（attack 被剔除后是 defense）。
    expect(item.subAttr).toBe('defense');
    expect(item.subValue).toBe(6);
  });

  it('法器掉落随机主属性时，副属性仍然不等于主属性', () => {
    // 部位名 0.99 → 最后一个；副属性 0 → 候选第一项。
    const item = generateEquipment({
      slot: 'artifact',
      quality: 'immortal',
      mainAttr: 'speed',
      random: sequence([0.99, 0, 0.99]),
    });
    expect(item.name).toBe('仙品·紫金葫芦');
    expect(item.subAttr).toBe('attack');
    expect(item.subValue).toBe(16);
  });

  it('副属性不等于主属性，且数值落在该品质区间内（含两端）', () => {
    for (const quality of QUALITY_IDS) {
      const def = findQuality(quality);
      expect(def).toBeDefined();
      for (const slot of EQUIPMENT_SLOTS) {
        const mainAttr = slot.mainAttr ?? 'speed';
        for (const roll of [0, 0.5, 0.9999]) {
          const item = generateEquipment({
            slot: slot.id,
            quality,
            mainAttr: mainAttr as EquipmentAttr,
            random: sequence([roll, roll, roll]),
          });
          expect(item.subAttr).not.toBe(item.mainAttr);
          expect(EQUIPMENT_ATTRS).toContain(item.subAttr);
          expect(item.subValue).toBeGreaterThanOrEqual(def!.subMin);
          expect(item.subValue).toBeLessThanOrEqual(def!.subMax);
          expect(Number.isInteger(item.subValue)).toBe(true);
        }
      }
    }
  });

  it('副属性区间是闭区间：随机值 0 取下界、接近 1 取上界', () => {
    for (const quality of QUALITY_IDS) {
      const def = findQuality(quality)!;
      const low = generateEquipment({
        slot: 'weapon', quality, mainAttr: 'attack', random: sequence([0, 0.5, 0]),
      });
      const high = generateEquipment({
        slot: 'weapon', quality, mainAttr: 'attack', random: sequence([0, 0.5, 0.9999]),
      });
      expect(low.subValue).toBe(def.subMin);
      expect(high.subValue).toBe(def.subMax);
    }
  });
});

describe('装备规则 · 世界 Boss 掉落（三期 2.1）', () => {
  it('掉落品质按关卡分段：1~2 / 3~4 / 5 及以上', () => {
    expect(bossDropQualities(1)).toEqual({ top: 'spirit', others: 'common' });
    expect(bossDropQualities(2)).toEqual({ top: 'spirit', others: 'common' });
    expect(bossDropQualities(3)).toEqual({ top: 'treasure', others: 'spirit' });
    expect(bossDropQualities(4)).toEqual({ top: 'treasure', others: 'spirit' });
    expect(bossDropQualities(5)).toEqual({ top: 'immortal', others: 'treasure' });
    expect(bossDropQualities(9)).toEqual({ top: 'immortal', others: 'treasure' });
  });

  it('高档概率 = 75% × √伤害占比（占比夹在 0~1：负数与 >1 都不放大）', () => {
    expect(BOSS_HIGH_DROP_FACTOR).toBe(0.75);
    expect(bossHighDropChance(1)).toBeCloseTo(0.75);
    expect(bossHighDropChance(0.25)).toBeCloseTo(0.375);
    expect(bossHighDropChance(0.04)).toBeCloseTo(0.15);
    expect(bossHighDropChance(0)).toBe(0);
    expect(bossHighDropChance(-0.5)).toBe(0);
    expect(bossHighDropChance(1.5)).toBeCloseTo(0.75);
  });

  it('先判高档、未中再判低档；都没中返回 null', () => {
    // 占比 100% → 高档 75%：0.74 中高档（第 5 关 = 仙品）。
    expect(rollBossDrop({ stage: 5, damageShare: 1, random: sequence([0.74]) })).toBe('immortal');
    // 0.76 未中高档 → 再取一个随机数判低档：0.39 < 0.4 得宝品。
    expect(rollBossDrop({ stage: 5, damageShare: 1, random: sequence([0.76, 0.39]) })).toBe('treasure');
    // 0.4 不满足「< 0.4」→ 不掉。
    expect(rollBossDrop({ stage: 5, damageShare: 1, random: sequence([0.76, 0.4]) })).toBeNull();
    // 第 1 关、占比 25% → 高档 37.5%：0.37 中高档（灵品）；0.38 未中 → 低档凡品。
    expect(rollBossDrop({ stage: 1, damageShare: 0.25, random: sequence([0.37]) })).toBe('spirit');
    expect(rollBossDrop({ stage: 1, damageShare: 0.25, random: sequence([0.38, 0.1]) })).toBe('common');
  });

  it('伤害占比 ≤ 0 不掉，且一次随机数都不取', () => {
    let calls = 0;
    const random = (): number => {
      calls += 1;
      return 0;
    };
    expect(rollBossDrop({ stage: 5, damageShare: 0, random })).toBeNull();
    expect(calls).toBe(0);
  });

  it('掉落说明文案与计划的示例一字不差', () => {
    expect(bossDropDescription(1)).toBe('按本关伤害占比各自判定：灵品装备 ×1 概率 = 75% × √占比；未得时 40% 概率得 凡品装备 ×1');
    expect(bossDropDescription(3)).toBe('按本关伤害占比各自判定：宝品装备 ×1 概率 = 75% × √占比；未得时 40% 概率得 灵品装备 ×1');
    expect(bossDropDescription(5)).toBe('按本关伤害占比各自判定：仙品装备 ×1 概率 = 75% × √占比；未得时 40% 概率得 宝品装备 ×1');
  });
});

describe('装备规则 · 分解与加成', () => {
  it('分解返还矿石按品质表换算成最小单位', () => {
    expect(salvageOreUnits('common')).toBe(50_000);
    expect(salvageOreUnits('spirit')).toBe(120_000);
    expect(salvageOreUnits('treasure')).toBe(250_000);
    expect(salvageOreUnits('immortal')).toBe(500_000);
  });

  it('一组装备的加成按属性求和（主 + 副，属性 id 之外的值忽略）', () => {
    const bonus = gearBonusOf([
      { main_attr: 'attack', main_value: 12, sub_attr: 'speed', sub_value: 3 },
      { main_attr: 'defense', main_value: 8, sub_attr: 'attack', sub_value: 2 },
      { main_attr: 'attack', main_value: 4, sub_attr: 'dirty', sub_value: 99 },
    ]);
    expect(bonus).toEqual({ attack: 18, defense: 8, speed: 3, luck: 0, physique: 0 });
    expect(gearBonusOf([])).toEqual(EMPTY_ATTRS);
  });

  it('弟子表 5 个冗余列直接当作加成；基础属性 + 加成可以超过 100', () => {
    const gear = gearBonusOfDisciple({
      gear_attack: 18,
      gear_defense: 0,
      gear_speed: 5,
      gear_luck: 3,
      gear_physique: 0,
    });
    expect(gear).toEqual({ attack: 18, defense: 0, speed: 5, luck: 3, physique: 0 });
    const base = { attack: 95, defense: 50, speed: 40, luck: 20, physique: 30 };
    expect(withGear(base, gear)).toEqual({ attack: 113, defense: 50, speed: 45, luck: 23, physique: 30 });
    // 没有装备时与基础属性完全一致（5 列默认值都是 0）。
    const none = gearBonusOfDisciple({
      gear_attack: 0, gear_defense: 0, gear_speed: 0, gear_luck: 0, gear_physique: 0,
    });
    expect(withGear(base, none)).toEqual(base);
  });
});

describe('装备二期：玄铁 · 炼器坊', () => {
  it('世界 Boss 玄铁：占比 <15% 每关 1 个（击退减半向下取整 = 0）；按关卡给量，第 1 名更多', () => {
    expect(bossXuantieFor({ stage: 1, damageShare: 0.14, isTop: false, repelled: false })).toBe(1);
    expect(bossXuantieFor({ stage: 1, damageShare: 0.14, isTop: false, repelled: true })).toBe(0);
    expect(bossXuantieFor({ stage: 1, damageShare: 0, isTop: false, repelled: false })).toBe(0);
    expect(bossXuantieFor({ stage: 1, damageShare: 0.15, isTop: false, repelled: false })).toBe(2);
    expect(bossXuantieFor({ stage: 1, damageShare: 0.5, isTop: true, repelled: false })).toBe(3);
    expect(bossXuantieFor({ stage: 4, damageShare: 0.3, isTop: false, repelled: false })).toBe(6);
    expect(bossXuantieFor({ stage: 9, damageShare: 0.3, isTop: true, repelled: false })).toBe(12);
    expect(bossXuantieFor({ stage: 2, damageShare: 0.3, isTop: true, repelled: true })).toBe(2);
  });

  it('秘境玄铁：只有三个高级秘境会掉，概率与数量按表', () => {
    expect(realmXuantieDrop('mistyForest', () => 0)).toBe(0);
    expect(realmXuantieDrop('beastNest', () => 0.09)).toBe(1);
    expect(realmXuantieDrop('beastNest', () => 0.1)).toBe(0);
    expect(realmXuantieDrop('tribulationRuins', () => 0)).toBe(2);
    expect(realmXuantieDrop('tribulationRuins', sequence([0.1, 0.99]))).toBe(3);
  });

  it('炼器坊升级表与各品质配方、分解返还玄铁', () => {
    expect(forgeWorkshopUpgradeFrom(1)).toMatchObject({ level: 2, sectLevel: 3, cost: { xuantie: '15000' } });
    expect(forgeWorkshopUpgradeFrom(3)).toMatchObject({ level: 4, sectLevel: 7, cost: { xuantie: '100000' } });
    expect(forgeWorkshopUpgradeFrom(4)).toBeNull();
    expect(forgeRecipeOf('immortal')).toMatchObject({ workshopLevel: 4, cost: { xuantie: '30000' } });
    expect(salvageXuantieUnits('common')).toBe(0);
    expect(salvageXuantieUnits('immortal')).toBe(8000);
  });
});

describe('装备二期：炼器成功率', () => {
  it('基础概率与炼器坊加成（先抵失败、再抵降级）', () => {
    expect(forgeOddsOf('common', 1)).toEqual({ success: 1, downgrade: 0, fail: 0 });
    expect(forgeOddsOf('spirit', 2)).toEqual({ success: 0.7, downgrade: 0.2, fail: 0.1 });
    expect(forgeOddsOf('spirit', 4)).toEqual({ success: 0.9, downgrade: 0.1, fail: 0 });
    expect(forgeOddsOf('treasure', 3)).toEqual({ success: 0.65, downgrade: 0.25, fail: 0.1 });
    expect(forgeOddsOf('treasure', 4)).toEqual({ success: 0.75, downgrade: 0.25, fail: 0 });
    expect(forgeOddsOf('immortal', 4)).toEqual({ success: 0.5, downgrade: 0.3, fail: 0.2 });
  });

  it('判定、降一档与失败返还', () => {
    const odds = { success: 0.7, downgrade: 0.2, fail: 0.1 };
    expect(rollForgeResult(odds, () => 0.05)).toBe('fail');
    expect(rollForgeResult(odds, () => 0.2)).toBe('downgrade');
    expect(rollForgeResult(odds, () => 0.3)).toBe('success');
    expect(lowerQuality('immortal')).toBe('treasure');
    expect(lowerQuality('common')).toBe('common');
    expect(forgeFailRefund({ spiritStone: '250000', ore: '400000', xuantie: '3000' })).toEqual({
      spiritStone: 125000,
      ore: 200000,
    });
  });
});

describe('装备战力加成（0032）', () => {
  it('按品质逐件相加；脏品质按 0', () => {
    expect(qualityPowerBonusBp('immortal')).toBe(1000);
    expect(qualityPowerBonusBp('weird')).toBe(0);
    expect(gearPowerBonusBpOf([])).toBe(0);
    expect(gearPowerBonusBpOf([{ quality: 'spirit' }, { quality: 'spirit' }, { quality: 'treasure' }])).toBe(1500);
    expect(gearPowerBonusBpOf([{ quality: 'immortal' }, { quality: 'immortal' }, { quality: 'immortal' }])).toBe(3000);
    expect(gearPowerBonusBpOfDisciple({ gear_power_bp: 700 })).toBe(700);
  });

  it('战力 = 原公式 ×（1 + 加成）：元婴初期、攻 116 / 防 112 / 身法 97', () => {
    // 境界基数 (3×3+1)×10 = 100；属性加权 (46.4 + 39.2 + 24.25) / 100 = 1.0985 → 209.85
    expect(discipleCombatPower('nascentSoul', 1, 116, 112, 97, 'mining')).toBe(209);
    // 灵 + 灵 + 宝 = +15%：209.85 × 1.15 = 241.3
    expect(discipleCombatPower('nascentSoul', 1, 116, 112, 97, 'mining', 1500)).toBe(241);
    // 不传加成与传 0 完全一致（历练、关卡血量预估走这条）
    expect(discipleCombatPower('nascentSoul', 1, 116, 112, 97, 'mining', 0)).toBe(209);
  });

  it('战斗天赋在装备加成之后再 ×1.15', () => {
    // 金丹后期：基数 90；属性 50/50/50 → ×1.5 = 135；+30% → 175.5 → 175；×1.15 → 201.25 → 201
    expect(discipleCombatPower('goldenCore', 3, 50, 50, 50, 'combat', 3000)).toBe(201);
  });
});
