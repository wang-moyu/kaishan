<script setup lang="ts">
import type { ToastItem } from '../types/ui';

const props = defineProps<{
  items: ToastItem[];
}>();

const emit = defineEmits<{
  dismiss: [id: number];
}>();

function toneLabel(toast: ToastItem): string {
  if (toast.tone === 'success') return '成功';
  if (toast.tone === 'error') return '失败';
  if (toast.tone === 'warning') return '提示';
  return '消息';
}
</script>

<template>
  <div class="toast-viewport" role="region" aria-label="消息通知">
    <TransitionGroup name="toast-list" tag="div" class="toast-stack">
      <article
        v-for="toast in props.items"
        :key="toast.id"
        class="toast-card"
        :class="`toast-${toast.tone}`"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
        aria-atomic="true"
      >
        <span class="toast-mark" aria-hidden="true">
          <svg v-if="toast.tone === 'success'" viewBox="0 0 24 24">
            <path d="m5 12.5 4.2 4.1L19 7" />
          </svg>
          <svg v-else-if="toast.tone === 'error'" viewBox="0 0 24 24">
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
          <svg v-else-if="toast.tone === 'warning'" viewBox="0 0 24 24">
            <path d="M12 4 3.5 19h17L12 4Zm0 5v4.5m0 2.5v.5" />
          </svg>
          <svg v-else viewBox="0 0 24 24">
            <path d="M12 7.5v.2M12 11v6M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z" />
          </svg>
        </span>

        <div class="toast-copy">
          <span class="toast-kicker">{{ toneLabel(toast) }}</span>
          <strong>{{ toast.title }}</strong>
          <p>{{ toast.message }}</p>
        </div>

        <button
          class="toast-close"
          type="button"
          :aria-label="`关闭消息：${toast.title}`"
          @click="emit('dismiss', toast.id)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </article>
    </TransitionGroup>
  </div>
</template>
