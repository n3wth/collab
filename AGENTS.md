# AGENTS.md

Instructions for AI coding agents working in this repository.

## Before you start

- Read `CLAUDE.md` for build commands and architecture overview
- Read the file you're editing before changing it
- Run `npm run build` after every change — the build must pass before committing
- Push only to `origin` (https://github.com/n3wth/markup.git)

## Code style

- 2 spaces, single quotes, no semicolons (Prettier conventions)
- No emojis in code or UI text
- Flat design: no glows, shadows, or gradients unless explicitly requested
- Use existing CSS variables from `src/index.css` — don't hardcode colors
- Follow existing patterns in the file you're editing

## Agent system internals

The agent pipeline is a 4-step chain. Understand this before touching any agent file:

```
orchestrator.ts → agent.ts → agent-actions.ts → Tiptap editor
     (queue)       (prompt)     (execute)         (DOM)
```

- **orchestrator** owns the queue, turn limits, heartbeat timer, and wizard-of-oz integration. One agent acts at a time. Never bypass the queue.
- **agent.ts** builds the prompt and calls the Gemini API via `/api/gemini`. The prompt includes persona, doc text (truncated), chat history, writing rules, and collaboration instructions. Rate limited to 7s between calls.
- **agent-actions.ts** takes the parsed `AgentAction` and mutates the Tiptap editor. Supports `insert`, `replace`, `read`, `chat`. Handles editor locking so two agents can't type simultaneously.
- **wizard-of-oz.ts** runs pattern detection without LLM calls. Fires before the LLM heartbeat. Observations are deduped per session.

## Common pitfalls

- `loadDocument` uses `.maybeSingle()` not `.single()` — Supabase returns 406 if no row exists with `.single()`
- The blob avatar canvas runs at 60fps when active but throttles to 4fps when idle. Check `isTransitioning` before throttling or the drain animation stutters.
- `describeAction()` in orchestrator truncates text for the timeline tooltip. Keep it long enough to be useful (120+ chars).
- Agent prompts ban specific words (delve, leverage, robust, etc.) — don't add them back.
- Auth is skipped on localhost (`window.location.hostname === 'localhost'`). Don't add login gates that break local dev.

## Deployment

```bash
git push origin main          # Auto-deploys via Vercel GitHub integration
vercel --prod                 # Manual deploy from local
vercel env add KEY production # Add/update env vars (requires redeploy)
```

Env vars are baked into the bundle at build time (Vite `VITE_` prefix). After changing env vars, you must redeploy.

## Testing

```bash
npm run test                                        # All tests
npx vitest run src/__tests__/orchestrator.test.ts   # Single file
```

Tests use vitest. Mock the Gemini API — never call it from tests.
