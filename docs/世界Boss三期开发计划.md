# 世界 Boss 三期开发计划：掉落人人有份 + 功勋兑换

> 目标：打破「最强的宗门每关必拿最好的装备 → 更强 → 继续拿」的循环，让弱一些的宗门也有稳定的追赶路线。
> 本文是**可直接照做的施工清单**：公式、常量、文件、函数、测试预期都已定好，**不要自行改数值或扩大范围**。遇到本文没写到、又必须决定的地方，停下来在最终汇报里列出，不要自己发挥。

---

## 0. 工作方式与边界

- 在独立 worktree / 分支 `feat/world-boss-v3` 上开发，基于 `main`。完成后**在该分支提交**，**不要 push、不要合并到 main**。
- **不要改**：战力公式（`apps/server/src/modules/game/realms.ts` 的 `discipleCombatPower`、`service.ts` 的 `gearedCombatPower` / `battleAttrsOf`）、装备品质表 `EQUIPMENT_QUALITIES` 的数值、关卡血量公式。另一条分支在改装备战力，碰这些会冲突。
- **不要启动开发服务器**（不跑 `vite` / `wrangler dev` / `npm run dev*`）。验证靠单元测试、类型检查和构建（见第 9 节）。
- 代码风格：照抄周围代码——中文注释、同样的注释密度、同样的命名和写法。金额一律用**最小单位**（1 展示单位 = 1000 最小单位）。
- 参考提交：`git show 1abafb3`（「装备二期」，新增资源「玄铁」的完整做法：game-config、迁移、seed、资源栏、glyph），本期新增资源「功勋」基本照它来。

---

## 1. 改动总览

| # | 改动 | 一句话 |
|---|---|---|
| A | 装备掉落 | 从「第 1 名必掉高档」改为「每个参与者按 √伤害占比 各自判定」 |
| B | 玄铁门槛 | 伤害占比 < 15% 的参与者由 0 改为每关 1 个 |
| C | 新资源「功勋」 | 每关结算按 √伤害占比 发放 |
| D | 功勋兑换 | 新接口：功勋换玄铁 / 灵品 / 宝品 / 仙品装备（自选部位） |
| E | 前端 | 讨伐面板：功勋兑换区、本关掉落概率、奖励说明与规则文案更新；资源栏不显示功勋 |
| F | 更新说明 | changelog 新增一条 |

资源奖励（灵石 / 药材 / 矿石 × 排名倍数）、丹药、最后一击奖励**全部不变**。

---

## 2. 规则与数值（全部写死，不要改）

### 2.1 装备掉落（A）

仅**击杀**时掉落（击退、逃走都不掉，与现在一致）。对每个参与宗门（对本关伤害 > 0，按伤害排名顺序）各自判定一次：

```
伤害占比 share = 该宗门对本关总伤害 / 本关所有参与宗门总伤害
高档概率 highChance = 0.75 × √share          （share 夹在 [0, 1]）
随机数 r1 < highChance        → 掉 1 件「高档」品质
否则 随机数 r2 < 0.4           → 掉 1 件「低档」品质
否则                            → 不掉
```

- 「高档 / 低档」品质沿用 `bossDropQualities(stage)` 的 `top` / `others`：第 1～2 关 灵/凡，第 3～4 关 宝/灵，第 5 关起 仙/宝。**函数和字段名保持不变**，只把注释改成「top = 高档，others = 低档」。
- **不再有「第 1 名必掉」**。
- 随机数取用顺序（测试依赖它）：每个参与者依次 `r1`（高档判定）→ 未中高档时 `r2`（低档判定）→ 掉落时再按现有代码取部位、法器主属性、`generateEquipment` 的随机数。
- 背包满自动分解、仙品全服广播：保持现有逻辑。

参考值：share 100% → 75%；55% → 约 55.6%；25% → 37.5%；8% → 约 21.2%；4% → 15%。

### 2.2 玄铁（B）

`bossXuantieFor` 只改「占比不足 15%」这一支：

| 条件 | 数量（展示单位） |
|---|---|
| share ≥ 15% | 与现在完全相同（按关卡查表、第 1 名更多、击退减半向下取整） |
| 0 < share < 15% | **1**；击退时 `Math.floor(1 / 2)` = **0** |
| share ≤ 0 | 0 |

### 2.3 功勋（C）

