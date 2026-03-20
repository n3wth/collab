import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { BlobAvatar } from '../blob-avatar'
import { ChatMessage } from './ChatMessage'
import type { Message, AgentState, AgentConfig } from '../types'

interface ChatPanelProps {
  messages: Message[]
  activeAgents: AgentConfig[]
  getAgentState: (name: string) => AgentState
  userAvatarUrl?: string
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onSendSuggestion: (text: string) => void
  onApproveProposal: (id: string) => void
  onRejectProposal: (id: string) => void
  chatWidth: number
}

export function ChatPanel({
  messages,
  activeAgents,
  getAgentState,
  userAvatarUrl,
  input,
  onInputChange,
  onSend,
  onSendSuggestion,
  onApproveProposal,
  onRejectProposal,
  chatWidth,
}: ChatPanelProps) {
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [chatVisibleCount, setChatVisibleCount] = useState(50)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const MENTION_NAMES = useMemo(() => [...activeAgents.map(a => a.name), 'Sarah'], [activeAgents])

  useEffect(() => {
    const container = chatEndRef.current?.parentElement
    if (!container) return
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120
    if (isNearBottom) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onInputChange(val)
    const atIdx = val.lastIndexOf('@')
    if (atIdx !== -1 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
      const query = val.slice(atIdx + 1)
      if (!query.includes(' ')) {
        setMentionQuery(query)
        setMentionIndex(0)
        return
      }
    }
    setMentionQuery(null)
  }, [onInputChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (mentionQuery !== null) {
      const filtered = MENTION_NAMES.filter(n => n.toLowerCase().startsWith(mentionQuery.toLowerCase()))
      if (e.key === 'Tab' || (e.key === 'Enter' && filtered.length > 0)) {
        e.preventDefault()
        const safeIndex = Math.min(mentionIndex, filtered.length - 1)
        const pick = filtered[safeIndex] ?? filtered[0]
        if (pick) {
          const atIdx = input.lastIndexOf('@')
          onInputChange(input.slice(0, atIdx) + '@' + pick + ' ')
          setMentionQuery(null)
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter') onSend()
  }, [mentionQuery, mentionIndex, MENTION_NAMES, input, onInputChange, onSend])

  // Memoize filtered + visible messages to avoid re-computing in render
  const { visible, hiddenCount } = useMemo(() => {
    const filtered = messages.filter(m => !m.text.startsWith('Couldn\'t find that text'))
    const hidden = Math.max(0, filtered.length - chatVisibleCount)
    const vis = hidden > 0 ? filtered.slice(-chatVisibleCount) : filtered
    return { visible: vis, hiddenCount: hidden }
  }, [messages, chatVisibleCount])

  return (
    <div className="chat-panel chat-right" style={{ width: chatWidth, maxWidth: chatWidth, flexBasis: chatWidth }}>
      <div className="chat-messages">
        <div className="chat-messages-inner">
          {hiddenCount > 0 && (
            <button className="load-older-btn" onClick={() => setChatVisibleCount(c => c + 50)}>
              Load {Math.min(50, hiddenCount)} older messages
            </button>
          )}
          {visible.map((m, i, arr) => {
            const prev = arr[i - 1]
            const sameSender = prev && prev.from === m.from
            return (
              <ChatMessage
                key={m.id}
                m={m}
                sameSender={sameSender}
                agentState={activeAgents.some(a => a.name === m.from) ? getAgentState(m.from) : null}
                userAvatarUrl={userAvatarUrl}
                onApproveProposal={onApproveProposal}
                onRejectProposal={onRejectProposal}
              />
            )
          })}
          {activeAgents.map(agent => {
            const state = getAgentState(agent.name)
            return (state.status === 'thinking' || state.status === 'typing') && !state.inDoc ? (
              <div key={agent.name} className="msg">
                <div className="msg-avatar">
                  <BlobAvatar name={agent.name} size={26} state={state.status} />
                </div>
                <div className="msg-body">
                  <div className="msg-header">
                    <span className="msg-name">{agent.name}</span>
                  </div>
                  <div className="msg-thinking">
                    <span className="thinking-text">{state.thought || 'Thinking...'}</span>
                  </div>
                </div>
              </div>
            ) : null
          })}
          <div ref={chatEndRef} />
        </div>
      </div>
      {messages.length === 0 && (
        <div className="chat-suggestions">
          {['Help me outline a product spec', 'Review my draft for clarity', 'What should this doc cover?', 'Brainstorm ideas for this topic'].map(text => (
            <button key={text} className="chat-suggestion-chip" onClick={() => onSendSuggestion(text)}>{text}</button>
          ))}
        </div>
      )}
      <div className="chat-input">
        {mentionQuery !== null && (() => {
          const filtered = MENTION_NAMES.filter(n => n.toLowerCase().startsWith(mentionQuery.toLowerCase()))
          if (filtered.length === 0) return null
          const safeIndex = Math.min(mentionIndex, filtered.length - 1)
          return (
            <div className="mention-dropdown">
              {filtered.map((n, i) => (
                <div
                  key={n}
                  className={`mention-option ${i === safeIndex ? 'mention-option-active' : ''}`}
                  onMouseDown={e => {
                    e.preventDefault()
                    const atIdx = input.lastIndexOf('@')
                    onInputChange(input.slice(0, atIdx) + '@' + n + ' ')
                    setMentionQuery(null)
                  }}
                >
                  <BlobAvatar name={n} size={16} />
                  <span>{n}</span>
                  {(() => {
                    const agent = activeAgents.find(a => a.name === n)
                    if (!agent) return null
                    const role = agent.persona.split('.')[0].replace(/^You are \w+, /, '')
                    return <span className="mention-role">{role}</span>
                  })()}
                </div>
              ))}
            </div>
          )
        })()}
        <input
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={activeAgents.some(a => getAgentState(a.name).inDoc) ? 'Talk to the agents...' : 'Message the team...'}
        />
      </div>
    </div>
  )
}
