-- Persistent conversation history for the Telegram bot.
-- Stores user and assistant messages per chat so history survives restarts.

CREATE TABLE messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_messages_chat_id ON messages (chat_id, created_at DESC);

-- Cleanup: auto-delete messages older than 30 days
-- Run via pg_cron or manually:
--   DELETE FROM messages WHERE created_at < now() - INTERVAL '30 days';