新资源 id `bossMerit`，名称「功勋」。每关结算时（击杀或击退；单纯逃走 < 70% 不发），对每个参与宗门：

```
base = max(2, Math.round(10 × stageRewardMultiplier(stage) × √share))
击杀：功勋 = base
击退：功勋 = max(1, Math.floor(base / 2))
share ≤ 0：0
```

`stageRewardMultiplier(stage)` 是 `worldBoss.ts` 里现成的关卡系数：1 + 0.5 ×（关卡 − 1）。入账时 × 1000（最小单位）。

参考值（用于测试）：

| 关卡 | share | 击杀 | 击退 |
|---|---|---|---|
| 1 | 100% | 10 | 5 |
| 1 | 25% | 5 | 2 |
| 1 | 1% | 2（保底） | 1 |
| 2 | 100% | 15 | 7 |
| 3 | 25% | 10 | 5 |
| 5 | 55% | 22 | 11 |
| 任意 | 0 | 0 | 0 |

### 2.4 功勋兑换（D）

| itemId | 名称 | 价格（功勋，展示单位） | 得到 |
|---|---|---|---|
| `xuantie` | 玄铁 | 4 / 个 | 玄铁，数量 `quantity`（1～100，默认 1） |
| `spirit` | 灵品装备 | 25 | 1 件灵品装备 |
| `treasure` | 宝品装备 | 70 | 1 件宝品装备 |
| `immortal` | 仙品装备 | 200 | 1 件仙品装备 |

- 装备：玩家**自选部位**（`weapon` / `armor` / `artifact`）；法器**必须**选主属性 `speed` 或 `luck`，其它部位**不许**传主属性（与炼器同一校验）；副属性随机（`generateEquipment` 现成逻辑）。
- 必定成功；**不需要**炼器坊等级、**不需要**炼器解锁、不花灵石矿石。
- 背包满（`BAG_CAPACITY`）时拒绝：`INVALID_STATUS`，文案用现成的 `bagFullReason(bagCount)`。
- 功勋不足：`draft.requireResource` 会抛 `INSUFFICIENT_RESOURCE`（文案「功勋不足」），直接用。
- 兑换出的装备 `source` 记 `'boss'`（不新增来源类型）。
- 兑换得仙品时全服广播一次：`` `【讨伐】${宗门名}以功勋兑换 ${装备名}！` ``（用现成的 `broadcastWorldBoss`，照 `forgeEquipment` 末尾的写法）。
- 装备请求带 `quantity` 时只允许 1；玄铁请求不许带 `slot` / `mainAttr`。违反一律 `VALIDATION_ERROR`。

---

## 3. 服务端：纯规则（`apps/server/src/modules/game/`）

### 3.1 `equipment.ts`

1. 新增常量 `BOSS_HIGH_DROP_FACTOR = 0.75`（注释：高档掉落概率 = 它 × √伤害占比）。
2. `BOSS_DROP_CHANCE_OTHERS`（0.4）保留，注释改为「未中高档时掉低档的概率」。
3. 新增 `bossHighDropChance(damageShare: number): number`：`share` 夹到 [0, 1] 后返回 `BOSS_HIGH_DROP_FACTOR * Math.sqrt(share)`。
4. 新增纯函数（随机源注入）：

   ```ts
   /** 世界 Boss 击杀掉落判定：先判高档，未中再判低档；都没中返回 null。 */
   export function rollBossDrop(input: { stage: number; damageShare: number; random: () => number }): EquipmentQuality | null
   ```

   按 2.1 的顺序取随机数；`damageShare <= 0` 直接返回 null，且**不取**随机数。
5. `bossXuantieFor`：按 2.2 改「< 15%」分支。
6. `bossDropDescription(stage)` 改为返回（`${高}` / `${低}` 是品质名，如「宝品」）：

   ```
   按本关伤害占比各自判定：${高}装备 ×1 概率 = 75% × √占比；未得时 40% 概率得 ${低}装备 ×1
   ```

   例：`bossDropDescription(5)` === `'按本关伤害占比各自判定：仙品装备 ×1 概率 = 75% × √占比；未得时 40% 概率得 宝品装备 ×1'`。数字用常量拼出来，不要写死。
7. 文件头注释里「除炼器与世界 Boss 以外的其他来源」等过时描述顺手补一句「三期：功勋兑换」即可，别大改。

