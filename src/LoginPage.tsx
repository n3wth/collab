import { ColorPanels } from '@paper-design/shaders-react'
import { useAuth } from './lib/auth'

export function LoginPage() {
  const { signInWithGoogle } = useAuth()

  return (
    <div className="login-page">
      <div className="login-shader">
        <ColorPanels speed={0.5} scale={1.15} density={3} angle1={0} angle2={0} length={1.1} edges={false} blur={0} fadeIn={1} fadeOut={0.3} gradient={0} rotation={0} offsetX={0} offsetY={0} colors={['#FF9D00', '#FD4F30', '#809BFF', '#6D2EFF', '#333AFF', '#F15CFF', '#FFD557']} colorBack="#00000000" style={{ backgroundColor: '#000000', height: '100%', width: '100%' }} />
      </div>
      <div className="login-content">
        <nav className="login-nav">
          <div className="home-nav-logo">
            <span className="home-nav-wordmark">Collab</span>
          </div>
          <div className="home-nav-actions">
            <button className="login-google-btn login-google-btn--nav" onClick={signInWithGoogle}>
              Sign in
            </button>
          </div>
        </nav>

        <header className="login-hero">
          <h1 className="login-headline">
            <span className="login-headline-main">Write with</span>
            <span className="login-headline-italic">AI experts.</span>
          </h1>
          <p className="login-subtitle">
            AI agents that read your docs and push back on what you missed.
          </p>
          <div className="login-cta-row">
            <button className="home-cta-primary" onClick={signInWithGoogle}>
              Get started
            </button>
          </div>
        </header>

        <footer className="login-footer">
          <a href="/privacy" className="login-footer-link">Privacy</a>
          <a href="/terms" className="login-footer-link">Terms</a>
        </footer>
      </div>
    </div>
  )
}
