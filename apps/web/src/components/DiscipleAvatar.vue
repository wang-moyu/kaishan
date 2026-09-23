<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { avatarFrameOption, resolveAvatarFrameId } from '../utils/avatarFrames';

/**
 * 弟子头像：框图 + 中央姓名首字。
 *
 * 层级固定为「最外修为环 → 框图 → 中央姓名首字」：修为环由调用方包在外层
 * （名册是 `.disciple-ring`，详情头部是 `.disciple-detail-portrait`），
 * 这里只画框图与首字。框图始终在首字**下面**，即使素材中央不透明也遮不住姓名。
 *
 * 服务端给的样式 id 只认白名单；未知值或图片加载失败都回退旧式外观（classic），
 * 绝不把破图、占位图或任意 URL 当成果。首字与性别标记是装饰，
 * 语义名称由调用方给出（名册按钮的 aria-label、详情头部的姓名标题）。
 */
const props = defineProps<{
  name: string;
  gender: string;
  realmId: string;
  /** 服务端样式 id（未知值按 classic 处理）。 */
  frameId: string;
  /** detail = 详情头部与预览用的大尺寸。 */
  variant?: 'roster' | 'detail';
}>();

const imageFailed = ref(false);

const option = computed(() => avatarFrameOption(props.frameId));
/** 实际渲染用的样式 id：图片失败时回退 classic（只影响图片，不显示破图）。 */
const frameId = computed(() => resolveAvatarFrameId(props.frameId, imageFailed.value));
const showImage = computed(() => option.value.src !== null && !imageFailed.value);

// 换了弟子或换了样式就重新给图片一次机会：上一次的 404 不该永久锁死这一行。
watch(
  () => [props.name, option.value.src],
  () => {
    imageFailed.value = false;
  },
);
</script>

<template>
  <div
    class="disciple-avatar"
    :class="[`realm-${realmId}`, variant === 'detail' ? 'is-large' : '']"
    :data-frame="frameId"
    aria-hidden="true"
  >
    <img
      v-if="showImage"
      class="disciple-frame"
      :src="option.src ?? ''"
      alt=""
      decoding="async"
      @error="imageFailed = true"
    />
    <span class="disciple-avatar-char">{{ name.slice(0, 1) }}</span>
    <i>{{ gender === 'female' ? '坤' : '乾' }}</i>
  </div>
</template>
