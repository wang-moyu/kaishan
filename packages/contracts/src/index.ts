/**
 * packages/contracts：请求/响应 schema、错误码与公共枚举（P0-03）。
 *
 * 只放「可对外复用」的定义：服务端用它校验与构造响应，前端将来用它做类型与轻量校验。
 * 禁止把数据库模型直接当公开 DTO（见 P0-03 禁做项）：公开视图在各自模块里显式白名单化。
 */
export * from './envelope';
export * from './errors';
export * from './primitives';

export const PACKAGE_NAME = '@xiuxian/contracts' as const;
