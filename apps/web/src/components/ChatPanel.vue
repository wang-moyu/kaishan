<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type { ChatMessageView } from '../api/game';
import { fetchChatMessages, sendChatMessage } from '../api/game';
import { EMOJI_LIST, renderEmoji } from '../utils/emoji';

const collapsed = ref(localStorage.getItem('chat-collapsed') === '1');
const messages = ref<ChatMessageView[]>([]);
const input = ref('');
const sending = ref(false);
const listEl = ref<HTMLElement | null>(null);
const loadError = ref<string | null>(null);
const showEmojiPicker = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

watch(collapsed, (v) => {
  localStorage.setItem('chat-collapsed', v ? '1' : '0');
  // 重新展开时立刻补拉一次，收起期间没有轮询。
  if (!v) void load();
});

let pollTimer: ReturnType<typeof setInterval> | undefined;
let latestId: string | undefined;
let sendVersion = 0;

function scrollToBottom(): void {
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

async function load(): Promise<void> {
  const v = sendVersion;
  try {
    const result = await fetchChatMessages(latestId);
    if (v !== sendVersion) return;
    if (latestId && result.length > 0) {
      const existing = new Set(messages.value.map((m) => m.id));
      const fresh = result.filter((m) => !existing.has(m.id));
      if (fresh.length > 0) {
        messages.value = [...messages.value, ...fresh];
      }
    } else if (!latestId) {
      messages.value = result;
    }
    if (messages.value.length > 0) {
      latestId = messages.value[messages.value.length - 1].id;
    }
    loadError.value = null;
    await nextTick();
    scrollToBottom();
  } catch {
    if (!latestId) loadError.value = '聊天加载失败';
  }
}

async function handleSend(): Promise<void> {
  const content = input.value.trim();
  if (content === '' || sending.value) return;
  sending.value = true;
  sendVersion++;
  try {
    const result = await sendChatMessage(content);
    messages.value = result;
    if (result.length > 0) {
      latestId = result[result.length - 1].id;
    }
    input.value = '';
    loadError.value = null;
    await nextTick();
    scrollToBottom();
  } catch (caught) {
    loadError.value = caught instanceof Error ? caught.message : '发送失败';
  } finally {
    sending.value = false;
  }
}

function insertEmoji(code: string): void {
  input.value += `[${code}]`;
  showEmojiPicker.value = false;
  inputEl.value?.focus();
}

function onPickerOutsideClick(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  if (!target.closest('.emoji-picker-wrap')) {
    showEmojiPicker.value = false;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function renderContent(text: string): string {
  return renderEmoji(text);
}

onMounted(() => {
  load();
  // 面板收起或标签页在后台时不轮询：没人看的时候不必每 8 秒请求一次。
  pollTimer = setInterval(() => {
    if (!collapsed.value && !document.hidden) void load();
  }, 8_000);
  document.addEventListener('click', onPickerOutsideClick);
});

onUnmounted(() => {
  if (pollTimer !== undefined) clearInterval(pollTimer);
  document.removeEventListener('click', onPickerOutsideClick);
});
</script>

<template>
  <section class="game-panel chat-panel" aria-labelledby="chat-title">
    <header class="section-heading panel-heading compact-heading chat-heading" @click="collapsed = !collapsed">
      <h2 id="chat-title" class="home-section-title">全服聊天</h2>
      <button
        class="chat-collapse-btn"
        type="button"
        :aria-expanded="!collapsed"
        aria-controls="chat-body"
        @click.stop="collapsed = !collapsed"
      >{{ collapsed ? '展开' : '收起' }}</button>
    </header>

    <div v-show="!collapsed" id="chat-body" class="chat-body">
      <div ref="listEl" class="chat-list">
        <p v-if="loadError && messages.length === 0" class="chat-hint">{{ loadError }}</p>
        <p v-else-if="messages.length === 0" class="chat-hint">暂无消息</p>
        <div v-for="msg in messages" :key="msg.id" class="chat-msg" :class="{ 'is-me': msg.isMe, 'is-system': msg.isSystem }">
          <span class="chat-time">{{ formatTime(msg.createdAt) }}</span>
          <span class="chat-name">{{ msg.sectName }}</span>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <span class="chat-text" v-html="renderContent(msg.content)"></span>
        </div>
      </div>

      <form class="chat-input-row" @submit.prevent="handleSend">
        <div class="emoji-picker-wrap">
          <button
            class="emoji-toggle-btn"
            type="button"
            title="表情"
            @click.stop="showEmojiPicker = !showEmojiPicker"
          >😊</button>
          <div v-if="showEmojiPicker" class="emoji-picker" @click.stop>
            <button
              v-for="emoji in EMOJI_LIST"
              :key="emoji.code"
              class="emoji-item"
              type="button"
              :title="emoji.label"
              @click="insertEmoji(emoji.code)"
            >
              <img :src="`/emoji/${emoji.file}`" :alt="emoji.label" />
            </button>
          </div>
        </div>
        <input
          ref="inputEl"
          v-model="input"
          class="chat-input"
          type="text"
          maxlength="200"
          placeholder="说点什么…"
          :disabled="sending"
        />
        <button class="chat-send-btn" type="submit" :disabled="sending || input.trim() === ''">发送</button>
      </form>

      <p v-if="loadError && messages.length > 0" class="chat-error">{{ loadError }}</p>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  padding: 18px;
  margin-bottom: 12px;
}

.chat-heading {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.chat-collapse-btn {
  background: none;
  border: 1px solid rgba(119, 184, 154, 0.16);
  border-radius: 2px;
  color: #9db3a8;
  font-size: 12px;
  padding: 2px 8px;
  cursor: pointer;
}

.chat-collapse-btn:hover {
  color: var(--gold);
  border-color: rgba(202, 169, 106, 0.3);
}

.chat-body {
  display: flex;
  flex-direction: column;
}

.chat-list {
  height: 220px;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 4px 0;
}

.chat-list::-webkit-scrollbar {
  display: none;
}

.chat-hint {
  text-align: center;
  color: #6a7a6f;
  font-size: 13px;
  padding: 16px 0;
}

.chat-msg {
  padding: 3px 0;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.chat-msg.is-me .chat-name {
  color: var(--gold);
}

.chat-time {
  color: #5a6a5f;
  font-size: 11px;
  margin-right: 6px;
}

.chat-name {
  color: var(--jade);
  margin-right: 6px;
  font-weight: 600;
}

.chat-text {
  color: var(--fg);
}

/* v-html 内的 img 需要 :deep 穿透 scoped */
.chat-text :deep(.chat-emoji) {
  width: 20px;
  height: 20px;
  vertical-align: text-bottom;
  margin: 0 1px;
}

.chat-msg.is-system .chat-name {
  color: #e06050;
}

.chat-msg.is-system .chat-text {
  color: #d4a76a;
}

.chat-input-row {
  display: flex;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--line);
  align-items: center;
}

.emoji-picker-wrap {
  position: relative;
}

.emoji-toggle-btn {
  background: none;
  border: none;
  font-size: 18px;
  cursor: pointer;
  padding: 2px;
  line-height: 1;
}

.emoji-picker {
  position: absolute;
  bottom: 32px;
  left: 0;
  width: 240px;
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: thin;
  background: rgba(13, 32, 27, 0.97);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  z-index: 10;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.emoji-item {
  background: none;
  border: 1px solid transparent;
  border-radius: 3px;
  cursor: pointer;
  padding: 3px;
  line-height: 0;
}

.emoji-item:hover {
  background: rgba(119, 184, 154, 0.15);
  border-color: rgba(119, 184, 154, 0.3);
}

.emoji-item img {
  width: 28px;
  height: 28px;
}

.chat-input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--fg);
  font-size: 13px;
  padding: 5px 8px;
  outline: none;
}

.chat-input:focus {
  border-color: var(--jade);
}

.chat-input::placeholder {
  color: #5a6a5f;
}

.chat-send-btn {
  background: rgba(119, 184, 154, 0.12);
  border: 1px solid rgba(119, 184, 154, 0.25);
  border-radius: 3px;
  color: var(--jade);
  font-size: 13px;
  padding: 5px 12px;
  cursor: pointer;
  white-space: nowrap;
}

.chat-send-btn:hover:not(:disabled) {
  background: rgba(119, 184, 154, 0.2);
  border-color: var(--jade);
}

.chat-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-error {
  color: var(--red, #c75050);
  font-size: 12px;
  margin-top: 4px;
}

@media (max-width: 900px) {
  .chat-panel {
    padding: 14px;
  }
}
</style>
