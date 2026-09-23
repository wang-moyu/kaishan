-- Migration number: 0016 	 Name: disciple_rating
--
-- 弟子属性与综合评分（docs/弟子属性与综合评分开发计划.md 第 3 节）：
--   disciples <- 新增 luck（幸运）与 physique（体魄）两列，取值 1..100，默认 50
--
-- 说明：
--   - 只加列，**不执行任何 UPDATE**：资质、攻/防/速、天赋、境界、修为、修为余量与
--     body_tempering_count（淬体丹成果）全部原样保留，旧弟子不重掷、不归一化、不回退。
--   - DEFAULT 50 是「机制中性点」：幸运 50 的额外收获概率仍是 1500 基点（15%），
--     体魄 50 的受伤概率与加列之前逐位相同（见 journey.ts 的两个纯函数）。
--   - 不加综合评分列：评分由服务端按当前六项属性现算（names.ts 的 attributeScore +
--     view.ts），存列会在淬体丹 / 突破等写入路径上留下不同步的陈旧值。
--   - NOT NULL DEFAULT 50 让旧测试 / 旧脚本只插旧字段时依然可用（自动获得 50/50）；
--     新弟子一律由生成器显式写入，不依赖数据库默认值。
--   - 两份 CHECK 与 view.ts / service.ts 的 1..100 口径一致，是脏数据的最后一道兜底。

ALTER TABLE disciples
  ADD COLUMN luck INTEGER NOT NULL DEFAULT 50
  CHECK (luck BETWEEN 1 AND 100);

ALTER TABLE disciples
  ADD COLUMN physique INTEGER NOT NULL DEFAULT 50
  CHECK (physique BETWEEN 1 AND 100);
