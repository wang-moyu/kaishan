-- Migration number: 0029 	 Name: equipment_rebalance
--
-- 装备属性加强：原数值穿满一身凡品只加约 +3 战力，玩家感知不到。
--   凡品 主 4 → 8，副 1~2 → 2~4（×2）
--   灵品 主 8 → 16，副 2~4 → 4~8（×2）
--   宝品 主 12 → 20，副 3~6 → 6~10（线性映射：6 + (旧值 − 3) × 4/3，四舍五入）
--   仙品 主 18 → 24，副 4~8 → 8~16（×2）
-- 已有装备按同一规则放大，再按装备表为**所有**弟子重新求和写回 5 列装备加成（顺带纠正任何不一致）（equipment.ts 的新常量与此一致）。

UPDATE equipment SET
  main_value = CASE quality
    WHEN 'common' THEN 8
    WHEN 'spirit' THEN 16
    WHEN 'treasure' THEN 20
    WHEN 'immortal' THEN 24
    ELSE main_value
  END,
  sub_value = CASE quality
    WHEN 'treasure' THEN CAST(ROUND(6 + (sub_value - 3) * 4.0 / 3) AS INTEGER)
    ELSE sub_value * 2
  END;

UPDATE disciples SET
  gear_attack = (SELECT COALESCE(SUM((CASE WHEN main_attr = 'attack' THEN main_value ELSE 0 END) + (CASE WHEN sub_attr = 'attack' THEN sub_value ELSE 0 END)), 0) FROM equipment WHERE equipment.disciple_id = disciples.id),
  gear_defense = (SELECT COALESCE(SUM((CASE WHEN main_attr = 'defense' THEN main_value ELSE 0 END) + (CASE WHEN sub_attr = 'defense' THEN sub_value ELSE 0 END)), 0) FROM equipment WHERE equipment.disciple_id = disciples.id),
  gear_speed = (SELECT COALESCE(SUM((CASE WHEN main_attr = 'speed' THEN main_value ELSE 0 END) + (CASE WHEN sub_attr = 'speed' THEN sub_value ELSE 0 END)), 0) FROM equipment WHERE equipment.disciple_id = disciples.id),
  gear_luck = (SELECT COALESCE(SUM((CASE WHEN main_attr = 'luck' THEN main_value ELSE 0 END) + (CASE WHEN sub_attr = 'luck' THEN sub_value ELSE 0 END)), 0) FROM equipment WHERE equipment.disciple_id = disciples.id),
  gear_physique = (SELECT COALESCE(SUM((CASE WHEN main_attr = 'physique' THEN main_value ELSE 0 END) + (CASE WHEN sub_attr = 'physique' THEN sub_value ELSE 0 END)), 0) FROM equipment WHERE equipment.disciple_id = disciples.id);
