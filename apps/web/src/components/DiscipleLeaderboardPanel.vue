<script setup lang="ts">
import { ref } from 'vue';

import type { DiscipleLeaderboardEntryView, DiscipleLeaderboardView } from '../api/game';
import { fetchDiscipleLeaderboard } from '../api/game';
import DiscipleAvatar from './DiscipleAvatar.vue';
import LoadingState from './LoadingState.vue';

const props = defineProps<{ busy: boolean }>();

type Tab = 'combatPower' | 'attributeScore';
const activeTab = ref<Tab>('combatPower');

const data = ref<DiscipleLeaderboardView | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);

let loadSeq = 0;

async function load(): Promise<void> {
  const seq = (loadSeq += 1);
  loading.value = true;
  try {
    const result = await fetchDiscipleLeaderboard();
    if (seq !== loadSeq) return;
    data.value = result;
    loadError.value = null;
  } catch (caught) {
    if (seq !== loadSeq) return;
    loadError.value = caught instanceof Error ? caught.message : '弟子榜读取失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

load();

function entries(): DiscipleLeaderboardEntryView[] {
  if (data.value === null) return [];
  return activeTab.value === 'combatPower'
    ? data.value.byCombatPower
    : data.value.byAttributeScore;
}

function valueLabel(entry: DiscipleLeaderboardEntryView): string {
  return activeTab.value === 'combatPower'
    ? `战力 ${entry.combatPower}`
    : `综合 ${entry.attributeScore}`;
}
</script>

<template>
  <section class="leaderboard-panel" aria-labelledby="disciple-lb-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">弟子榜</p>
        <h2 id="disciple-lb-title">天骄榜</h2>
      </div>
    </header>

    <div class="dlb-tabs" role="tablist" aria-label="弟子榜分类">
      <button
        class="dlb-tab"
        :class="{ active: activeTab === 'combatPower' }"
        role="tab"
        :aria-selected="activeTab === 'combatPower'"
        @click="activeTab = 'combatPower'"
      >战力榜</button>
      <button
        class="dlb-tab"
        :class="{ active: activeTab === 'attributeScore' }"
        role="tab"
        :aria-selected="activeTab === 'attributeScore'"
        @click="activeTab = 'attributeScore'"
      >综合榜</button>
    </div>

    <LoadingState v-if="loading" label="正在读取弟子榜" detail="天下英才，正在查阅。" />
    <p v-else-if="loadError" class="explore-hint">{{ loadError }}</p>

    <ul v-else-if="entries().length > 0" class="rank-list">
      <li
        v-for="entry in entries()"
        :key="entry.discipleId"
        class="rank-row"
        :class="{ 'is-me': entry.isMe }"
      >
        <div class="rank-open dlb-row">
          <span class="rank-no">{{ entry.rank }}</span>
          <DiscipleAvatar
            class="dlb-avatar"
            :name="entry.discipleName"
            :gender="entry.gender"
            :realm-id="entry.realmId"
            :frame-id="entry.frameId"
            variant="roster"
          />
          <span class="rank-copy">
            <span class="rank-title">
              <strong>{{ entry.discipleName }}</strong>
              <span class="rank-level">{{ entry.stageName }}</span>
              <span v-if="entry.isMe" class="rank-me">本宗</span>
            </span>
            <span class="rank-meta">
              <span>{{ entry.sectName }}</span>
              <span v-if="entry.talentName !== '无'">天赋 {{ entry.talentName }}</span>
              <span class="dlb-value">{{ valueLabel(entry) }}</span>
            </span>
          </span>
        </div>
      </li>
    </ul>

    <div v-else-if="loadError === null" class="empty-state compact-empty">
      <span aria-hidden="true">榜</span>
      <strong>暂无弟子上榜</strong>
    </div>
  </section>
</template>

<style scoped>
.dlb-tabs {
  display: flex;
  gap: 4px;
  padding-bottom: 9px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 4px;
}

.dlb-tab {
  padding: 6px 16px;
  border: 1px solid rgba(119, 184, 154, 0.16);
  border-radius: 2px;
  color: #9db3a8;
  background: rgba(255, 255, 255, 0.02);
  font-size: 13px;
  cursor: pointer;
}

.dlb-tab:hover {
  border-color: rgba(202, 169, 106, 0.3);
  color: #e4ece6;
}

.dlb-tab.active {
  border-color: var(--gold);
  color: var(--gold);
  background: rgba(202, 169, 106, 0.08);
}

.dlb-row {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 28px 36px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 10px 6px;
}

.dlb-avatar {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
}

.dlb-value {
  color: var(--gold);
  font-weight: 600;
}
</style>
