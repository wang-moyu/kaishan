<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';

/**
 * 小问号说明：电脑上鼠标移上去显示，手机上点一下显示、再点一下或点别处收起。
 *
 * 触屏点击会先模拟一次 mouseenter，所以悬停只认 pointerType === 'mouse'，
 * 点击单独维护「钉住」状态 —— 两者任一为真就显示。Esc、页面滚动都会收起。
 *
 * 气泡挂到 body 上、用 fixed 定位并夹在视口内：问号靠右（如战力旁）或在窄屏上时不会伸出屏幕，
 * 也不受弹窗容器的 overflow / transform 影响。
 */
defineProps<{
  /** 读屏用的名称，如「战力说明」。 */
  label: string;
  /** 说明正文；`\n` 换行。 */
  text: string;
}>();

/** 气泡与视口边缘、与问号之间的留白（px）。 */
const EDGE_GAP = 12;
const ANCHOR_GAP = 6;
const MAX_WIDTH = 280;

const button = ref<HTMLButtonElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
const hovered = ref(false);
const pinned = ref(false);
const position = ref({ left: 0, top: 0, width: MAX_WIDTH });

const visible = computed(() => pinned.value || hovered.value);

/** 默认放在问号下方、左边与问号对齐；放不下就往左挪、下方放不下就翻到上方。 */
async function place(): Promise<void> {
  await nextTick();
  const anchor = button.value?.getBoundingClientRect();
  if (anchor === undefined) return;
  const width = Math.min(MAX_WIDTH, window.innerWidth - EDGE_GAP * 2);
  const left = Math.min(Math.max(EDGE_GAP, anchor.left - 8), window.innerWidth - width - EDGE_GAP);
  position.value = { left, top: anchor.bottom + ANCHOR_GAP, width };
  await nextTick();
  const height = bubble.value?.offsetHeight ?? 0;
  if (anchor.bottom + ANCHOR_GAP + height > window.innerHeight - EDGE_GAP && anchor.top - ANCHOR_GAP - height >= EDGE_GAP) {
    position.value = { left, top: anchor.top - ANCHOR_GAP - height, width };
  }
}

function onPointerEnter(event: PointerEvent): void {
  if (event.pointerType !== 'mouse') return;
  hovered.value = true;
  // 悬停时滚轮滚动同样要收起（同一个监听重复添加会被浏览器去重）。
  listen(true);
  void place();
}

function onPointerLeave(event: PointerEvent): void {
  if (event.pointerType === 'mouse') hovered.value = false;
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (button.value !== null && !button.value.contains(event.target as Node)) close();
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close();
}

function listen(on: boolean): void {
  if (on) {
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeydown);
    // 气泡是 fixed 定位，滚动后会和问号错位：任何滚动都直接收起。
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return;
  }
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onDocumentKeydown);
  window.removeEventListener('scroll', close, true);
  window.removeEventListener('resize', close);
}

function open(): void {
  pinned.value = true;
  listen(true);
  void place();
}

function close(): void {
  pinned.value = false;
  hovered.value = false;
  listen(false);
}

function toggle(): void {
  if (pinned.value) close();
  else open();
}

onBeforeUnmount(close);
</script>

<template>
  <span class="help-tip" @pointerenter="onPointerEnter" @pointerleave="onPointerLeave">
    <button
      ref="button"
      class="help-tip-button"
      type="button"
      :aria-label="label"
      :aria-expanded="visible"
      @click.stop="toggle"
    >?</button>
    <Teleport to="body">
      <span
        v-if="visible"
        ref="bubble"
        class="help-tip-bubble"
        role="tooltip"
        :style="{ left: `${position.left}px`, top: `${position.top}px`, maxWidth: `${position.width}px` }"
      >{{ text }}</span>
    </Teleport>
  </span>
</template>

<style scoped>
.help-tip {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.help-tip-button {
  display: inline-grid;
  width: 16px;
  height: 16px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  color: var(--gold);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: help;
}

.help-tip-button:hover,
.help-tip-button[aria-expanded='true'] {
  border-color: var(--gold);
  background: rgba(202, 169, 106, 0.12);
}

.help-tip-bubble {
  position: fixed;
  /* 高于弹窗（.modal-backdrop 900），低于提示条（.toast-viewport 1000）。 */
  z-index: 950;
  width: max-content;
  padding: 8px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  color: var(--ink-text);
  background: var(--surface-strong);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.6;
  text-align: left;
  white-space: pre-line;
  pointer-events: none;
}
</style>
