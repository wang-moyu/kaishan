<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { CSSProperties } from 'vue';

import type {
  SectStateView,
  WorldBossHitView,
  WorldBossMemberOutcomeView,
  WorldBossView,
} from '../api/game';
import { attackWorldBoss, fetchWorldBoss } from '../api/game';
import { formatAmount } from '../utils/format';
import { severeRiskPercent } from '../utils/worldBossRisk';
import { selectionBlockReason } from '../utils/discipleFilter';
import DisciplePicker from './DisciplePicker.vue';
import ModalShell from './ModalShell.vue';

/**
 * 0027 世界 Boss（讨伐，二期）面板（计划 §阶段三）。
 *
 * 只在「打开时 / 出手后 / 点刷新」请求接口，**不做定时轮询**；
 * 「距结束」与「出手冷却」都是拿到数据后由前端计时器自己走（每秒递减，不再发请求）。
 */
const props = defineProps<{
  state: SectStateView;
  busy?: boolean;
}>();

const emit = defineEmits<{
  'state-update': [state: SectStateView];
  notify: [tone: 'success' | 'warning', title: string, message: string];
}>();

const panel = ref<WorldBossView | null>(null);
const loading = ref(false);
const submitting = ref(false);
const selected = ref<string[]>([]);
const showRules = ref(false);
/** 奖励说明：各名次能拿到什么（数字由服务端按本宗门产出算好）。 */
const showRewards = ref(false);

function toggleRules(): void {
  showRules.value = !showRules.value;
  if (showRules.value) showRewards.value = false;
}

function toggleRewards(): void {
  showRewards.value = !showRewards.value;
  if (showRewards.value) showRules.value = false;
}

function rankLabel(rank: number): string {
  return rank >= 4 ? '第 4 名及以后' : `第 ${String(rank)} 名`;
}
/** 词缀气泡：点标签展开「一行效果 + 一行配队提示」。 */
const showAffixTip = ref(false);
/** 伤害榜：默认只显示前 3 名。 */
const showAllRanks = ref(false);
/** 出手记录：默认折叠。 */
const showHits = ref(false);
/** 最近一次出手的逐人判定（结果区常驻到下次出手 / 刷新）。 */
const lastOutcomes = ref<WorldBossMemberOutcomeView[]>([]);
const lastAttack = ref<{
  actualDamage: number;
  crit: boolean;
  lastHit: boolean;
  nextStage: number | null;
} | null>(null);

/** 被击中：`hitKey` 每次 +1 让抖动的 CSS 动画重新播放，飘字 0.9 秒后消失。 */
const hitKey = ref(0);
const hit = ref<{ damage: number; crit: boolean } | null>(null);
let hitTimer: number | null = null;

const boss = computed(() => panel.value?.boss ?? null);

const hpPercent = computed(() => {
  const current = boss.value;
  if (current === null || current.maxHp <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current.hp / current.maxHp) * 100)));
});

/** Boss 主色：印章与血条共用的 CSS 变量（未出现时给一个中性色）。 */
const sealStyle = computed<CSSProperties>(() => ({
  '--boss-color': boss.value?.def.color ?? '#7a8c6e',
}));

/* ---------- 两个本地倒计时（距结束 / 出手冷却） ---------- */

const remaining = ref(0);
const cooldown = ref(0);
let closesAtMs = 0;
let cooldownAtMs = 0;
let countdownTimer: number | undefined;

function tickCountdown(): void {
  const now = Date.now();
  remaining.value = Math.max(0, Math.ceil((closesAtMs - now) / 1000));
  cooldown.value = Math.max(0, Math.ceil((cooldownAtMs - now) / 1000));
  if (remaining.value <= 0 && cooldown.value <= 0) stopCountdown();
}

function startCountdown(): void {
  stopCountdown();
  tickCountdown();
  if (remaining.value <= 0 && cooldown.value <= 0) return;
  countdownTimer = window.setInterval(tickCountdown, 1000);
}

