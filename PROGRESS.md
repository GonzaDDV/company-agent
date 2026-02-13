# Progress Tracker

Track implementation progress. Update this file as work is completed.

---

## Phase 1 — Core Agent (Telegram + Data)

### Setup
- [x] Project scaffolding (package.json, tsconfig, biome, .gitignore)
- [x] Directory structure
- [x] Environment config with Zod validation
- [x] Team member config module
- [x] CLAUDE.md documentation
- [ ] Create Telegram bot via @BotFather → get token
- [ ] Create Agent Supabase project → get URL + service role key
- [ ] Run `001_initial_schema.sql` migration on Agent DB
- [ ] Apply `patagon-migrations/add_readonly_query.sql` to Patagon DB
- [ ] Fill in `.env` with real credentials
- [ ] Add team members to `src/config/team.ts`
- [ ] `pnpm install` and verify `pnpm dev` starts without errors
- [ ] First successful bot interaction on Telegram

### Agent Core
- [x] Agent brain with Claude tool use loop (`src/agent/core.ts`)
- [x] System prompt (`src/agent/prompts.ts`)
- [x] Tool registry with permission filtering (`src/tools/index.ts`)
- [x] Conversation memory (in-memory, per chat)
- [ ] Verify tool loop handles multiple sequential tool calls
- [ ] Verify error handling when tools fail
- [ ] Test conversation memory across multiple messages

### Telegram Bot
- [x] Bot setup with grammY (`src/bot/telegram.ts`)
- [x] Auth middleware (team members only)
- [x] Commands: /start, /reset, /help
- [x] Message splitting for long responses (>4096 chars)
- [x] Typing indicator during processing
- [ ] Test all commands work
- [ ] Test long response splitting
- [ ] Test unauthorized user rejection

### Tools — Patagon DB
- [x] Read-only SQL query tool (`src/tools/patagon-db.ts`)
- [x] SQL injection prevention (SELECT-only, blocked keywords)
- [ ] Apply `execute_readonly_query` function to Patagon DB
- [ ] Test: "How many active markets do we have?"
- [ ] Test: "What's our total purchase volume this month?"
- [ ] Test: "Which investors have completed KYC?"

### Tools — Knowledge Store
- [x] Store notes/tasks/ideas/logistics/legal (`src/tools/knowledge.ts`)
- [x] Search notes with filters
- [x] Update note status
- [ ] Test: "Remember that we need to follow up with lawyers about X"
- [ ] Test: "What open tasks do we have?"
- [ ] Test: "Mark task [id] as done"

### Tools — Nerd Fuel
- [x] Store readings with metadata (`src/tools/readings.ts`)
- [x] Search readings by keyword and type
- [ ] Test: "Store as nerd fuel: [url] — great article about X"
- [ ] Test: "What articles have we saved about fintech?"
- [ ] Test: "Show me all saved podcasts"

### Tools — People
- [x] Store contacts (`src/tools/people.ts`)
- [x] Search people by name/company/role
- [x] Update contact info
- [ ] Test: "What do we know about John from Sequoia?"
- [ ] Test: "Store contact: Sarah Chen, VP at Stripe, met at conference"
- [ ] Test: "Who do we know at Goldman?"

---

## Phase 2 — Integrations

### Monday.com CRM
- [ ] Get Monday.com board structure from team
- [ ] Implement Monday.com GraphQL client
- [ ] Create `src/tools/monday.ts` — search contacts
- [ ] Create `src/tools/monday.ts` — search deals/pipeline
- [ ] Create `src/tools/monday.ts` — update CRM entries (with confirmation)
- [ ] Test CRM queries

### Granola Transcripts
- [ ] Determine ingestion method (email forwarding, API, manual paste)
- [ ] Implement transcript storage tool
- [ ] Implement transcript search
- [ ] Test: paste a transcript and search for content within it
- [ ] Auto-extract action items from transcripts (stretch)

### Semantic Search (pgvector)
- [ ] Add pgvector extension to Agent DB
- [ ] Create embeddings table and migration
- [ ] Choose embedding provider (OpenAI, Voyage, etc.)
- [ ] Implement embedding generation utility
- [ ] Upgrade search tools to use semantic search with fallback to ilike

---

## Phase 3 — Multi-Channel + Automation

### Slack Bot
- [ ] Create Slack app
- [ ] Implement Slack bot using @slack/bolt
- [ ] Route to same agent core
- [ ] Post to #nerd-fuel channel when readings are added
- [ ] Post alerts for stale purchases, KYC issues, etc.

### Telegram Enhancements
- [ ] Persist conversation history to DB (survive restarts)
- [ ] Group chat support (bot responds when mentioned)
- [ ] Inline buttons for common actions (mark task done, etc.)

### Proactive Features
- [ ] Daily digest: open tasks, stuck purchases, follow-up reminders
- [ ] Stale contact alerts ("Haven't talked to X in 2+ months")
- [ ] New reading notifications to team

### Web UI
- [ ] Simple chat interface (Next.js)
- [ ] Authenticated via Supabase Auth
- [ ] Same agent core, different channel adapter

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-02-13 | Telegram-first, no web UI | Simpler for team, everyone has Telegram |
| 2025-02-13 | Separate Agent DB from Patagon DB | Clean separation, Patagon stays untouched |
| 2025-02-13 | grammY over Telegraf | Better TypeScript support, more actively maintained |
| 2025-02-13 | ilike search for Phase 1, pgvector for Phase 2 | Ship faster, upgrade search later |
| 2025-02-13 | In-memory conversations | Good enough for Phase 1, DB persistence later |
| 2025-02-13 | Sonnet for tool use | Cost-effective, fast enough for chat |
| 2025-02-13 | Team config in code, not DB | 7 people, rarely changes, version controlled |

---

## Known Issues / Tech Debt

- Search uses `ilike` which is slow on large datasets — upgrade to pgvector in Phase 2
- Conversation history lost on restart — add DB persistence
- No rate limiting on agent API calls — add if costs become a concern
- No logging beyond console — add structured logging (pino) if needed
- `execute_readonly_query` in Patagon DB could theoretically be abused with expensive queries — the 5s timeout mitigates this
