import { useState, useEffect } from 'react'
import { listSessions, createSession, deleteSession } from './lib/session-store'
import { DOC_TEMPLATES } from './templates'
import type { Session, DocTemplate } from './types'

const TEMPLATE_KEYS: DocTemplate[] = ['blank', 'prd', 'tech-spec', 'meeting-notes']

interface Props {
  onSelect: (session: Session) => void
}

export function SessionPicker({ onSelect }: Props) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState<DocTemplate>('blank')

  useEffect(() => {
    listSessions()
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async () => {
    const session = await createSession(title.trim() || 'Untitled', template)
    onSelect(session)
  }

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await deleteSession(id)
    setSessions(s => s.filter(x => x.id !== id))
  }

  if (loading) return <div className="session-picker"><p className="sp-empty">Loading...</p></div>

  return (
    <div className="session-picker">
      <div className="sp-header">
        <h2>Sessions</h2>
        <button className="sp-new-btn" onClick={() => setCreating(!creating)}>New</button>
      </div>

      {creating && (
        <div className="sp-form">
          <input
            className="sp-input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Session title"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <div className="sp-templates">
            {TEMPLATE_KEYS.map(t => (
              <button
                key={t}
                className={`sp-template-btn ${template === t ? 'active' : ''}`}
                onClick={() => setTemplate(t)}
              >
                {DOC_TEMPLATES[t].label}
              </button>
            ))}
          </div>
          <button className="sp-create-btn" onClick={handleCreate}>Create</button>
        </div>
      )}

      {sessions.length === 0 && !creating && (
        <p className="sp-empty">No sessions yet. Create one to get started.</p>
      )}

      <div className="sp-list">
        {sessions.map(s => (
          <div key={s.id} className="sp-item" onClick={() => onSelect(s)}>
            <div className="sp-item-main">
              <span className="sp-item-title">{s.title}</span>
              <span className="sp-badge">{DOC_TEMPLATES[s.template]?.label ?? s.template}</span>
            </div>
            <div className="sp-item-meta">
              <span className="sp-item-date">
                {new Date(s.updated_at).toLocaleDateString()}
              </span>
              <button className="sp-delete-btn" onClick={e => handleDelete(e, s.id)}>x</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
