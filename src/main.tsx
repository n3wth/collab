import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PostHogProvider } from '@posthog/react'
import './index.css'
import { AuthProvider } from './lib/auth.tsx'
import App from './App.tsx'

const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY as string
const posthogHost = (import.meta.env.VITE_PUBLIC_POSTHOG_HOST as string) || 'https://us.i.posthog.com'

const root = createRoot(document.getElementById('root')!)

if (posthogKey) {
  root.render(
    <StrictMode>
      <PostHogProvider apiKey={posthogKey} options={{ api_host: posthogHost, autocapture: false, capture_pageview: false, persistence: 'localStorage' }}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </PostHogProvider>
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StrictMode>,
  )
}
