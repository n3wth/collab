import type { Session, DocTemplate } from '../types'

const SESSIONS_KEY = 'collab-sessions'

function uid() {
  return crypto.randomUUID()
}

function loadAll(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveAll(sessions: Session[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

export async function createSession(title: string, template: DocTemplate): Promise<Session> {
  const session: Session = {
    id: uid(),
    title,
    template,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const all = loadAll()
  all.unshift(session)
  saveAll(all)
  return session
}

export async function listSessions(): Promise<Session[]> {
  return loadAll()
}

export async function deleteSession(id: string): Promise<void> {
  saveAll(loadAll().filter(s => s.id !== id))
}
