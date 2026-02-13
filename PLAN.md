# Company Agent — Plan

## What is this?

An internal AI agent for The Holdin Co (THC) and its portfolio companies (starting with Patagon Markets). It's a Telegram bot that serves as the team's shared brain — answering business questions, storing knowledge, tracking ideas and tasks, and managing contacts.

The team is 7 people: 4 engineers, 3 ops/compliance/admin/sales. 5 people work for THC, some overlap with Patagon. The agent should be useful for both technical and non-technical members.

## Why?

1. **Institutional knowledge is siloed** — in people's heads, Granola transcripts, Monday.com, and the database. Nobody has the full picture.
2. **Data questions require a technical person** — "how much volume this month?" shouldn't need an engineer to answer.
3. **CRM maintenance is a chore** — Monday.com gets stale because updating it is friction.
4. **Ideas and tasks get lost** — things come up in conversation and disappear.
5. **Relationship context is scattered** — who knows whom, what was discussed, what's the history with a person.

The agent unifies all of this behind a natural language interface that anyone can use.

## Architecture Decisions

### One agent, not two
THC is the parent company. Patagon is a portfolio company under it. The agent serves THC, with Patagon-specific tools available to Patagon team members. If more portfolio companies are added, they get their own tool sets. This avoids maintaining multiple agents while keeping data access properly scoped.

### Two databases
- **Agent DB** — the agent's own knowledge store (notes, readings, people, transcripts). New Supabase project.
- **Patagon DB** — Patagon's production database. Read-only access via a SQL RPC function.

The agent connects to both. This keeps Patagon's DB clean and the agent's knowledge store independent.

### Telegram-first
The team uses Telegram. Building a web UI adds complexity without adding value for Phase 1. Slack and web can come later as additional channels — the agent core is channel-agnostic.

### Claude with tool use
The agent is Claude (Sonnet) with tools. It doesn't "know" things — it has tools to query databases, store notes, search contacts, etc. Claude decides which tools to call based on the user's question. This is more reliable and maintainable than RAG-only approaches because structured data (DB, CRM) is queried live, not embedded.

## Phases

### Phase 1 — Core Agent (current)
**Goal:** A working Telegram bot the team actually uses daily.

What it does:
- Answers Patagon business questions (SQL queries against the DB)
- Stores and searches notes, tasks, ideas (the knowledge store)
- Stores and searches articles/podcasts/books (Nerd Fuel library)
- Stores and searches external contacts (people directory)

What's needed:
- Create Telegram bot (@BotFather)
- Create Agent Supabase project + run migration
- Apply readonly query function to Patagon DB
- Fill in env vars, add team members
- `pnpm dev`

**Success metric:** 3+ team members using it at least once per day within the first week.

### Phase 2 — Integrations
**Goal:** Connect to existing tools so the agent has the full picture.

**Monday.com CRM:**
- Read contacts, deals, pipeline status
- Update CRM entries (with human confirmation before writes)
- Requires: Monday.com board structure documentation

**Granola transcripts:**
- Ingest meeting transcripts (start with manual paste or email forwarding)
- Search across all meeting history
- "What did we discuss with X last time?" works
- Stretch: auto-extract action items from transcripts

**Semantic search (pgvector):**
- Add vector embeddings for all stored text (notes, transcripts, readings)
- Upgrade search from keyword (ilike) to semantic
- "Ideas we had about marketing" finds relevant notes even without the word "marketing"

### Phase 3 — Multi-Channel + Proactive
**Goal:** Meet people where they are + agent takes initiative.

**Additional channels:**
- Slack bot (post nerd fuel to #nerd-fuel, alerts to #ops)
- Web UI (for longer sessions, reading library browsing)

**Proactive features:**
- Daily digest: open tasks, stuck purchases, follow-up reminders
- Stale contact alerts ("Haven't talked to X in 2 months")
- New reading notifications

**Conversation persistence:**
- Save chat history to DB (survive restarts)
- Per-user conversation threads

### Phase 4 — Deep Integrations (future)
- Email integration (Gmail/Outlook) for lawyer communications
- Google Calendar for team schedules/travel
- Auto-CRM: after meeting transcripts are ingested, draft CRM updates for approval
- Document review: summarize legal docs, compare against standard terms

## How the Agent Works (for non-technical team)

You message the bot on Telegram like you'd message a colleague:

- **"How much volume did we close this quarter?"** → queries Patagon DB, gives you the number
- **"Remember that we need to follow up with the lawyers about the SPV structure"** → stores a task
- **"What open tasks do we have?"** → searches and lists them
- **"Store as nerd fuel: [link] — great article about secondary markets"** → saves it to the reading library with a summary
- **"What do we know about Sarah from Sequoia?"** → searches contacts, meeting notes, CRM
- **"Mark task [x] as done"** → updates the task status
- **"What ideas have we had that we haven't followed up on?"** → searches ideas with open status

The agent figures out what you need and uses the right tools to answer. If it's not sure, it asks.

## Adding New Capabilities

Adding a new tool to the agent follows this pattern:

1. Create a file in `src/tools/` with the tool definition and executor
2. Register it in `src/tools/index.ts`
3. The agent automatically starts using it

The tool definition tells Claude what the tool does and what inputs it takes. The executor is the function that actually runs when Claude calls the tool. That's it — no prompt engineering needed because Claude reads the tool descriptions and figures out when to use them.

## Open Questions

- [ ] What's the Monday.com board structure? (needed for CRM integration)
- [ ] Should the agent be available in group chats or DM only?
- [ ] What Granola export/integration options are available?
- [ ] Are there specific legal document templates to compare against?
- [ ] Should there be a separate "admin" role that can manage team members via the bot?
