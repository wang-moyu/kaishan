<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { DiscipleProfileView } from '../api/game';
import { fetchDiscipleProfile } from '../api/game';
import DiscipleAvatar from './DiscipleAvatar.vue';
import DiscipleRadarChart from './DiscipleRadarChart.vue';
import LoadingState from './LoadingState.vue';
import ModalShell from './ModalShell.vue';

/**
 * 天骄榜点开的弟子公开档案（只读）：境界、天赋、战力、综合评分、六轴雷达图、属性（含装备加成）、
 * 已穿戴装备与伤势。数据全部来自 GET /game/disciple-profile/:id，不含掌门备注等私有字段。
 */
const props = defineProps<{ discipleId: string }>();
const emit = defineEmits<{ close: [] }>();

const profile = ref<DiscipleProfileView | null>(null);
const loadError = ref<string | null>(null);
let loadSeq = 0;

async function load(discipleId: string): Promise<void> {
  const seq = (loadSeq += 1);
  profile.value = null;
  loadError.value = null;
  try {
    const result = await fetchDiscipleProfile(discipleId);
    if (seq === loadSeq) profile.value = result;
  } catch (caught) {
    if (seq === loadSeq) loadError.value = caught instanceof Error ? caught.message : '弟子档案读取失败';
  }
}

watch(() => props.discipleId, (id) => { void load(id); }, { immediate: true });

type GearKey = keyof DiscipleProfileView['gear'];
const attributeRows = computed(() => {
  const p = profile.value;
  if (p === null) return [];
  const rows: { label: string; value: number; gear: number }[] = [
    { label: '资质', value: p.aptitude, gear: 0 },
  ];
  const gearRows: [string, GearKey][] = [
    ['攻击', 'attack'],
    ['防御', 'defense'],
    ['身法', 'speed'],
    ['幸运', 'luck'],
    ['体魄', 'physique'],
  ];
  for (const [label, key] of gearRows) rows.push({ label, value: p[key], gear: p.gear[key] });
  return rows;
});

const injuryText = computed(() => {
  if (profile.value?.injury === 'severe') return '重伤卧床';
  if (profile.value?.injury === 'injured') return '负伤';
  return null;
});
</script>

<template>
  <ModalShell narrow label="弟子档案" @close="emit('close')">
    <LoadingState v-if="profile === null && loadError === null" label="正在读取弟子档案" />
    <p v-else-if="loadError" class="explore-hint">{{ loadError }}</p>

    <section v-else-if="profile" class="dpf-card" aria-labelledby="dpf-title">
      <header class="dpf-head">
        <DiscipleAvatar
          class="dpf-avatar"
          :name="profile.name"
          :gender="profile.gender"
          :realm-id="profile.realmId"
          :frame-id="profile.frameId"
          variant="roster"
        />
        <div class="dpf-head-copy">
          <h2 id="dpf-title" class="dpf-name">
            {{ profile.name }}
            <span v-if="profile.isMe" class="rank-me">本宗</span>
          </h2>
          <p class="dpf-meta">
            <span>{{ profile.sectName }}</span>
            <span>{{ profile.realmName }} · {{ profile.stageName }}</span>
            <span v-if="injuryText" class="dpf-injury">{{ injuryText }}</span>
          </p>
        </div>
      </header>

      <div class="dpf-scores">
        <div class="disciple-score">
          <span class="disciple-score-label">战力</span>
          <strong class="disciple-score-value">{{ profile.combatPower }}</strong>
        </div>
        <div class="disciple-score">
          <span class="disciple-score-label">综合评分</span>
          <strong class="disciple-score-value">{{ profile.attributeScore.toFixed(1) }}</strong>
        </div>
      </div>

      <DiscipleRadarChart
        :name="profile.name"
        :aptitude="profile.aptitude"
        :attack="profile.attack"
        :defense="profile.defense"
        :speed="profile.speed"
        :luck="profile.luck"
        :physique="profile.physique"
        :gear="profile.gear"
      />

      <dl class="dpf-attrs">
        <div v-for="row in attributeRows" :key="row.label">
          <dt>{{ row.label }}</dt>
          <dd>
            {{ row.value }}<span v-if="row.gear > 0" class="dpf-gear">(+{{ row.gear }})</span>
          </dd>
        </div>
      </dl>

      <div class="disciple-stats">
        <span class="stat-tag stat-talent" :title="profile.talentDescription">
          <template v-if="profile.talentDescription">{{ profile.talentName }}：{{ profile.talentDescription }}</template>
          <template v-else>无天赋</template>
        </span>
        <span class="stat-tag">淬体 {{ profile.bodyTemperingUses }} 次</span>
        <span class="stat-tag">悟道 {{ profile.daoInsightUsed }} 点</span>
      </div>

      <h3 class="disciple-detail-title dpf-section-title">装备</h3>
      <ul v-if="profile.equipment.length > 0" class="gear-slots">
        <li
          v-for="item in profile.equipment"
          :key="item.id"
          class="gear-slot"
          :style="{ borderColor: item.color }"
        >
          <span class="gear-slot-label">{{ item.slotName }}</span>
          <strong class="gear-slot-name" :style="{ color: item.color }">{{ item.name }}</strong>
          <span class="gear-slot-attrs">
            {{ item.mainAttrName }} +{{ item.mainValue }} · {{ item.subAttrName }} +{{ item.subValue }}
          </span>
        </li>
      </ul>
      <p v-else class="gear-slot-empty">未穿戴装备</p>
    </section>
  </ModalShell>
</template>

<style scoped>
.dpf-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10px;
}

.dpf-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-right: 32px;
}

.dpf-avatar {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.dpf-head-copy {
  min-width: 0;
}

.dpf-name {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: #e4ece6;
  font-size: 18px;
  font-weight: 500;
}

.dpf-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 10px;
  margin: 4px 0 0;
  color: #93a99e;
  font-size: 12px;
}

.dpf-injury {
  color: #e08a7a;
}

.dpf-scores {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.dpf-attrs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin: 0;
}

.dpf-attrs > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border: 1px solid rgba(119, 184, 154, 0.12);
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.016);
}

.dpf-attrs dt {
  color: #7d9186;
  font-size: 12px;
}

.dpf-attrs dd {
  margin: 0;
  color: #e4ece6;
  font-size: 14px;
}

.dpf-gear {
  margin-left: 2px;
  color: var(--jade);
  font-size: 11px;
}

.dpf-section-title {
  margin: 4px 0 0;
}

@media (max-width: 420px) {
  .dpf-attrs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
