<script setup lang="ts">
import { ref } from 'vue';

import type { DiscipleLeaderboardEntryView, DiscipleLeaderboardView } from '../api/game';
import { fetchDiscipleLeaderboard } from '../api/game';
import DiscipleAvatar from './DiscipleAvatar.vue';
import DiscipleProfileDialog from './DiscipleProfileDialog.vue';
import LoadingState from './LoadingState.vue';

const props = defineProps<{ busy: boolean }>();

type Tab = 'combatPower' | 'attributeScore' | 'equipment';
const activeTab = ref<Tab>('combatPower');

const data = ref<DiscipleLeaderboardView | null>(null);
const loading = ref(true);
const loadError = ref<string | null>(null);
/** 正在查看公开档案的弟子（null = 没打开）。 */
const profileId = ref<string | null>(null);

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
  if (activeTab.value === 'combatPower') return data.value.byCombatPower;
  if (activeTab.value === 'attributeScore') return data.value.byAttributeScore;
  return data.value.byEquipment;
}

function valueLabel(entry: DiscipleLeaderboardEntryView): string {
  if (activeTab.value === 'combatPower') return `战力 ${entry.combatPower}`;
  if (activeTab.value === 'attributeScore') return `综合 ${entry.attributeScore}`;
  // 装备榜：战力加成是 100 基点的整数倍，直接换成百分数显示。
  return `装备 +${entry.gearPowerBonusBp / 100}%`;
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
      <button
        class="dlb-tab"
        :class="{ active: activeTab === 'equipment' }"
        role="tab"
        :aria-selected="activeTab === 'equipment'"
        @click="activeTab = 'equipment'"
      >装备榜</button>
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
        <button
          class="rank-open dlb-row"
          type="button"
          :aria-label="`查看 ${entry.discipleName} 的档案`"
          @click="profileId = entry.discipleId"
        >
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
            <!-- 装备榜：三个部位的品质（品质色边框；没穿的部位显示「空」）。 -->
            <span v-if="activeTab === 'equipment' && entry.gearSlots" class="dlb-gear">
              <span
                v-for="slot in entry.gearSlots"
                :key="slot.slot"
                class="dlb-gear-slot"
                :class="{ 'is-empty': slot.quality === null }"
                :style="slot.color ? { borderColor: slot.color, color: slot.color } : undefined"
              >{{ slot.slotName }} {{ slot.qualityName ?? '空' }}</span>
            </span>
          </span>
          <span class="rank-arrow" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>

    <div v-else-if="loadError === null" class="empty-state compact-empty">
      <span aria-hidden="true">榜</span>
      <strong>{{ activeTab === 'equipment' ? '暂无弟子穿戴装备' : '暂无弟子上榜' }}</strong>
    </div>

    <DiscipleProfileDialog v-if="profileId" :disciple-id="profileId" @close="profileId = null" />
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
  grid-template-columns: 28px 36px minmax(0, 1fr) 14px;
  cursor: pointer;
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

.dlb-gear {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.dlb-gear-slot {
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 2px;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}

.dlb-gear-slot.is-empty {
  border-color: rgba(119, 184, 154, 0.16);
  color: #6f8479;
}
</style>
