# Telemetry: PostHog + Langfuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument Markup with PostHog (product analytics) and Langfuse (LLM observability) to capture agent decision traces, user interaction patterns, session quality metrics, and error patterns.

**Architecture:** PostHog captures product-level events (session lifecycle, user actions, feature usage) in the browser. Langfuse captures LLM traces (prompt/response, tokens, latency, action type, scores) server-side in Vercel functions. Langfuse pipes LLM metrics into PostHog via its native integration for unified dashboards.

**Tech Stack:** PostHog JS SDK (`posthog-js`), Langfuse v4 (`@langfuse/tracing`, `@langfuse/otel`, `@langfuse/client`), OpenTelemetry (`@opentelemetry/sdk-trace-node`)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/analytics.ts` | PostHog client init + typed event helpers |
| `api/instrumentation.ts` | Langfuse OTel span processor setup (server-side) |
| `api/gemini.ts` | Wrap existing Gemini proxy with Langfuse traces |
| `api/gemini-image.ts` | Wrap existing image proxy with Langfuse traces |
| `api/score.ts` | New endpoint: accept scores from browser, forward to Langfuse |
| `src/lib/telemetry.ts` | Browser-side helpers to send scores via `/api/score` |
| `src/App.tsx` | PostHog init + session/page tracking |
| `src/hooks/useOrchestrator.ts` | Emit agent action events to PostHog |
| `src/agent.ts` | Pass sessionId/userId through to API for Langfuse correlation |

---

### Task 1: Install PostHog

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install posthog-js**

```bash
npm install posthog-js
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add posthog-js dependency"
```

---

### Task 2: PostHog Client and Product Events

**Files:**
- Create: `src/lib/analytics.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create analytics module**

```typescript
// src/lib/analytics.ts
import posthog from 'posthog-js'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string) || 'https://us.i.posthog.com'

let initialized = false

export function initAnalytics(userId?: string) {
  if (initialized || !POSTHOG_KEY) return
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    persistence: 'localStorage',
    loaded: (ph) => {
      if (userId) ph.identify(userId)
    },
  })
  initialized = true
}

export function identify(userId: string, properties?: Record<string, unknown>) {
  if (!initialized) return
  posthog.identify(userId, properties)
}

export function track(event: string, properties?: Record<string, unknown>) {
  if (!initialized) return
  posthog.capture(event, properties)
}

// Typed event helpers
export const events = {
  sessionCreated: (template: string, agentCount: number) =>
    track('session_created', { template, agent_count: agentCount }),

  sessionOpened: (sessionId: string, template: string) =>
    track('session_opened', { session_id: sessionId, template }),

  messageSent: (sessionId: string, mentionedAgents: string[]) =>
    track('message_sent', { session_id: sessionId, mentioned_agents: mentionedAgents }),

  agentAction: (sessionId: string, agent: string, actionType: string, success: boolean) =>
    track('agent_action', { session_id: sessionId, agent, action_type: actionType, success }),

  agentError: (sessionId: string, agent: string, errorCode: string) =>
    track('agent_error', { session_id: sessionId, agent, error_code: errorCode }),

  planningPhaseCompleted: (sessionId: string, messageCount: number) =>
    track('planning_phase_completed', { session_id: sessionId, message_count: messageCount }),

  imageGenerated: (sessionId: string, agent: string, success: boolean) =>
    track('image_generated', { session_id: sessionId, agent, success }),

  templatePicked: (template: string, agents: string[]) =>
    track('template_picked', { template, agents }),

  agentConfigChanged: (agentCount: number, agents: string[]) =>
    track('agent_config_changed', { agent_count: agentCount, agents }),
}
```

- [ ] **Step 2: Init PostHog in App.tsx**

In `App.tsx`, after the auth check, add:

```typescript
import { initAnalytics, identify } from './lib/analytics'

// Inside App(), after useAuth():
useEffect(() => {
  initAnalytics(user?.id)
  if (user) identify(user.id, { email: user.email })
}, [user])
```

- [ ] **Step 3: Add env vars**

Add to `.env.local`:
```
VITE_POSTHOG_KEY=<your-posthog-project-api-key>
VITE_POSTHOG_HOST=https://us.i.posthog.com
```

Run `npx @posthog/wizard` to get the project API key if not already available.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.ts src/App.tsx
git commit -m "feat: add PostHog analytics client with typed events"
```

---

### Task 3: Wire PostHog Events Into Existing Code

**Files:**
- Modify: `src/hooks/useOrchestrator.ts`
- Modify: `src/hooks/useSession.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Track session lifecycle in useSession.ts**

