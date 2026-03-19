import { useState, useRef, useEffect } from 'react'
import { BlobAvatar } from './blob-avatar'
import type { Session } from './types'
import type { User } from '@supabase/supabase-js'

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

interface Props {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (session: Session) => void
  onNewDoc: () => void
  user: User | null
  onSignOut?: () => void
}

export function Sidebar({ sessions, activeSessionId, onSelect, onNewDoc, user, onSignOut }: Props) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [userMenuOpen])

  return (
    <div className="sidebar">
      <div className="sidebar-top">
        <button className="sidebar-new-btn" onClick={onNewDoc}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New document
        </button>
      </div>
      <div className="sidebar-docs">
        <div className="sidebar-section-label">Documents</div>
        <div className="sidebar-doc-list">
          {sessions.map(s => (
            <button
              key={s.id}
              className={`sidebar-doc-item ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => onSelect(s)}
              title={relativeTime(s.updated_at)}
            >
              <span className={`sidebar-doc-dot ${s.id === activeSessionId ? 'active' : ''}`} />
              <span className="sidebar-doc-title">{s.title}</span>
            </button>
          ))}
          {sessions.length === 0 && (
            <div className="sidebar-empty">No documents yet</div>
          )}
        </div>
      </div>
      <div className="sidebar-user" ref={menuRef}>
        {userMenuOpen && (
          <div className="sidebar-user-menu">
            {onSignOut && (
              <button className="sidebar-user-menu-item sidebar-user-menu-signout" onClick={() => { setUserMenuOpen(false); onSignOut() }}>
                Sign out
              </button>
            )}
            <a href="/privacy" className="sidebar-user-menu-item">Privacy</a>
            <a href="/terms" className="sidebar-user-menu-item">Terms</a>
          </div>
        )}
        {user ? (
          <button className="sidebar-user-btn" onClick={() => setUserMenuOpen(v => !v)}>
            {user.user_metadata?.avatar_url ? (
              <img
                src={user.user_metadata.avatar_url}
                alt=""
                className="sidebar-user-avatar"
              />
            ) : (
              <div className="sidebar-user-avatar sidebar-user-avatar-fallback" />
            )}
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{user.user_metadata?.full_name || 'User'}</span>
              <span className="sidebar-user-email">{user.email}</span>
            </div>
          </button>
        ) : (
          <button className="sidebar-user-btn" onClick={() => setUserMenuOpen(v => !v)}>
            <BlobAvatar name="Collab" size={22} state="logo" color="#30d158" />
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">Local mode</span>
            </div>
          </button>
        )}
      </div>
    </div>
  )
}