### 3.2 `worldBoss.ts`

1. 新增常量与函数：

   ```ts
   /** 功勋资源 id（game-config 的第六种资源）。 */
   export const BOSS_MERIT_RESOURCE_ID = 'bossMerit';
   export const WORLD_BOSS_MERIT_BASE = 10;
   export const WORLD_BOSS_MERIT_MIN = 2;

   /** 一个参与宗门在该关获得的功勋（展示单位整数），公式见计划 2.3。 */
   export function worldBossMeritFor(input: { stage: number; damageShare: number; repelled: boolean }): number
   ```

2. 兑换价目表（**唯一一份**，前端不复制）：

   ```ts
   export type BossMeritShopItemId = 'xuantie' | 'spirit' | 'treasure' | 'immortal';
   export const WORLD_BOSS_MERIT_SHOP: readonly { id: BossMeritShopItemId; name: string; cost: number; quality: EquipmentQuality | null }[] = [
     { id: 'xuantie', name: '玄铁', cost: 4, quality: null },
     { id: 'spirit', name: '灵品装备', cost: 25, quality: 'spirit' },
     { id: 'treasure', name: '宝品装备', cost: 70, quality: 'treasure' },
     { id: 'immortal', name: '仙品装备', cost: 200, quality: 'immortal' },
   ];
   export const WORLD_BOSS_MERIT_XUANTIE_MAX = 100;
   export function findMeritShopItem(id: string) { ... }
   ```

   `cost` 是展示单位；扣款时 × 1000。`EquipmentQuality` 从 `./equipment` 导入（`worldBoss.ts` 已经从那里导入 `bossDropDescription`，没有循环依赖问题）。
3. 文件头注释补一段「三期」：掉落人人有份、功勋、玄铁门槛放宽。

---

## 4. 新资源「功勋」（照 `git show 1abafb3` 的玄铁做法）

1. **`packages/game-config/src/index.ts`**：在 `xuantie` 之后追加：

   ```ts
   {
     // 世界 Boss 三期：功勋（讨伐按伤害占比发放，用于功勋兑换）。
     // 没有产速；不可在坊市买卖、不可下注（坊市与赌坊都有资源白名单）。
     id: 'bossMerit',
     name: '功勋',
     startAmount: '0',
     capacity: '9999000',
     baseRatePerHour: '0',
     visibility: 'public',
   },
   ```

   - `GAME_CONFIG_VERSION` 改为 `'v7.0.0'`。
   - 重新计算 `GAME_CONFIG_PAYLOAD_HASH`：在仓库根目录建一个临时文件 `scripts/tmp-hash.mts`：

     ```ts
     import { GAME_CONFIG_CONTENT } from '@xiuxian/game-config';
     import { computeConfigHash } from '@xiuxian/game-core';
     import { sha256Digest } from '../apps/server/src/infra/crypto/sha256';
     console.log(await computeConfigHash(GAME_CONFIG_CONTENT, sha256Digest));
     ```

     运行 `npx tsx scripts/tmp-hash.mts`，把输出填进 `GAME_CONFIG_PAYLOAD_HASH`，**然后删掉这个临时文件**。
2. **`scripts/seed/seed.sql`**：`config_versions` 那一行的 id / version / 哈希改成 `cfg-v7.0.0` / `v7.0.0` / 新哈希（`tests/game-config/config-integrity.test.ts` 会校验）。
3. **迁移 `migrations/0031_world_boss_v3.sql`**：照 `0030_equipment_phase2.sql` 的第一段，给所有已有宗门补一行 `bossMerit` 余额 0（`NOT EXISTS` 保证幂等）。文件头注释写清楚用途。本期**不需要**其它表结构改动。
4. 白名单确认（只检查，通常不用改）：坊市 `SHOP_TRADABLE_RESOURCES`（`shop.ts`）、赌坊 `BETTABLE_RESOURCES`（`gambling.ts`）都不能包含 `bossMerit`。

---

## 5. 服务端：结算、面板、兑换接口（`service.ts` / `view.ts` / `routes.ts` / `schema.ts`）

### 5.1 结算 `rewardWorldBoss`（`service.ts`，搜 `async function rewardWorldBoss`）

在「`participants.forEach(([sectId, info], index) => { ... })`」里：

