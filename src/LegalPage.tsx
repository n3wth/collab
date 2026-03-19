import { BlobAvatar } from './blob-avatar'

interface Props {
  page: 'privacy' | 'terms'
}

export function LegalPage({ page }: Props) {
  return (
    <div className="home">
      <div className="home-inner">
        <nav className="home-nav">
          <div className="home-nav-logo">
            <a href="/" className="home-nav-logo-link">
              <div className="home-nav-blob-wrap">
                <BlobAvatar name="Collab" size={24} state="idle" color="#30d158" />
              </div>
              <span className="home-nav-wordmark">Collab</span>
            </a>
          </div>
        </nav>

        <section className="legal-content">
          {page === 'privacy' ? <PrivacyContent /> : <TermsContent />}
        </section>

        <footer className="home-footer">
          <div className="home-footer-left">
            <span className="home-footer-brand">Collab</span>
          </div>
          <div className="home-footer-right">
            <a href="/privacy" className="home-footer-link">Privacy</a>
            <a href="/terms" className="home-footer-link">Terms</a>
            <span className="home-footer-copy">Built by n3wth</span>
          </div>
        </footer>
      </div>
    </div>
  )
}

function PrivacyContent() {
  return (
    <>
      <h1 className="legal-title">Privacy Policy</h1>
      <p className="legal-date">Last updated: March 19, 2026</p>

      <h2>What we collect</h2>
      <p>When you sign in with Google, we receive your name, email address, and profile picture. We use these solely to identify you within the app.</p>

      <h2>How we use your data</h2>
      <ul>
        <li>Authenticate your account</li>
        <li>Save your documents and chat messages</li>
        <li>Display your identity to collaborators</li>
      </ul>

      <h2>What we don't do</h2>
      <ul>
        <li>We don't sell your data</li>
        <li>We don't serve ads</li>
        <li>We don't share your data with third parties beyond our infrastructure providers (Supabase, Vercel, Google Gemini API)</li>
      </ul>

      <h2>Data storage</h2>
      <p>Documents and messages are stored in Supabase (hosted on AWS). API keys you provide in Settings are stored in your browser's localStorage only and never sent to our servers.</p>

      <h2>Deletion</h2>
      <p>You can delete your sessions and data from within the app. To request full account deletion, email <a href="mailto:oliver@newth.ai">oliver@newth.ai</a>.</p>

      <h2>Contact</h2>
      <p><a href="mailto:oliver@newth.ai">oliver@newth.ai</a></p>
    </>
  )
}

function TermsContent() {
  return (
    <>
      <h1 className="legal-title">Terms of Service</h1>
      <p className="legal-date">Last updated: March 19, 2026</p>

      <h2>What this is</h2>
      <p>Collab is a collaborative writing tool where AI agents edit documents alongside humans. It is provided as-is for personal and professional use.</p>

      <h2>Your content</h2>
      <p>You own everything you write. We don't claim any rights to your documents or messages. Content you create may be processed by the Google Gemini API to generate AI responses.</p>

      <h2>Acceptable use</h2>
      <p>Don't use Collab to generate harmful, illegal, or abusive content. Don't attempt to exploit the service or its infrastructure.</p>

      <h2>Availability</h2>
      <p>We aim to keep Collab running but make no uptime guarantees. The service may change or shut down with reasonable notice.</p>

      <h2>Liability</h2>
      <p>Collab is provided without warranty. We are not liable for data loss, AI-generated content, or service interruptions.</p>

      <h2>Contact</h2>
      <p><a href="mailto:oliver@newth.ai">oliver@newth.ai</a></p>
    </>
  )
}
