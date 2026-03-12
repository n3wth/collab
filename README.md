# Collab — Ambient AI Companions for Real-Time Collaboration

> A prototype workspace where personal AI agents work *alongside* humans in shared documents and chat — visible, transparent, and collaborating with each other in real time.

**By [Oliver Newth](https://github.com/n3wth) (n3wth).**

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
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#dbeafe', 'primaryTextColor': '#1a1a2e', 'primaryBorderColor': '#2563eb', 'lineColor': '#64748b' }}}%%
graph TD
    subgraph Browser["🌐 Browser — React SPA"]
        CP["💬 Chat Panel<br/>Message bubbles · Status chips · Input"]
        DP["📝 Document Panel<br/>Tiptap editor + AgentCursors<br/>cursors · thoughts · selections"]

        CP & DP --> App

        App["⚛️ App.tsx — State<br/>docOpen · aiden / nova · messages#91;#93;"]

        App --> Orch

        Orch["🎯 orchestrator.ts<br/>Turn queue &amp; coordination<br/>Triggers: doc-opened · user-message · agent-tagged"]

        Orch --> Agent
        Orch --> Actions

        Agent["🤖 agent.ts — askAgent#40;#41;<br/>Prompts · Rate limit · JSON repair"]
        Actions["⚡ agent-actions.ts — executeAction#40;#41;<br/>insert · replace · read · chat · editor lock"]
    end

    Agent -- "🔒 HTTPS" --> Proxy
    Proxy --> Gemini

    Proxy["🔀 /api/gemini.ts<br/>Vercel serverless proxy — hides API key"]
    Gemini["✨ Gemini 2.5 Flash<br/>Google AI API — LLM reasoning"]

    classDef ui fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#1e3a5f
    classDef state fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#3b1f6e
    classDef orch fill:#fce7f3,stroke:#db2777,stroke-width:1.5px,color:#4a1930
    classDef agent fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef actions fill:#ffedd5,stroke:#ea580c,stroke-width:1.5px,color:#6b2f0a
    classDef proxy fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef gemini fill:#fef9c3,stroke:#ca8a04,stroke-width:1.5px,color:#713f12

    class CP,DP ui
    class App state
    class Orch orch
    class Agent agent
    class Actions actions
    class Proxy proxy
    class Gemini gemini

    style Browser fill:#f8fafc,stroke:#475569,stroke-width:2px,color:#1e293b
```

### Module Responsibilities

| Module | Lines | Responsibility |
|--------|-------|----------------|
| `src/App.tsx` | 610 | Root component: split layout, state, user input handlers |
| `src/orchestrator.ts` | 318 | Agent turn queue, trigger dispatch, autonomous turn cap |
| `src/agent.ts` | 459 | Gemini API calls, prompt building, rate limiting, JSON repair |
| `src/agent-actions.ts` | 467 | Editor mutations: insert/replace/read/chat, cursor animation |
| `src/agent-cursor.ts` | 190 | Custom Tiptap extension: cursor widgets, thought bubbles |
| `api/gemini.ts` | 61 | Vercel serverless proxy — forwards requests, hides key |

---

## How It Works

### Agent Turn Lifecycle

<!-- Diagram source: docs/diagrams/agent-turn-lifecycle.mmd -->

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#dbeafe', 'primaryTextColor': '#1a1a2e', 'primaryBorderColor': '#2563eb', 'lineColor': '#64748b' }}}%%
flowchart TD
    A(["👤 User sends message"]):::input --> B["⚛️ App.tsx"]:::state
    B --> C["🎯 Orchestrator"]:::orch
    C --> D{"🔍 Detect trigger type"}:::decision

    D -- "📂 doc-opened" --> E["Enqueue both agents<br/>with initial instructions"]:::trigger
    D -- "💬 user-message" --> F["Clear queue, detect @mention<br/>and enqueue relevant agent"]:::trigger
    D -- "🏷️ agent-tagged" --> G["Limited back-and-forth<br/>max 2 tags"]:::trigger

    E --> H["⚙️ processQueue#40;#41;"]:::process
    F --> H
    G --> H

    H --> I["🤖 askAgent#40;params#41;"]:::agent
    I --> J["📋 Build prompt<br/>• Persona injection<br/>• Doc text ≤ 2 000 chars<br/>• Chat history — last 6<br/>• Recent changes context"]:::agent
    J --> K["📡 POST /api/gemini"]:::api
    K --> L["✨ Gemini 2.5 Flash"]:::gemini
    L --> M["🔧 Parse JSON response<br/>with repair on truncation"]:::process

    M -- "📝 insert" --> N["🔒 Acquire lock<br/>Insert at end / heading<br/>char-by-char"]:::action
    M -- "✏️ replace" --> O["🔒 Acquire lock<br/>Find &amp; replace<br/>char-by-char"]:::action
    M -- "👁️ read" --> P["Highlight text<br/>Show thought bubble<br/>3.5 s"]:::action

    N --> Q(["✅ Turn complete"]):::done
    O --> Q
    P --> Q

    Q --> R{"📝 Was doc edited?"}:::decision
    R -- "Yes" --> S["📨 Enqueue other<br/>agent to react"]:::trigger
    R -- "No" --> T["Continue queue"]:::process

    S --> U{"🔢 Autonomous turn cap?<br/>max 3 per agent / session"}:::decision
    T --> U
    U -- "Yes" --> V["🛑 Stop auto turns"]:::stop
    U -- "No" --> W["▶️ Next turn"]:::next

    classDef input fill:#dbeafe,stroke:#2563eb,stroke-width:2px,color:#1e3a5f
    classDef state fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#3b1f6e
    classDef orch fill:#fce7f3,stroke:#db2777,stroke-width:1.5px,color:#4a1930
    classDef decision fill:#fef3c7,stroke:#d97706,stroke-width:2px,color:#78350f
    classDef trigger fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81
    classDef process fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#334155
    classDef agent fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef api fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef gemini fill:#fef9c3,stroke:#ca8a04,stroke-width:1.5px,color:#713f12
    classDef action fill:#ffedd5,stroke:#ea580c,stroke-width:1.5px,color:#6b2f0a
    classDef done fill:#dcfce7,stroke:#16a34a,stroke-width:2px,color:#14532d
    classDef stop fill:#fee2e2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d
    classDef next fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
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
%%{init: {'theme': 'base', 'themeVariables': { 'actorBkg': '#f1f5f9', 'actorBorder': '#475569', 'actorTextColor': '#1a1a2e', 'actorLineColor': '#94a3b8', 'signalColor': '#475569', 'signalTextColor': '#1a1a2e', 'noteBkgColor': '#fef9c3', 'noteBorderColor': '#ca8a04', 'noteTextColor': '#713f12', 'activationBkgColor': '#dbeafe', 'activationBorderColor': '#2563eb', 'sequenceNumberColor': '#ffffff' }}}%%
sequenceDiagram
    autonumber

    participant A as 🔵 Aiden · Technical
    participant O as 🎯 Orchestrator
    participant N as 🟠 Nova · Product

    A->>O: Inserts "Technical Architecture" section
    activate O
    O->>O: Detects insert action
    O->>N: Auto-enqueue — React to Aiden's changes
    deactivate O

    activate N
    N->>N: Reads section & decides response
    N->>O: Chat: @Aiden should we add onboarding flows?
    deactivate N

    activate O
    O->>O: Detects @Aiden mention (agent-tagged)
    O->>A: Enqueue response
    deactivate O

    activate A
    A->>O: Responds
    deactivate A

    Note over A,N: 🔄 Tag limit prevents infinite loops — MAX_AGENT_TAGS = 2
```

### Rate Limiting & Reliability

<!-- Diagram source: docs/diagrams/rate-limiting.mmd -->

```mermaid
%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#f1f5f9', 'primaryTextColor': '#1a1a2e', 'primaryBorderColor': '#475569', 'lineColor': '#64748b' }}}%%
flowchart LR
    subgraph rl["⏱️ Rate Limiter"]
        direction TB
        A["🔄 Min interval — 7 000 ms between calls"]:::config
        B["🔁 Max retries — 3 attempts per request"]:::config
        C["📈 Backoff on 429:<br/>5 s → 10 s → 20 s → 40 s → 60 s"]:::warn
        D["🛑 3 consecutive errors → 30 s cool-down"]:::error
        A ~~~ B ~~~ C ~~~ D
    end

    classDef config fill:#e0f2fe,stroke:#0284c7,stroke-width:1.5px,color:#0c4a6e
    classDef warn fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef error fill:#fee2e2,stroke:#dc2626,stroke-width:1.5px,color:#7f1d1d

    style rl fill:#f8fafc,stroke:#475569,stroke-width:2px,color:#1e293b
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
# Used by the server-side proxy (never exposed to the client)
GEMINI_API_KEY=your_gemini_api_key_here
```

> **Note:** The API key is only read server-side by the `/api/gemini` proxy. It is never bundled into the client.

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
│   ├── blob-avatar.tsx    # Animated blob avatars (simplex-noise, canvas)
│   ├── lib/
│   │   └── utils.ts        # Shared utilities
│   ├── agent.ts            # Gemini API calls, prompt building, rate limiting
│   ├── agent-actions.ts    # Editor mutations and cursor animations
│   ├── agent-cursor.ts     # Custom Tiptap extension for agent cursors
│   ├── orchestrator.ts     # Turn queue and agent coordination
│   └── __tests__/          # Vitest unit tests
│
├── public/
│   └── vite.svg
│
├── index.html              # HTML shell
├── vite.config.ts          # Vite build configuration
├── components.json         # shadcn/ui component config
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
| `npm run test` | Run Vitest unit tests |

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
%%{init: {'theme': 'base', 'themeVariables': { 'actorBkg': '#f1f5f9', 'actorBorder': '#475569', 'actorTextColor': '#1a1a2e', 'actorLineColor': '#94a3b8', 'signalColor': '#475569', 'signalTextColor': '#1a1a2e', 'noteBkgColor': '#dcfce7', 'noteBorderColor': '#16a34a', 'noteTextColor': '#14532d', 'activationBkgColor': '#e0f2fe', 'activationBorderColor': '#0284c7', 'sequenceNumberColor': '#ffffff' }}}%%
sequenceDiagram
    autonumber

    participant B as 🌐 Browser
    participant V as 🔀 Vercel Function<br/>(api/gemini.ts)
    participant G as ✨ Gemini API

    B->>+V: POST /api/gemini
    Note over V: 🔑 Reads process.env.GEMINI_API_KEY
    V->>+G: POST with API key
    G-->>-V: Response
    V-->>-B: JSON response

    Note over B,G: 🔒 API key never exposed to the browser
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
| Agent avatars | BlobAvatar (simplex-noise) | Custom canvas blobs |

---

## Security Considerations

| Concern | Development | Production |
|---------|-------------|------------|
| Gemini API key | In `.env.local` (loaded by dev server only) | In Vercel env var (server-side only) |
| Key exposure | Not in client bundle; proxy reads env | Hidden behind serverless proxy |
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

## Author

**Oliver Newth** ([n3wth](https://github.com/n3wth)) — prototype, architecture, and implementation.

---

## License

MIT — see [LICENSE](LICENSE) for details.
