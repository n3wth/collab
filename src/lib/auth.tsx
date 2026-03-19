import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { User } from '@supabase/supabase-js'

interface AuthContextValue {
  user: User | null
  loading: boolean
  providerToken: string | null
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  providerToken: null,
  signInWithGoogle: async () => {},
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [providerToken, setProviderToken] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setProviderToken(session?.provider_token ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setProviderToken(session?.provider_token ?? null)
        setLoading(false)
      },
    )

    return () => subscription.unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        scopes: 'https://www.googleapis.com/auth/drive.file',
      },
    })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, providerToken, signInWithGoogle, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}