function stopCountdown(): void {
  if (countdownTimer !== undefined) {
    window.clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

/** 拿到面板数据：把「剩余秒数 / 冷却秒数」换算成绝对截止时刻再每秒回算（后台标签页节流也不会走偏）。 */
function applyPanel(data: WorldBossView): void {
  panel.value = data;
  const now = Date.now();
  closesAtMs = now + data.remainingSeconds * 1000;
  cooldownAtMs = now + data.cooldownSeconds * 1000;
  startCountdown();
}

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  // 开放时段长达 15 小时，超过 1 小时要显示成 8:37:50，而不是 517:50。
  return h > 0 ? `${String(h)}:${mmss}` : mmss;
}

/* ---------- 展示 ---------- */

/** 词缀标签颜色（狂暴用醒目的红）。 */
const AFFIX_COLORS: Record<string, string> = {
  ironclad: '#8fa79b',
  swift: '#6fb6d9',
  brute: '#d98a4a',
  eerie: '#a98ad9',
  berserk: '#d9534f',
};

const affixColor = computed(() => AFFIX_COLORS[boss.value?.affix.id ?? ''] ?? '#8fa79b');

const statusText = computed(() => {
  const current = boss.value;
  if (current === null) {
    return panel.value !== null && panel.value.phase === 'closed'
      ? '今日已结束，明日 08:00 再临'
      : '未出现：08:00 降临';
  }
  if (current.status === 'killed') {
    return current.killerSectName === null ? '已击杀' : `已击杀（${current.killerSectName} 最后一击）`;
  }
  if (current.status === 'fled') {
    return current.fledOutcome === 'repelled' ? '已击退' : '已逃走';
  }
  if (current.phase === 'closed' || remaining.value <= 0) return '已结束，点击刷新';
  return current.phase === 'frenzy' ? '力竭中 ×1.5' : '讨伐中';
});

const canAttack = computed(
  () =>
    (panel.value?.attackable ?? false) &&
    remaining.value > 0 &&
    cooldown.value === 0 &&
    selected.value.length > 0 &&
    !submitting.value &&
    props.busy !== true,
);

/** 今日出手次数已用满（上限由服务端下发；0 = 不限）。 */
const attackLimitReached = computed(() => {
  const limit = panel.value?.dailyAttackLimit ?? 0;
  return limit > 0 && (panel.value?.attacksToday ?? 0) >= limit;
});

const attackButtonText = computed(() => {
  if (attackLimitReached.value) return '今日出手次数已用完';
  if (cooldown.value > 0) return `冷却 ${String(cooldown.value)}s`;
  return `出手讨伐（已选 ${String(selected.value.length)} 人）`;
});

/** 伤害是换算前的原始数字（不走 formatAmount 的千分位换算）。 */
function formatDamage(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '0';
}

/**
 * 时刻一律按 **UTC+8** 渲染（业务日就是 UTC+8）：
 * 不用浏览器本地时区，否则跨时区的玩家看到的出手时刻会与业务日对不上。
 */
function timeUtc8(ms: number): string {
  const shifted = new Date(ms + 8 * 3_600_000);
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 出战弟子超过 3 人时不逐个列名，写「门下 N 名弟子」（一次最多 10 人，全列出来太长）。 */
function partyLabel(names: readonly string[]): string {
  return names.length > 3 ? `门下 ${String(names.length)} 名弟子` : names.join('、');
}

/** 出手记录一行：`21:32  乾坤门 · 白折月、墨明烛 联手打出 9,870 【暴击】【受伤：墨明烛】`。 */
function hitLine(entry: WorldBossHitView): string {
  const names = partyLabel(entry.discipleNames);
  const verb = entry.discipleNames.length > 1 ? '联手打出' : '打出';
  const allSevere = entry.damage === 0 && entry.severeNames.length === entry.discipleNames.length;
  const body = allSevere ? '全员重伤，未造成伤害' : `${verb} ${formatDamage(entry.damage)}`;
  const tags = `${entry.isCrit ? '【暴击】' : ''}${entry.isLastHit ? '【最后一击】' : ''}`;
  const harm = `${entry.injuredNames.length > 0 ? `【受伤：${entry.injuredNames.join('、')}】` : ''}${entry.severeNames.length > 0 ? `【重伤：${entry.severeNames.join('、')}】` : ''}`;
  return `${timeUtc8(entry.createdAt)}  ${entry.sectName} · ${names} ${body} ${tags}${harm}`.trim();
}

const visibleRanks = computed(() => {
  const ranks = panel.value?.ranks ?? [];
  return showAllRanks.value ? ranks : ranks.slice(0, 3);
});

/**
 * 三期：本关掉落概率一行（Boss 在讨伐中才有意义，与伤害榜一起显示；与出手同一套「还没结束」判定）。
 * 占比与概率都来自服务端 myDrop，这里只把 0~1 的小数四舍五入成整数百分比。
 */
const dropLine = computed<string | null>(() => {
  const current = boss.value;
  const drop = panel.value?.myDrop ?? null;
  if (current === null || current.status !== 'active' || remaining.value <= 0 || drop === null) return null;
  const percent = (value: number) => `${String(Math.round(value * 100))}%`;
  // 括注里的 40% 是计划里的固定低档概率（服务端的掉落说明文案同口径），前端只照抄。
  return `本关伤害占比 ${percent(drop.damageShare)}，击杀时 ${drop.highQualityName}装备概率 ${percent(drop.highChance)}（未得时 40% 得 ${drop.lowQualityName}装备）`;
});

async function refresh(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  try {
    const data = await fetchWorldBoss();
    emit('state-update', data.state);
    applyPanel(data.boss);
  } catch (error) {
    emit('notify', 'warning', '讨伐', error instanceof Error ? error.message : '面板加载失败');
  } finally {
    loading.value = false;
  }
}

/* ---------- 一键选人 ---------- */

/** 词缀 → 加伤害的属性（铁甲 / 迅捷 / 蛮力）；其余词缀按战力排。 */
const AFFIX_DAMAGE_ATTR: Record<string, 'defense' | 'speed' | 'attack'> = {
  ironclad: 'defense',
  swift: 'speed',
  brute: 'attack',
};

/**
 * 自动挑最多 10 名「安全」弟子：能出战（不在外、不疗伤、不重伤）且本小时出战不到 3 次（不会冒进）。
 * 排序 ≈ 伤害：战力 ×（1 + 对应属性（含装备）× 0.5%），与服务端词缀加成同一口径。
 */
function autoPick(): void {
  const affixAttr = AFFIX_DAMAGE_ATTR[boss.value?.affix.id ?? ''];
  const now = Date.now();
  const score = (disciple: (typeof props.state.disciples)[number]): number => {
    if (affixAttr === undefined) return disciple.combatPower;
    const value = disciple[affixAttr] + (disciple.gear?.[affixAttr] ?? 0);
    return disciple.combatPower * (1 + value * 0.005);
  };
  selected.value = props.state.disciples
    .filter((disciple) => selectionBlockReason(disciple, now, { blockInjured: true, blockAway: true }) === null)
    .filter((disciple) => (panel.value?.fatigue[disciple.id] ?? 0) < 3)
    .sort((a, b) => score(b) - score(a))
    .slice(0, 10)
    .map((disciple) => disciple.id);
}

/* ---------- 冒进二次确认 ---------- */

const isBerserk = computed(() => boss.value?.affix.id === 'berserk');

/** 已选弟子里有重伤风险的（本小时已出战 ≥3 次）：名字 + 概率。 */
const riskyPicks = computed(() =>
  selected.value
    .map((id) => props.state.disciples.find((disciple) => disciple.id === id))
    .filter((disciple): disciple is NonNullable<typeof disciple> => disciple !== undefined)
    .map((disciple) => ({
      name: disciple.name,
      risk: severeRiskPercent(panel.value?.fatigue[disciple.id] ?? 0, disciple.physique, isBerserk.value),
    }))
    .filter((pick) => pick.risk > 0),
);

const confirmRisk = ref(false);

function onAttackClick(): void {
  if (!canAttack.value) return;
  if (riskyPicks.value.length > 0) {
    confirmRisk.value = true;
    return;
  }
  void submit();
}

function confirmAttack(): void {
  confirmRisk.value = false;
  void submit();
}

async function submit(): Promise<void> {
  if (!canAttack.value) return;
  submitting.value = true;
  try {
    const data = await attackWorldBoss(selected.value);
    emit('state-update', data.state);
    applyPanel(data.boss);

    hitKey.value += 1;
    hit.value = { damage: data.result.actualDamage, crit: data.result.crit };
    if (hitTimer !== null) window.clearTimeout(hitTimer);
    hitTimer = window.setTimeout(() => {
      hit.value = null;
    }, 900);

    lastOutcomes.value = data.result.members;
    lastAttack.value = {
      actualDamage: data.result.actualDamage,
      crit: data.result.crit,
      lastHit: data.result.lastHit,
      nextStage: data.result.nextStage,
    };
    selected.value = [];

    const parts = [`造成 ${formatDamage(data.result.actualDamage)} 伤害`];
    if (data.result.crit) parts.push('暴击');
    if (data.result.frenzy) parts.push('力竭 ×1.5');
    if (data.result.lastHit) parts.push('最后一击');
    const harmed = data.result.members.filter((member) => member.outcome !== 'normal');
    for (const member of harmed) {
      parts.push(`${member.discipleName}${member.outcome === 'severe' ? '重伤' : '受伤'}`);
    }
    if (data.result.nextStage !== null) parts.push(`第 ${String(data.result.nextStage)} 关已降临`);
    emit('notify', data.result.members.every((member) => member.outcome === 'severe') ? 'warning' : 'success', '讨伐', parts.join(' · '));
  } catch (error) {
    emit('notify', 'warning', '讨伐', error instanceof Error ? error.message : '出手失败，请稍后再试');
  } finally {
    submitting.value = false;
  }
}

/** 点了别处就收掉词缀气泡。 */
function onDocumentClick(): void {
  showAffixTip.value = false;
}

onMounted(() => {
  void refresh();
  document.addEventListener('click', onDocumentClick);
});

onUnmounted(() => {
  stopCountdown();
  document.removeEventListener('click', onDocumentClick);
  if (hitTimer !== null) window.clearTimeout(hitTimer);
});

const RULES_TEXT = `讨伐 · 玩法说明

连战：每天 08:00 第 1 关降临，打死立刻出下一关（第 1 关血量 = 一轮伤害 × 2，之后每关 ×1.6）；
      23:00 当前关逃走，血量被打掉 70% 以上记为「击退」。
出手：同一宗门每 3 秒只能出手一次，每天出手次数有上限（出手按钮下方可见）；每次派 1~10 名弟子（可点「一键选人」）。
弟子：在外历练 / 疗伤中 / 重伤卧床的弟子不能出战。
受伤：概率 = 3% −（体魄 − 50）/10 × 1%，夹在 1%~8%；受伤后疗伤 30 分钟，回春丹可治。
重伤：本小时第 4 次出手 30%、第 5 次 70%、第 6 次起必定重伤（体魄每高 10 点让前两档下调 3 个百分点）；
      被打成重伤要静养 1 天 —— 期间不产出、不修炼，转岗/破境/服丹/历练/秘境/挑战/论道/讨伐全都不行，丹药无效；
      被判重伤的那一刀不计伤害。
词缀：每关随机一个 ——
      铁甲：防御越高，伤害越高（派防御高的弟子）
      迅捷：身法越高，伤害越高（派身法高的弟子）
      蛮力：攻击越高，伤害越高（派攻击高的弟子）
      邪祟：暴击率翻倍（派幸运高的弟子）
      狂暴：受伤、重伤概率翻倍（派体魄高的弟子，别贪刀）
奖励：每关单独结算 —— 参与宗门各得自己 2.5 小时产出的 灵石/药材/矿石（伤害第 1/2/3 名额外 ×1.5/1.25/1.1），
      每往后一关奖励 +30%，第 5 关起不再增加；入账不超过资源容量，仓库满了多出的部分作废；具体数字点「奖励」查看；
      击杀时每个参与宗门再得聚气丹 ×1、伤害第 1 名得淬体丹 ×1、最后一击另有灵石；
      击退时资源减半、没有丹药与最后一击；不足 70% 逃走则什么也不发。
玄铁：本关伤害占比 ≥15% 按表发放（击退减半），不足则每关 1 个；
掉落：每关击杀时，每个参与宗门按伤害占比各自判定 —— 高档装备概率 = 75% × √占比，未得时 40% 概率得低档装备；第 1～2 关 灵/凡、第 3～4 关 宝/灵、第 5 关起 仙/宝。
功勋：每关按伤害占比发放 = max(2, 10 × 关卡系数 × √占比)，击退减半；在首页「功勋」里兑换玄铁与装备（装备自选部位）。`;
</script>

<template>
  <section class="boss-panel" aria-labelledby="world-boss-title">
    <div class="boss-head">
      <h3 id="world-boss-title" class="boss-title">
        <span>{{ boss?.def.displayName ?? '讨伐' }}</span>
        <span v-if="panel" class="boss-day">{{ panel.boss?.dayKey ?? '' }}</span>
      </h3>
      <div class="boss-head-actions">
        <span v-if="panel && remaining > 0" class="boss-countdown">
          距结束 {{ formatCountdown(remaining) }}
        </span>
        <button class="boss-quiet-button" type="button" @click="toggleRewards">
          {{ showRewards ? '收起奖励' : '奖励' }}
        </button>
        <button class="boss-quiet-button" type="button" @click="toggleRules">
          {{ showRules ? '收起说明' : '说明' }}
        </button>
        <button class="boss-quiet-button" type="button" :disabled="loading" @click="refresh">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div v-if="showRules" class="boss-rules">
      <p class="boss-rules-text">{{ RULES_TEXT }}</p>
    </div>

    <div v-else-if="showRewards" class="boss-rules">
      <template v-if="panel?.rewardPreview">
        <p class="boss-reward-title">第 {{ panel.rewardPreview.stage }} 关击杀奖励（按你宗门当前产出计算）</p>
        <table class="boss-reward-table">
          <thead>
            <tr><th>伤害名次</th><th>灵石</th><th>药材</th><th>矿石</th><th>玄铁</th><th>丹药</th></tr>
          </thead>
          <tbody>
            <tr v-for="tier in panel.rewardPreview.tiers" :key="tier.rank">
              <td>{{ rankLabel(tier.rank) }} <small>×{{ tier.multiplier }}</small></td>
              <td>{{ formatAmount(String(tier.resources.spiritStone ?? 0)) }}</td>
              <td>{{ formatAmount(String(tier.resources.herb ?? 0)) }}</td>
              <td>{{ formatAmount(String(tier.resources.ore ?? 0)) }}</td>
              <td>{{ tier.rank === 1 ? panel.rewardPreview.xuantie.top : panel.rewardPreview.xuantie.others }}</td>
              <td>{{ tier.topDamagePill ? '聚气丹、淬体丹' : '聚气丹' }}</td>
            </tr>
          </tbody>
        </table>
        <ul class="boss-reward-notes">
          <li>最后一击：另得灵石 {{ formatAmount(String(panel.rewardPreview.lastHitStone)) }}</li>
          <li>玄铁：本关伤害占比 ≥{{ panel.rewardPreview.xuantie.minSharePercent }}% 按表发放（击退减半），不足则每关 {{ panel.rewardPreview.xuantie.below }} 个</li>
          <!-- 三期功勋：满占比能拿多少来自服务端 meritFullShare，实际按 √占比 折算、保底 2。 -->
          <li>功勋：max(2, {{ panel.rewardPreview.meritFullShare }} × √伤害占比)，击退减半；可在首页「功勋」里兑换玄铁与装备</li>
          <li>每往后一关，资源奖励 +30%（第 5 关起不再增加）；入账不超过资源容量，溢出作废</li>
          <li>击退（打掉 70% 以上没打死）：资源减半，无丹药；不足 70% 逃走：无奖励</li>
          <!-- 0028 装备掉落说明：文案由服务端按当前关卡的品质表拼好，前端直接渲染。 -->
          <li v-if="panel.rewardPreview.dropDescription" class="boss-reward-drop">
            掉落：{{ panel.rewardPreview.dropDescription }}
          </li>
        </ul>
      </template>
      <p v-else class="boss-empty">奖励信息加载中…</p>
    </div>

    <template v-else>
      <!-- 连战战绩 + 史上最强一击（常驻） -->
      <p class="boss-record">
        <span class="boss-record-label">今日已连斩</span>
        <strong class="boss-record-who">{{ panel?.killedToday ?? 0 }} 只</strong>
        <span class="boss-record-label">史上最高</span>
        <strong class="boss-record-who">{{ panel?.bestStage ?? 0 }} 只 / 天</strong>
        <span class="boss-record-label boss-record-sep">史上最强一击</span>
        <template v-if="panel?.topHit">
          <strong class="boss-record-who">
            {{ panel.topHit.sectName }} · {{ partyLabel(panel.topHit.discipleNames) }}
          </strong>
          <span class="boss-record-damage">{{ formatDamage(panel.topHit.damage) }}</span>
        </template>
        <span v-else class="boss-record-empty">暂无</span>
      </p>

      <!-- Boss 区 -->
      <div class="boss-stage">
        <div class="boss-seal-wrap">
          <svg
            class="boss-seal"
            :class="{ 'is-hit': hit !== null }"
            :style="sealStyle"
            viewBox="0 0 120 120"
            aria-hidden="true"
          >
            <circle class="boss-seal-ring" cx="60" cy="60" r="54" />
            <circle class="boss-seal-face" cx="60" cy="60" r="44" />
            <text class="boss-seal-text" x="60" y="62" text-anchor="middle" dominant-baseline="middle">
              {{ boss?.def.sealCharacter ?? '？' }}
            </text>
          </svg>
          <span v-if="hit" :key="hitKey" class="boss-damage-float" :class="{ 'is-crit': hit.crit }">
            {{ hit.crit ? '暴击 ' : '' }}{{ formatDamage(hit.damage) }}
          </span>
        </div>

        <div class="boss-info">
          <p class="boss-name">
            <span>{{ boss?.def.displayName ?? '妖王未现' }}</span>
            <span
              v-if="boss && boss.affix.id !== 'none'"
              class="boss-affix"
              :style="{ borderColor: affixColor, color: affixColor }"
              role="button"
              tabindex="0"
              :aria-expanded="showAffixTip"
              @click.stop="showAffixTip = !showAffixTip"
              @keydown.enter.stop="showAffixTip = !showAffixTip"
            >
              {{ boss.affix.name }}
            </span>
          </p>
          <p v-if="boss && showAffixTip" class="boss-affix-tip" :style="{ borderColor: affixColor }">
            {{ boss.affix.effect }}
            <br />
            {{ boss.affix.tip }}
          </p>
          <p class="boss-desc">
            {{ boss?.def.description ?? '每日 08:00 妖王降临，全服共讨之。' }}
          </p>
          <p class="boss-status" :class="{ 'is-down': boss !== null && boss.status !== 'active' }">
            {{ statusText }}
          </p>
          <template v-if="boss">
            <div
              class="boss-hp"
              role="progressbar"
              :aria-valuenow="hpPercent"
              aria-valuemin="0"
              aria-valuemax="100"
              :style="sealStyle"
            >
              <div class="boss-hp-fill" :style="{ width: `${hpPercent}%` }"></div>
            </div>
            <p class="boss-hp-text">
              {{ formatDamage(boss.hp) }} / {{ formatDamage(boss.maxHp) }}（{{ hpPercent }}%）
            </p>
          </template>
        </div>
      </div>

      <!-- 出手结果：本次受伤 / 重伤名单 -->
      <div v-if="lastAttack !== null" class="boss-outcome">
        <p class="boss-outcome-line">
          本次出手：{{ formatDamage(lastAttack.actualDamage) }} 伤害
          <span v-if="lastAttack.crit">· 暴击</span>
          <span v-if="lastAttack.lastHit">· 最后一击</span>
          <span v-if="lastAttack.nextStage !== null">· 第 {{ lastAttack.nextStage }} 关已降临</span>
        </p>
        <p v-if="lastOutcomes.some((member) => member.outcome !== 'normal')" class="boss-outcome-line">
          <span
            v-for="member in lastOutcomes.filter((item) => item.outcome !== 'normal')"
            :key="member.discipleId"
            class="boss-outcome-member"
            :class="{ 'is-severe': member.outcome === 'severe' }"
          >
            {{ member.discipleName }}{{ member.outcome === 'severe' ? '重伤' : '受伤' }}
          </span>
        </p>
        <p v-else class="boss-outcome-line is-quiet">门下弟子均无大碍。</p>
      </div>

      <!-- 出手区 -->
      <DisciplePicker
        v-model:selected="selected"
        :disciples="state.disciples"
        :min="1"
        :max="10"
        :busy="submitting || busy === true"
        sort="power"
        title="选择出战弟子"
        :fatigue="panel?.fatigue"
        :fatigue-times="panel?.fatigueTimes"
        :extra-sort="boss?.affix.sortAttribute"
        :berserk="isBerserk"
      >
        <template #actions>
          <button class="quiet-button" type="button" :disabled="submitting || busy === true" @click="autoPick">
            一键选人
          </button>
        </template>
      </DisciplePicker>

      <button class="boss-attack-button" type="button" :disabled="!canAttack" @click="onAttackClick">
        <span v-if="submitting">讨伐中…</span>
        <span v-else>{{ attackButtonText }}</span>
      </button>
      <p v-if="panel && panel.dailyAttackLimit > 0" class="boss-attack-count">
        今日出手 {{ panel.attacksToday }} / {{ panel.dailyAttackLimit }}
      </p>

      <!-- 本关伤害榜 -->
      <section class="boss-section">
        <h4 class="boss-section-title">本关伤害榜</h4>
        <!-- 三期：本关掉落概率（占比与概率都来自服务端 myDrop，只有 Boss 在讨伐中才显示）。 -->
        <p v-if="dropLine !== null" class="boss-drop-line">{{ dropLine }}</p>
        <p v-if="panel === null || panel.ranks.length === 0" class="boss-empty">还没有人出手。</p>
        <template v-else>
          <ul class="boss-ranks">
            <li
              v-for="(rank, index) in visibleRanks"
              :key="rank.sectId"
              class="boss-rank"
              :class="{ 'is-me': rank.isMe }"
            >
              <span class="boss-rank-no">{{ index + 1 }}</span>
              <strong class="boss-rank-name">{{ rank.sectName }}</strong>
              <span class="boss-rank-damage">{{ formatDamage(rank.damage) }}</span>
              <span class="boss-rank-attempts">{{ rank.attempts }} 次</span>
              <span v-if="rank.isTopDamage" class="boss-tag">最高伤害</span>
              <span v-if="rank.isLastHit" class="boss-tag">最后一击</span>
            </li>
          </ul>
          <button
            v-if="panel.ranks.length > 3"
            class="boss-quiet-button boss-more-button"
            type="button"
            @click="showAllRanks = !showAllRanks"
          >
            {{ showAllRanks ? '只看前 3 名' : `显示全部 ${panel.ranks.length} 个宗门` }}
          </button>
        </template>
      </section>

      <!-- 出手记录（默认折叠） -->
      <section class="boss-section">
        <button
          class="boss-quiet-button boss-more-button"
          type="button"
          @click="showHits = !showHits"
        >
          {{ showHits ? '收起出手记录' : `展开出手记录（${panel?.hits.length ?? 0} 条）` }}
        </button>
        <template v-if="showHits">
          <p v-if="panel === null || panel.hits.length === 0" class="boss-empty">还没有出手记录。</p>
          <ul v-else class="boss-hits">
            <li
              v-for="entry in panel.hits"
              :key="`${entry.createdAt}-${entry.sectId}-${entry.damage}-${entry.discipleNames.join()}`"
              class="boss-hit"
            >
              {{ hitLine(entry) }}
            </li>
          </ul>
        </template>
      </section>
    </template>

    <!-- 冒进二次确认：已选弟子里有重伤风险时，点「出手」先弹这里 -->
    <ModalShell v-if="confirmRisk" narrow label="重伤风险确认" @close="confirmRisk = false">
      <section class="boss-risk-card" aria-labelledby="boss-risk-title">
        <h2 id="boss-risk-title" class="disciple-detail-title">重伤风险</h2>
        <p class="boss-risk-text">以下弟子本小时已多次出战，这次出手可能重伤：</p>
        <ul class="boss-risk-list">
          <li v-for="pick in riskyPicks" :key="pick.name">
            <strong>{{ pick.name }}</strong>
            <span>{{ pick.risk >= 100 ? '必定重伤' : `重伤概率 ${pick.risk}%` }}</span>
          </li>
        </ul>
        <p class="boss-risk-text">重伤需静养 <b>1 天</b>：期间不产出、不修炼、不能做任何事，丹药无效，且这一刀不计伤害。</p>
        <div class="boss-risk-actions">
          <button class="action-button" type="button" @click="confirmRisk = false">取消</button>
          <button class="action-button primary-action" type="button" @click="confirmAttack">仍然出手</button>
        </div>
      </section>
    </ModalShell>
  </section>
</template>

<style scoped>
.boss-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.boss-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.boss-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  color: var(--gold-bright, #ead19a);
  font-size: 16px;
  font-weight: 600;
}

.boss-day {
  color: #8fa79b;
  font-size: 12px;
  font-weight: 400;
}

.boss-head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.boss-countdown {
  color: var(--gold, #caa96a);
  font-size: 12px;
}

.boss-quiet-button {
  padding: 2px 10px;
  border: 1px solid rgba(202, 169, 106, 0.4);
  border-radius: 2px;
  background: rgba(202, 169, 106, 0.08);
  color: var(--gold, #caa96a);
  font-size: 12px;
  cursor: pointer;
}

.boss-quiet-button:hover:not(:disabled) {
  background: rgba(202, 169, 106, 0.16);
}

.boss-quiet-button:disabled {
  color: #63756c;
  cursor: not-allowed;
}

.boss-more-button {
  align-self: flex-start;
}

.boss-risk-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.boss-risk-text {
  margin: 0;
  color: #c8d6ce;
  font-size: 13px;
  line-height: 1.7;
}

.boss-risk-text b {
  color: #e8664e;
}

.boss-risk-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.boss-risk-list li {
  display: flex;
  justify-content: space-between;
  padding: 6px 10px;
  border: 1px solid rgba(232, 102, 78, 0.35);
  border-radius: 3px;
  background: rgba(232, 102, 78, 0.08);
  font-size: 13px;
}

.boss-risk-list li span {
  color: #e8664e;
}

.boss-risk-actions {
  display: flex;
  gap: 10px;
}

.boss-risk-actions .action-button {
  flex: 1 1 0;
}

.boss-reward-title {
  margin: 0 0 8px;
  color: var(--gold, #caa96a);
  font-size: 13px;
}

.boss-reward-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.boss-reward-table th,
.boss-reward-table td {
  padding: 5px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: #c8d6ce;
  text-align: right;
  white-space: nowrap;
}

.boss-reward-table th {
  color: #8fa79b;
  font-weight: 600;
}

.boss-reward-table th:first-child,
.boss-reward-table td:first-child,
.boss-reward-table th:last-child,
.boss-reward-table td:last-child {
  text-align: left;
}

.boss-reward-table small {
  color: #7d9186;
}

.boss-reward-notes {
  margin: 8px 0 0;
  padding-left: 16px;
  color: #8fa79b;
  font-size: 12px;
  line-height: 1.7;
}

/* 0028 装备掉落说明：与资源奖励区分开（掉落不是资源结算）。 */
.boss-reward-drop {
  color: var(--gold-bright, #e0cd97);
}

/* 三期：本关掉落概率（伤害榜上的一行小字）。 */
.boss-drop-line {
  margin: 0;
  color: #9fb2a8;
  font-size: 12px;
  line-height: 1.6;
}

.boss-rules-text {
  margin: 0;
  color: #c8d6ce;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.boss-record {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  padding: 6px 10px;
  border: 1px solid var(--line, rgba(202, 169, 106, 0.2));
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
  font-size: 12px;
}

.boss-record-label {
  flex: 0 0 auto;
  color: #8fa79b;
}

.boss-record-sep {
  margin-left: 6px;
}

.boss-record-who {
  color: var(--gold-bright, #ead19a);
}

.boss-record-damage {
  color: #e8b96a;
  font-weight: 600;
}

.boss-record-empty {
  color: #6d8078;
}

.boss-stage {
  display: flex;
  align-items: center;
  gap: 16px;
}

.boss-seal-wrap {
  position: relative;
  flex: 0 0 auto;
}

.boss-seal {
  width: 104px;
  height: 104px;
  filter: drop-shadow(0 0 10px color-mix(in srgb, var(--boss-color, #7a8c6e) 55%, transparent));
}

.boss-seal.is-hit {
  animation: boss-shake 420ms ease-in-out;
}

.boss-seal-ring {
  fill: none;
  stroke: var(--boss-color, #7a8c6e);
  stroke-width: 2;
  opacity: 0.85;
}

.boss-seal-face {
  fill: color-mix(in srgb, var(--boss-color, #7a8c6e) 32%, rgba(6, 18, 15, 0.9));
  stroke: var(--boss-color, #7a8c6e);
  stroke-width: 1;
}

.boss-seal-text {
  fill: #f2ecdc;
  font-family: 'STKaiti', 'KaiTi', 'Kaiti SC', 'Kai', serif;
  font-size: 40px;
}

@keyframes boss-shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20% {
    transform: translateX(-6px) rotate(-2deg);
  }
  45% {
    transform: translateX(5px) rotate(2deg);
  }
  70% {
    transform: translateX(-3px);
  }
}

.boss-damage-float {
  position: absolute;
  top: -6px;
  left: 50%;
  color: #e8ddc4;
  font-size: 16px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  white-space: nowrap;
  animation: boss-float 900ms ease-out forwards;
}

.boss-damage-float.is-crit {
  color: #ffd45e;
  font-size: 22px;
}

@keyframes boss-float {
  0% {
    opacity: 0;
    transform: translate(-50%, 6px);
  }
  25% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -34px);
  }
}

.boss-info {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
}

.boss-name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--gold-bright, #ead19a);
  font-size: 15px;
  font-weight: 600;
}

.boss-affix {
  padding: 1px 8px;
  border: 1px solid currentColor;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 11px;
  font-weight: 400;
  cursor: pointer;
}

.boss-affix-tip {
  margin: 0;
  padding: 4px 8px;
  border: 1px solid var(--line, rgba(202, 169, 106, 0.2));
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.02);
  color: #9fb2a8;
  font-size: 11px;
  line-height: 1.6;
}

.boss-desc {
  margin: 0;
  color: #9fb2a8;
  font-size: 12px;
  line-height: 1.6;
}

.boss-status {
  margin: 0;
  color: var(--jade-bright, #77b89a);
  font-size: 12px;
}

.boss-status.is-down {
  color: #b08a5a;
}

.boss-hp {
  height: 8px;
  margin-top: 2px;
  overflow: hidden;
  border: 1px solid var(--line, rgba(202, 169, 106, 0.2));
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.05);
}

.boss-hp-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--boss-color, #7a8c6e) 70%, #d8433a),
    var(--boss-color, #7a8c6e)
  );
  transition: width 420ms ease;
}

.boss-hp-text {
  margin: 0;
  color: #8fa79b;
  font-size: 11px;
}

.boss-outcome {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border: 1px solid rgba(119, 184, 154, 0.28);
  border-radius: 3px;
  background: rgba(119, 184, 154, 0.06);
}

.boss-outcome-line {
  margin: 0;
  color: #cbd8d0;
  font-size: 12px;
  line-height: 1.7;
}

.boss-outcome-line.is-quiet {
  color: #7d8f86;
}

.boss-outcome-member {
  margin-right: 8px;
  color: #d9b06a;
}

.boss-outcome-member.is-severe {
  color: #e06a5f;
}

.boss-attack-button {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 40px;
  border: 1px solid rgba(202, 169, 106, 0.55);
  border-radius: 3px;
  background: rgba(202, 169, 106, 0.12);
  color: var(--gold-bright, #ead19a);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.boss-attack-count {
  /* 面板是 gap 12px 的纵向 flex：往上收一点，让它贴着出手按钮 */
  margin: -6px 0 0;
  color: var(--muted, #92a79d);
  font-size: 12px;
  text-align: center;
}

.boss-attack-button:hover:not(:disabled) {
  border-color: rgba(234, 209, 154, 0.8);
  background: rgba(202, 169, 106, 0.2);
}

.boss-attack-button:disabled {
  border-color: rgba(167, 184, 173, 0.11);
  background: rgba(255, 255, 255, 0.016);
  color: #63756c;
  cursor: not-allowed;
}

.boss-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.boss-section-title {
  margin: 0;
  color: #8fa79b;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
}

.boss-empty {
  margin: 0;
  color: #6d8078;
  font-size: 12px;
}

.boss-ranks,
.boss-hits {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.boss-rank {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid var(--line, rgba(202, 169, 106, 0.2));
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.014);
  font-size: 12px;
}

.boss-rank.is-me {
  border-color: rgba(119, 184, 154, 0.5);
  background: rgba(119, 184, 154, 0.08);
}

.boss-rank-no {
  flex: 0 0 16px;
  color: #6d8078;
}

.boss-rank-name {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: #cbd8d0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.boss-rank-damage {
  color: #e8b96a;
  font-weight: 600;
}

.boss-rank-attempts {
  color: #6d8078;
}

.boss-tag {
  padding: 1px 6px;
  border-radius: 20px;
  background: rgba(202, 169, 106, 0.14);
  color: var(--gold, #caa96a);
  font-size: 11px;
}

.boss-hit {
  color: #a9bcb2;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
}

/* 窄屏：头部按钮多，一律换行，别撑出横向滚动。 */
@media (max-width: 480px) {
  .boss-head,
  .boss-head-actions {
    flex-wrap: wrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .boss-seal.is-hit,
  .boss-damage-float {
    animation: none;
  }

  .boss-hp-fill {
    transition: none;
  }
}
</style>
