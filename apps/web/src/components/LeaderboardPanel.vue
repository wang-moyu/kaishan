<script setup lang="ts">
import { ref, watch } from 'vue';

import type { LeaderboardEntryView, PublicSectView, SectStateView } from '../api/game';
import { fetchLeaderboard } from '../api/game';
import LoadingState from './LoadingState.vue';
import PublicSectPanel from './PublicSectPanel.vue';

/**
 * 江湖榜（弹窗内容）。
 *
 * 列表按服务端给的顺序展示（等级 → 声望 → 创建时间）；点别人那行看公开档案（同一弹窗内切换），
 * 自己的行不可点。
 */
const props = defineProps<{
  state: SectStateView;
  busy: boolean;
}>();

const emit = defineEmits<{
  challenge: [sect: PublicSectView];
}>();

const entries = ref<LeaderboardEntryView[]>([]);
const loadError = ref<string | null>(null);
const loading = ref(true);
const selectedSectId = ref<string | null>(null);

let loadSeq = 0;

async function loadLeaderboard(): Promise<void> {
  const seq = (loadSeq += 1);
  loading.value = true;
  try {
    const list = await fetchLeaderboard();
    if (seq !== loadSeq) return; // 已有更新的请求在途，丢弃这次过期响应
    entries.value = list;
    loadError.value = null;
  } catch (caught) {
    if (seq !== loadSeq) return;
    loadError.value = caught instanceof Error ? caught.message : '榜单读取失败';
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
}

// state 变化（自己升级 / 挑战后刷新）就重拉一次，自己的名次与声望保持最新。
watch(() => props.state, () => { void loadLeaderboard(); }, { immediate: true });

function openSect(entry: LeaderboardEntryView): void {
  if (props.busy || entry.isMe) return;
  selectedSectId.value = entry.sectId;
}
</script>

<template>
  <PublicSectPanel
    v-if="selectedSectId"
    :sect-id="selectedSectId"
    :state="state"
    :busy="busy"
    @back="selectedSectId = null"
    @challenge="emit('challenge', $event)"
  />

  <section v-else class="leaderboard-panel" aria-labelledby="leaderboard-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">江湖榜</p>
        <h2 id="leaderboard-title">宗门排名</h2>
      </div>
      <span class="count-badge">{{ entries.length }} 家</span>
    </header>

    <LoadingState v-if="loading" label="正在读取江湖榜" detail="正在查阅各宗门最新名次。" />
    <p v-else-if="loadError" class="explore-hint">{{ loadError }}</p>

    <ul v-else-if="entries.length > 0" class="rank-list">
      <li
        v-for="(entry, index) in entries"
        :key="entry.sectId"
        class="rank-row"
        :class="{ 'is-me': entry.isMe }"
      >
        <button class="rank-open" type="button" :disabled="entry.isMe || busy" @click="openSect(entry)">
          <span class="rank-no">{{ index + 1 }}</span>
          <span class="rank-copy">
            <span class="rank-title">
              <strong>{{ entry.name }}</strong>
              <span class="rank-level">{{ entry.levelName }}</span>
              <span v-if="entry.isMe" class="rank-me">本宗</span>
            </span>
            <span class="rank-meta">
              <span>声望 {{ entry.reputation }}</span>
              <span>弟子 {{ entry.discipleCount }}</span>
              <span v-if="entry.topDisciple">最强者 {{ entry.topDisciple.name }} · {{ entry.topDisciple.stageName }}</span>
              <span v-else>尚无可战弟子</span>
            </span>
          </span>
          <span v-if="!entry.isMe" class="rank-arrow" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>

    <div v-else-if="loadError === null" class="empty-state compact-empty">
      <span aria-hidden="true">榜</span>
      <strong>江湖上还没有别的宗门</strong>
    </div>

    <p class="leaderboard-note">点其他宗门可查看公开档案并发起挑战；每日 3 次机会，同一宗门每天限挑战 1 次。</p>
  </section>
</template>
