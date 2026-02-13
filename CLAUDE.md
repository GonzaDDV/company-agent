# CLAUDE.md

## Project Overview

Company agent for **The Holdin Co (THC)** and its portfolio companies (currently **Patagon Markets**). A Telegram bot powered by Claude that serves as the team's shared brain — answering business questions, storing knowledge, tracking ideas, and managing contacts.

## Architecture

```
Telegram Bot (grammY)
  → Agent Core (Claude API with tool use)
    → Tools:
      ├── Patagon DB (read-only SQL via Supabase RPC)
      ├── Knowledge Store (notes, tasks, ideas, logistics, legal)
      ├── Nerd Fuel (articles, podcasts, books)
      └── People (contacts, relationships)
```

**Two databases:**
- **Agent DB** (Supabase) — The agent's own knowledge store (notes, readings, people, transcripts)
- **Patagon DB** (Supabase, read-only) — Patagon Markets' production database (markets, deals, purchases, positions)

The agent connects to both. Claude decides which tools to call based on the user's question.

## Project Structure

```
company-agent/
├── src/
│   ├── index.ts                 ← Entry point (starts Telegram bot)
│   ├── config/
│   │   ├── env.ts               ← Zod-validated environment variables
│   │   └── team.ts              ← Team member config (Telegram ID → name + permissions)
│   ├── db/
│   │   ├── agent-db.ts          ← Supabase client for the agent's own DB
│   │   └── patagon-db.ts        ← Supabase client for Patagon's DB (read-only)
│   ├── bot/
│   │   └── telegram.ts          ← Telegram bot setup, commands, message handling
│   ├── agent/
│   │   ├── core.ts              ← Agent brain: Claude API + tool execution loop
│   │   └── prompts.ts           ← System prompt
│   └── tools/
│       ├── index.ts             ← Tool registry, permission filtering, dispatch
│       ├── patagon-db.ts        ← Patagon DB read-only queries
│       ├── knowledge.ts         ← Notes, tasks, ideas, logistics, legal notes
│       ├── readings.ts          ← Nerd Fuel library
│       └── people.ts            ← External contacts and relationships
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  ← Agent DB schema
├── patagon-migrations/
│   └── add_readonly_query.sql      ← Must be applied to Patagon's DB (not this project)
├── CLAUDE.md                       ← This file
└── PROGRESS.md                     ← Progress tracker for implementation
```

## Commands

```bash
pnpm dev          # Start bot with hot reload (tsx watch)
pnpm build        # Compile TypeScript
pnpm start        # Run compiled build
pnpm lint         # Run Biome linter
pnpm typecheck    # Type check without emit
```

## Environment Variables

Required in `.env` (see `.env.example`):

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | From @BotFather on Telegram |
| `ANTHROPIC_API_KEY` | Claude API key |
| `AGENT_SUPABASE_URL` | Agent's own Supabase project URL |
| `AGENT_SUPABASE_SERVICE_ROLE_KEY` | Agent DB service role key |
| `PATAGON_SUPABASE_URL` | Patagon's Supabase project URL |
| `PATAGON_SUPABASE_SERVICE_ROLE_KEY` | Patagon DB service role key (read-only usage) |
| `MONDAY_API_TOKEN` | Monday.com API token (optional, Phase 2) |

## Key Patterns

### Tool Use Loop

The agent core (`src/agent/core.ts`) implements Claude's tool use pattern:
1. Send user message + tool definitions to Claude
2. If Claude returns `tool_use`, execute the tools and send results back
3. Repeat until Claude returns a text response (max 10 rounds)

### Adding a New Tool

1. Create `src/tools/your-tool.ts` with:
   - Tool definition(s) (`Anthropic.Tool` type — name, description, input_schema)
   - Executor function(s) that take input + AgentContext and return a string
2. Register in `src/tools/index.ts`:
   - Import definitions and executor
   - Add to `allTools` array with optional `company` restriction
3. That's it — the agent will automatically use the new tool when relevant.

### Team Member Config

Edit `src/config/team.ts` to add/remove team members. Each member has:
- `telegramId` — Get this by messaging @userinfobot on Telegram
- `name` — Display name used in conversations and as author for stored items
- `companies` — Array of `'thc'` and/or `'patagon'` for tool access permissions

### Permission Model

- Tools can be restricted to specific companies via the `company` field in `allTools`
- `getToolsForUser(companies)` filters available tools based on the user's company access
- Currently: knowledge, readings, and people tools are shared; Patagon DB is restricted to Patagon members

### Conversation Memory

- In-memory per Telegram chat (last 40 messages)
- Reset with `/reset` command
- Lost on bot restart (by design for Phase 1 — DB persistence is a future enhancement)

## Database

### Agent DB (this project)

Tables: `notes`, `readings`, `people`, `transcripts`

Migration in `supabase/migrations/001_initial_schema.sql`. Apply via Supabase dashboard or CLI.

### Patagon DB (separate project)

The agent needs `execute_readonly_query` RPC function in Patagon's DB.
Migration file: `patagon-migrations/add_readonly_query.sql` — must be applied in the Patagon repo.

## Tech Stack

- **Runtime:** Node.js with TypeScript (ESM)
- **Bot framework:** grammY (Telegram Bot API)
- **AI:** Claude API via `@anthropic-ai/sdk` (Sonnet for tool use)
- **Database:** Supabase (PostgreSQL)
- **Linting:** Biome (same config as Patagon)
- **Dev:** tsx for hot-reload

## Important Notes

- **Model:** Uses `claude-sonnet-4-5-20250929` for the agent (fast + cost-effective for tool use). Can be upgraded to Opus for complex reasoning if needed.
- **Read-only Patagon access:** The agent can only SELECT from Patagon's DB. The `execute_readonly_query` function blocks all mutations.
- **No web UI yet:** Phase 1 is Telegram-only. Web UI and Slack are future phases.
- **Monday.com:** Integration is planned but requires the Monday.com board structure to be documented first.
