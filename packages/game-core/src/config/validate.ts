import { hashConfigContent, type DigestFn } from './hash';
import { gameConfigContentSchema, type GameConfigContent } from './schema';

/**
 * 配置加载校验（03 第 12 节：启动校验引用、概率、成本、循环、溢出）。
 *
 * 三道关卡，全部通过才返回可用配置：
 *   1. schema：严格对象，未声明字段/类型/格式错误直接失败；
 *   2. 语义：重复 id、引用不存在的定义、范围与成本不合法；
 *   3. 哈希：内容哈希必须与声明的 payloadHash 一致（同版本内容不能被改写）。
 *
 * 任何一道失败都抛 ConfigValidationError，调用方（Worker 启动、构建校验、测试）
 * 必须让进程/请求失败，而不是带着坏配置继续跑。
 */

export type ConfigIssueCode =
  | 'schema'
  | 'invalid_version'
  | 'duplicate_id'
  | 'unknown_reference'
  | 'invalid_range'
  | 'invalid_cost'
  | 'hash_mismatch';

export interface ConfigIssue {
  /** 配置内的字段路径，例如 resources.0.capacity。 */
  path: string;
  code: ConfigIssueCode;
  message: string;
}

export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly ConfigIssue[]) {
    super(`游戏配置校验失败（${issues.length} 项）：${issues.map((issue) => issue.path).join(', ')}`);
    this.name = 'ConfigValidationError';
  }
}

/** 配置来源：版本、声明的内容哈希与未校验的内容。 */
export interface GameConfigSource {
  version: string;
  payloadHash: string;
  content: unknown;
}

export interface ValidatedGameConfig {
  version: string;
  payloadHash: string;
  content: GameConfigContent;
}

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u;

export function collectSchemaIssues(input: unknown, version: string): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  if (!VERSION_PATTERN.test(version)) {
    issues.push({
      path: 'version',
      code: 'invalid_version',
      message: '版本号必须是非空字母数字串（可含 . _ -）',
    });
  }

  const parsed = gameConfigContentSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
        code: 'schema',
        message: issue.message,
      });
    }
  }

  return issues;
}

