-- 0022: 全服聊天消息
CREATE TABLE chat_messages (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  sect_name  TEXT    NOT NULL,
  content    TEXT    NOT NULL CHECK(length(content) >= 1 AND length(content) <= 200),
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_chat_messages_created_at ON chat_messages (created_at DESC);
