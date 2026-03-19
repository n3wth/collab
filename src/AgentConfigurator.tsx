import { useState, useEffect } from 'react'
import { BlobAvatar } from './blob-avatar'

export interface AgentConfig {
  name: string
  description: string
  persona: string
  owner: string
  color: string
}

const PRESETS: AgentConfig[] = [
  {
    name: 'Aiden',
    description: 'Technical architecture and engineering',
    persona: 'You are Aiden, a collaborative AI agent who writes with technical precision. You think in systems, APIs, data models, and implementation trade-offs. You add concrete substance to documents: specific protocols, data flows, component boundaries, failure modes, and performance constraints. You turn vague ideas into buildable specifications.',
    color: '#30d158',
    owner: 'You',
  },
  {
    name: 'Nova',
    description: 'Product strategy and user research',
    persona: 'You are Nova, a collaborative AI agent who writes from the user\'s perspective. You think in user journeys, adoption curves, market positioning, and behavioral psychology. You challenge assumptions by asking "who benefits?" and "what breaks?". You add user scenarios, edge cases, adoption risks, and competitive framing.',
    color: '#ff6961',
    owner: 'You',
  },
  {
    name: 'Lex',
    description: 'Legal review and compliance',
    persona: 'You are Lex, a collaborative AI agent who writes with legal precision. You spot regulatory risks, privacy gaps, contractual ambiguity, and compliance failures. You flag liabilities before they become problems. Your prose is exact and cautious — every qualifier earns its place.',
    color: '#64d2ff',
    owner: 'You',
  },
  {
    name: 'Mira',
    description: 'Design and user experience',
    persona: 'You are Mira, a collaborative AI agent who advocates for the end user. You think in user flows, visual hierarchy, accessibility, and interaction cost. You question complexity that hurts usability. When you see a feature without a user story, you write one. Your writing is visual — you describe what users see and do, not abstract principles.',
    color: '#ffd60a',
    owner: 'You',
  },
]

interface Props {
  agents: AgentConfig[]
  onChange: (agents: AgentConfig[]) => void
}

const API_KEY_STORAGE_KEY = 'collab-gemini-api-key'

export function getStoredApiKey(): string {
  return localStorage.getItem(API_KEY_STORAGE_KEY) || ''
}

export function AgentConfigurator({ agents, onChange }: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [keyVisible, setKeyVisible] = useState(false)
  const [keySaved, setKeySaved] = useState(false)

  useEffect(() => {
    setApiKey(getStoredApiKey())
  }, [])

  const saveKey = (key: string) => {
    setApiKey(key)
    if (key) {
      localStorage.setItem(API_KEY_STORAGE_KEY, key)
    } else {
      localStorage.removeItem(API_KEY_STORAGE_KEY)
    }
    setKeySaved(true)
    setTimeout(() => setKeySaved(false), 1500)
  }

  const addPreset = (preset: AgentConfig) => {
    if (agents.length >= 4) return
    const name = agents.some(a => a.name === preset.name)
      ? `${preset.name} ${agents.length + 1}`
      : preset.name
    onChange([...agents, { ...preset, name }])
  }

  const remove = (idx: number) => {
    onChange(agents.filter((_, i) => i !== idx))
    if (editing === idx) setEditing(null)
  }

  const update = (idx: number, patch: Partial<AgentConfig>) => {
    onChange(agents.map((a, i) => i === idx ? { ...a, ...patch } : a))
  }

  const availablePresets = PRESETS.filter(pr => !agents.some(a => a.name === pr.name))

  return (
    <div className="agent-configurator">
      <div className="ac-active">
        <div className="ac-label">Active agents</div>
        <div className="ac-cards">
          {agents.map((a, i) => (
            <div key={a.name + i} className="ac-card" style={{ borderColor: `${a.color}40` }}>
              {editing === i ? (
                <div className="ac-edit">
                  <div className="ac-edit-row">
                    <label className="ac-field">
                      <span className="ac-field-label">Name</span>
                      <input value={a.name} onChange={e => update(i, { name: e.target.value })} />
                    </label>
                    <label className="ac-field">
                      <span className="ac-field-label">Owner</span>
                      <input value={a.owner} onChange={e => update(i, { owner: e.target.value })} />
                    </label>
                  </div>
                  <label className="ac-field">
                    <span className="ac-field-label">Description</span>
                    <input value={a.description} onChange={e => update(i, { description: e.target.value })} />
                  </label>
                  <label className="ac-field">
                    <span className="ac-field-label">System prompt</span>
                    <textarea value={a.persona} onChange={e => update(i, { persona: e.target.value })} rows={3} />
                  </label>
                  <button className="ac-done-btn" onClick={() => setEditing(null)}>Done</button>
                </div>
              ) : (
                <div className="ac-view">
                  <div className="ac-card-top">
                    <BlobAvatar name={a.name} size={28} color={a.color} />
                    <div className="ac-card-info">
                      <span className="ac-card-name">{a.name}</span>
                      <span className="ac-card-desc">{a.description}</span>
                    </div>
                    <div className="ac-card-dot" style={{ background: a.color }} />
                  </div>
                  <div className="ac-card-actions">
                    <button className="ac-btn" onClick={() => setEditing(i)}>Edit</button>
                    {agents.length > 1 && <button className="ac-btn ac-btn-remove" onClick={() => remove(i)}>Remove</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {agents.length < 4 && availablePresets.length > 0 && (
        <div className="ac-add">
          <div className="ac-label">Add agent</div>
          <div className="ac-preset-grid">
            {availablePresets.map(pr => (
              <button key={pr.name} className="ac-preset-card" onClick={() => addPreset(pr)}>
                <BlobAvatar name={pr.name} size={24} color={pr.color} />
                <div className="ac-preset-info">
                  <span className="ac-preset-name">{pr.name}</span>
                  <span className="ac-preset-desc">{pr.description}</span>
                </div>
                <div className="ac-card-dot" style={{ background: pr.color }} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ac-api-key">
        <div className="ac-label">Gemini API Key</div>
        <div className="ac-key-row">
          <input
            type={keyVisible ? 'text' : 'password'}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onBlur={() => saveKey(apiKey)}
            onKeyDown={e => { if (e.key === 'Enter') saveKey(apiKey) }}
            placeholder="Paste your Gemini API key"
            className="ac-key-input"
            spellCheck={false}
            autoComplete="off"
          />
          <button className="ac-btn" onClick={() => setKeyVisible(v => !v)}>
            {keyVisible ? 'Hide' : 'Show'}
          </button>
          {keySaved && <span className="ac-key-saved">Saved</span>}
        </div>
        <span className="ac-key-hint">
          Optional. Used when no server key is configured.{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a key</a>
        </span>
      </div>
    </div>
  )
}

export { PRESETS as AGENT_PRESETS }
