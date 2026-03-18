import { useCallback, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { auth, googleProvider, hasFirebaseConfig } from '../lib/firebase.js'
import { AuthContext } from './auth-context.js'

const formatAuthError = (error) => {
  switch (error?.code) {
    case 'auth/popup-closed-by-user':
      return '로그인 창이 닫혀 로그인이 취소되었습니다.'
    case 'auth/popup-blocked':
      return '브라우저가 팝업을 차단했습니다. 팝업 허용 후 다시 시도해 주세요.'
    case 'auth/cancelled-popup-request':
      return '기존 로그인 시도가 취소되었습니다. 다시 시도해 주세요.'
    default:
      return error?.message ?? '로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'
  }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [isAuthReady, setIsAuthReady] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth) {
      setIsAuthReady(true)
      return undefined
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser)
        setIsAuthReady(true)
      },
      (nextError) => {
        setError(formatAuthError(nextError))
        setIsAuthReady(true)
      },
    )

    return unsubscribe
  }, [])

  const clearError = useCallback(() => {
    setError('')
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!auth || !googleProvider) {
      setError('Firebase 환경변수가 설정되지 않았습니다. `.env.local`을 확인해 주세요.')
      return null
    }

    setError('')
    setIsLoading(true)

    try {
      const result = await signInWithPopup(auth, googleProvider)
      return result.user
    } catch (nextError) {
      const message = formatAuthError(nextError)
      setError(message)
      throw new Error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    if (!auth) {
      setUser(null)
      return
    }

    setError('')
    setIsLoading(true)

    try {
      await signOut(auth)
    } catch (nextError) {
      const message = formatAuthError(nextError)
      setError(message)
      throw new Error(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isAuthReady,
      isLoading,
      error,
      hasFirebaseConfig,
      signInWithGoogle,
      logout,
      clearError,
    }),
    [clearError, error, isAuthReady, isLoading, logout, signInWithGoogle, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
