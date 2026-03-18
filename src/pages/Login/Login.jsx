import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth.js'

const LoginPage = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, isAuthReady, isLoading, error, hasFirebaseConfig, signInWithGoogle } = useAuth()

  const from = location.state?.from?.pathname ?? '/'

  useEffect(() => {
    if (isAuthReady && isAuthenticated) {
      navigate(from, { replace: true })
    }
  }, [from, isAuthenticated, isAuthReady, navigate])

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle()
    } catch {
      // Error state is already handled in the auth context.
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-medium text-sky-600">로그인</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">Family에 로그인</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">
          Google 계정으로 로그인하면 가족 정보 관리 화면을 계속 사용할 수 있습니다.
        </p>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={!hasFirebaseConfig || isLoading}
          className="mt-8 flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isLoading ? '로그인 중...' : 'Google로 로그인'}
        </button>

        {!hasFirebaseConfig ? (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Firebase 설정이 아직 없습니다. `.env.local`에 `VITE_FIREBASE_*` 값을 넣은 뒤 다시 시도해 주세요.
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="mt-6 text-sm text-slate-500">
          <span>로그인 전에 공개 페이지를 보려면 </span>
          <Link to="/about" className="font-medium text-sky-600 hover:text-sky-700">
            소개 페이지로 이동
          </Link>
          <span>하세요.</span>
        </div>
      </section>
    </div>
  )
}

export default LoginPage
