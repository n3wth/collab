import { ColorPanels } from '@paper-design/shaders-react'
import { useAuth } from './lib/auth'

interface Effect {
  image: string
  imageOpacity: number
  imageBlend: string
  shaderColors: string[]
  shaderOpacity: number
  shaderBlend: string
  shaderSpeed: number
  bgColor: string
  textColor: string
}

const EFFECTS: Record<string, Effect> = {
  original: {
    image: '',
    imageOpacity: 0,
    imageBlend: 'normal',
    shaderColors: ['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557'],
    shaderOpacity: 1,
    shaderBlend: 'normal',
    shaderSpeed: 0.5,
    bgColor: '#000000',
    textColor: '#ffffff',
  },
  night: {
    image: '/hero-texture-night.jpg',
    imageOpacity: 0.7,
    imageBlend: 'normal',
    shaderColors: ['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557'],
    shaderOpacity: 1,
    shaderBlend: 'screen',
    shaderSpeed: 0.5,
    bgColor: '#000000',
    textColor: '#ffffff',
  },
  warm: {
    image: '/hero-texture-warm.jpg',
    imageOpacity: 0.9,
    imageBlend: 'normal',
    shaderColors: ['#C0583F33', '#7A8B6F33', '#C9A84C33', '#5B8FA833', '#D4A57433', '#FAF6F1', '#C0583F33'],
    shaderOpacity: 0.4,
    shaderBlend: 'overlay',
    shaderSpeed: 0.2,
    bgColor: '#FAF6F1',
    textColor: '#2A2420',
  },
  swiss: {
    image: '/hero-texture-swiss.jpg',
    imageOpacity: 0.85,
    imageBlend: 'normal',
    shaderColors: ['#2563EB22', '#3B82F622', '#FFFFFF', '#F4F4F5', '#E4E4E7', '#2563EB11', '#FFFFFF'],
    shaderOpacity: 0.3,
    shaderBlend: 'overlay',
    shaderSpeed: 0.15,
    bgColor: '#FFFFFF',
    textColor: '#0A0A0A',
  },
  'night-img': {
    image: '/hero-texture-night.jpg',
    imageOpacity: 1,
    imageBlend: 'normal',
    shaderColors: ['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557'],
    shaderOpacity: 0,
    shaderBlend: 'normal',
    shaderSpeed: 0,
    bgColor: '#0F0D2E',
    textColor: '#ffffff',
  },
  'warm-img': {
    image: '/hero-texture-warm.jpg',
    imageOpacity: 1,
    imageBlend: 'normal',
    shaderColors: ['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557'],
    shaderOpacity: 0,
    shaderBlend: 'normal',
    shaderSpeed: 0,
    bgColor: '#FAF6F1',
    textColor: '#2A2420',
  },
}

export function LoginPage() {
  const { signInWithGoogle } = useAuth()
  const params = new URLSearchParams(window.location.search)
  const effectName = params.get('effect') || 'original'
  const effect = EFFECTS[effectName] || EFFECTS.original

  return (
    <div className="login-page" style={{ backgroundColor: effect.bgColor }}>
      <div className="login-shader">
        {effect.image && (
          <img src={effect.image} alt="" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: effect.imageOpacity, zIndex: 0, mixBlendMode: effect.imageBlend as any }} />
        )}
        {effect.shaderOpacity > 0 && (
          <ColorPanels speed={effect.shaderSpeed} scale={1.15} density={3} angle1={0} angle2={0} length={1.1} edges={false} blur={0} fadeIn={1} fadeOut={0.3} gradient={0} rotation={0} offsetX={0} offsetY={0} colors={effect.shaderColors} colorBack="#00000000" style={{ height: '100%', width: '100%', opacity: effect.shaderOpacity, mixBlendMode: effect.shaderBlend as any }} />
        )}
      </div>
      <div className="login-content" style={{ color: effect.textColor }}>
        <nav className="login-nav">
          <div className="home-nav-logo">
            <span className="home-nav-wordmark" style={{ color: effect.textColor }}>Collab</span>
          </div>
          <div className="home-nav-actions">
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginRight: '16px', flexWrap: 'wrap' }}>
              {Object.keys(EFFECTS).map(name => {
                const isDark = EFFECTS[name].textColor === '#ffffff'
                const isActive = effectName === name
                return (
                  <a
                    key={name}
                    href={`?login&effect=${name}`}
                    style={{
                      fontSize: '11px',
                      padding: '4px 10px',
                      borderRadius: '100px',
                      background: isActive
                        ? (isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)')
                        : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)'),
                      color: isActive
                        ? effect.textColor
                        : (isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.4)'),
                      textDecoration: 'none',
                      fontFamily: 'Inter, sans-serif',
                      border: isActive
                        ? `1px solid ${isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)'}`
                        : `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                    }}
                  >
                    {name}
                  </a>
                )
              })}
            </div>
            <button className="login-google-btn login-google-btn--nav" onClick={signInWithGoogle} style={effect.textColor !== '#ffffff' ? { color: effect.textColor, borderColor: effect.textColor + '33' } : undefined}>
              Sign in
            </button>
          </div>
        </nav>

        <header className="login-hero" style={{ position: 'relative' }}>
          {effect.textColor !== '#ffffff' && (
            <div style={{ position: 'absolute', top: '-60px', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '360px', background: `radial-gradient(ellipse, ${effect.bgColor}ee 30%, ${effect.bgColor}00 70%)`, zIndex: 0, pointerEvents: 'none' }} />
          )}
          <h1 className="login-headline" style={{ color: effect.textColor, position: 'relative', zIndex: 1 }}>
            <span className="login-headline-main" style={{ color: effect.textColor }}>Write with</span>
            <span className="login-headline-italic" style={{ color: effect.textColor }}>AI experts.</span>
          </h1>
          <p className="login-subtitle" style={{ color: effect.textColor === '#ffffff' ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.55)', position: 'relative', zIndex: 1 }}>
            AI agents that read your docs and push back on what you missed.
          </p>
          <div className="login-cta-row" style={{ position: 'relative', zIndex: 1 }}>
            <button className="home-cta-primary" onClick={signInWithGoogle} style={effect.textColor !== '#ffffff' ? { background: effect.textColor, color: effect.bgColor } : undefined}>
              Get started
            </button>
          </div>
        </header>

        <footer className="login-footer">
          <div className="login-footer-left">
            <a href="/privacy" className="login-footer-link" style={{ color: effect.textColor === '#ffffff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }}>Privacy</a>
            <a href="/terms" className="login-footer-link" style={{ color: effect.textColor === '#ffffff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }}>Terms</a>
          </div>
          <div className="login-footer-right">
            <span className="login-footer-credit" style={{ color: effect.textColor === '#ffffff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }}>A project by <a href="https://n3wth.com" className="login-footer-link" style={{ color: effect.textColor === '#ffffff' ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)' }} target="_blank" rel="noopener noreferrer">n3wth</a></span>
          </div>
        </footer>
      </div>
    </div>
  )
}
