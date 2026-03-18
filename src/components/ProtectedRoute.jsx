import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth.js'

const ProtectedRoute = ({ children }) => {
  const location = useLocation()
  const { isAuthenticated, isAuthReady } = useAuth()

  if (!isAuthReady) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm">
          로그인 상태를 확인하는 중입니다...
        </div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return children
}

export default ProtectedRoute
