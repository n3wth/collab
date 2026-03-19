import { useState, useRef, useEffect } from 'react'
import { BlobAvatar } from './blob-avatar'
import { deleteSession } from './lib/session-store'
import type { Session } from './types'
import type { User } from '@supabase/supabase-js'

function getDateGroup(dateStr: string): string {
  const now = new Date()
  const then = new Date(dateStr)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const weekAgo = new Date(today.getTime() - 7 * 86400000)
  if (then >= today) return 'Today'
  if (then >= yesterday) return 'Yesterday'
  if (then >= weekAgo) return 'This week'
  return 'Older'
}

function groupSessions(sessions: Session[]): { label: string, items: Session[] }[] {
  const groups: { label: string, items: Session[] }[] = []
  let currentLabel = ''
  for (const s of sessions) {
    const label = getDateGroup(s.updated_at)
    if (label !== currentLabel) {
      groups.push({ label, items: [] })
      currentLabel = label
    }
    groups[groups.length - 1].items.push(s)
  }
  return groups
}

interface Props {
  sessions: Session[]
  activeSessionId: string | null
  onSelect: (session: Session) => void
  onNewDoc: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onCollapse: () => void
  onHome: () => void
  collapsed: boolean
  user: User | null
  onSignOut?: () => void
}

export function Sidebar({ sessions, activeSessionId, onSelect, onNewDoc, onDelete, onRename, onCollapse, onHome, collapsed, user, onSignOut }: Props) {
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false)
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

  const handleDelete = async (id: string) => {
    await deleteSession(id)
    onDelete(id)
    setConfirmDelete(null)
    if (editing && sessions.length <= 1) setEditing(false)
  }

  if (collapsed) {
    return (
      <div className="sidebar sidebar-collapsed">
        <button className="sidebar-expand-btn" onClick={onCollapse} title="Expand sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <span className="header-wordmark" onClick={onHome}>Collab</span>
      </div>
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
        <div className="sidebar-section-header">
          <span className="sidebar-section-label">Documents</span>
          {editing ? (
            <button className="sidebar-edit-btn" onClick={() => setEditing(false)}>Done</button>
          ) : sessions.length > 0 ? (
            <button className="sidebar-edit-btn" onClick={() => setEditing(true)} title="Manage">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
              </svg>
            </button>
          ) : null}
        </div>
        {sessions.length > 5 && (
          <div className="sidebar-search">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              className="sidebar-search-input"
              placeholder="Search documents..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="sidebar-search-clear" onClick={() => setSearch('')}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div className="sidebar-doc-list">
          {(() => {
            const filtered = search
              ? sessions.filter(s => s.title.toLowerCase().includes(search.toLowerCase()))
              : sessions
            if (filtered.length === 0) return (
              <div className="sidebar-empty">{search ? 'No matches' : 'No documents yet'}</div>
            )
            return groupSessions(filtered).map(group => (
            <div key={group.label} className="sidebar-doc-group">
              <div className="sidebar-group-label">{group.label}</div>
              {group.items.map(s => (
                <div key={s.id} className="sidebar-doc-row">
                  {renamingId === s.id ? (
                    <input
                      className="sidebar-doc-rename-input"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => {
                        if (renameValue.trim() && renameValue !== s.title) onRename(s.id, renameValue.trim())
                        setRenamingId(null)
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      autoFocus
                    />
                  ) : (
                    <button
                      className={`sidebar-doc-item ${s.id === activeSessionId ? 'active' : ''}`}
                      onClick={() => !editing && onSelect(s)}
                      onDoubleClick={() => { setRenamingId(s.id); setRenameValue(s.title) }}
                    >
                      <span className="sidebar-doc-title">{s.title}</span>
                    </button>
                  )}
                  {editing && (
                    <button
                      className="sidebar-doc-delete"
                      onClick={() => setConfirmDelete(s.id)}
                      title="Delete"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))
          })()}
        </div>
      </div>
      <div className="sidebar-user" ref={menuRef}>
        {userMenuOpen && (
          <div className="sidebar-user-menu">
            <a href="/privacy" className="sidebar-user-menu-item">Privacy</a>
            <a href="/terms" className="sidebar-user-menu-item">Terms</a>
            {onSignOut && (
              <>
                <div className="sidebar-user-menu-sep" />
                <button className="sidebar-user-menu-item" onClick={() => { setUserMenuOpen(false); onSignOut() }}>
                  Sign out
                </button>
                <button className="sidebar-user-menu-item sidebar-user-menu-danger" onClick={() => { setUserMenuOpen(false); setConfirmDeleteAccount(true) }}>
                  Delete account
                </button>
              </>
            )}
          </div>
        )}
        {user ? (
          <button className="sidebar-user-btn" onClick={() => setUserMenuOpen(v => !v)}>
            {user.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="" className="sidebar-user-avatar" />
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
        <button className="sidebar-collapse-btn" onClick={onCollapse} title="Collapse sidebar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      </div>

      {confirmDelete && (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="sidebar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <p className="sidebar-confirm-text">Delete this document? This can't be undone.</p>
            <div className="sidebar-confirm-actions">
              <button className="sidebar-confirm-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="sidebar-confirm-delete" onClick={() => handleDelete(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
      {confirmDeleteAccount && (
        <div className="sidebar-confirm-overlay" onClick={() => setConfirmDeleteAccount(false)}>
          <div className="sidebar-confirm-dialog" onClick={e => e.stopPropagation()}>
            <p className="sidebar-confirm-text sidebar-confirm-text-danger">Delete your account and all documents? This can't be undone.</p>
            <div className="sidebar-confirm-actions">
              <button className="sidebar-confirm-cancel" onClick={() => setConfirmDeleteAccount(false)}>Cancel</button>
              <button className="sidebar-confirm-delete" onClick={() => { setConfirmDeleteAccount(false) }}>Delete account</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
