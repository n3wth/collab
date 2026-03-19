import { useEffect, useRef, useState } from 'react'
import { AGENT_PRESETS } from './AgentConfigurator'
import { supabase } from './lib/supabase'
import type { AgentConfig } from './orchestrator'
import type { DocTemplate } from './types'

const AGENT_DESCRIPTIONS: Record<string, string> = {
  Aiden: 'Technical architecture and engineering',
  Nova: 'Product strategy and user research',
  Lex: 'Legal review and compliance',
  Mira: 'Design and user experience',
}

interface Starter {
  id: string
  title: string
  description: string
  template: DocTemplate
  agents: AgentConfig[]
}

export const STARTERS: Starter[] = [
  {
    id: 'blank',
    title: 'Blank Canvas',
    description: 'Empty doc, your choice of agents.',
    template: 'blank',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    ],
  },
  {
    id: 'product-brief',
    title: 'Product Brief',
    description: 'Architecture review and user assumption testing.',
    template: 'prd',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
    ],
  },
  {
    id: 'tech-spec',
    title: 'Technical Spec',
    description: 'System design with compliance and risk review.',
    template: 'tech-spec',
    agents: [
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
      { name: 'Lex', persona: AGENT_PRESETS[2].persona, owner: 'You', color: '#64d2ff' },
    ],
  },
  {
    id: 'design-review',
    title: 'Design Review',
    description: 'UX advocacy and product-market fit analysis.',
    template: 'prd',
    agents: [
      { name: 'Mira', persona: AGENT_PRESETS[3].persona, owner: 'You', color: '#ffd60a' },
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
    ],
  },
  {
    id: 'full-team',
    title: 'Full Team',
    description: 'Engineering, product, legal, and design.',
    template: 'prd',
    agents: AGENT_PRESETS.map(p => ({
      name: p.name,
      persona: p.persona,
      owner: 'You',
      color: p.color,
    })),
  },
  {
    id: 'meeting-notes',
    title: 'Meeting Notes',
    description: 'Decision capture and action item extraction.',
    template: 'meeting-notes',
    agents: [
      { name: 'Nova', persona: AGENT_PRESETS[1].persona, owner: 'You', color: '#ff6961' },
      { name: 'Aiden', persona: AGENT_PRESETS[0].persona, owner: 'You', color: '#30d158' },
    ],
  },
]

export interface GoogleDocFile {
  id: string
  name: string
  modifiedTime: string
  iconLink?: string
}

interface Props {
  onSelect: (starter: Starter) => void
  onImport?: (file: GoogleDocFile) => void
  onClose: () => void
  importAvailable?: boolean
}

export function TemplatePickerModal({ onSelect, onImport, onClose, importAvailable }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const [showDrivePicker, setShowDrivePicker] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showDrivePicker) setShowDrivePicker(false)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, showDrivePicker])

  return (
    <div
      className="template-picker-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) { if (showDrivePicker) setShowDrivePicker(false); else onClose() } }}
    >
      <div className="template-picker">
        <div className="template-picker-header">
          {showDrivePicker ? (
            <>
              <button className="template-picker-back" onClick={() => setShowDrivePicker(false)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="template-picker-title">Google Docs</span>
            </>
          ) : (
            <span className="template-picker-title">New document</span>
          )}
          <button className="template-picker-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {showDrivePicker && onImport ? (
          <DriveFilePicker onSelect={onImport} />
        ) : (
        <>
        <div className="template-picker-import">
          <button
            className="template-picker-import-btn"
            onClick={() => {
              if (!importAvailable) {
                alert('Sign in with Google to import from Drive')
                return
              }
              setShowDrivePicker(true)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
              <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
              <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-20.4 35.3c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/>
              <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 13.95z" fill="#ea4335"/>
              <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/>
              <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
              <path d="m73.4 26.5-10.1-17.5c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
            </svg>
            <div className="template-picker-import-info">
              <span className="template-picker-item-name">Import from Google Docs</span>
              <span className="template-picker-item-desc">Bring in an existing document for review</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <div className="template-picker-divider" />
        <div className="template-picker-list">
          {STARTERS.map(s => (
            <button
              key={s.id}
              className="template-picker-item"
              onClick={() => onSelect(s)}
            >
              <div className="template-picker-item-info">
                <span className="template-picker-item-name">{s.title}</span>
                <span className="template-picker-item-desc">{s.description}</span>
              </div>
              <div className="template-picker-agents">
                {s.agents.map(a => (
                  <span
                    key={a.name}
                    className="template-picker-agent-tag"
                    style={{ color: a.color, background: `${a.color}1a` }}
                    title={AGENT_DESCRIPTIONS[a.name]}
                  >
                    {a.name}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
        </>
        )}
      </div>
    </div>
  )
}

// --- Drive file picker (inline, no external SDK) ---

function DriveFilePicker({ onSelect }: { onSelect: (file: GoogleDocFile) => void }) {
  const [files, setFiles] = useState<GoogleDocFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.provider_token
        if (!token) {
          setError('No Google token. Please sign in again.')
          setLoading(false)
          return
        }
        const q = encodeURIComponent("mimeType='application/vnd.google-apps.document' and trashed=false")
        const res = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=20&fields=files(id,name,modifiedTime,iconLink)`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        if (!res.ok) {
          const err = await res.text()
          console.error('[drive-picker] list failed:', res.status, err.slice(0, 200))
          setError(res.status === 401 ? 'Google session expired. Sign out and back in.' : 'Failed to load documents')
          setLoading(false)
          return
        }
        const data = await res.json()
        if (!cancelled) {
          setFiles(data.files || [])
          setLoading(false)
        }
      } catch (err) {
        console.error('[drive-picker] error:', err)
        if (!cancelled) {
          setError('Failed to load documents')
          setLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const filtered = search
    ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()))
    : files

  if (loading) {
    return (
      <div className="drive-picker-loading">
        <span className="drive-picker-spinner" />
        Loading documents...
      </div>
    )
  }

  if (error) {
    return <div className="drive-picker-error">{error}</div>
  }

  return (
    <div className="drive-picker">
      <div className="drive-picker-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          placeholder="Filter documents..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="drive-picker-list">
        {filtered.length === 0 ? (
          <div className="drive-picker-empty">
            {search ? 'No matching documents' : 'No Google Docs found'}
          </div>
        ) : (
          filtered.map(f => (
            <button
              key={f.id}
              className="drive-picker-item"
              onClick={() => onSelect(f)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#4285f4" strokeWidth="1.5" fill="none" />
                <polyline points="14 2 14 8 20 8" stroke="#4285f4" strokeWidth="1.5" fill="none" />
                <line x1="8" y1="13" x2="16" y2="13" stroke="#4285f4" strokeWidth="1.5" />
                <line x1="8" y1="17" x2="13" y2="17" stroke="#4285f4" strokeWidth="1.5" />
              </svg>
              <div className="drive-picker-item-info">
                <span className="drive-picker-item-name">{f.name}</span>
                <span className="drive-picker-item-date">
                  {new Date(f.modifiedTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
