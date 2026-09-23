<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { ApiError } from '../api/client';
import { login, register } from '../api/game';
import { fetchHealth } from '../api/system';
import type { ToastTone } from '../types/ui';

/** 登录 / 注册界面。成功后交给父组件重新同步状态。 */
const emit = defineEmits<{
  authenticated: [];
  notify: [tone: ToastTone, title: string, message: string];
}>();

const mode = ref<'login' | 'register'>('login');
const account = ref('');
const password = ref('');
const inviteCode = ref('');
const busy = ref(false);
const serverState = ref<'checking' | 'online' | 'offline'>('checking');
const serverVersion = ref('');

const isRegister = computed(() => mode.value === 'register');

async function checkServer(): Promise<void> {
  try {
    const health = await fetchHealth();
    serverState.value = 'online';
    serverVersion.value = health.data.configVersion;
  } catch {
    serverState.value = 'offline';
    emit('notify', 'warning', '山门驿未响应', '后端服务尚未就绪，请确认开发服务已经启动。');
  }
}

function validateForm(): boolean {
  const cleanAccount = account.value.trim();
  if (cleanAccount.length < 2 || cleanAccount.length > 32) {
    emit('notify', 'warning', '账号格式有误', '账号长度应为 2 至 32 个字符。');
    return false;
  }
  if (password.value.length < 8 || password.value.length > 128) {
    emit('notify', 'warning', '密码格式有误', '密码长度应为 8 至 128 个字符。');
    return false;
  }
  if (isRegister.value && inviteCode.value.trim().length > 64) {
    emit('notify', 'warning', '邀请码格式有误', '邀请码最多为 64 个字符。');
    return false;
  }
  return true;
}

async function submit(): Promise<void> {
  if (busy.value || !validateForm()) return;
  busy.value = true;
  try {
    if (mode.value === 'login') {
      await login(account.value.trim(), password.value);
    } else {
      const cleanInviteCode = inviteCode.value.trim();
      await register(
        account.value.trim(),
        password.value,
        cleanInviteCode.length === 0 ? undefined : cleanInviteCode,
      );
    }
    emit('authenticated');
  } catch (caught) {
    emit(
      'notify',
      'error',
      mode.value === 'login' ? '玉令核验失败' : '名册录入失败',
      caught instanceof ApiError ? caught.message : '暂时无法进入，请稍后重试。',
    );
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  void checkServer();
});
</script>

<template>
  <main class="auth-stage">
    <section class="auth-lore" aria-labelledby="world-title">
      <div class="lore-brand">
        <img class="lore-logo" src="/brand-logo.png" alt="" aria-hidden="true" />
        <div>
          <p class="eyebrow">开山立派 · 太初界</p>
          <h1 id="world-title">万法归山海<br /><span>一念启仙途</span></h1>
        </div>
      </div>

      <p class="lore-intro">
        灵脉苏醒，山门待兴。于云海深处经营一方仙宗，收徒授业，让每一次离开都化作归来时的积累。
      </p>

      <ul class="lore-features" aria-label="游戏特色">
        <li>
          <span class="feature-glyph" aria-hidden="true">息</span>
          <div><strong>离线修行</strong><small>山中岁月不曾停歇</small></div>
        </li>
        <li>
          <span class="feature-glyph" aria-hidden="true">门</span>
          <div><strong>宗门经营</strong><small>聚灵筑阁，调度百业</small></div>
        </li>
        <li>
          <span class="feature-glyph" aria-hidden="true">道</span>
          <div><strong>弟子问道</strong><small>识人授业，静候突破</small></div>
        </li>
      </ul>

      <blockquote>
        <span aria-hidden="true">“</span>
        <p>大道五十，天衍四九，遁去其一。<br />今日之山门，便由掌门亲启。</p>
      </blockquote>
    </section>

    <section class="auth-card" aria-labelledby="auth-title">
      <div class="card-ornament" aria-hidden="true"><i /><span>玄</span><i /></div>

      <header class="auth-card-head">
        <p class="eyebrow">掌门玉令</p>
        <h2 id="auth-title">{{ isRegister ? '录名入界' : '重返山门' }}</h2>
        <p>{{ isRegister ? '初来此界，请留下名号、密令与可选邀帖' : '验明身份，续写你的宗门长卷' }}</p>
      </header>

      <div class="auth-tabs" role="group" aria-label="身份方式">
        <button
          type="button"
          :disabled="busy"
          :aria-pressed="mode === 'login'"
          :class="{ active: mode === 'login' }"
          @click="mode = 'login'"
        >
          登临
        </button>
        <button
          type="button"
          :aria-pressed="mode === 'register'"
          :disabled="busy"
          :class="{ active: mode === 'register' }"
          @click="mode = 'register'"
        >
          入册
        </button>
      </div>

      <form class="auth-form" novalidate @submit.prevent="submit">
        <label class="field-group">
          <span class="field-label">掌门名号</span>
          <span class="field-control">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c.7-4 3-6 7-6s6.3 2 7 6" />
            </svg>
            <input
              v-model="account"
              autocomplete="username"
              minlength="2"
              maxlength="32"
              inputmode="text"
              placeholder="输入账号"
              required
            />
          </span>
        </label>

        <label class="field-group">
          <span class="field-label">护山密令</span>
          <span class="field-control">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v2" />
            </svg>
            <input
              v-model="password"
              type="password"
              :autocomplete="isRegister ? 'new-password' : 'current-password'"
              minlength="8"
              maxlength="128"
              placeholder="输入密码"
              required
            />
          </span>
        </label>

        <label v-if="isRegister" class="field-group">
          <span class="field-label">入界邀帖 <small>选填</small></span>
          <span class="field-control">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16v12H4V7Zm0 2 8 5 8-5M8 4h8" />
            </svg>
            <input
              v-model="inviteCode"
              autocomplete="off"
              maxlength="64"
              placeholder="若山门设限，请输入邀请码"
            />
          </span>
        </label>

        <button class="action-button primary-action auth-submit" type="submit" :disabled="busy">
          <span>{{ busy ? '灵纹核验中' : isRegister ? '录入仙册' : '开启山门' }}</span>
          <svg v-if="!busy" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h13m-5-5 5 5-5 5" />
          </svg>
          <span v-else class="button-spinner" aria-hidden="true" />
        </button>
      </form>

      <footer class="auth-card-foot">
        <span class="server-light" :class="serverState" aria-hidden="true" />
        <span v-if="serverState === 'checking'">正在感应山门驿</span>
        <span v-else-if="serverState === 'online'">山门驿畅通 · {{ serverVersion }}</span>
        <span v-else>山门驿暂未连通</span>
      </footer>
    </section>
  </main>
</template>