Import `events` from analytics. In `handleSessionSelect`, after the session loads:
```typescript
events.sessionOpened(session.id, session.template)
```

In `handleTemplatePick`, after session creation:
```typescript
events.sessionCreated(starter.template, starter.agents.length)
events.templatePicked(starter.template, starter.agents.map(a => a.name))
```

- [ ] **Step 2: Track agent actions in useOrchestrator.ts**

In the `onDone` callback of the orchestrator config, after action completes:
```typescript
events.agentAction(sessionId, agentName, action.type, success !== false)
```

In the `onError` callback:
```typescript
events.agentError(sessionId, agentName, error.code)
```

- [ ] **Step 3: Track user messages in App.tsx**

In `handleSendMessage`, after sending:
```typescript
const mentioned = activeAgents.filter(a => text.toLowerCase().includes(a.name.toLowerCase())).map(a => a.name)
events.messageSent(activeSession?.id || '', mentioned)
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useOrchestrator.ts src/hooks/useSession.ts src/App.tsx
git commit -m "feat: wire PostHog events into session, orchestrator, and chat"
```

---

### Task 4: Install Langfuse Server-Side Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Langfuse + OTel packages**

```bash
npm install @langfuse/tracing @langfuse/otel @langfuse/client @opentelemetry/sdk-trace-node
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add Langfuse v4 and OpenTelemetry dependencies"
```

---

### Task 5: Langfuse Instrumentation Setup

**Files:**
- Create: `api/instrumentation.ts`

- [ ] **Step 1: Create instrumentation module**

```typescript
// api/instrumentation.ts
import { LangfuseSpanProcessor } from '@langfuse/otel'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'

export const langfuseSpanProcessor = new LangfuseSpanProcessor({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
})

const tracerProvider = new NodeTracerProvider({
  spanProcessors: [langfuseSpanProcessor],
})
tracerProvider.register()
```

- [ ] **Step 2: Add env vars to Vercel**

```bash
vercel env add LANGFUSE_PUBLIC_KEY
vercel env add LANGFUSE_SECRET_KEY
vercel env add LANGFUSE_BASE_URL
```

Values:
- `LANGFUSE_PUBLIC_KEY` = `pk-lf-d2ac7c9e-070f-4e23-b963-d71ed0614ac6`
- `LANGFUSE_SECRET_KEY` = `sk-lf-7046a88c-b024-4fd1-a464-ad3ff4f07e11`
- `LANGFUSE_BASE_URL` = `https://us.cloud.langfuse.com`

- [ ] **Step 3: Commit**

```bash
git add api/instrumentation.ts
git commit -m "feat: add Langfuse OTel instrumentation for serverless"
```

---

### Task 6: Instrument Gemini API Proxy With Langfuse Traces

**Files:**
- Modify: `api/gemini.ts`

- [ ] **Step 1: Wrap the existing handler with Langfuse tracing**

The key changes to `api/gemini.ts`:
1. Import instrumentation (triggers OTel setup on cold start)
2. Wrap the Gemini API call in `startActiveObservation` with `asType: 'generation'`
3. Capture: model, prompt text, response text, token usage, latency
4. Accept `X-Session-Id` and `X-User-Id` headers from the browser for trace correlation
5. Call `forceFlush()` before responding

```typescript
// At top of api/gemini.ts:
import './instrumentation'
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing'
import { langfuseSpanProcessor } from './instrumentation'

// Inside the handler, wrap the fetch call:
const sessionId = req.headers['x-session-id'] as string || undefined
const userId = req.headers['x-user-id'] as string || undefined
const agentName = req.headers['x-agent-name'] as string || undefined

const data = await propagateAttributes(
  { userId, sessionId, tags: agentName ? [agentName] : [] },
  () => startActiveObservation('gemini-generate', async (gen) => {
    gen.update({
      input: req.body,
      model: MODEL,
      modelParameters: req.body.generationConfig,
      metadata: { agent: agentName },
    })

    const startTime = Date.now()
    const response = await fetch(...)  // existing fetch
    const data = await response.json()
    const latencyMs = Date.now() - startTime

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    const usage = data.usageMetadata

    gen.update({
      output: text ? { text } : data,
      usageDetails: {
        input: usage?.promptTokenCount ?? 0,
        output: usage?.candidatesTokenCount ?? 0,
        total: usage?.totalTokenCount ?? 0,
      },
      metadata: { latencyMs, status: response.status },
    })

    return data
  }, { asType: 'generation' })
)

await langfuseSpanProcessor.forceFlush()
return res.status(200).json(data)
```

- [ ] **Step 2: Pass session/user headers from browser**

