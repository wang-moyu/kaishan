-- Migration number: 0017 	 Name: disciple_avatar_frame
--
-- 弟子头像框（掌门私有外观，弟子交互优化计划第 3 节）：
--   disciples <- 新增 avatar_frame_id 列（'classic' 或 'frame01'…'frame10'）
--
-- 说明：
--   - 头像是 10 张玩家提供的固定素材（稳定 ID 'frame01'…'frame10'）+ 旧样式 'classic'；
--     不接受任意上传 URL / 路径；服务端 schema 只放行这 11 个字符串。
--   - NOT NULL DEFAULT 'classic' 让已有弟子行与旧式不带该列的 INSERT 自动落到 'classic'。
--   - CHECK 是最后一道兜底（与 schema 的 11 个值白名单一致；SQLite 允许 ADD COLUMN 带 CHECK）。
--   - 这一列是掌门私有的外观选择：只出现在登录玩家自己的 SectStateView.disciples（view.ts），
--     公开宗门档案 / 排行榜 / 战报 / 招贤候选人都**不**读这一列（不泄露）。
--   - 不新增表、不加外键：头像框是代码常量（素材在 apps/web/public），不进配置表。
--   - 与 0013 note 同一模式：单列写回 + commitDisciple 快照守卫；存相同值显式早退，
--     不产生资源 / 计数 / 事件副作用。

ALTER TABLE disciples
  ADD COLUMN avatar_frame_id TEXT NOT NULL DEFAULT 'classic'
  CHECK (avatar_frame_id IN (
    'classic',
    'frame01', 'frame02', 'frame03', 'frame04', 'frame05',
    'frame06', 'frame07', 'frame08', 'frame09', 'frame10'
  ));