export function collectSemanticIssues(config: GameConfigContent): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const add = (path: string, code: ConfigIssueCode, message: string): void => {
    issues.push({ path, code, message });
  };

  const resourceIds = new Set<string>();
  config.resources.forEach((resource, index) => {
    if (resourceIds.has(resource.id)) {
      add(`resources.${index}.id`, 'duplicate_id', `资源 id 重复：${resource.id}`);
    }
    resourceIds.add(resource.id);
    if (BigInt(resource.capacity) < BigInt(resource.startAmount)) {
      add(`resources.${index}.capacity`, 'invalid_range', '容量不能小于初始数量');
    }
  });

  const buildingMaxLevel = new Map<string, number>();
  config.buildings.forEach((building, index) => {
    if (buildingMaxLevel.has(building.id)) {
      add(`buildings.${index}.id`, 'duplicate_id', `建筑 id 重复：${building.id}`);
    }
    buildingMaxLevel.set(building.id, building.maxLevel);

    for (const [resourceId, amount] of Object.entries(building.upgradeCostPerLevel)) {
      if (!resourceIds.has(resourceId)) {
        add(
          `buildings.${index}.upgradeCostPerLevel.${resourceId}`,
          'unknown_reference',
          `升级成本引用了未声明的资源：${resourceId}`,
        );
      }
      if (BigInt(amount) <= 0n) {
        add(
          `buildings.${index}.upgradeCostPerLevel.${resourceId}`,
          'invalid_cost',
          '升级成本必须大于 0，避免免费升级',
        );
      }
    }
    if (building.maxLevel > 1 && Object.keys(building.upgradeCostPerLevel).length === 0) {
      add(
        `buildings.${index}.upgradeCostPerLevel`,
        'invalid_cost',
        '可升级建筑必须声明升级成本',
      );
    }
  });

  const positionIds = new Set<string>();
  config.positions.forEach((position, index) => {
    if (positionIds.has(position.id)) {
      add(`positions.${index}.id`, 'duplicate_id', `岗位 id 重复：${position.id}`);
    }
    positionIds.add(position.id);

    for (const resourceId of Object.keys(position.outputPerHourPerDisciple)) {
      if (!resourceIds.has(resourceId)) {
        add(
          `positions.${index}.outputPerHourPerDisciple.${resourceId}`,
          'unknown_reference',
          `岗位产出引用了未声明的资源：${resourceId}`,
        );
      }
    }
  });

  const initialBuildingIds = new Set<string>();
  config.sect.initialBuildings.forEach((entry, index) => {
    if (!buildingMaxLevel.has(entry.defId)) {
      add(`sect.initialBuildings.${index}.defId`, 'unknown_reference', `未声明的建筑：${entry.defId}`);
      return;
    }
    if (initialBuildingIds.has(entry.defId)) {
      add(`sect.initialBuildings.${index}.defId`, 'duplicate_id', `同一建筑类型只能出现一次：${entry.defId}`);
    }
    initialBuildingIds.add(entry.defId);

    const maxLevel = buildingMaxLevel.get(entry.defId) ?? 0;
    if (entry.level > maxLevel) {
      add(
        `sect.initialBuildings.${index}.level`,
        'invalid_range',
        `初始等级 ${entry.level} 超过该建筑上限 ${maxLevel}`,
      );
    }
  });

  if (config.sect.initialBuildings.length > config.sect.initialBuildingCapacity) {
    add('sect.initialBuildings', 'invalid_range', '初始建筑数量超过建筑上限');
  }

  config.sect.initialDisciples.forEach((disciple, index) => {
    if (disciple.assignment !== 'idle' && !positionIds.has(disciple.assignment)) {
      add(
        `sect.initialDisciples.${index}.assignment`,
        'unknown_reference',
        `未声明的岗位：${disciple.assignment}`,
      );
    }
  });

  if (config.sect.initialDisciples.length > config.sect.initialDiscipleCapacity) {
    add('sect.initialDisciples', 'invalid_range', '初始弟子数量超过弟子上限');
  }

  for (const [resourceId, amount] of Object.entries(config.recruitment.cost)) {
    if (!resourceIds.has(resourceId)) {
      add(`recruitment.cost.${resourceId}`, 'unknown_reference', `招募成本引用了未声明的资源：${resourceId}`);
    }
    if (BigInt(amount) <= 0n) {
      add(`recruitment.cost.${resourceId}`, 'invalid_cost', '招募成本必须大于 0');
    }
  }

  const { breakthrough, cultivation, offlineCapSeconds } = config;
  if (breakthrough.minChanceBp > breakthrough.baseChanceBp || breakthrough.baseChanceBp > breakthrough.maxChanceBp) {
    add(
      'breakthrough',
      'invalid_range',
      '突破概率必须满足 minChanceBp <= baseChanceBp <= maxChanceBp',
    );
  }
  if (
    cultivation.aptitudeCoefficientBaseBp + 100 * cultivation.aptitudeCoefficientPerPointBp >
    cultivation.maxTotalBonusBp
  ) {
    add(
      'cultivation.maxTotalBonusBp',
      'invalid_range',
      '满资质时的资质系数不能超过总成长加成上限',
    );
  }
  if (offlineCapSeconds <= 0) {
    add('offlineCapSeconds', 'invalid_range', '离线上限必须大于 0');
  }

  return issues;
}

export interface ValidateGameConfigOptions {
  /** 摘要函数（Web Crypto SHA-256）；不传则跳过哈希校验。 */
  digest?: DigestFn;
}

export async function validateGameConfig(
  source: GameConfigSource,
  options: ValidateGameConfigOptions = {},
): Promise<ValidatedGameConfig> {
  const schemaIssues = collectSchemaIssues(source.content, source.version);

  const parsed = gameConfigContentSchema.safeParse(source.content);
  const semanticIssues = parsed.success ? collectSemanticIssues(parsed.data) : [];
  const issues = [...schemaIssues, ...semanticIssues];

  if (issues.length > 0 || !parsed.success) {
    throw new ConfigValidationError(issues);
  }

  if (options.digest) {
    const actualHash = await hashConfigContent(parsed.data, options.digest);
    if (actualHash !== source.payloadHash) {
      throw new ConfigValidationError([
        {
          path: 'payloadHash',
          code: 'hash_mismatch',
          message: `内容哈希与声明不一致：声明 ${source.payloadHash}，实际 ${actualHash}`,
        },
      ]);
    }
  }

  return { version: source.version, payloadHash: source.payloadHash, content: parsed.data };
}

/** 便于测试与工具使用：只算哈希，不做其他校验。 */
export async function computeConfigHash(content: unknown, digest: DigestFn): Promise<string> {
  return hashConfigContent(content, digest);
}