In `src/agent.ts`, in the `askAgent` function, add headers:
```typescript
// Before the fetch call, get session context
const sessionId = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('s') || window.location.pathname.split('/s/')[1]
  : undefined

const headers: Record<string, string> = { 'Content-Type': 'application/json' }
if (clientKey) headers['X-Gemini-Key'] = clientKey
if (sessionId) headers['X-Session-Id'] = sessionId
if (params.agentName) headers['X-Agent-Name'] = params.agentName
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add api/gemini.ts src/agent.ts
git commit -m "feat: instrument Gemini proxy with Langfuse generation traces"
```

---

### Task 7: Instrument Image Generation Proxy

**Files:**
- Modify: `api/gemini-image.ts`

- [ ] **Step 1: Same pattern as Task 6**

Add Langfuse tracing to `api/gemini-image.ts`:
- Import instrumentation
- Wrap the image generation call in `startActiveObservation` with `asType: 'generation'`
- Capture model (`gemini-3.1-flash-image-preview`), prompt, success/failure, latency
- Flush before responding

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add api/gemini-image.ts
git commit -m "feat: instrument image generation proxy with Langfuse traces"
```

---

### Task 8: Score Endpoint for Browser-to-Langfuse Scoring

**Files:**
- Create: `api/score.ts`
- Create: `src/lib/telemetry.ts`
- Modify: `vite.config.ts` (add dev proxy)

- [ ] **Step 1: Create score API endpoint**

Langfuse scores can only be created server-side (requires secret key). This endpoint accepts score submissions from the browser.

```typescript
// api/score.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { LangfuseClient } from '@langfuse/client'

const langfuse = new LangfuseClient({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL || 'https://us.cloud.langfuse.com',
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { traceId, observationId, sessionId, name, value, dataType, comment } = req.body

  if (!name || value === undefined) {
    return res.status(400).json({ error: 'name and value required' })
  }

  try {
    await langfuse.score.create({
      traceId,
      observationId,
      sessionId,
      name,
      value,
      dataType: dataType || 'NUMERIC',
      comment,
    })
    await langfuse.flush()
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[score] error:', err)
    return res.status(500).json({ error: 'Failed to create score' })
  }
}
```

- [ ] **Step 2: Create browser-side telemetry helpers**

```typescript
// src/lib/telemetry.ts
export async function scoreSession(sessionId: string, name: string, value: number, comment?: string) {
  try {
    await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, name, value, dataType: 'NUMERIC', comment }),
    })
  } catch { /* fire and forget */ }
}

export async function scoreTrace(traceId: string, name: string, value: number | string | boolean, dataType?: string) {
  try {
    await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceId, name, value, dataType: dataType || 'NUMERIC' }),
    })
  } catch { /* fire and forget */ }
}
```

- [ ] **Step 3: Add dev proxy in vite.config.ts**

Add alongside existing `/api/gemini` proxy:
```typescript
'/api/score': {
  target: 'http://localhost:3001',  // or handle inline
  changeOrigin: true,
},
```

(For dev, you may need a simple local handler or skip scores in dev mode.)

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add api/score.ts src/lib/telemetry.ts vite.config.ts
git commit -m "feat: add score endpoint and browser telemetry helpers"
```

---

### Task 9: Enable Langfuse-PostHog Integration

**Files:** None (dashboard configuration only)

- [ ] **Step 1: Configure in Langfuse dashboard**

1. Go to https://us.cloud.langfuse.com > Project "markup" > Settings > Integrations > PostHog
2. Enter PostHog host: `https://us.i.posthog.com`
3. Enter PostHog project API key (same as `VITE_POSTHOG_KEY`)
4. Select "Enriched observations" as export source
5. Enable and save

- [ ] **Step 2: Create PostHog dashboard**

In PostHog, create a new dashboard from the "LLM metrics -- Langfuse" template.

- [ ] **Step 3: Verify data flows**

Trigger a few agent actions, then check:
1. PostHog: custom events (`session_created`, `agent_action`, etc.) appear
2. Langfuse: traces appear with generation details
3. PostHog: Langfuse-exported events (`langfuse generation`, `langfuse trace`) appear

---

### Task 10: Add Vercel Environment Variables

**Files:** None (Vercel dashboard or CLI)

- [ ] **Step 1: Set production env vars**

```bash
vercel env add LANGFUSE_PUBLIC_KEY production
vercel env add LANGFUSE_SECRET_KEY production
vercel env add LANGFUSE_BASE_URL production
vercel env add VITE_POSTHOG_KEY production
vercel env add VITE_POSTHOG_HOST production
```

- [ ] **Step 2: Deploy and verify**

```bash
vercel --prod
```

Check Langfuse dashboard for incoming traces from production.
