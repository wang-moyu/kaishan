<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { ApiError } from '../api/client';
import { changePassword, fetchMe } from '../api/game';
import type { ToastTone } from '../types/ui';
import { formatTime } from '../utils/format';
import ModalShell from './ModalShell.vue';

/**
 * 账号弹窗：查看账号信息 + 修改密码。
 *
 * 账号名与注册时间打开时从 /auth/me 现取（不在全局 state 里常驻）；改密码直接调 auth 接口，
 * 不走 App 的全局 busy 门闩（与宗门写操作互不相干）。
 * 规则的最终裁决在服务端：旧密码错误、限频、新旧相同都以服务端返回为准，这里只做即时提示。
 * 成功后其他设备的会话全部失效，当前设备保持登录。
 */
const props = defineProps<{
  sectName: string;
}>();

const emit = defineEmits<{
  close: [];
  notify: [tone: ToastTone, title: string, message: string];
}>();

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

const account = ref<string | null>(null);
const createdAt = ref<string | null>(null);
const loadError = ref('');

const oldPassword = ref('');
const newPassword = ref('');
const confirmPassword = ref('');
const submitting = ref(false);
const submitError = ref('');

onMounted(async () => {
  try {
    const me = await fetchMe();
    account.value = me.user.account;
    createdAt.value = me.user.createdAt;
  } catch (caught) {
    loadError.value = caught instanceof ApiError ? caught.message : '账号信息获取失败，请稍后重试。';
  }
});

/** 即时校验（只挡明显不合规的输入；空表单不报错，只禁用提交）。 */
const formHint = computed<string>(() => {
  if (newPassword.value === '') return '';
  if (newPassword.value.length < MIN_PASSWORD_LENGTH || newPassword.value.length > MAX_PASSWORD_LENGTH) {
    return `新密码长度应为 ${MIN_PASSWORD_LENGTH} 至 ${MAX_PASSWORD_LENGTH} 个字符。`;
  }
  if (oldPassword.value !== '' && newPassword.value === oldPassword.value) {
    return '新密码不能与当前密码相同。';
  }
  if (confirmPassword.value !== '' && confirmPassword.value !== newPassword.value) {
    return '两次输入的新密码不一致。';
  }
  return '';
});

const canSubmit = computed(
  () =>
    !submitting.value &&
    oldPassword.value !== '' &&
    newPassword.value !== '' &&
    confirmPassword.value === newPassword.value &&
    formHint.value === '',
);

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = '';
  try {
    const { revokedSessions } = await changePassword(oldPassword.value, newPassword.value);
    emit(
      'notify',
      'success',
      '密码已修改',
      revokedSessions > 0
        ? `其他 ${String(revokedSessions)} 处登录已下线，本机保持登录。`
        : '下次登录请使用新密码。',
    );
    emit('close');
  } catch (caught) {
    submitError.value = caught instanceof ApiError ? caught.message : '修改失败，请稍后重试。';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <ModalShell narrow :loading="submitting" loading-text="正在更换密码" label="账号与密码" @close="emit('close')">
    <section class="account-dialog" aria-labelledby="account-dialog-title">
      <header class="section-heading panel-heading compact-heading">
        <div>
          <p class="eyebrow">掌门玉令</p>
          <h2 id="account-dialog-title">账号与密码</h2>
        </div>
      </header>

      <dl class="disciple-facts">
        <div>
          <dt>账号</dt>
          <dd>{{ account ?? (loadError ? '—' : '读取中…') }}</dd>
        </div>
        <div>
          <dt>注册时间</dt>
          <dd>{{ createdAt === null ? (loadError ? '—' : '读取中…') : formatTime(createdAt) }}</dd>
        </div>
        <div>
          <dt>所属宗门</dt>
          <dd>{{ props.sectName }}</dd>
        </div>
      </dl>
      <p v-if="loadError" class="blocked-hint" role="alert">{{ loadError }}</p>

      <form class="account-form" novalidate @submit.prevent="submit">
        <p class="eyebrow">修改密码</p>
        <!-- 给密码管理器识别账号用，不可见也不可聚焦。 -->
        <input class="account-username" type="text" autocomplete="username" :value="account ?? ''" readonly tabindex="-1" aria-hidden="true" />

        <label class="field-group">
          <span class="field-label">当前密码</span>
          <span class="field-control">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v2" />
            </svg>
            <input
              v-model="oldPassword"
              type="password"
              autocomplete="current-password"
              :maxlength="MAX_PASSWORD_LENGTH"
              placeholder="输入当前密码"
              required
            />
          </span>
        </label>

        <label class="field-group">
          <span class="field-label">新密码</span>
          <span class="field-control">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v2" />
            </svg>
            <input
              v-model="newPassword"
              type="password"
              autocomplete="new-password"
              :minlength="MIN_PASSWORD_LENGTH"
              :maxlength="MAX_PASSWORD_LENGTH"
              :placeholder="`${MIN_PASSWORD_LENGTH} 至 ${MAX_PASSWORD_LENGTH} 个字符`"
              required
            />
          </span>
        </label>

        <label class="field-group">
          <span class="field-label">确认新密码</span>
          <span class="field-control">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v2" />
            </svg>
            <input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              :maxlength="MAX_PASSWORD_LENGTH"
              placeholder="再输入一次新密码"
              required
            />
          </span>
        </label>

        <p class="disciple-note-meta" :class="{ 'is-error': formHint !== '' || submitError !== '' }" role="status">
          {{ submitError || formHint || '修改后，其他设备上的登录会全部失效，本机保持登录。' }}
        </p>

        <div class="disciple-break-confirm-actions">
          <button class="action-button" type="button" :disabled="submitting" @click="emit('close')">取消</button>
          <button class="action-button primary-action" type="submit" :disabled="!canSubmit">
            <span>{{ submitting ? '修改中…' : '确认修改' }}</span>
          </button>
        </div>
      </form>
    </section>
  </ModalShell>
</template>
