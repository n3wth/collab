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
  targetX: number
  targetY: number
  spawnTime: number
}

// Spawn schedule — agents awaken one by one (600ms stagger)
const SPAWN_TIMES = [300, 900, 1500, 2100]

// Sequence timing (narrative beats)
const NOTICE_TIME = 2800      // all blobs visible, start converging to center
const CONVERGE_END = 4200     // blobs reach center and lock to nav positions
const WORDMARK_TIME = 4200    // "Collab" wordmark appears as blobs settle
const TAGLINE_TIME = 4600     // tagline fades in
const COMPLETE_TIME = 6400    // fade out and close

// Physics
const SPRING_K = 24
const SPRING_DAMPING = 0.92

// Blob sizes
const BLOB_SIZE = 64
const GLOW_SIZE = 160

export function AwakenSequence({ onComplete }: Props) {
  const [phase, setPhase] = useState<'awakening' | 'fading' | 'done'>('awakening')
  const [visibleBlobs, setVisibleBlobs] = useState<number[]>([])
  const [showWordmark, setShowWordmark] = useState(false)
  const [showTagline, setShowTagline] = useState(false)

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
      setShowWordmark(true)
      setShowTagline(true)
      completeSequence()
    }
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
    const cy = rect.height / 2

    // Spawn from cardinal directions
    const startAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]
    const radius = 280
    const angle = startAngles[idx]
    const startX = cx + Math.cos(angle) * radius
    const startY = cy + Math.sin(angle) * radius

    positionsRef.current[idx] = {
      x: startX,
      y: startY,
      vx: 0,
      vy: 0,
      opacity: 0,
      targetX: cx, // gather at center
      targetY: cy,
      spawnTime: performance.now(),
    }
  }

  // Physics loop
  useEffect(() => {
    if (phase !== 'awakening') return

    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const cx = rect.width / 2
    const cy = rect.height / 2

    // Nav positions (top right, mirroring nav layout)
    const getNavPosition = (idx: number) => {
      const navY = 38
      const navStartX = rect.width - 60
      const spacing = 26
      return {
        x: navStartX - idx * spacing,
        y: navY,
      }
    }

    function tick() {
      const now = performance.now()
      const elapsed = now - startTimeRef.current
      const dt = 1 / 60

      const positions = positionsRef.current
      const blobCount = positions.length

      for (let i = 0; i < blobCount; i++) {
        const p = positions[i]
        if (!p) continue

        // Fade in opacity over 600ms
        const age = now - p.spawnTime
        p.opacity = Math.min(1, age / 600)

        // Determine target based on sequence phase
        if (elapsed < NOTICE_TIME) {
          // Spawn phase: stay still, just fade in
          p.targetX = p.x
          p.targetY = p.y
        } else if (elapsed < CONVERGE_END) {
          // Notice & converge: move toward center
          p.targetX = cx
          p.targetY = cy
        } else {
          // Settle: move to nav positions
          const nav = getNavPosition(i)
          p.targetX = nav.x
          p.targetY = nav.y
        }

        // Spring toward target
        const dx = p.targetX - p.x
        const dy = p.targetY - p.y
        const ax = dx * SPRING_K - p.vx * SPRING_DAMPING
        const ay = dy * SPRING_K - p.vy * SPRING_DAMPING
        p.vx += ax * dt
        p.vy += ay * dt

        // Damping
        p.vx *= 0.92
        p.vy *= 0.92

        p.x += p.vx * dt
        p.y += p.vy * dt

        // Apply to DOM
        const halfBlob = BLOB_SIZE / 2
        const el = blobRefs.current[i]
        const glow = glowRefs.current[i]
        if (el) {
          el.style.transform = `translate(${p.x - halfBlob}px, ${p.y - halfBlob}px)`
          el.style.opacity = String(p.opacity)
        }
        if (glow) {
          const halfGlow = GLOW_SIZE / 2
          glow.style.transform = `translate(${p.x - halfGlow}px, ${p.y - halfGlow}px)`
          glow.style.opacity = String(p.opacity * 0.15)
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
      {/* Glow divs */}
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
          <BlobAvatar name={p.name} size={BLOB_SIZE} state="idle" color={p.color} />
        </div>
      ))}

      {/* Wordmark — celebration moment when blobs converge */}
      <div className={`awaken-wordmark ${showWordmark ? 'visible' : ''}`}>
        Collab
      </div>

      {/* Tagline */}
      <div className={`awaken-tagline ${showTagline ? 'visible' : ''}`}>
        AI agents that co-author documents in real time.
      </div>
    </div>
  )
}
