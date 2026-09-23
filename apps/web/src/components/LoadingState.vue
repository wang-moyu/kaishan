<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    detail?: string;
    compact?: boolean;
  }>(),
  {
    label: '正在连接天地灵机',
    detail: '请稍候，结果将由服务端裁定。',
    compact: false,
  },
);
</script>

<template>
  <div class="loading-state" :class="{ 'is-compact': compact }" role="status" aria-live="polite" aria-atomic="true">
    <span class="loading-seal" aria-hidden="true"><i /></span>
    <span class="loading-state-copy">
      <strong>{{ label }}</strong>
      <small v-if="detail">{{ detail }}</small>
    </span>
  </div>
</template>
