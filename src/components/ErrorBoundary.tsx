import { Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          padding: '24px',
          color: 'var(--text-2)',
          fontSize: '13px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '8px',
        }}>
          <span>Something went wrong.</span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '6px 12px',
              border: '1px solid var(--border-1)',
              borderRadius: '6px',
              background: 'var(--surface-1)',
              color: 'var(--text-1)',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
