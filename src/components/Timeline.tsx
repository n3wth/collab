import { useState } from 'react'
import type { TimelineEntry } from '../types'

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  const [hoveredTip, setHoveredTip] = useState<{ text: string, x: number, y: number } | null>(null)
  if (entries.length === 0) return null
  return (
    <div className="timeline">
      {entries.slice(-20).map(e => (
        <div
          key={e.id}
          className="timeline-dot"
          style={{ background: e.color }}
          onMouseEnter={(ev) => {
            const rect = ev.currentTarget.getBoundingClientRect()
            const x = Math.max(140, Math.min(window.innerWidth - 140, rect.left + rect.width / 2))
            setHoveredTip({ text: e.tooltip, x, y: rect.top })
          }}
          onMouseLeave={() => setHoveredTip(null)}
        />
      ))}
      {hoveredTip && (
        <div className="timeline-tooltip" style={{ left: hoveredTip.x, top: hoveredTip.y }}>
          {hoveredTip.text}
        </div>
      )}
    </div>
  )
}
