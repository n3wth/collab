import { useState, useEffect, useRef } from 'react'

export interface Command {
  id: string
  label: string
  shortcut?: string
  action: () => void
}

interface Props {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const filtered = query
    ? commands.filter(c => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const run = (cmd: Command) => {
    onClose()
    cmd.action()
  }

  return (
    <div
      className="cmd-palette-overlay"
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="cmd-palette">
        <div className="cmd-palette-input-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="cmd-palette-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(i => Math.min(i + 1, filtered.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(i => Math.max(i - 1, 0)) }
              if (e.key === 'Enter' && filtered[selected]) run(filtered[selected])
            }}
            placeholder="Type a command..."
          />
        </div>
        <div className="cmd-palette-list">
          {filtered.length === 0 ? (
            <div className="cmd-palette-empty">No matching commands</div>
          ) : filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`cmd-palette-item ${i === selected ? 'cmd-palette-item-active' : ''}`}
              onClick={() => run(cmd)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="cmd-palette-item-label">{cmd.label}</span>
              {cmd.shortcut && <span className="cmd-palette-item-shortcut">{cmd.shortcut}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
