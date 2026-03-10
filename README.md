# Collab — Ambient AI Companions for Real-Time Collaboration

> A prototype workspace where personal AI agents work *alongside* humans in shared documents and chat — visible, transparent, and collaborating with each other in real time.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?logo=vite)](https://vitejs.dev/)
[![Tiptap](https://img.shields.io/badge/Tiptap-3-1A1A1A?logo=tiptap)](https://tiptap.dev/)
[![Gemini](https://img.shields.io/badge/Gemini-2.5_Flash-4285F4?logo=google)](https://deepmind.google/technologies/gemini/)
[![Vercel](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel)](https://vercel.com/)

---

## What Is This?

Collab explores a new paradigm: **AI agents as ambient collaborators**, not just assistants. Instead of chatting with a single AI in a sidebar, you work in a shared space where your agents are *present* — you can see their cursors, watch them think, and observe them edit documents in real time.

The demo centers on two AI personas editing a shared project proposal together with a human team:

| Agent | Color | Expertise |
|-------|-------|-----------|
| **Aiden** | Blue | Technical architecture, specifications, data models |
| **Nova** | Orange | Product strategy, UX design, adoption risks, user journeys |

Both agents are powered by **Google Gemini 2.5 Flash** and coordinate their turns through a shared queue so they never conflict.

---

## Key Features

- **Live agent cursors** — Animated avatars move through the document as agents read and write
- **Thought bubbles** — Agents display their reasoning before acting, making AI transparent
- **Agent-to-agent collaboration** — Agents tag each other and respond to each other's edits
- **Structured document actions** — Agents can `insert`, `replace`, `read`, or `chat`
- **Conflict-free editing** — An editor lock prevents simultaneous document mutations
- **Rate-limited API calls** — Automatic backoff and retry (7 seconds minimum between calls; exponential on 429)
- **Duplicate-heading guard** — Agents never insert a section that already exists
- **Chat-driven triggers** — Natural language commands open/close the doc and direct agent activity
- **Secure API proxy** — Gemini key is never exposed in production (Vercel serverless function)

---

## Architecture

### High-Level Component Map

<!-- Diagram source: docs/diagrams/high-level-component-map.mmd -->

```mermaid
graph TD
    subgraph Browser["Browser (React SPA)"]
        subgraph ChatPanel["Chat Panel"]
            CP1["Message bubbles"]
            CP2["Agent status chips"]
            CP3["Chat input"]
        end

        subgraph DocPanel["Document Panel"]
            DP1["Tiptap rich-text editor<br/>+ AgentCursors extension<br/>(cursors, thoughts, selections)"]
        end

        ChatPanel & DocPanel --> AppState

        subgraph AppState["App.tsx (State)"]
            S1["docOpen"]
            S2["aiden / nova"]
            S3["messages[]"]
        end

        AppState --> Orchestrator

        subgraph Orchestrator["orchestrator.ts"]
            O1["Turn queue & coordination"]
            O2["Queue: TurnRequest[]"]
            O3["Triggers: doc-opened,<br/>user-message, agent-tagged"]
        end

        Orchestrator --> Agent
        Orchestrator --> Actions

        subgraph Agent["agent.ts — askAgent()"]
            A1["Prompts"]
            A2["Rate limit"]
            A3["JSON repair"]
        end

        subgraph Actions["agent-actions.ts — executeAction()"]
            AC1["insert"]
            AC2["replace"]
            AC3["read"]
            AC4["chat"]
            AC5["editor lock"]
        end
    end

    Agent -->|HTTPS| Proxy

    subgraph Proxy["/api/gemini.ts"]
        PX1["Vercel serverless proxy<br/>(hides API key)"]
    end

    Proxy --> Gemini

    subgraph Gemini["Gemini 2.5 Flash"]
        G1["Google AI API<br/>(LLM reasoning)"]
    end
```

### Module Responsibilities

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `src/App.tsx` | 430 | Root component: split layout, state, user input handlers |
| `src/orchestrator.ts` | 246 | Agent turn queue, trigger dispatch, autonomous turn cap |
| `src/agent.ts` | 318 | Gemini API calls, prompt building, rate limiting, JSON repair |
| `src/agent-actions.ts` | 307 | Editor mutations: insert/replace/read/chat, cursor animation |
| `src/agent-cursor.ts` | 120 | Custom Tiptap extension: cursor widgets, thought bubbles |
| `api/gemini.ts` | 33 | Vercel serverless proxy — forwards requests, hides key |

---

## How It Works

### Agent Turn Lifecycle

<!-- Diagram source: docs/diagrams/agent-turn-lifecycle.mmd -->

```mermaid
flowchart TD
    A["User sends message"] --> B["App.tsx"]
    B --> C["Orchestrator"]
    C --> D{"Detect trigger type"}

    D -->|doc-opened| E["Enqueue both agents<br/>with initial instructions"]
    D -->|user-message| F["Clear queue, detect<br/>@mention and enqueue<br/>relevant agent"]
    D -->|agent-tagged| G["Limited back-and-forth<br/>(max 2 tags)"]

    E --> H["processQueue()"]
    F --> H
    G --> H

    H --> I["askAgent(params)"]
    I --> J["Build prompt:<br/>• Persona injection<br/>• Doc text (≤2000 chars)<br/>• Chat history (last 6)<br/>• Recent changes context"]
    J --> K["POST /api/gemini"]
    K --> L["Gemini 2.5 Flash"]
    L --> M["Parse JSON response<br/>(with repair on truncation)"]

    M -->|insert| N["Acquire lock<br/>Insert at end/heading<br/>char-by-char"]
    M -->|replace| O["Acquire lock<br/>Find & replace<br/>char-by-char"]
    M -->|read| P["Highlight text<br/>Show thought bubble<br/>(3.5 seconds)"]

    N --> Q["Turn complete"]
    O --> Q
    P --> Q

    Q --> R{"Was doc edited?"}
    R -->|Yes| S["Enqueue other<br/>agent to react"]
    R -->|No| T["Continue queue"]

    S --> U{"Autonomous turn cap?<br/>(max 3 per agent/session)"}
    T --> U
    U -->|Yes| V["Stop auto turns"]
    U -->|No| W["Next turn"]
```

### Editor Action Types

| Action | Description | Lock needed? |
|--------|-------------|--------------|
| `insert` | Appends content blocks at end or after a heading | Yes |
| `replace` | Finds exact text, deletes it, types replacement | Yes |
| `read` | Highlights a passage, shows thought bubble for 3.5 seconds | No |
| `chat` | Sends a chat message only, no editor interaction | No |

### Agent-to-Agent Collaboration

<!-- Diagram source: docs/diagrams/agent-to-agent-collaboration.mmd -->

```mermaid
sequenceDiagram
    participant Aiden
    participant Orchestrator
    participant Nova

    Aiden->>Orchestrator: Inserts "Technical Architecture" section
    Orchestrator->>Orchestrator: Detects insert action
    Orchestrator->>Nova: Auto-enqueue: "React to Aiden's changes<br/>to Technical Architecture"
    Nova->>Nova: Reads section
    Nova->>Nova: Decides to add UX commentary<br/>or question Aiden
    Nova->>Orchestrator: Chat: "@Aiden should we add<br/>onboarding flows here?"
    Orchestrator->>Orchestrator: Detects @Aiden mention<br/>(agent-tagged trigger)
    Orchestrator->>Aiden: Enqueue response
    Aiden->>Orchestrator: Responds<br/>(limited to MAX_AGENT_TAGS = 2 exchanges)
```

### Rate Limiting & Reliability

<!-- Diagram source: docs/diagrams/rate-limiting.mmd -->

```mermaid
flowchart LR
    subgraph rateLimiter["rateLimiter"]
        direction TB
        A["minIntervalMs: 7000"]
        B["maxRetries: 3"]
        C["Backoff sequence on 429:<br/>5s → 10s → 20s → 40s → 60s"]
        D["After 3 consecutive errors:<br/>30-second cool-down"]
    end
```

The 7-second minimum interval keeps usage safely below the free-tier limit of ~10 RPM.

---

## Getting Started

### Prerequisites

- **Node.js** 18 or later
- **npm** 9 or later
- A **[Google AI Studio](https://aistudio.google.com/app/apikey)** API key (free tier works)

### 1. Install dependencies

```bash
git clone https://github.com/n3wth/collab.git
cd collab
npm install
```

### 2. Configure environment

Create a `.env.local` file in the project root:

```env
# Used by the client in development (never commit this file)
VITE_GEMINI_API_KEY=your_gemini_api_key_here
```

> **Note:** The `VITE_` prefix exposes the key in the browser bundle — this is acceptable for local development only. For production, use the serverless proxy (see [Deployment](#deployment)).

### 3. Start the dev server

```bash
npm run dev
```

Open **http://localhost:5173** in your browser.

### 4. Try it out

| What to type | What happens |
|---|---|
| `Open the doc` | Both agents enter the document and start collaborating |
| `@Aiden add a technical spec` | Aiden receives the instruction and edits the doc |
| `@Nova what's the user journey?` | Nova responds with product perspective |
| `Come back` / `Stop` | Agents exit the document |

---

## Project Structure

```
collab/
├── api/
│   └── gemini.ts           # Vercel serverless proxy — hides Gemini key in prod
│
├── docs/
│   └── diagrams/           # Mermaid diagram sources (.mmd)
│       ├── high-level-component-map.mmd
│       ├── agent-turn-lifecycle.mmd
│       ├── agent-to-agent-collaboration.mmd
│       ├── rate-limiting.mmd
│       └── proxy-flow.mmd
│
├── src/
│   ├── main.tsx            # React entry point
│   ├── App.tsx             # Root component: layout, state, user handlers
│   ├── App.css             # All styling (layout, animations, agent colours)
│   ├── index.css           # CSS resets & globals
│   │
│   ├── agent.ts            # Gemini API calls, prompt building, rate limiting
│   ├── agent-actions.ts    # Editor mutations and cursor animations
│   ├── agent-cursor.ts     # Custom Tiptap extension for agent cursors
│   └── orchestrator.ts     # Turn queue and agent coordination
│
├── public/
│   └── vite.svg
│
├── index.html              # HTML shell
├── vite.config.ts          # Vite build configuration
├── tsconfig.json           # TypeScript root config
├── tsconfig.app.json       # App TypeScript config (strict, ES2022)
├── tsconfig.node.json      # Node TypeScript config
├── eslint.config.js        # ESLint rules
└── package.json            # Dependencies and scripts
```

---

## Agent Personas

### Aiden (Technical)

> *"You are Aiden. You have strong opinions about clean architecture and precise specifications."*

- Writes technical specifications and data models
- Proposes system architecture and protocols
- Adds implementation-level detail to proposals
- **Color:** `#1a73e8` (Google Blue)

### Nova (Product)

> *"You are Nova. You champion the user and are skeptical of complexity."*

- Identifies UX gaps and adoption risks
- Adds user scenarios and journey maps
- Questions assumptions with product strategy lens
- **Color:** `#e37400` (Google Orange)

Both agents receive the same document context and recent chat history on every turn, enabling coherent multi-turn collaboration.

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR at `localhost:5173` |
| `npm run build` | Type-check + bundle for production (`dist/`) |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint across all source files |

---

## Deployment

This project is designed to deploy on **[Vercel](https://vercel.com/)** using its native serverless function support.

### 1. Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

### 2. Set the production API key

In the Vercel dashboard → **Settings → Environment Variables**, add:

```
GEMINI_API_KEY = your_gemini_api_key_here
```

The client in production will call `/api/gemini` (the serverless proxy) instead of the Gemini API directly, keeping your key secure.

### How the proxy works

<!-- Diagram source: docs/diagrams/proxy-flow.mmd -->

```mermaid
sequenceDiagram
    participant Browser
    participant Vercel as Vercel Function<br/>(api/gemini.ts)
    participant Gemini as Gemini API

    Browser->>Vercel: POST /api/gemini
    Note over Vercel: Reads process.env.GEMINI_API_KEY
    Vercel->>Gemini: POST (with API key)
    Gemini-->>Vercel: Response
    Vercel-->>Browser: JSON response
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| UI Framework | React | 19.2 |
| Language | TypeScript | 5.9 |
| Build Tool | Vite | 7.3 |
| Rich Text Editor | Tiptap | 3.20 |
| CRDT / Collab Primitives | Yjs | 13.6 |
| AI Model | Gemini 2.5 Flash | — |
| Serverless Hosting | Vercel | — |
| Avatar Generation | boring-avatars | 2.0 |

---

## Security Considerations

| Concern | Development | Production |
|---------|-------------|------------|
| Gemini API key | In `.env.local` (client-side) | In Vercel env var (server-side only) |
| Key exposure | Exposed in browser bundle | Hidden behind serverless proxy |
| Request validation | None | None (add auth if needed) |

> For a production deployment with multiple users, add authentication to `/api/gemini` to prevent key abuse.

---

## Known Limitations

- **No persistence** — All state is lost on page refresh
- **Single document** — One hardcoded proposal; no multi-doc support
- **Fixed agents** — Only Aiden and Nova; personas are hardcoded
- **Single session** — No real multi-user collaboration (everyone sees the same local state)
- **Rate limited** — 7 s between API calls; interactions can feel slow
- **Autonomous turn cap** — Max 3 autonomous turns per agent per session (cost control)
- **Mobile unfriendly** — Fixed-width layout assumes a desktop viewport

---

## License

MIT — see [LICENSE](LICENSE) for details.
