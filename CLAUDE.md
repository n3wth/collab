# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start dev server (Vite, port 5173)
npm run build        # TypeScript check + Vite production build
npm run test         # Run all tests (vitest)
npx vitest run src/__tests__/orchestrator.test.ts  # Single test file
npm run lint         # ESLint
```

## Architecture

**Collab** is a real-time collaborative workspace where AI agents edit documents alongside humans. React 19 + Vite + Tiptap 3 rich text editor + Supabase + Google Gemini 2.5 Flash.

### Agent System (the core loop)

The agent system has four layers that work together:

1. **`orchestrator.ts`** — Turn-based queue that coordinates agent actions. One agent acts at a time. Manages turn limits (`MAX_TURNS=4`), exchange caps (`MAX_EXCHANGES=4`), error tracking, and the heartbeat timer for proactive behaviors. Creates the orchestrator via `createOrchestrator(config)`.

2. **`agent.ts`** — Prompt builder + Gemini API caller. `buildPrompt()` assembles the system prompt with persona, doc snapshot, chat history, writing rules, and collaboration instructions. `askAgent()` calls the Gemini API through `/api/gemini` proxy with rate limiting (7s min interval).

3. **`agent-actions.ts`** — Executes agent decisions in the Tiptap editor. Handles `insert`, `replace`, `read`, and `chat` action types. Manages editor locking, character-by-character typing animation, and `after:HeadingName` position targeting.

4. **`wizard-of-oz.ts`** — Scripted proactive behaviors that fire without LLM calls. Detects patterns (TODOs, thin sections, open questions) and surfaces observations via the orchestrator's heartbeat.

### Data Flow

- User sends message → `orchestrator.trigger('user-message')` → agent queued → `askAgent()` calls Gemini → response parsed as `AgentAction` → `executeAgentAction()` mutates editor or sends chat
- Heartbeat fires every 20-30s → `wizard-of-oz.detectObservations()` runs first → then `heartbeat.generateHeartbeat()` may queue an LLM-driven observation
- Doc edits saved to Supabase via debounced `saveDocument()` in App.tsx `onUpdate`

### API Proxy

`api/gemini.ts` — Vercel serverless function that proxies Gemini API calls, keeping the API key server-side. In dev, Vite's proxy config in `vite.config.ts` handles the same route.

### Persistence (Supabase)

- `src/lib/supabase.ts` — Client singleton (implicit OAuth flow for SPA)
- `src/lib/session-store.ts` — CRUD for sessions, documents, chat_messages, agent_personas
- `src/lib/auth.tsx` — AuthProvider context with Google OAuth
- Schema in `supabase/migrations/001_initial_schema.sql`
- Tables: `sessions`, `documents`, `chat_messages`, `agent_personas` (all with permissive RLS)
- Uses `.maybeSingle()` for document loads (returns null, not 406)

### UI Components

- **`App.tsx`** — Main app. Session state, editor setup, orchestrator wiring, chat panel, doc panel, agent activity bar, timeline. Skips auth on localhost.
- **`HomePage.tsx`** — Landing page with animated hero blobs, 6 starter presets, demo CTA for first-time visitors, recent sessions list.
- **`blob-avatar.tsx`** — Canvas-based animated blob with water-fill effect. States: idle (outline), thinking (partial fill), typing (full fill). Uses simplex-noise for organic movement.
- **`agent-cursor.ts`** — Tiptap extension that renders agent cursors as ProseMirror decorations with blob avatars and thought bubbles.
- **`AgentConfigurator.tsx`** — Panel for adding/removing/editing agents (max 4). Presets: Aiden, Nova, Lex, Mira.

### Agent Presets

| Agent | Color | Specialty |
|-------|-------|-----------|
| Aiden | `#30d158` | Engineering, architecture, specs |
| Nova  | `#ff6961` | Product strategy, user research |
| Lex   | `#64d2ff` | Legal, compliance |
| Mira  | `#ffd60a` | Design, UX |

## Environment Variables

```
GEMINI_API_KEY=...              # Server-side only (api/gemini.ts + vite proxy)
VITE_SUPABASE_URL=...           # Supabase project URL
VITE_SUPABASE_ANON_KEY=...      # Supabase anon key (JWT format)
```

## Deployment

- Vercel project "collab" under n3wth team
- Domain: collab.n3wth.com
- Push to `main` triggers auto-deploy, or run `vercel --prod`
- Env vars set via `vercel env add`

## Key Patterns

- Agent prompts include Strunk-based writing rules and a banned word list (no "delve", "leverage", etc.)
- Agents are instructed to disagree constructively (30% pushback rate)
- `scheduleTimeout()` wrapper in orchestrator tracks all timers for cleanup on destroy
- Rate limiter in `agent.ts` handles 429s with exponential backoff
- CSS uses design tokens in `index.css` (surfaces, text, borders, easing curves, durations)
