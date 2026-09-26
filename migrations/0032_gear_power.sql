-- Migration number: 0032 	 Name: gear_power
--
-- 装备战力加成：每件穿在身上的装备按品质再给战力 凡 2% / 灵 4% / 宝 7% / 仙 10%（三件相加），
-- 弟子战力 = 原公式 × (1 + 加成之和)。属性加成（gear_attack 等 5 列）不变。
--
--   disciples.gear_power_bp <- 第 6 个冗余列：身上装备的战力加成之和（基点，10000 = +100%）。
--                              与 5 个属性列同一套写回（repository.refreshDiscipleGearStatement），
--                              战斗计算只读这一列，不查装备表。
--
-- 已穿戴的装备在这里按同一张品质表回填（与 equipment.ts 的 powerBonusBp 一致）。
-- 编号跳过 0031：留给同期开发的世界 Boss 三期。

ALTER TABLE disciples ADD COLUMN gear_power_bp INTEGER NOT NULL DEFAULT 0;

UPDATE disciples SET
  gear_power_bp = (
    SELECT COALESCE(SUM(CASE quality
      WHEN 'common' THEN 200
      WHEN 'spirit' THEN 400
      WHEN 'treasure' THEN 700
      WHEN 'immortal' THEN 1000
      ELSE 0
    END), 0)
    FROM equipment WHERE equipment.disciple_id = disciples.id
  );
