-- sessions
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Untitled',
  template text not null default 'blank',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- documents (one per session)
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions(id) on delete cascade,
  html_snapshot text,
  updated_at timestamptz not null default now()
);

-- chat_messages
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  sender text not null,
  text text not null,
  reasoning jsonb,
  created_at timestamptz not null default now()
);

create index idx_chat_messages_session on chat_messages(session_id, created_at);

-- agent_personas
create table if not exists agent_personas (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  name text not null,
  description text not null default '',
  system_prompt text not null default '',
  color text not null default '#1a1a1a',
  owner text not null default 'You',
  model text not null default 'gemini-2.5-flash',
  sort_order int not null default 0
);

create index idx_agent_personas_session on agent_personas(session_id, sort_order);

-- Permissive RLS (no auth yet)
alter table sessions enable row level security;
alter table documents enable row level security;
alter table chat_messages enable row level security;
alter table agent_personas enable row level security;

create policy "public_sessions" on sessions for all using (true) with check (true);
create policy "public_documents" on documents for all using (true) with check (true);
create policy "public_chat" on chat_messages for all using (true) with check (true);
create policy "public_personas" on agent_personas for all using (true) with check (true);
