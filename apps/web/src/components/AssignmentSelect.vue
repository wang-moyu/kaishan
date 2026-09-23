<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { AssignmentOptionView } from '../api/game';

const props = defineProps<{
  modelValue: string;
  options: AssignmentOptionView[];
  disabled: boolean;
  label: string;
}>();

const emit = defineEmits<{
  change: [value: string];
}>();

const root = ref<globalThis.HTMLElement | null>(null);
const trigger = ref<globalThis.HTMLButtonElement | null>(null);
const optionRefs = ref<globalThis.HTMLButtonElement[]>([]);
const open = ref(false);
const activeIndex = ref(0);

/** 满员岗位（如采灵）显示占用/上限，无上限的岗位只显示名字。 */
function displayName(option: AssignmentOptionView): string {
  if (option.maxCount === null || option.currentCount === null) return option.name;
  return `${option.name}（${option.currentCount}/${option.maxCount}）`;
}

/**
 * 上限已满且当前弟子不在该岗位上时禁选；弟子自己当前的岗位永远可选
 * （选中它就是「不改动」，不该被上限挡住）。
 */
function isDisabled(option: AssignmentOptionView): boolean {
  if (option.maxCount === null || option.currentCount === null) return false;
  if (option.id === props.modelValue) return false;
  return option.currentCount >= option.maxCount;
}

const currentName = computed(() => {
  const option = props.options.find((item) => item.id === props.modelValue);
  return option === undefined ? props.modelValue : displayName(option);
});

function setOptionRef(element: globalThis.Element | null, index: number): void {
  if (element instanceof window.HTMLButtonElement) {
    optionRefs.value[index] = element;
  }
}

/** 从 start 出发按 step 方向找最近的可选项下标（满员岗位不能聚焦）。 */
function nearestEnabledIndex(start: number, step: 1 | -1): number {
  const total = props.options.length;
  let index = start;
  for (let guard = 0; guard < total; guard += 1) {
    index = (index + step + total) % total;
    const option = props.options[index];
    if (option !== undefined && !isDisabled(option)) return index;
  }
  return start;
}

function focusOption(index: number, step: 1 | -1 = 1): void {
  if (props.options.length === 0) return;
  const safeIndex = (index + props.options.length) % props.options.length;
  const option = props.options[safeIndex];
  const target =
    option !== undefined && isDisabled(option) ? nearestEnabledIndex(safeIndex, step) : safeIndex;
  activeIndex.value = target;
  void nextTick(() => optionRefs.value[target]?.focus());
}

function showMenu(focusSelected = false): void {
  if (props.disabled || props.options.length === 0) return;
  const selectedIndex = props.options.findIndex((option) => option.id === props.modelValue);
  activeIndex.value = selectedIndex < 0 ? 0 : selectedIndex;
  open.value = true;
  if (focusSelected) focusOption(activeIndex.value);
}

function closeMenu(restoreFocus = false): void {
  open.value = false;
  optionRefs.value = [];
  if (restoreFocus) {
    void nextTick(() => trigger.value?.focus());
  }
}

function focusAdjacentControl(backward: boolean): void {
  void nextTick(() => {
    const controls = Array.from(
      document.querySelectorAll<globalThis.HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const triggerIndex = trigger.value === null ? -1 : controls.indexOf(trigger.value);
    const target = controls[triggerIndex + (backward ? -1 : 1)];
    target?.focus();
  });
}

function toggleMenu(): void {
  if (open.value) closeMenu();
  else showMenu(false);
}

function choose(option: AssignmentOptionView): void {
  // 满员岗位点不动（按钮本身也是 disabled，这里是键盘/程序化触发的兜底）。
  if (isDisabled(option)) return;
  closeMenu(true);
  // 与原生 select 的 change 语义一致：选择当前岗位不重复发送写请求。
  if (option.id !== props.modelValue) {
    emit('change', option.id);
  }
}

function onTriggerKeydown(event: globalThis.KeyboardEvent): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    showMenu(true);
  } else if (event.key === 'Escape') {
    closeMenu();
  }
}

function onOptionKeydown(event: globalThis.KeyboardEvent, index: number): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusOption(index + 1, 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusOption(index - 1, -1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusOption(0, 1);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusOption(props.options.length - 1, -1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === 'Tab') {
    // 菜单会被 v-if 卸载，显式接续焦点，避免旧浏览器把焦点丢回 body。
    event.preventDefault();
    closeMenu();
    focusAdjacentControl(event.shiftKey);
  }
}

function onOptionFocus(index: number): void {
  activeIndex.value = index;
}

function onDocumentPointer(event: globalThis.MouseEvent | globalThis.TouchEvent): void {
  const target = event.target;
  if (open.value && target instanceof window.Node && !root.value?.contains(target)) {
    closeMenu();
  }
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && open.value) closeMenu(true);
  },
);

onMounted(() => {
  document.addEventListener('mousedown', onDocumentPointer);
  document.addEventListener('touchstart', onDocumentPointer);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onDocumentPointer);
  document.removeEventListener('touchstart', onDocumentPointer);
});
</script>

<template>
  <div ref="root" class="assignment-select" :class="{ 'is-open': open, 'is-disabled': disabled }">
    <button
      ref="trigger"
      class="assignment-trigger"
      type="button"
      :aria-disabled="disabled"
      :aria-label="`${label}，当前岗位 ${currentName}`"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click="toggleMenu"
      @keydown="onTriggerKeydown"
    >
      <span class="assignment-trigger-label">{{ currentName }}</span>
      <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </button>

    <div v-if="open" class="assignment-menu" role="listbox" :aria-label="`${label}岗位`">
      <button
        v-for="(option, index) in options"
        :key="option.id"
        :ref="(element) => setOptionRef(element as Element | null, index)"
        class="assignment-option"
        :class="{ selected: option.id === modelValue, 'is-full': isDisabled(option) }"
        type="button"
        role="option"
        :disabled="isDisabled(option)"
        :tabindex="index === activeIndex ? 0 : -1"
        :aria-selected="option.id === modelValue"
        @click="choose(option)"
        @focus="onOptionFocus(index)"
        @keydown="onOptionKeydown($event, index)"
      >
        <span class="option-seal" aria-hidden="true">{{ option.name.slice(0, 1) }}</span>
        <span>
          {{ displayName(option) }}
          <small v-if="isDisabled(option)" class="assignment-full-note">已满</small>
        </span>
        <svg v-if="option.id === modelValue" viewBox="0 0 18 18" aria-hidden="true">
          <path d="m4 9 3.2 3.2L14 5.8" />
        </svg>
      </button>
    </div>
  </div>
</template>
