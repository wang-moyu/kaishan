<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import { isTopModalLayer, modalLayerCount, popModalLayer, pushModalLayer } from '../utils/modalStack';
import LoadingState from './LoadingState.vue';

/**
 * 通用弹窗外壳：遮罩 + 面板容器 + 右上角关闭按钮。
 *
 * 关闭方式：点遮罩、点关闭、按 Esc（多层叠加时只关最上面那层）；打开期间锁住页面滚动，
 * 并把焦点移进弹窗。只要这一层在最上面，Tab / Shift+Tab 就被约束在本弹窗内的可操作控件之间，
 * 不会跑到被遮住的页面上（二级弹窗因此不会把焦点丢给底下的详情）。
 * 内容自己滚（`.modal-card` 与弹窗内的滚动区各自滚动，滚动条全局隐藏）。
 * 关闭后把焦点还给打开它的那个控件（二级弹窗因此回到「服用丹药」这类入口）。
 */
const props = defineProps<{
  /** 给读屏用的弹窗名称（内容里的标题通常已有 h2，这里只补一个简短标签）。 */
  label: string;
  /** 窄一点的弹窗（二级弹窗用）。 */
  narrow?: boolean;
  /** 固定为稳定的视口内高度，内容组件自行提供内部滚动区。 */
  fixedHeight?: boolean;
  /** 弹窗内请求进行中：统一遮罩内容并阻止重复操作。 */
  loading?: boolean;
  loadingText?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

// 层级栈与滚动锁放在独立模块里（写在 <script setup> 里的「模块级」变量其实是每个实例一份）。
const layerToken: object = {};

const dialog = ref<HTMLElement | null>(null);

/** 打开本层之前获得焦点的元素：关闭时把焦点还回去（二级弹窗因此回到「服用丹药」这类入口）。 */
let restoreTarget: HTMLElement | null = null;

/** 焦点约束只认真实可操作控件：读屏用的 tabpanel（tabindex="0"）不参与首尾环绕。 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
].join(',');

/** 当前弹窗里可见（未被 display:none 隐藏）的可操作控件，按 DOM 顺序。 */
function focusableElements(): HTMLElement[] {
  if (props.loading) return [];
  const card = dialog.value;
  if (card === null) return [];
  return [...card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    // offsetParent 为 null 说明它在隐藏的 Tab 面板里，不参与 Tab 循环。
    (element) => element.offsetParent !== null,
  );
}

function onKeydown(event: KeyboardEvent): void {
  // 只有最上层弹窗响应键盘：Esc 关最上面那层，焦点也只在最上面那层里循环。
  if (!isTopModalLayer(layerToken)) {
    return;
  }
  if (event.key === 'Escape') {
    if (props.loading) {
      event.preventDefault();
      return;
    }
    emit('close');
    return;
  }
  if (event.key !== 'Tab') {
    return;
  }

  const card = dialog.value;
  if (card === null) {
    return;
  }
  const focusables = focusableElements();
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) {
    // 没有任何可操作控件：焦点留在弹窗容器上，不让 Tab 跑掉。
    event.preventDefault();
    card.focus();
    return;
  }

  const active = document.activeElement;
  const inside = active !== null && card.contains(active);
  if (event.shiftKey) {
    if (!inside || active === first || active === card) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (!inside || active === last || active === card) {
    event.preventDefault();
    first.focus();
  }
}

function requestClose(): void {
  if (props.loading) return;
  emit('close');
}

onMounted(() => {
  const active = document.activeElement;
  restoreTarget = active instanceof HTMLElement ? active : null;
  pushModalLayer(layerToken);
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onKeydown);
  dialog.value?.focus();
});

onUnmounted(() => {
  popModalLayer(layerToken);
  window.removeEventListener('keydown', onKeydown);
  if (modalLayerCount() === 0) {
    document.body.style.overflow = '';
  }
  restoreFocus();
});

/**
 * 焦点回退：只有「焦点仍留在本层（或已掉到 body）」且目标元素还在文档里时才动，
 * 绝不抢走上一层弹窗（或页面别处）刚拿到的焦点。
 * 目标已被移除（例如弟子被驱逐、那一行不再匹配筛选）时不抢焦点，交给各自的兜底逻辑。
 */
function restoreFocus(): void {
  const card = dialog.value;
  const active = document.activeElement;
  const focusStillOurs =
    active === null || active === document.body || (card !== null && card.contains(active));
  if (!focusStillOurs) return;
  if (restoreTarget === null || !document.contains(restoreTarget)) return;
  if (card !== null && card.contains(restoreTarget)) return;
  restoreTarget.focus();
}
</script>

<template>
  <div class="modal-backdrop" @click.self="requestClose">
    <div
      ref="dialog"
      class="modal-card game-panel"
      :class="{ 'is-narrow': narrow, 'is-fixed-height': fixedHeight, 'is-loading': loading }"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      :aria-busy="loading"
      tabindex="-1"
    >
      <button class="modal-close" type="button" aria-label="关闭" :disabled="loading" @click="requestClose">
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" />
        </svg>
      </button>
      <slot />
      <div v-if="loading" class="modal-loading-layer">
        <LoadingState :label="loadingText ?? '正在处理请求'" />
      </div>
    </div>
  </div>
</template>
