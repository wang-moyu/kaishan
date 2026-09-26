<script setup lang="ts">
import { CHANGELOG, MAX_ENTRIES } from '../data/changelog';
import ModalShell from './ModalShell.vue';

/**
 * 更新说明弹窗：纯展示（内容见 data/changelog.ts）。
 * 「已读」由打开它的一方（SectScreen）在打开时记录，这里不碰本地存储。
 */
const emit = defineEmits<{
  close: [];
}>();

const entries = CHANGELOG.slice(0, MAX_ENTRIES);
</script>

<template>
  <ModalShell label="更新说明" @close="emit('close')">
    <section class="changelog" aria-labelledby="changelog-title">
      <header class="section-heading panel-heading compact-heading">
        <div>
          <p class="eyebrow">山门告示</p>
          <h2 id="changelog-title">更新说明</h2>
        </div>
      </header>

      <ol class="changelog-list">
        <li v-for="entry in entries" :key="entry.id" class="changelog-entry">
          <p class="changelog-meta">
            <time :datetime="entry.time.replace(' ', 'T')">{{ entry.time }}</time>
            <strong>{{ entry.title }}</strong>
          </p>
          <ul>
            <li v-for="(item, index) in entry.items" :key="index">{{ item }}</li>
          </ul>
        </li>
      </ol>
    </section>
  </ModalShell>
</template>
