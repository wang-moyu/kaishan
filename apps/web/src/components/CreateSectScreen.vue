<script setup lang="ts">
import { computed, ref } from 'vue';

import { ApiError } from '../api/client';
import { createSect } from '../api/game';
import type { SectStateView } from '../api/game';
import type { ToastTone } from '../types/ui';

/** 创建宗门：初始弟子、建筑和资源仍全部由服务端按配置发放。 */
const emit = defineEmits<{
  created: [state: SectStateView];
  logout: [];
  notify: [tone: ToastTone, title: string, message: string];
}>();

const name = ref('');
const busy = ref(false);

const cleanName = computed(() => name.value.trim());
// 按 Unicode 码点计数（与服务端 normalizeEntityName 同一口径；星平面字符算 1 个）。
// maxlength 是浏览器按 UTF-16 单元算的，所以留 24 个单元 = 12 个星平面字符的余量，
// 真正的规则由 validateName 的 nameCount 判定。
const nameCount = computed(() => Array.from(cleanName.value).length);

function validateName(): boolean {
  if (nameCount.value < 2 || nameCount.value > 12) {
    emit('notify', 'warning', '宗名尚未成形', '宗门名需为 2 至 12 个字符。');
    return false;
  }
  return true;
}

async function submit(): Promise<void> {
  if (busy.value || !validateName()) return;
  busy.value = true;
  try {
    const state = await createSect(cleanName.value);
    emit('created', state);
  } catch (caught) {
    emit(
      'notify',
      'error',
      '立派未成',
      caught instanceof ApiError ? caught.message : '创建失败，请稍后再试。',
    );
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="founding-stage">
    <section class="founding-banner">
      <button class="quiet-button back-button" type="button" :disabled="busy" @click="emit('logout')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
        更换掌门玉令
      </button>

      <div class="founding-heading">
        <p class="eyebrow">山河有待 · 一宗将起</p>
        <h1>为你的仙门，<span>落下第一笔。</span></h1>
        <p>宗名一经镌刻，三位初入道途的弟子与三座宗门建筑将随之归位。</p>
      </div>
    </section>

    <section class="founding-card" aria-labelledby="founding-title">
      <div class="founding-seal" aria-hidden="true">
        <span>{{ cleanName.slice(0, 1) || '宗' }}</span>
        <i />
      </div>

      <div class="founding-form-wrap">
        <header>
          <p class="eyebrow">第一卷 · 开宗</p>
          <h2 id="founding-title">镌刻宗门之名</h2>
          <p>取一方名号，自此山河万卷皆由此展开。</p>
        </header>

        <form class="founding-form" novalidate @submit.prevent="submit">
          <label class="field-group founding-field">
            <span class="field-label">宗门名号</span>
            <span class="field-control">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 19h16M6 19v-8l6-5 6 5v8M9 12h6m-3-6V3" />
              </svg>
              <input
                v-model="name"
                minlength="2"
                maxlength="24"
                autocomplete="off"
                placeholder="例如：太虚剑宗"
                required
              />
              <span class="field-count">{{ nameCount }}/12</span>
            </span>
          </label>

          <p class="founding-hint">宗门名不可与其他宗门重名；立派之后再改名要花 500 灵石。</p>

          <button class="action-button primary-action founding-submit" type="submit" :disabled="busy">
            <span>{{ busy ? '敕令正在落印' : '敕立山门' }}</span>
            <svg v-if="!busy" viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 15 6-6 6 6M12 9v11M5 4h14" />
            </svg>
            <span v-else class="button-spinner" aria-hidden="true" />
          </button>
        </form>
      </div>

      <aside class="founding-gifts" aria-label="开宗赐予">
        <p class="eyebrow">开宗赐予</p>
        <ul>
          <li><span aria-hidden="true">人</span><div><strong>三名弟子</strong><small>各循其职，静候掌门调度</small></div></li>
          <li><span aria-hidden="true">殿</span><div><strong>三座建筑</strong><small>聚灵、灵药与灵矿俱全</small></div></li>
          <li><span aria-hidden="true">藏</span><div><strong>初始资源</strong><small>足以开启宗门第一轮经营</small></div></li>
        </ul>
        <p class="gift-note">具体弟子、建筑与资源均由天地法则（服务端配置）生成。</p>
      </aside>
    </section>
  </main>
</template>
