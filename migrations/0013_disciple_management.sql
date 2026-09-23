-- Migration number: 0013 	 Name: disciple_management
--
-- 弟子管理优化（列表找人、详情管人）：
--   disciples <- 新增 note 列（掌门私有备注，不进任何公开视图）
--
-- 说明：
--   - 备注是单行纯文本，保存时由服务端 trim 并校验：最多 60 个 Unicode 字符、
--     禁止换行与控制字符（见 service.ts 的 normalizeDiscipleNote）；
--     CHECK (length(note) <= 60) 是最后一道兜底（SQLite length 按字符计数）。
--   - NOT NULL DEFAULT '' 让已有弟子行自动获得空串，新招募弟子同样默认空串。
--   - 驱逐不新增表：删除 disciples 行 + 清理守擂阵容在同一个 D1 batch 完成；
--     challenge_log / sparring_log / explorations 的历史快照原样保留。
--   - note 只出现在登录玩家自己的 SectStateView.disciples（view.ts），
--     PublicSectView / 排行榜 / 战报等公开视图不读这一列。

ALTER TABLE disciples
  ADD COLUMN note TEXT NOT NULL DEFAULT ''
  CHECK (length(note) <= 60);
