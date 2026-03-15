import { useState, useEffect, useRef, useCallback } from 'react'
import { BlobAvatar } from './blob-avatar'
import { AGENT_PRESETS } from './AgentConfigurator'

interface Props {
  onComplete: () => void
}

interface BlobPosition {
  x: number
  y: number
  vx: number
  vy: number
  opacity: number
  scale: number
  targetX: number
  targetY: number
  spawnTime: number
}

// Spring constants
const SPRING_K = 3.2
const SPRING_DAMPING = 0.75
const GRAVITY_STRENGTH = 2000
const GRAVITY_CAP = 0.5

// Spawn schedule (ms)
const SPAWN_TIMES = [400, 1400, 2400, 2600]

// Sequence timing
const GATHER_END = 3800    // blobs drift together for this long
const TAGLINE_TIME = 4200
const WORDMARK_TIME = 3400
const COMPLETE_TIME = 6400

// Blob sizes
const BLOB_SIZE_DRAMATIC = 80
const BLOB_SIZE_FINAL = 64
const GLOW_SIZE = 200

export function AwakenSequence({ onComplete }: Props) {
  const [phase, setPhase] = useState<'awakening' | 'fading' | 'done'>('awakening')
  const [visibleBlobs, setVisibleBlobs] = useState<number[]>([])
  const [showTagline, setShowTagline] = useState(false)
  const [showWordmark, setShowWordmark] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const blobRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null])
  const glowRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null])
  const positionsRef = useRef<BlobPosition[]>([])
  const rafRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const completedRef = useRef(false)

  const completeSequence = useCallback(() => {
    if (completedRef.current) return
    completedRef.current = true
    localStorage.setItem('collab-awakening-seen', Date.now().toString())
    cancelAnimationFrame(rafRef.current)
    setPhase('fading')
    // Fade out the overlay, then fully remove
    setTimeout(() => {
      setPhase('done')
      onComplete()
    }, 600)
  }, [onComplete])

  // Fast-forward on click or keypress
  useEffect(() => {
    if (phase !== 'awakening') return
    const handleFastForward = () => {
      setVisibleBlobs([0, 1, 2, 3])
      setShowTagline(true)
      setShowWordmark(true)
      completeSequence()
    }
    // Delay listener so the initial page click doesn't immediately skip
    const timer = window.setTimeout(() => {
      window.addEventListener('click', handleFastForward)
      window.addEventListener('keydown', handleFastForward)
    }, 800)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('click', handleFastForward)
      window.removeEventListener('keydown', handleFastForward)
    }
  }, [phase, completeSequence])

  // Main sequence orchestrator
  useEffect(() => {
    if (phase !== 'awakening') return
    startTimeRef.current = performance.now()

    const timers: number[] = []

    // Spawn blobs at staggered times
    SPAWN_TIMES.forEach((time, idx) => {
      timers.push(window.setTimeout(() => {
        setVisibleBlobs(prev => [...prev, idx])
        initBlobPosition(idx)
      }, time))
    })

    timers.push(window.setTimeout(() => setShowWordmark(true), WORDMARK_TIME))
    timers.push(window.setTimeout(() => setShowTagline(true), TAGLINE_TIME))
    timers.push(window.setTimeout(completeSequence, COMPLETE_TIME))

    return () => timers.forEach(t => clearTimeout(t))
  }, [phase, completeSequence])

  function initBlobPosition(idx: number) {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height * 0.4

    // Wide initial spread — dramatic entrance positions
    const startOffsets = [
      { x: -180, y: 20 },   // Aiden: far left
      { x: 180, y: -10 },   // Nova: far right
      { x: -40, y: -140 },  // Lex: above-left
      { x: 60, y: 140 },    // Mira: below-right
    ]

    // Final positions: match the homepage hero flexbox layout
    // Homepage uses gap: 24px, blob width ~64px, so center-to-center = 88px
    const spacing = 88
    const rowWidth = spacing * 3
    const finalX = cx - rowWidth / 2 + idx * spacing

    positionsRef.current[idx] = {
      x: cx + startOffsets[idx].x,
      y: cy + startOffsets[idx].y,
      vx: 0,
      vy: 0,
      opacity: 0,
      scale: 1,
      targetX: finalX,
      targetY: cy,
      spawnTime: performance.now(),
    }
  }

  // Physics loop
  useEffect(() => {
    if (phase !== 'awakening') return

    function tick() {
      const now = performance.now()
      const elapsed = now - startTimeRef.current
      const dt = 1 / 60

      const positions = positionsRef.current
      const blobCount = positions.length

      const driftingApart = elapsed > GATHER_END
      // Smooth scale transition from dramatic to final size
      const scaleProgress = driftingApart
        ? Math.min(1, (elapsed - GATHER_END) / 1200)
        : 0
      const currentScale = 1 + (1 - scaleProgress) * ((BLOB_SIZE_DRAMATIC / BLOB_SIZE_FINAL) - 1)

      for (let i = 0; i < blobCount; i++) {
        const p = positions[i]
        if (!p) continue

        // Fade in opacity over 800ms
        const age = now - p.spawnTime
        p.opacity = Math.min(1, age / 800)
        p.scale = driftingApart ? currentScale : BLOB_SIZE_DRAMATIC / BLOB_SIZE_FINAL

        if (driftingApart) {
          // Spring toward final position
          const dx = p.targetX - p.x
          const dy = p.targetY - p.y
          const ax = dx * SPRING_K - p.vx * SPRING_DAMPING * 12
          const ay = dy * SPRING_K - p.vy * SPRING_DAMPING * 12
          p.vx += ax * dt
          p.vy += ay * dt
        } else {
          // Gravitational pull — blobs drift toward each other
          let fx = 0, fy = 0
          for (let j = 0; j < blobCount; j++) {
            if (i === j || !positions[j]) continue
            const dx = positions[j].x - p.x
            const dy = positions[j].y - p.y
            const dist = Math.sqrt(dx * dx + dy * dy)
            if (dist < 20) continue
            const force = Math.min(GRAVITY_STRENGTH / (dist * dist), GRAVITY_CAP)
            fx += (dx / dist) * force
            fy += (dy / dist) * force
          }
          p.vx += fx * dt
          p.vy += fy * dt
          // Damping
          p.vx *= 0.95
          p.vy *= 0.95
        }

        p.x += p.vx * dt
        p.y += p.vy * dt

        // Apply to DOM directly for performance
        const halfBlob = (BLOB_SIZE_FINAL * p.scale) / 2
        const el = blobRefs.current[i]
        const glow = glowRefs.current[i]
        if (el) {
          el.style.transform = `translate(${p.x - halfBlob}px, ${p.y - halfBlob}px) scale(${p.scale})`
          el.style.opacity = String(p.opacity)
        }
        if (glow) {
          const halfGlow = GLOW_SIZE / 2
          glow.style.transform = `translate(${p.x - halfGlow}px, ${p.y - halfGlow}px)`
          glow.style.opacity = String(p.opacity * 0.2)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [phase])

  if (phase === 'done') return null

  return (
    <div
      ref={containerRef}
      className={`awaken-backdrop ${phase === 'fading' ? 'awaken-fading' : ''}`}
    >
      {/* Glow divs — larger for dramatic effect */}
      {AGENT_PRESETS.map((p, i) => (
        <div
          key={`glow-${p.name}`}
          ref={el => { glowRefs.current[i] = el }}
          className="awaken-glow"
          style={{
            width: GLOW_SIZE,
            height: GLOW_SIZE,
            background: `radial-gradient(circle, ${p.color} 0%, transparent 70%)`,
            opacity: 0,
          }}
        />
      ))}

      {/* Blob containers */}
      {AGENT_PRESETS.map((p, i) => (
        <div
          key={p.name}
          ref={el => { blobRefs.current[i] = el }}
          className={`awaken-blob ${visibleBlobs.includes(i) ? 'visible' : ''}`}
          style={{ opacity: 0 }}
        >
          <BlobAvatar name={p.name} size={BLOB_SIZE_FINAL} state="idle" color={p.color} />
        </div>
      ))}

      {/* Wordmark — appears before blobs settle */}
      <div className={`awaken-wordmark ${showWordmark ? 'visible' : ''}`}>
        Collab
      </div>

      {/* Tagline — appears as blobs drift apart */}
      <div className={`awaken-tagline ${showTagline ? 'visible' : ''}`}>
        AI agents that co-author documents in real time.
      </div>
    </div>
  )
}
