import { useState } from 'react'

export function ReasoningChain({ steps }: { steps: string[] }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`reasoning-chain ${expanded ? 'expanded' : ''}`} onClick={() => setExpanded(!expanded)}>
      <div className="reasoning-header">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`reasoning-chevron ${expanded ? 'open' : ''}`}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="reasoning-label">{steps.length} {steps.length === 1 ? 'step' : 'steps'}</span>
      </div>
      {expanded && (
        <div className="reasoning-steps">
          {steps.map((step, i) => (
            <div key={i} className="reasoning-step">
              <span className="reasoning-step-num">{i + 1}</span>
              <span className="reasoning-step-text">{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
