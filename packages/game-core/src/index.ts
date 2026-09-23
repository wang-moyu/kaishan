/**
 * packages/game-core：无 IO 的纯函数（不依赖框架、真实时钟或 Cloudflare 绑定）。
 * P0-03 交付配置校验与公开投影；结算/成长/战斗自 P1 起在此实现。
 */
export * from './config';

export const PACKAGE_NAME = '@xiuxian/game-core' as const;
