// ProtectedRoute: wraps any page that requires login. If no user, bounce
// to /login. If still loading the initial session, show a quiet placeholder
// instead of flashing the login screen.

import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return <div className="loading-screen">Loading…</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return children
}