1. 玄铁：`bossXuantieFor` 调用不变（函数本身已按 2.2 改）。
2. **新增功勋**：紧跟玄铁之后，`worldBossMeritFor({ stage, damageShare, repelled })`，> 0 时：
   `statements.push(resourceDeltaStatement(sectId, BOSS_MERIT_RESOURCE_ID, merit * 1000, now))` 与 `creditLedger(sectId, BOSS_MERIT_RESOURCE_ID, merit * 1000)`。
   （击杀和击退都会走到这里；逃走 < 70% 根本进不了这个分支，符合 2.3。）

在「0028 装备掉落」那段（`if (killed) { ... }` 里的 `for (const [index, [sectId]] of participants.entries())`）：

3. 删掉 `isTop` / `BOSS_DROP_CHANCE_OTHERS` 的判断，改为：
   `const quality = rollBossDrop({ stage, damageShare: info.damage / totalDamage, random: Math.random });` 为 null 就 `continue`。
   循环需要拿到每个参与者的 `info.damage` 和前面算好的 `totalDamage`（`totalDamage` 目前定义在外层 `if` 块里，确认作用域能访问到）。
   其余（部位随机、法器主属性、背包满分解、写库、`bossDrops`、账本 items）保持不变。
4. 函数头注释里关于掉落和玄铁的描述同步更新。

### 5.2 讨伐面板 `buildWorldBossView`（`service.ts`）+ 类型（`view.ts` 的 `WorldBossView`）

`WorldBossView` 新增两个字段（`view.ts` 与前端 `apps/web/src/api/game.ts` 同步）：

```ts
/** 三期：本宗门在当前关的掉落概率（boss 为 null 时为 null）。 */
myDrop: {
  /** 本宗门对本关的伤害占比（0~1；还没出手为 0）。 */
  damageShare: number;
  /** 击杀时掉高档装备的概率（0~1）。 */
  highChance: number;
  highQualityName: string;
  lowQualityName: string;
} | null;
/** 三期：功勋兑换价目（服务端唯一一份，前端只渲染）。cost 为展示单位。 */
meritShop: { id: string; name: string; cost: number; quality: string | null }[];
```

- `damageShare`：用已经查出来的 `rankRows`：本宗门 damage / 所有 damage 之和（和为 0 时 0）。
- `highChance = bossHighDropChance(damageShare)`；品质名用 `bossDropQualities(boss.stage)` + `qualityNameOf`。
- `meritShop` 直接由 `WORLD_BOSS_MERIT_SHOP` 映射（`xuantie` 的 `quality` 为 null）。

奖励预览 `rewardPreview`（`withXuantiePreview`）新增：

```ts
/** 三期：本关伤害占比 100% 时的功勋（展示单位）；实际按 √占比 折算，保底 2。 */
meritFullShare: number;
```

值为 `worldBossMeritFor({ stage: preview.stage, damageShare: 1, repelled: false })`。`WorldBossRewardPreviewView` 类型（`view.ts` + 前端）同步加字段。`xuantie` 预览对象再加一个 `below: 1`（占比不足门槛时的数量），类型同步。

### 5.3 兑换接口

- **schema.ts**：

  ```ts
  /** 世界 Boss 三期：功勋兑换。合法性（部位 / 主属性 / 数量组合）由 service 校验，这里只做类型与长度。 */
  export const worldBossExchangeRequestSchema = z.strictObject({
    itemId: z.enum(['xuantie', 'spirit', 'treasure', 'immortal']),
    quantity: z.number().int().min(1).max(100).optional(),
    slot: z.string().min(1).max(16).optional(),
    mainAttr: z.string().min(1).max(16).optional(),
  });
  ```

- **routes.ts**：紧跟 `/game/world-boss/attack` 之后：

  ```ts
  // 世界 Boss 三期：功勋兑换（结算 → 价目 / 余额 / 背包校验 → 扣功勋 + 发玄铁或装备，一次受保护 batch）。
  routes.post('/game/world-boss/exchange', async (c) => { ... respondOk(c, { state: result.state, outcome: result.outcome }) });
  ```

