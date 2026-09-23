/**
 * Secret 型绑定的类型声明（单独成文件，避免被 `npm run cf:types` 覆盖）。
 *
 * `worker-configuration.d.ts` 是 `wrangler types` 生成的：它只包含 wrangler.jsonc 里的
 * 非敏感 `vars`，`wrangler secret put` 注入的绑定永远不会出现在里面，
 * 而把它手写进那个文件又会在下次 `npm run cf:types` 时被冲掉。
 * 所以这里用**声明合并**（同名 `interface Env`）补齐 secret 的绑定类型。
 *
 * 注意：只声明真正的 secret。`REALM_EXPLORE_ENABLED` 之类的普通变量由 `wrangler types`
 * 从 wrangler.jsonc 生成（字面量类型，如 `"false"`）；在这里重复声明成 `string` 会与
 * 生成的字面量类型冲突，因此一律不在本文件出现。
 */

interface Env {
  /** OpenRouter API key（wrangler secret put OPENROUTER_API_KEY 注入）。 */
  OPENROUTER_API_KEY: string;
}
