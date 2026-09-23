<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { SecretRealmView, SectStateView } from '../api/game';
import { fetchSecretRealms } from '../api/game';
import { formatAmount } from '../utils/format';
import LoadingState from './LoadingState.vue';

/**
 * 秘境列表（弹窗内容）。
 *
 * 只负责按服务端算好的状态把秘境列出来 + 派发「点探索」：
 * 选弟子与真正的结算交给 ExplorePartyDialog / App.vue。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  select: [realm: SecretRealmView];
  /** V6 交互探索：只给 realmId，秘境定义由 SectScreen 自己补一次只读列表请求。 */
  'explore-start': [realmId: string];
  /** 面板顶部「继续探索」：断点已在 state 里，直接打开交互弹窗。 */
  'explore-resume': [];
}>();

const realms = ref<SecretRealmView[]>([]);
const loadError = ref<string | null>(null);
const loading = ref(true);

let loadSeq = 0;

async function loadRealms(): Promise<void> {
  const seq = (loadSeq += 1);
  loading.value = true;
  try {
    const list = await fetchSecretRealms();
    if (seq !== loadSeq) return; // 已有更新的请求在途，丢弃这次过期响应
    realms.value = list;
    loadError.value = null;
  } catch (caught) {
    if (seq !== loadSeq) return;
    loadError.value = caught instanceof Error ? caught.message : '秘境列表加载失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

watch(() => props.state, () => { void loadRealms(); }, { immediate: true });

const resourceNameMap = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);

/** 进行中的交互探索（服务端唯一权威）；非空时两个出发按钮都要让路。 */
const activeExploration = computed(() => props.state.activeExploration);

/** 有没有演武场以服务端算好的 `realms[].hasArena` 为准。 */
const hasArena = computed(() => realms.value.some((realm) => realm.hasArena));

/** 该秘境当前不能探索的原因（null = 可以探索）。 */
function realmBlockedReason(realm: SecretRealmView): string | null {
  if (realm.locked) {
    return `宗门需达 ${realm.requiredSectLevel} 级`;
  }
  if (!realm.hasArena) {
    return '尚无演武场';
  }
  if (realm.dailyLimit !== null && realm.usedToday >= realm.dailyLimit) {
    return `今日次数已用完（${realm.dailyLimit} 次/天）`;
  }
  return null;
}

/**
 * 单个秘境自身能否出发（锁定 / 演武场 / 每日次数）；「已有探索进行中」是宗门级限制，
 * 由 canDepart 叠加，保持这个函数只回答秘境自身的条件。
 */
function canExplore(realm: SecretRealmView): boolean {
  return !props.busy && realmBlockedReason(realm) === null;
}

/** 速通与探索共用的门禁：战场同一时间只能有一支队伍在秘境里。 */
function canDepart(realm: SecretRealmView): boolean {
  return canExplore(realm) && activeExploration.value === null;
}

/** 交互探索被挡住的原因（null = 可以出发）：先看进行中的探索，再看秘境自身条件。 */
function exploreBlockedReason(realm: SecretRealmView): string | null {
  if (activeExploration.value !== null) {
    return `已有探索进行中（${activeExploration.value.realmName}）`;
  }
  return realmBlockedReason(realm);
}

function openParty(realm: SecretRealmView): void {
  if (!canDepart(realm)) {
    return;
  }
  emit('select', realm);
}

/** 交互探索：交给 SectScreen 开选人弹窗（提交时才真正调接口）。 */
function openExplore(realm: SecretRealmView): void {
  if (!canDepart(realm)) {
    return;
  }
  emit('explore-start', realm.id);
}

function realmGlyph(realmId: string): string {
  const glyphs: Record<string, string> = {
    mistyForest: '雾',
    savageMine: '矿',
    fallenStarAbyss: '渊',
    beastNest: '兽',
    ancientRealm: '古',
    tribulationRuins: '劫',
  };
  return glyphs[realmId] ?? '境';
}
</script>

<template>
  <section class="explore-panel" aria-labelledby="explore-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">秘境探索</p>
        <h2 id="explore-title">秘境</h2>
      </div>
      <span class="count-badge">{{ realms.length }} 处</span>
    </header>

    <LoadingState v-if="loading" label="正在探查秘境" detail="正在读取秘境、次数与出发条件。" />

    <!-- 断点恢复入口：进行中的探索优先于出发（服务端每宗门同时只允许一场）。 -->
    <button v-else-if="activeExploration" class="realm-resume" type="button" @click="emit('explore-resume')">
      <span class="realm-resume-glyph" aria-hidden="true">续</span>
      <span class="realm-resume-copy">
        <strong>继续探索 · {{ activeExploration.realmName }}</strong>
        <small>
          第 {{ activeExploration.currentStage + 1 }}/{{ activeExploration.totalStages }} 关 · 队伍仍在秘境之中
        </small>
      </span>
      <span class="realm-resume-arrow" aria-hidden="true">›</span>
    </button>
    <p v-if="!loading && activeExploration" class="explore-hint">
      已有探索进行中，须先完成或放弃才能再次出发（速通与探索共用每日次数）。
    </p>

    <p v-if="!loading && loadError" class="explore-hint">{{ loadError }}</p>
    <p v-else-if="!loading && realms.length > 0 && !hasArena" class="explore-hint">部分高阶秘境需要建造演武场（4 级解锁）方可探索。</p>

    <ul v-if="!loading && realms.length > 0" class="realm-list">
      <li v-for="realm in realms" :key="realm.id" class="realm-row" :class="{ 'is-locked': realm.locked }">
        <div class="realm-glyph" aria-hidden="true">{{ realmGlyph(realm.id) }}</div>

        <div class="realm-copy">
          <div class="realm-title">
            <strong>{{ realm.name }}</strong>
            <span v-if="realmBlockedReason(realm)" class="realm-flag">{{ realmBlockedReason(realm) }}</span>
            <span v-if="activeExploration" class="realm-flag is-active">探索进行中</span>
          </div>
          <p class="realm-desc">{{ realm.description }}</p>
          <div class="realm-meta">
            <span>难度 {{ realm.difficulty }}</span>
            <span v-if="realm.dailyLimit === null">不限次数</span>
            <span v-else>次数 {{ realm.usedToday }}/{{ realm.dailyLimit }}</span>
            <span>队伍 {{ realm.minParty }}~{{ realm.maxParty }} 人</span>
          </div>
          <div class="realm-tags">
            <span class="tag-label">奖励</span>
            <span v-for="(amount, resourceId) in realm.rewards" :key="resourceId" class="reward-tag is-gain">
              {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
            </span>
            <span class="tag-label">消耗</span>
            <span v-for="(amount, resourceId) in realm.entryCost" :key="resourceId" class="reward-tag is-cost">
              {{ resourceNameMap[resourceId] ?? resourceId }} {{ formatAmount(amount) }}
            </span>
          </div>
        </div>

        <div class="realm-actions">
          <button
            class="realm-go"
            :class="{ 'is-disabled': !canDepart(realm) }"
            type="button"
            :disabled="busy"
            :aria-disabled="!canDepart(realm)"
            :aria-label="`速通${realm.name}`"
            @click="openParty(realm)"
          >
            速通
          </button>

          <button
            v-if="realm.exploreEnabled"
            class="realm-go is-explore"
            :class="{ 'is-disabled': !canDepart(realm) }"
            type="button"
            :disabled="busy"
            :aria-disabled="!canDepart(realm)"
            :aria-label="`探索${realm.name}${exploreBlockedReason(realm) === null ? '' : `（${exploreBlockedReason(realm)}）`}`"
            @click="openExplore(realm)"
          >
            探索
          </button>
        </div>
      </li>
    </ul>

    <div v-else-if="!loading && loadError === null" class="empty-state compact-empty">
      <span aria-hidden="true">境</span>
      <strong>暂无秘境</strong>
    </div>
  </section>
</template>
