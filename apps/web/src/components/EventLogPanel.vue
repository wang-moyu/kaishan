<script setup lang="ts">
import { computed } from 'vue';

import type { EventLogView, SectStateView } from '../api/game';
import { formatAmount, formatTime } from '../utils/format';
import { resourceGlyph } from '../utils/glyph';

/**
 * 天机录：最近触发的事件（服务端最多给 10 条，新→旧）。
 *
 * 现在是弹窗内容，面板边框与留白由 ModalShell 提供，所以根节点不再带 `game-panel`；
 * 列表也不再自己开滚动区域，整个弹窗一起滚。
 */
const props = defineProps<{
  state: SectStateView;
}>();

const recentEvents = computed<EventLogView[]>(() => props.state.recentEvents ?? []);

const resourceNames = computed<Record<string, string>>(() =>
  Object.fromEntries(props.state.resources.map((resource) => [resource.id, resource.name])),
);

interface EventEffectLine {
  resourceId: string;
  name: string;
  text: string;
  positive: boolean;
}

/** 资源变化：最小单位换算成展示单位，正负分色。 */
function eventEffects(event: EventLogView): EventEffectLine[] {
  return Object.entries(event.effects).map(([resourceId, amount]) => {
    const value = Number(amount);
    return {
      resourceId,
      name: resourceNames.value[resourceId] ?? resourceId,
      text: `${value < 0 ? '-' : '+'}${formatAmount(Math.abs(value))}`,
      positive: value >= 0,
    };
  });
}

/** 圆形标记配色：吉兆 / 凶兆 / 吉凶参半。 */
function eventToneClass(event: EventLogView): string {
  const amounts = Object.values(event.effects).map((amount) => Number(amount));
  const gained = amounts.some((amount) => amount > 0);
  const lost = amounts.some((amount) => amount < 0);
  if (gained && lost) return 'is-mixed';
  return lost ? 'is-loss' : 'is-gain';
}
</script>

<template>
  <section class="event-panel" aria-labelledby="event-title">
    <header class="section-heading panel-heading compact-heading">
      <div>
        <p class="eyebrow">天机录</p>
        <h2 id="event-title">近期异象</h2>
      </div>
      <span v-if="recentEvents.length > 0" class="count-badge">{{ recentEvents.length }} 条</span>
    </header>

    <ul v-if="recentEvents.length > 0" class="event-list">
      <li v-for="event in recentEvents" :key="event.id" class="event-card">
        <div class="event-glyph" :class="eventToneClass(event)" aria-hidden="true">{{ resourceGlyph(Object.keys(event.effects)[0] ?? '') }}</div>
        <div class="event-copy">
          <div>
            <strong>{{ event.name }}</strong>
            <span class="event-time">{{ formatTime(event.createdAt) }}</span>
          </div>
          <p>{{ event.description }}</p>
          <small class="event-effects">
            <span
              v-for="effect in eventEffects(event)"
              :key="effect.resourceId"
              :class="effect.positive ? 'is-gain' : 'is-loss'"
            >{{ effect.name }} {{ effect.text }}</span>
          </small>
        </div>
      </li>
    </ul>

    <div v-else class="empty-state compact-empty">
      <span aria-hidden="true">静</span>
      <strong>近来风平浪静</strong>
      <p>宗门异象会记于此处。</p>
    </div>
  </section>
</template>