- **service.ts** 新增 `exchangeBossMerit(db, userId, input, now)`，写法照 `forgeEquipment`：
  1. `const draft = await draftFor(db, userId, now);`
  2. `findMeritShopItem(input.itemId)`，找不到 `VALIDATION_ERROR`。
  3. 玄铁：校验无 `slot` / `mainAttr`；`quantity` 默认 1、上限 `WORLD_BOSS_MERIT_XUANTIE_MAX`；`draft.requireResource(BOSS_MERIT_RESOURCE_ID, cost * quantity * 1000)`；`draft.addResource(XUANTIE_RESOURCE_ID, quantity * 1000)`；`await draft.commit()`。
  4. 装备：`quantity` 只能缺省或 1；部位 / 主属性校验与 `forgeEquipment` **完全相同**——把 `forgeEquipment` 里那段校验（`isEquipmentSlot` → 法器必须 speed/luck、其它不许传 → `resolveMainAttr`）**抽成一个共用函数**，两处都调它，不要复制粘贴。然后 `loadEquipment` 查背包件数，满了抛 `INVALID_STATUS` + `bagFullReason`；`draft.requireResource(...)` 扣功勋；`generateEquipment({ slot, quality, mainAttr, random: Math.random })`；`insertEquipmentStatement({ ..., source: 'boss', now })`；`await draft.commit()`；仙品广播（2.4）。
  5. 返回 `{ state: draft.view(), outcome }`，`outcome` 类型定义在 service.ts 里（照 `ForgeEquipmentOutcome` 的位置和写法），导出给路由用：

     ```ts
     export interface BossMeritExchangeOutcome {
       itemId: string;
       /** 花掉的功勋（最小单位）。 */
       cost: number;
       /** 兑换到的玄铁（最小单位）；兑换装备时为 0。 */
       xuantie: number;
       /** 兑换到的装备；兑换玄铁时为 null。 */
       equipment: { id: string; name: string; quality: string; slot: string; slotName: string } | null;
     }
     ```

---

## 6. 前端（`apps/web/src/`）

1. **`api/game.ts`**：
   - `WorldBossView` 加 `myDrop`、`meritShop`；奖励预览类型加 `meritFullShare`、`xuantie.below`。
   - 新增 `exchangeBossMerit(input: { itemId: string; quantity?: number; slot?: string; mainAttr?: string })`，POST `/api/v1/game/world-boss/exchange`，返回 `{ state: SectStateView; outcome: BossMeritExchangeOutcome }`（类型照服务端）。写法照 `forgeEquipment` / `attackWorldBoss`。
2. **`utils/glyph.ts`**：`RESOURCE_GLYPHS` 加 `bossMerit: '勋'`。
3. **`components/SectScreen.vue`**：`mainResources` 的过滤条件加上 `bossMerit`（资源栏**不**显示功勋，也**不**新增窄格）。
4. **`components/WorldBossDialog.vue`**：
   - 头部按钮区加「功勋」按钮，与「奖励」「说明」三者互斥（照 `toggleRewards` / `toggleRules` 的写法加 `showMerit` / `toggleMerit`，并让另两个 toggle 也会关掉它）。
   - 功勋区内容：
     - 第一行：`功勋 {余额}`，余额从 `props.state.resources` 里找 `bossMerit`，用 `formatAmount` 显示。
     - 一个表格，每行一个 `panel.meritShop` 项：名称、价格、操作。
       - 玄铁行：数量输入框（1～100 的整数，默认 1）+「兑换」按钮，按钮旁显示合计功勋。
       - 装备行：部位下拉（兵器 / 护甲 / 法器）；选法器时再出一个主属性下拉（身法 / 幸运）；「兑换」按钮。
       - 余额不足时按钮禁用（前端只做提示，最终以服务端校验为准）。
     - 底部一行小字：「装备自选部位，副属性随机；必定成功，不需要炼器坊。」
   - 兑换流程：调用 `exchangeBossMerit` → 成功后 `emit('state-update', state)`，`emit('notify', 'success', 标题, 内容)`：
     - 玄铁：标题「兑换成功」，内容「玄铁 +N」。
     - 装备：标题「兑得 {装备名}」，内容「{部位名} · 已放入背包。」
     - 失败：`emit('notify', 'warning', '兑换未成', 错误信息)`。
     - 提交期间禁用所有兑换按钮（照 `submitting` 的用法）。
   - 本关掉落概率：在伤害榜附近显示一行（`panel.myDrop` 非 null 且 Boss 在讨伐中时）：
     `本关伤害占比 X%，击杀时 {高档}装备概率 Y%（未得时 40% 得 {低档}装备）`，百分比四舍五入到整数。
   - 奖励面板（`showRewards`）的说明列表：
     - 玄铁那条改为：`玄铁：本关伤害占比 ≥{minSharePercent}% 按表发放（击退减半），不足则每关 {below} 个`。
     - 新增一条：`功勋：max(2, {meritFullShare} × √伤害占比)，击退减半；可在「功勋」里兑换玄铁与装备`。
     - 掉落那条保持直接渲染 `dropDescription`（文案已由服务端改好）。
   - `RULES_TEXT`：
     - 把最后的「玄铁」行改为与奖励面板一致的新规则。
     - 新增「掉落」行：`掉落：每关击杀时，每个参与宗门按伤害占比各自判定 —— 高档装备概率 = 75% × √占比，未得时 40% 概率得低档装备；第 1～2 关 灵/凡、第 3～4 关 宝/灵、第 5 关起 仙/宝。`
     - 新增「功勋」行：`功勋：每关按伤害占比发放 = max(2, 10 × 关卡系数 × √占比)，击退减半；可兑换 玄铁（4）、灵品（25）、宝品（70）、仙品（200）装备，装备自选部位。`
   - 样式：复用面板里已有的 class（`boss-rules`、`boss-reward-table`、`boss-quiet-button` 等）；新 class 需要的话写在该组件自己的 `<style scoped>` 里，照现有配色变量；窄屏（≤ 480px）表格不能横向溢出。
