<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { PublicSectView, SectStateView } from '../api/game';
import { fetchPublicSect } from '../api/game';
import { formatTime } from '../utils/format';
import DiscipleAvatar from './DiscipleAvatar.vue';
import LoadingState from './LoadingState.vue';

/**
 * 别人宗门的公开档案（嵌在江湖榜弹窗里）。
 *
 * 只显示服务端给的公开字段：没有资源余额、修为进度、岗位、伤势、招募次数。
 * 挑战预览（剩余次数/等级差/奖励/守擂方式/阻止原因）都由服务端相对当前玩家算好。
 */
const props = defineProps<{
  sectId: string;
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  back: [];
  challenge: [sect: PublicSectView];
}>();

const sect = ref<PublicSectView | null>(null);
const loadError = ref<string | null>(null);
const loading = ref(true);
let loadSeq = 0;

watch(
  () => [props.sectId, props.state] as const,
  async ([sectId]) => {
    const seq = ++loadSeq;
    sect.value = null;
    loadError.value = null;
    loading.value = true;
    try {
      const next = await fetchPublicSect(sectId);
      if (seq !== loadSeq) return;
      sect.value = next;
    } catch (caught) {
      if (seq !== loadSeq) return;
      loadError.value = caught instanceof Error ? caught.message : '档案读取失败';
    } finally {
      if (seq === loadSeq) loading.value = false;
    }
  },
  { immediate: true },
);

/** 名册只展示境界最高的 6 位（境界下标 → 阶段 → 战力），其余只报数量。 */
const TOP_DISCIPLE_COUNT = 6;

const topDisciples = computed(() => {
  const list = [...(sect.value?.disciples ?? [])];
  list.sort(
    (a, b) => b.realmOrder - a.realmOrder || b.stage - a.stage || b.combatPower - a.combatPower,
  );
  return list.slice(0, TOP_DISCIPLE_COUNT);
});

const hiddenDiscipleCount = computed(() =>
  Math.max(0, (sect.value?.disciples.length ?? 0) - topDisciples.value.length),
);

/** 打开二级弹窗（能不能打由弹窗里的服务端情报裁决，这一页不做拦截）。 */
function requestChallenge(): void {
  if (props.busy || sect.value === null) {
    return;
  }
  emit('challenge', sect.value);
}
</script>

<template>
  <section class="public-sect" aria-labelledby="public-sect-title">
    <button class="quiet-button back-button" type="button" @click="emit('back')">← 返回榜单</button>

    <LoadingState v-if="loading" label="正在翻阅宗门档案" detail="正在读取对方门人与挑战情报。" />

    <template v-else-if="sect">
      <header class="section-heading panel-heading compact-heading">
        <div>
          <h2 id="public-sect-title" class="public-sect-name">{{ sect.name }}</h2>
        </div>
        <button
          v-if="sect.challenge"
          class="action-button primary-action public-challenge-button"
          :class="{ 'is-disabled': busy }"
          type="button"
          :disabled="busy"
          :aria-disabled="busy"
          @click="requestChallenge"
        >
          <span>挑战</span>
        </button>
      </header>

      <div class="public-meta">
        <span class="public-meta-item is-tier">{{ sect.levelName }}</span>
        <span class="public-meta-item">声望 {{ sect.reputation }}</span>
        <span class="public-meta-item">门人 {{ sect.disciples.length }} 位</span>
        <span class="public-meta-item">建筑 {{ sect.buildings.length }} 座</span>
        <span class="public-meta-item">立于 {{ formatTime(sect.createdAt) }}</span>
      </div>


      <div class="public-block">
        <p class="public-block-title">
          门下最强 {{ topDisciples.length }} 位
          <span class="public-block-sub">共 {{ sect.disciples.length }} 位门人</span>
        </p>
        <ul class="public-list">
          <li v-for="(disciple, index) in topDisciples" :key="disciple.id" class="public-row">
            <span class="public-rank" :class="{ 'is-first': index === 0 }">{{ index + 1 }}</span>
            <span class="public-avatar">
              <DiscipleAvatar
                :name="disciple.name"
                :gender="disciple.gender"
                :realm-id="disciple.realmId"
                frame-id="classic"
              />
            </span>
            <span class="public-name">{{ disciple.name }}</span>
            <span class="public-stage">{{ disciple.stageName }}</span>
            <span class="public-metrics">
              <span class="public-metric">
                <small>战力</small>
                <b>{{ disciple.combatPower }}</b>
              </span>
              <span class="public-metric">
                <small>资质</small>
                <b>{{ disciple.aptitude }}</b>
              </span>
            </span>
          </li>
        </ul>
        <p v-if="topDisciples.length === 0" class="public-empty">门下暂无弟子</p>
        <p v-else-if="hiddenDiscipleCount > 0" class="public-more">
          另有 {{ hiddenDiscipleCount }} 位门人未列出
        </p>
      </div>
    </template>

    <p v-else-if="loadError" class="explore-hint">{{ loadError }}</p>
  </section>
</template>
