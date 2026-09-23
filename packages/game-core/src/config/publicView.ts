import type { GameConfigContent } from './schema';

/**
 * 公开配置投影（04 第 3 节 GET /config/public：只给已允许公开的定义，不含事件暗奖/RNG）。
 *
 * 机制是**白名单**：
 *   - 只有 PUBLIC_CONFIG_SECTIONS 里列出的 section 会进入公开响应；
 *   - 未列出的 section（包括将来新增的、以及未知字段）默认不公开；
 *   - 集合里 visibility = 'internal' 的条目会被剔除。
 *
 * 因此新增配置 section 时不会「默认泄露」，必须显式加入白名单并在评审中确认。
 */

export const PUBLIC_CONFIG_SECTIONS = [
  'server',
  'offlineCapSeconds',
  'resources',
  'buildings',
  'positions',
  'sect',
  'recruitment',
  'cultivation',
  'breakthrough',
] as const;

export type PublicConfigSection = (typeof PUBLIC_CONFIG_SECTIONS)[number];

export type PublicGameConfig = Pick<GameConfigContent, PublicConfigSection>;

export function toPublicGameConfig(config: GameConfigContent): PublicGameConfig {
  const source = config as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const section of PUBLIC_CONFIG_SECTIONS) {
    if (!Object.hasOwn(source, section)) {
      continue;
    }
    result[section] = stripInternal(source[section]);
  }

  return result as PublicGameConfig;
}

function stripInternal(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => !isInternal(entry))
      .map((entry) => stripInternal(entry));
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
      result[key] = stripInternal(child);
    }
    return result;
  }
  return value;
}

function isInternal(entry: unknown): boolean {
  return (
    entry !== null &&
    typeof entry === 'object' &&
    (entry as { visibility?: unknown }).visibility === 'internal'
  );
}
