-- Migration number: 0008 	 Name: v4_disciple_attributes
--
-- 弟子属性与天赋：
--   disciples <- 新增 attack / defense / speed（1~100 战斗属性）与 talent（天赋 id）
--
-- 说明：
--   - 三个属性列 DEFAULT 50、talent DEFAULT 'none'，让已有弟子行自动获得该列；
--     不依赖 DEFAULT（老弟子）时下面的 UPDATE 会随机重掷，避免老弟子全是 50/50/50。
--   - talent 取值：'herbGathering' | 'mining' | 'cultivation' | 'combat'
--     （常量定义见 apps/server/src/modules/game/constants.ts 的 TALENTS）。
--   - 列值都是整数/文本，不用外键：天赋是代码常量，不进配置表。

ALTER TABLE disciples ADD COLUMN attack INTEGER NOT NULL DEFAULT 50;
ALTER TABLE disciples ADD COLUMN defense INTEGER NOT NULL DEFAULT 50;
ALTER TABLE disciples ADD COLUMN speed INTEGER NOT NULL DEFAULT 50;
ALTER TABLE disciples ADD COLUMN talent TEXT NOT NULL DEFAULT 'none';

-- 给已有弟子随机分配属性和天赋（不让老弟子全是 50/50/50）
UPDATE disciples SET
  attack = abs(random()) % 100 + 1,
  defense = abs(random()) % 100 + 1,
  speed = abs(random()) % 100 + 1,
  talent = CASE abs(random()) % 4
    WHEN 0 THEN 'herbGathering'
    WHEN 1 THEN 'mining'
    WHEN 2 THEN 'cultivation'
    WHEN 3 THEN 'combat'
  END;
