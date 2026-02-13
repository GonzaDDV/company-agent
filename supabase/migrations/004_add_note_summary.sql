-- Add summary column to notes for digest-friendly one-liners
ALTER TABLE notes ADD COLUMN IF NOT EXISTS summary text;