5. **`data/changelog.ts`**：在最前面加一条（id 用 `'2026-09-26-boss'`，time 写实际开发日期 + 时间）：

   ```ts
   {
     id: '2026-09-26-boss',
     time: '2026-09-26 12:00',
     title: '讨伐：掉落人人有份，新增功勋兑换',
     items: [
       '装备掉落不再只给伤害第一：每个参与宗门按伤害占比各自判定，高档装备概率 = 75% × √占比。',
       '伤害占比不足 15% 的宗门，每关也能得 1 个玄铁。',
       '新增「功勋」：每关按伤害占比发放，可在讨伐面板兑换玄铁与灵品 / 宝品 / 仙品装备（自选部位）。',
       '出手冷却由 10 秒缩短为 3 秒；普通受伤概率下调（体魄 50 时 8% → 3%）。',
     ],
   },
   ```

   （最后一条是已上线但尚未写进更新说明的改动，一并补上。）

---

## 7. 测试

先跑一遍现有测试确认基线全绿，再开始改。**只修改因本期规则变化而必然失效的断言**，不要删测试或放宽无关断言。

### 7.1 纯规则测试

- `tests/game/equipment-rules.test.ts`：
  - `bossHighDropChance`：1 → 0.75；0.25 → 0.375；0.04 → 0.15；0 → 0；负数 → 0；1.5 → 0.75（`toBeCloseTo`）。
  - `rollBossDrop`（用文件里现成的随机序列工具，若无就写一个按顺序吐值的 `sequence`）：
    - stage 5，share 1，随机 `[0.74]` → `'immortal'`；
    - stage 5，share 1，随机 `[0.76, 0.39]` → `'treasure'`；
    - stage 5，share 1，随机 `[0.76, 0.4]` → `null`；
    - stage 1，share 0.25，随机 `[0.37]` → `'spirit'`；`[0.38, 0.1]` → `'common'`；
    - share 0 → `null`，且随机源一次都没被调用。
  - `bossXuantieFor`：原有 `share 0.14 → 0` 的断言改为 `→ 1`；新增 `share 0.14 击退 → 0`、`share 0 → 0`；其余原断言保持。
  - `bossDropDescription(1/3/5)`：改为 3.1 第 6 条的新文案。
- `tests/game/world-boss-rules.test.ts`：
  - `worldBossMeritFor`：2.3 参考值表逐条断言。
  - `WORLD_BOSS_MERIT_SHOP`：四项价格 4 / 25 / 70 / 200；`findMeritShopItem('xxx')` 为 undefined。

### 7.2 服务端集成测试

