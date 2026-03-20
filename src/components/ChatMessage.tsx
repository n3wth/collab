import { memo } from 'react'
import { BlobAvatar } from '../blob-avatar'
import { ShapeAvatar } from './ShapeAvatar'
import { AgentHoverCard } from './AgentHoverCard'
import { ReasoningChain } from './ReasoningChain'
import { FormatMentions } from './FormatMentions'
import type { Message, AgentState } from '../types'

export const ChatMessage = memo(({ m, sameSender, agentState, userAvatarUrl, onApproveProposal, onRejectProposal }: {
  m: Message, sameSender: boolean, agentState?: AgentState | null, userAvatarUrl?: string,
  onApproveProposal?: (id: string) => void, onRejectProposal?: (id: string) => void
}) => {
  const isAgent = m.from !== 'You' && m.from !== 'Sarah' && m.from !== 'System'
  const displayText = m.text.replace('[from doc] ', '')
  return (
    <div className={`msg ${isAgent ? 'msg-agent' : 'msg-human'} ${sameSender ? 'msg-consecutive' : ''}`} data-agent={isAgent ? m.from.toLowerCase() : undefined}>
      {!sameSender && (
        <div className={`msg-avatar ${isAgent ? 'msg-avatar-agent' : ''}`}>
          {isAgent ? (
            <>
              <BlobAvatar name={m.from} size={26} />
              <AgentHoverCard name={m.from} agentState={agentState ?? null} />
            </>
          ) : m.from === 'You' ? (
            userAvatarUrl ? (
              <img src={userAvatarUrl} alt="You" className="user-avatar" width={26} height={26} />
            ) : (
              <div className="user-avatar user-avatar-fallback" style={{ width: 26, height: 26 }} />
            )
          ) : (
            <ShapeAvatar name={m.from} size={26} />
          )}
        </div>
      )}
      <div className={`msg-body ${sameSender ? 'msg-body-consecutive' : ''}`}>
        {!sameSender && (
          <div className="msg-header">
            <span className="msg-name">{m.from}</span>
            <span className="msg-time">{m.time}</span>
          </div>
        )}
        {isAgent && m.reasoning && m.reasoning.length > 0 && (
          <ReasoningChain steps={m.reasoning} />
        )}
        <div className="msg-text">
          <FormatMentions text={displayText} />
        </div>
        {m.proposal && m.proposal.status === 'pending' && (
          <div className="msg-proposal-actions">
            <button
              className="msg-proposal-btn msg-proposal-approve"
              onClick={() => onApproveProposal?.(m.id)}
            >Approve</button>
            <button
              className="msg-proposal-btn msg-proposal-reject"
              onClick={() => onRejectProposal?.(m.id)}
            >Dismiss</button>
          </div>
        )}
        {m.proposal && m.proposal.status === 'approved' && (
          <span className="msg-proposal-status">Approved</span>
        )}
        {m.proposal && m.proposal.status === 'rejected' && (
          <span className="msg-proposal-status msg-proposal-dismissed">Dismissed</span>
        )}
      </div>
    </div>
  )
})
