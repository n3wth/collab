import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { Timeline } from './Timeline'
import { supabase } from '../lib/supabase'
import type { TimelineEntry, Session, Message } from '../types'

interface EditorPanelProps {
  editor: Editor
  timeline: TimelineEntry[]
  activeSession: Session
  driveStatus: 'idle' | 'saving' | 'saved' | 'error'
  setDriveStatus: (status: 'idle' | 'saving' | 'saved' | 'error') => void
  user: { user_metadata?: { avatar_url?: string } } | null
  providerToken: string | null
  signInWithGoogle: () => void
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  now: () => string
  uid: () => string
}

export function EditorPanel({
  editor,
  timeline,
  activeSession,
  driveStatus,
  setDriveStatus,
  user,
  providerToken,
  signInWithGoogle,
  setMessages,
  now,
  uid,
}: EditorPanelProps) {
  return (
    <div className="doc-panel">
      <div className="doc-toolbar">
        <button
          className={`doc-toolbar-btn ${editor.isActive('bold') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
        >
          B
        </button>
        <button
          className={`doc-toolbar-btn ${editor.isActive('italic') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
        >
          <em>I</em>
        </button>
        <span className="doc-toolbar-sep" />
        <button
          className={`doc-toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          title="Heading 1"
        >
          H1
        </button>
        <button
          className={`doc-toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          title="Heading 2"
        >
          H2
        </button>
        <span className="doc-toolbar-sep" />
        <button
          className={`doc-toolbar-btn ${editor.isActive('bulletList') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bullet List"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
        </button>
        <button
          className={`doc-toolbar-btn ${editor.isActive('orderedList') ? 'active' : ''}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Ordered List"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="1" y="8" fontSize="8" fill="currentColor" stroke="none" fontFamily="sans-serif">1</text><text x="1" y="14" fontSize="8" fill="currentColor" stroke="none" fontFamily="sans-serif">2</text><text x="1" y="20" fontSize="8" fill="currentColor" stroke="none" fontFamily="sans-serif">3</text></svg>
        </button>
        <span className="doc-toolbar-spacer" />
        <button
          className="doc-toolbar-btn"
          onClick={() => {
            const text = editor.getText()
            const h1 = text.split('\n')[0] || 'document'
            const blob = new Blob([text], { type: 'text/markdown' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = `${h1.slice(0, 40)}.md`; a.click()
            URL.revokeObjectURL(url)
          }}
          title="Download as Markdown"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button
          className="doc-toolbar-btn"
          onClick={async () => {
            const token = providerToken || (await supabase.auth.getSession()).data.session?.provider_token
            if (!token) {
              if (!user) {
                signInWithGoogle()
              } else {
                setMessages(prev => [...prev, { id: uid(), from: 'System', text: 'Google Drive access expired. Please sign out and sign in again to reconnect Drive.', time: now() }])
              }
              return
            }
            setDriveStatus('saving')
            const html = editor.getHTML()
            const title = activeSession?.title || 'Untitled'
            const metadata = { name: `${title}.html`, mimeType: 'application/vnd.google-apps.document' }
            const form = new FormData()
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
            form.append('file', new Blob([html], { type: 'text/html' }))
            const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: form,
            })
            if (res.ok) {
              setDriveStatus('saved')
              setTimeout(() => setDriveStatus('idle'), 3000)
            } else {
              setDriveStatus('error')
              setTimeout(() => setDriveStatus('idle'), 3000)
            }
          }}
          title={driveStatus === 'saved' ? 'Saved to Drive' : driveStatus === 'error' ? 'Save failed' : 'Save to Google Drive'}
          disabled={driveStatus === 'saving'}
        >
          {driveStatus === 'saving' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite' }}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
          ) : driveStatus === 'saved' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#30d158" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : driveStatus === 'error' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff6961" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-20.4 35.3c-.8 1.4-1.2 2.95-1.2 4.5h27.5z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 13.95z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/><path d="m73.4 26.5-10.1-17.5c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 23.8h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/></svg>
          )}
        </button>
      </div>
      <div className="doc-body">
        <EditorContent editor={editor} />
      </div>
      <Timeline entries={timeline} />
    </div>
  )
}