- `apps/server/test/world-boss.test.ts`：
  - 「击杀发奖」用例：追加断言功勋入账——单宗门、第 2 关、share 100% → `bossMerit` 余额 +15000，天机录 `effects.bossMerit === '15000'`。
  - 「击退」用例：追加功勋减半断言（按该用例的关卡与占比算）。
  - 「不足 70% 逃走」用例：功勋不变。
  - 新增：两个宗门参与、一家占比 < 15% → 该宗门玄铁 +1000（击杀）。占比用 `world_boss_hits` 实际数据算出来再断言，不要猜。
  - 新增一组「功勋兑换」（直接调 `exchangeBossMerit`，余额用 SQL 直接写 `resource_balances`）：
    - 功勋不足 → `INSUFFICIENT_RESOURCE`；
    - 玄铁 ×3：功勋 −12000、玄铁 +3000；
    - 灵品兵器：功勋 −25000，`equipment` 表多一行 quality `spirit`、slot `weapon`、source `boss`、`disciple_id` 为 null；
    - 法器不带 mainAttr → `VALIDATION_ERROR`；兵器带 mainAttr → `VALIDATION_ERROR`；玄铁带 slot → `VALIDATION_ERROR`；装备 quantity 2 → `VALIDATION_ERROR`；
    - 背包满（直接插 50 件未穿戴装备）→ `INVALID_STATUS`，功勋未扣；
    - 仙品：全服广播一条含「以功勋兑换」的系统消息；
    - 路由层：`POST /api/v1/game/world-boss/exchange` 多余字段 → 400（照「出手入参校验」用例写）。
  - 面板用例：`getWorldBoss` 返回里有 `meritShop`（4 项）、`myDrop`（出手前 share 0 / highChance 0）、`rewardPreview.meritFullShare`。
- `apps/server/test/equipment.test.ts`「世界 Boss 装备掉落」相关用例按新规则改写：
  - 随机数 `0` → 两家都掉高档品质；
  - 随机数 `0.99` → 两家都不掉；
  - 单宗门（share 100%）第 5 关、随机数 0.5 → 掉仙品并广播（0.5 < 0.75）；
  - 单宗门的用例（仙品广播、背包满自动分解）：share 100% 时高档概率 75%，原来的随机数 0.5 仍然会掉，保持不变即可。
  - 注意随机数 `0` 也会让出手时的受伤判定命中（0 < 3%），弟子会受伤但伤害照算，不影响掉落断言；如有用例因此失败，改用 `0.05`（高于体魄 50 时的受伤概率 3%，又低于两家的高档概率）。
  - `killBossWithTwoSects` 等夹具可以保留，注释里「第 1 名必掉」之类的描述要同步改。
- 新宗门：建宗后 `state.resources` 里有 `bossMerit`，余额 `'0'`（加在任一现有的建宗 / 同步用例里即可）。

---

## 8. 容易踩的坑

1. 改了 game-config 却没改版本号 / 哈希 / seed → `config-integrity.test.ts` 失败。三处必须一致。
2. 功勋、玄铁、装备的金额都是**最小单位**入库（× 1000），价目表 `cost` 是展示单位。
3. `rewardWorldBoss` 里所有写库语句必须进同一个 `statements` 数组、同一个 `db.batch`，不要单独 `await` 写库（发奖必须「要么全成功、要么全不发」）。
4. `exchangeBossMerit` 必须走 `draft` + `draft.commit()`（带快照守卫），不要直接拼 SQL 扣余额。
5. 部位 / 主属性校验要**抽公共函数**与炼器共用，不要复制一份。
6. 前端不要硬编码价格、概率公式或品质表：价格来自 `panel.meritShop`，概率来自 `panel.myDrop`，说明文字来自 `rewardPreview`。唯一例外是 `RULES_TEXT` 这段静态说明文字。
7. `Math.random` 在集成测试里是 mock 成常数的，改掉落判定后要重新推算现有用例的预期，别盲目改数字让它通过。

---

## 9. 完成标准

在 worktree 根目录依次执行，全部通过：

```bash
npm run typecheck
npm run test:unit
npm run build:node
```

然后在分支 `feat/world-boss-v3` 上提交（一个提交即可，提交信息用中文，照仓库近期提交的风格，例如 `feat: 世界Boss三期（掉落人人有份 + 功勋兑换）`，正文分条列出改动）。**不要 push。**

最终汇报需包含：
- 改了哪些文件（按服务端 / 前端 / 测试 / 迁移分组）；
- 三条命令的结果；
- 第 7 节里哪些用例是改写的、为什么；
- 本计划没覆盖、你做了取舍或没做的地方（没有就写「无」）。
