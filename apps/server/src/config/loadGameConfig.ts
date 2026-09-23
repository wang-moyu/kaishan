import { gameConfigSource } from '@xiuxian/game-config';
import { toPublicGameConfig, validateGameConfig, type PublicGameConfig } from '@xiuxian/game-core';

import { sha256Digest } from '../infra/crypto/sha256';

/**
 * 启动期配置加载（P0-03 验收：无效配置启动失败；configVersion 加哈希校验）。
 *
 * 这里用**顶层 await**：Worker 模块初始化时就必须完成 schema + 语义 + 哈希校验。
 * 配置破损时整个 Worker 起不来（而不是带着坏配置对外服务）。
 * 校验通过的公开投影只在这里算一次，供 /config/public 复用。
 */
export const validatedGameConfig = await validateGameConfig(gameConfigSource, {
  digest: sha256Digest,
});

export const gameConfigVersion: string = validatedGameConfig.version;

export const publicGameConfig: PublicGameConfig = toPublicGameConfig(validatedGameConfig.content);
