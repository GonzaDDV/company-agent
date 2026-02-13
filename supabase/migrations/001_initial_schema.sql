-- Company Agent — Initial Schema
-- This is the agent's own database (separate from Patagon's).

-- Notes: general knowledge store (tasks, ideas, logistics, legal, etc.)
CREATE TABLE notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  type text NOT NULL CHECK (type IN ('note', 'task', 'idea', 'logistics', 'legal')),
  tags text[] DEFAULT '{}',
  company text CHECK (company IS NULL OR company IN ('thc', 'patagon')),
  status text DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
  author_name text,
  author_telegram_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Readings: the "Nerd Fuel" library
CREATE TABLE readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text,
  title text NOT NULL,
  summary text,
  content_type text NOT NULL CHECK (content_type IN ('article', 'podcast', 'book', 'video', 'paper', 'thread')),
  tags text[] DEFAULT '{}',
  submitted_by_name text,
  submitted_by_telegram_id text,
  created_at timestamptz DEFAULT now()
);

-- People: external contacts and relationships
CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company text,
  role text,
  notes text,
  known_by text[] DEFAULT '{}',
  tags text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Transcripts: meeting notes (from Granola, manual paste, etc.)
CREATE TABLE transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content text NOT NULL,
  summary text,
  participants text[] DEFAULT '{}',
  meeting_date timestamptz,
  source text DEFAULT 'manual' CHECK (source IN ('granola', 'manual')),
  author_telegram_id text,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_notes_type ON notes (type);
CREATE INDEX idx_notes_company ON notes (company);
CREATE INDEX idx_notes_status ON notes (status);
CREATE INDEX idx_notes_created ON notes (created_at DESC);
CREATE INDEX idx_readings_content_type ON readings (content_type);
CREATE INDEX idx_readings_created ON readings (created_at DESC);
CREATE INDEX idx_people_name ON people USING gin (to_tsvector('english', name));
CREATE INDEX idx_transcripts_date ON transcripts (meeting_date DESC);
