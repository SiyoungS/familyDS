import { NavLink, Route, Routes } from 'react-router-dom'
import MainPage from './pages/Main/Main.jsx'
import AboutPage from './pages/About/About.jsx'
import LoginPage from './pages/Login/Login.jsx'
import { useAuth } from './hooks/useAuth.js'
import ProtectedRoute from './components/ProtectedRoute.jsx'

function App() {
  const { user, isLoading, isAuthenticated, logout } = useAuth()

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      // Error state is surfaced by the auth context on the relevant screens.
    }
  } 

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="border-b border-slate-200 bg-white/80 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-4">
            <span className="text-lg font-semibold text-slate-900">Family</span>
            <nav className="flex gap-3 text-sm">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  [
                    'rounded-full px-3 py-1',
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')
                }
              >
                메인
              </NavLink>
              <NavLink
                to="/about"
                className={({ isActive }) =>
                  [
                    'rounded-full px-3 py-1',
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')
                }
              >
                소개
              </NavLink>
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  [
                    'rounded-full px-3 py-1',
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')
                }
              >
                로그인
              </NavLink>
            </nav>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            {isAuthenticated ? (
              <>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
                  {user?.displayName ?? '로그인 사용자'}
                  {user?.email ? ` (${user.email})` : ''}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoading}
                  className="rounded-full border border-slate-300 px-3 py-1 text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isLoading ? '처리 중...' : '로그아웃'}
                </button>
              </>
            ) : (
              <div className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                로그인하지 않음
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 justify-center p-4">
        <div className="flex w-full max-w-5xl">
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <MainPage />
                </ProtectedRoute>
              }
            />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/login" element={<LoginPage />} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App
