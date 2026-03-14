import { useState, useEffect } from 'react'
import { BlobAvatar } from './blob-avatar'
import { AGENT_PRESETS } from './AgentConfigurator'

interface Props {
  onDismiss: () => void
  onDemo: () => void
}

export function SplashScreen({ onDismiss, onDemo }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(onDismiss, 400)
    }, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  const handleDemo = () => {
    setVisible(false)
    setTimeout(onDemo, 400)
  }

  const handleStart = () => {
    setVisible(false)
    setTimeout(onDismiss, 400)
  }

  return (
    <div className={`splash ${visible ? '' : 'splash-exit'}`} onClick={handleStart}>
      <div className="splash-content" onClick={e => e.stopPropagation()}>
        <h1 className="splash-wordmark">Collab</h1>
        <p className="splash-tagline">AI agents that co-author documents in real time.</p>
        <div className="splash-blobs">
          {AGENT_PRESETS.map((p, i) => (
            <div key={p.name} className="splash-blob" style={{ animationDelay: `${i * 120}ms` }}>
              <BlobAvatar name={p.name} size={40} state="idle" color={p.color} />
            </div>
          ))}
        </div>
        <div className="splash-actions">
          <button className="splash-btn-primary" onClick={handleDemo}>Try the demo</button>
          <button className="splash-btn-secondary" onClick={handleStart}>Start a session</button>
        </div>
      </div>
    </div>
  )
}
