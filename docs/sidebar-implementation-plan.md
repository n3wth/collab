# Sidebar Navigation Implementation Plan

Branch: `feat/sidebar-navigation` (already created, on main HEAD)

## Design Reference

Paper file "Bright wave" has all wireframes. Key artboard: **"Workspace — Chat Right"** is the final approved design.

Design spec saved at: `~/.claude/projects/-Users-oliver-GitHub-collab/memory/project_sidebar_design.md`

## Architecture Overview

The current app has two views: a full-page HomePage (doc list + templates) and a workspace view (chat + editor). The sidebar unifies these into one persistent shell. The HomePage goes away for logged-in users — the sidebar IS the home.

### Current flow:
```
LoginPage → HomePage (full page) → Workspace (chat-left + editor)
```

### New flow:
```
LoginPage → AppShell (sidebar + main area)
                      ├── No doc selected: empty state with shader
                      └── Doc selected: editor (center) + chat (right)
```

## Step-by-step Implementation

### Step 1: Create Sidebar component
**New file: `src/Sidebar.tsx`**

- 240px fixed width, bg `#161618`
- Top: "Collab" wordmark (text only, no blob)
- "+ New document" button (opens template picker modal/dropdown)
- "DOCUMENTS" section header
- Doc list: green dot + bold = active, gray dot + regular = inactive
- Bottom: user avatar (Google photo, 22px circle) + name + email, border-top separator
- Props: `sessions`, `activeSessionId`, `onSelect`, `onNewDoc`, `user`

### Step 2: Create TemplatePickerModal component
**New file: `src/TemplatePickerModal.tsx`**

- Small modal/dropdown that appears when "+ New document" is clicked
- Shows the existing STARTERS (Product Brief, Technical Spec, etc.)
- Each option: agent blobs + title + description
- On click: creates session and selects it
- Replaces the HomePage template grid for logged-in users

### Step 3: Restructure App.tsx layout

Remove the conditional HomePage/Workspace split. Replace with:

```tsx
// Logged-in users always see the app shell
<div className="app-shell">
  <div className="app-header">
    <div className="header-sidebar-zone">Collab</div>
    <div className="header-editor-zone">Product Brief</div>
    <div className="header-chat-zone">[agent avatars] [+ button]</div>
  </div>
  <div className="app-body">
    <Sidebar ... />
    {activeSession ? (
      <>
        <EditorPanel ... />
        <ChatPanel ... />
      </>
    ) : (
      <EmptyState />  // shader + frosted glass card
    )}
  </div>
</div>
```

Key changes to App.tsx:
- Remove `if (!activeSession) return <HomePage ...>` — sidebar handles doc selection
- Move chat panel from LEFT to RIGHT of editor
- Move agent avatars from header-left to header-right
- Doc title: left-aligned in editor header zone, regular weight, muted color
- Header split into three zones matching the three columns

### Step 4: Update CSS — unified chrome

- Sidebar, header, chat panel all use `#161618` (same bg)
- Editor uses `#1c1c1f` (stands out as the focal point)
- Remove borders between same-color surfaces
- Only border where different bg colors meet (sidebar↔editor, editor↔chat)
- Header has bottom border only

CSS variables to reference:
```css
--surface-0: #0e0e10   /* base/body */
--surface-1: #1c1c1f   /* editor */
--sidebar-bg: #161618  /* sidebar, header, chat */
```

### Step 5: Agent avatar popover

Replace the old AgentConfigurator panel with a click-on-avatar popover:
- Click agent circle in header → dropdown with: agent name, role, "Edit persona", "Remove agent"
- Gray "+" circle at end → opens agent preset picker
- Remove the gear icon entirely

### Step 6: Editor typography

- Add Charter font (Google Fonts: `Libre Baskerville` as web fallback)
- Editor body text: `font-family: Charter, 'Libre Baskerville', Georgia, serif`
- Editor headings stay: `font-family: Inter, sans-serif`
- Add `<link>` for Libre Baskerville in index.html

### Step 7: Landing page update

- Keep for unauthenticated users only
- Same shader as empty state behind hero
- Headline: "Write with AI experts." (Instrument Serif)
- Product mockup below showing the actual 3-column layout
- "Get started" button + "Sign in" ghost button
- No footer (move privacy/terms to a settings menu later)

### Step 8: Empty state (no doc selected)

- Full-bleed shader canvas behind content
- Frosted glass card centered: "Select a document" / "Pick a document from the sidebar or create a new one." / "Cmd + N to create"
- Same shader component used on landing page

## Files that will change

- `src/App.tsx` — Major restructure (layout, routing, state)
- `src/App.css` — Major CSS rewrite (3-column layout, unified chrome)
- `src/Sidebar.tsx` — New file
- `src/TemplatePickerModal.tsx` — New file
- `src/HomePage.tsx` — Simplify to landing-only (unauthenticated)
- `src/LoginPage.tsx` — May merge with simplified HomePage
- `src/AgentConfigurator.tsx` — Replace with popover pattern
- `src/index.html` — Add Libre Baskerville font
- `src/index.css` — Add sidebar-bg variable

## Files that should NOT change

- `src/agent.ts` — Agent logic unchanged
- `src/agent-actions.ts` — Action execution unchanged
- `src/orchestrator.ts` — Orchestrator unchanged
- `src/agent-cursor.ts` — Cursor system unchanged
- `src/blob-avatar.tsx` — Blob rendering unchanged
- `src/lib/` — All Supabase/auth logic unchanged
- `api/` — Server functions unchanged

## Validation

After each step, run:
```bash
npm run build   # Must pass with zero errors
npm run test    # Existing tests must pass (1 pre-existing failure in orchestrator.test.ts is OK)
```

Before marking done:
1. Build passes
2. Dev server renders all three states (landing, empty state, workspace)
3. Can create new doc from sidebar
4. Can switch between docs
5. Chat works on the right side
6. Agent avatars show in header with popover
7. Editor uses Charter serif for body text
8. User avatar shows at sidebar bottom

## Important constraints

- Never commit to main directly — use the `feat/sidebar-navigation` branch
- The agent system (orchestrator, agent.ts, agent-actions.ts) must not be modified
- Preserve all existing Supabase persistence (sessions, documents, chat messages)
- The existing URL routing (`/s/:sessionId`) should still work
- Keep the formatting toolbar (B, I, H1, H2, lists)
- Auth flow (Google OAuth via Supabase) unchanged
