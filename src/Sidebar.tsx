import { useState, useRef, useEffect } from 'react'
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
  collapsed: boolean
  user: User | null
  onSignOut?: () => void
  onHome?: () => void
  onSettings?: () => void
}

export function Sidebar({ sessions, activeSessionId, onSelect, onNewDoc, onDelete, onRename, onCollapse, collapsed, user, onSignOut, onHome, onSettings }: Props) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    if (!userMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [userMenuOpen])

  const handleDelete = async (id: string) => {
    await deleteSession(id)
    onDelete(id)
    setConfirmDelete(null)
  }

  if (collapsed) {
    return (
      <button className="sidebar-expand-btn" onClick={onCollapse} title="Expand sidebar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    )
  }

  return (
    <div className={`sidebar ${searchOpen ? 'sidebar-searching' : ''}`}>
      <div className="sidebar-header">
        {searchOpen ? (
          <div className="sidebar-search-inline">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              className="sidebar-search-input"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false) } }}
              onBlur={() => { if (!search) setSearchOpen(false) }}
            />
            {search && (
              <button className="sidebar-search-clear" onClick={() => { setSearch(''); setSearchOpen(false) }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        ) : (
          <>
            <span className="sidebar-brand-label" onClick={onHome} style={{ cursor: onHome ? 'pointer' : undefined }}>Collab</span>
            {sessions.length > 3 && (
              <button className="sidebar-search-btn" onClick={() => setSearchOpen(true)} title="Search documents">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            )}
          </>
        )}
      </div>
      <div className="sidebar-docs">
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
                      onClick={() => onSelect(s)}
                      onDoubleClick={() => { setRenamingId(s.id); setRenameValue(s.title) }}
                    >
                      <span className="sidebar-doc-title">{s.title}</span>
                    </button>
                  )}
                  <button
                    className="sidebar-doc-delete"
                    onClick={() => setConfirmDelete(s.id)}
                    title="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ))
          })()}
        </div>
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-avatar-wrap" ref={userMenuRef}>
          {user?.user_metadata?.avatar_url ? (
            <img
              src={user.user_metadata.avatar_url}
              alt=""
              className="sidebar-user-avatar"
              onClick={() => setUserMenuOpen(v => !v)}
            />
          ) : (
            <div className="sidebar-user-avatar sidebar-user-avatar-placeholder" onClick={() => setUserMenuOpen(v => !v)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}
          {userMenuOpen && (
            <div className="sidebar-avatar-menu">
              <div className="sidebar-avatar-menu-name">{user?.user_metadata?.full_name || user?.email || 'Local user'}</div>
              <button className="sidebar-avatar-menu-item" onClick={() => { setUserMenuOpen(false); onSettings?.() }}>Settings</button>
              {onSignOut && <button className="sidebar-avatar-menu-item" onClick={onSignOut}>Sign out</button>}
            </div>
          )}
        </div>
        <button className="sidebar-new-btn" onClick={onNewDoc}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New document
          <span className="sidebar-new-shortcut">{navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl+'}N</span>
        </button>
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
    </div>
  )
}
