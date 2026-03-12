import { useEffect, useRef, memo } from 'react'
import { createNoise3D } from 'simplex-noise'

type BlobState = 'idle' | 'thinking' | 'reading' | 'typing' | 'editing'

interface BlobAvatarProps {
  name: string
  size?: number
  state?: BlobState
}

// Each agent gets a unique noise seed
const SEEDS: Record<string, number> = { Aiden: 1, Nova: 2 }

// Base speed multipliers per state (scaled by size — smaller = faster)
const SPEED: Record<BlobState, number> = {
  idle: 0.15,
  thinking: 0.6,
  reading: 0.3,
  typing: 0.9,
  editing: 0.9,
}

// Distortion amount per state (subtle)
const DISTORT: Record<BlobState, number> = {
  idle: 0.05,
  thinking: 0.12,
  reading: 0.08,
  typing: 0.16,
  editing: 0.16,
}

// Reference size — blobs at this size move at base speed
const REF_SIZE = 28

// Number of points on the blob path
const POINTS = 6

function buildPath(cx: number, cy: number, r: number, noise3D: ReturnType<typeof createNoise3D>, t: number, distortion: number, seed: number): string {
  const pts: [number, number][] = []
  for (let i = 0; i < POINTS; i++) {
    const angle = (Math.PI * 2 * i) / POINTS
    const n = noise3D(Math.cos(angle) + seed, Math.sin(angle) + seed, t)
    const rad = r * (1 + n * distortion)
    pts.push([cx + Math.cos(angle) * rad, cy + Math.sin(angle) * rad])
  }

  // Smooth closed catmull-rom → cubic bezier
  let d = ''
  for (let i = 0; i < POINTS; i++) {
    const p0 = pts[(i - 1 + POINTS) % POINTS]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % POINTS]
    const p3 = pts[(i + 2) % POINTS]

    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6

    if (i === 0) d += `M${p1[0].toFixed(1)},${p1[1].toFixed(1)}`
    d += `C${cp1x.toFixed(1)},${cp1y.toFixed(1)},${cp2x.toFixed(1)},${cp2y.toFixed(1)},${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  d += 'Z'
  return d
}

export const BlobAvatar = memo(({ name, size = 28, state = 'idle' }: BlobAvatarProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const noise3DRef = useRef<ReturnType<typeof createNoise3D> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  const seed = SEEDS[name] ?? 0
  const isAiden = name === 'Aiden'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!noise3DRef.current) {
      noise3DRef.current = createNoise3D()
    }
    const noise3D = noise3DRef.current

    const dpr = window.devicePixelRatio || 1
    canvas.width = size * dpr
    canvas.height = size * dpr
    ctx.scale(dpr, dpr)

    let t = 0
    let lastFrame = 0
    const cx = size / 2
    const cy = size / 2
    const r = size * 0.34

    function draw(now: number) {
      const s = stateRef.current
      const isActive = s !== 'idle'

      // Idle blobs render at 4fps, active at full speed
      const minInterval = isActive ? 0 : 250
      if (now - lastFrame < minInterval) {
        rafRef.current = requestAnimationFrame(draw)
        return
      }
      const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016
      lastFrame = now

      const sizeScale = REF_SIZE / size // smaller → faster
      const speed = SPEED[s] * sizeScale
      const distortion = DISTORT[s]
      const isShimmer = s === 'thinking' || s === 'reading'

      t += dt * speed
      ctx!.clearRect(0, 0, size, size)

      const pathStr = buildPath(cx, cy, r, noise3D, t, distortion, seed)
      const path = new Path2D(pathStr)

      if (isShimmer) {
        // Radial shimmer: a soft light orbits around the blob
        const shimmerSpeed = s === 'thinking' ? 0.8 : 1.2
        const angle = (t * shimmerSpeed) % (Math.PI * 2)
        const highlightX = cx + Math.cos(angle) * r * 0.6
        const highlightY = cy + Math.sin(angle) * r * 0.6

        // Draw base shape
        if (isAiden) {
          ctx!.fillStyle = '#1a1a1a'
          ctx!.fill(path)
          // Overlay radial highlight
          ctx!.save()
          ctx!.clip(path)
          const glow = ctx!.createRadialGradient(highlightX, highlightY, 0, highlightX, highlightY, r * 0.9)
          glow.addColorStop(0, 'rgba(255,255,255,0.45)')
          glow.addColorStop(0.4, 'rgba(255,255,255,0.15)')
          glow.addColorStop(1, 'rgba(255,255,255,0)')
          ctx!.fillStyle = glow
          ctx!.fill(path)
          ctx!.restore()
        } else {
          // For outline: vary stroke opacity around the path using two passes
          ctx!.strokeStyle = '#1a1a1a'
          ctx!.lineWidth = size * 0.065
          ctx!.stroke(path)
          // Highlight pass
          ctx!.save()
          const strokeGlow = ctx!.createRadialGradient(highlightX, highlightY, 0, highlightX, highlightY, r * 0.9)
          strokeGlow.addColorStop(0, 'rgba(255,255,255,0.7)')
          strokeGlow.addColorStop(0.35, 'rgba(255,255,255,0.2)')
          strokeGlow.addColorStop(1, 'rgba(255,255,255,0)')
          ctx!.strokeStyle = strokeGlow
          ctx!.lineWidth = size * 0.065
          ctx!.stroke(path)
          ctx!.restore()
        }
      } else {
        if (isAiden) {
          ctx!.fillStyle = '#1a1a1a'
          ctx!.fill(path)
        } else {
          ctx!.strokeStyle = '#1a1a1a'
          ctx!.lineWidth = size * 0.065
          ctx!.stroke(path)
        }
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(rafRef.current)
    }
  }, [size, seed, isAiden])

  const label = state === 'idle' ? name : `${name} — ${state}`

  return (
    <div className="blob-avatar-wrap" data-tooltip={label}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, flexShrink: 0, display: 'block' }}
      />
    </div>
  )
})

BlobAvatar.displayName = 'BlobAvatar'
