/**
 * 弟子头像框：固定白名单 + 静态图片映射（纯函数，不碰 DOM、不依赖 Vue）。
 *
 * 为什么是白名单而不是自由输入：头像框只允许玩家提供的 20 张固定静态图，
 * 接口与数据库都按 id 校验，前端同样只认这 21 个 id（`classic` + `frame01`–`frame20`），
 * 不接受任意 URL、路径或上传内容。
 *
 * 素材约定：`frame01`–`frame20` 对应 `apps/web/public/avatar-frames/frame01.png` …
 * `frame20.png`（透明背景、中央留白）。`classic` 没有图片，用界面内置的旧外观。
 * 图片缺失或加载失败时一律回退 `classic`，绝不把破图或占位图当成玩家选的样式。
 */

/** 允许的样式 id（顺序即选择器里的展示顺序）。 */
export const AVATAR_FRAME_IDS = [
  'classic',
  'frame01',
  'frame02',
  'frame03',
  'frame04',
  'frame05',
  'frame06',
  'frame07',
  'frame08',
  'frame09',
  'frame10',
  'frame11',
  'frame12',
  'frame13',
  'frame14',
  'frame15',
  'frame16',
  'frame17',
  'frame18',
  'frame19',
  'frame20',
] as const;

export type AvatarFrameId = (typeof AVATAR_FRAME_IDS)[number];

/** 旧外观，同时是旧弟子与新弟子的默认值（与服务端列默认值一致）。 */
export const DEFAULT_AVATAR_FRAME_ID: AvatarFrameId = 'classic';

/** 静态图目录（相对站点根；对应 apps/web/public/avatar-frames/）。 */
export const AVATAR_FRAME_ASSET_DIR = '/avatar-frames';

export interface AvatarFrameOption {
  id: AvatarFrameId;
  label: string;
  /** 图片地址；`classic` 用内置外观，没有图片（null）。 */
  src: string | null;
}

/** 旧外观：没有图片，用界面内置的圆形样式（同时也是默认值）。 */
const CLASSIC_FRAME: AvatarFrameOption = { id: 'classic', label: '旧式', src: null };

/**
 * 选择器里的全部选项：顺序即展示顺序（`classic` 在最前）。
 * `frameNN` 的图片地址由 id 直接推导，避免再维护一份容易写错的映射表。
 */
export const AVATAR_FRAME_OPTIONS: readonly AvatarFrameOption[] = AVATAR_FRAME_IDS.map((id) =>
  id === 'classic'
    ? CLASSIC_FRAME
    : { id, label: `样式 ${id.slice('frame'.length)}`, src: `${AVATAR_FRAME_ASSET_DIR}/${id}.png` },
);

/** 服务端传来的值是否是白名单里的 id（拒绝任意 URL / 路径 / 大小写变体）。 */
export function isAvatarFrameId(value: unknown): value is AvatarFrameId {
  return typeof value === 'string' && (AVATAR_FRAME_IDS as readonly string[]).includes(value);
}

/** 取某个 id 的选项；未知值按 `classic` 处理（旧数据、服务端新增值都不会渲染成空白）。 */
export function avatarFrameOption(id: unknown): AvatarFrameOption {
  return AVATAR_FRAME_OPTIONS.find((option) => option.id === id) ?? CLASSIC_FRAME;
}

/**
 * 最终用于渲染的样式 id：
 * 未知值 → `classic`；图片加载失败 → `classic`（`classic` 本身没有图片，失败标记对它是无意义的）。
 */
export function resolveAvatarFrameId(value: unknown, imageFailed = false): AvatarFrameId {
  if (imageFailed) return DEFAULT_AVATAR_FRAME_ID;
  return isAvatarFrameId(value) ? value : DEFAULT_AVATAR_FRAME_ID;
}
