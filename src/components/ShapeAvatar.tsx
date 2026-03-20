export function ShapeAvatar({ name, size = 28, className = '' }: { name: string, size?: number, className?: string }) {
  const color = 'currentColor'
  const s = size

  const squarePoints = `${s * 0.18},${s * 0.18} ${s * 0.82},${s * 0.18} ${s * 0.82},${s * 0.82} ${s * 0.18},${s * 0.82}`
  const diamondPoints = `${s * 0.5},${s * 0.05} ${s * 0.95},${s * 0.5} ${s * 0.5},${s * 0.95} ${s * 0.05},${s * 0.5}`

  const points: Record<string, string> = {
    You: squarePoints,
    Sarah: diamondPoints,
  }

  const pts = points[name] || points.You

  return (
    <div className={`avatar-wrapper ${className}`} style={{ width: s, height: s }}>
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`}>
        <polygon points={pts} fill={color} />
      </svg>
    </div>
  )
}
