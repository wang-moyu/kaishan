/**
 * game-core 的配置校验与投影（无 IO 纯函数）：
 * - canonical/hash：内容哈希（摘要函数由调用方注入，见 hash.ts）
 * - schema：严格 Zod schema
 * - validate：schema + 语义 + 哈希三道校验
 * - publicView：公开配置白名单投影
 */
export * from './canonical';
export * from './hash';
export * from './publicView';
export * from './schema';
export * from './validate';
