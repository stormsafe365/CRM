// App: routing wired to AuthProvider so every route can see auth state.
// AppLayout wraps every protected page so the header is consistent.

import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ClientsList from './pages/ClientsList'
import ClientNew from './pages/ClientNew'
import ClientDetail from './pages/ClientDetail'
import Today from './pages/Today'
import ActiveOrders from './pages/ActiveOrders'
import AllQuotes from './pages/AllQuotes'
import Documents from './pages/Documents'
import FollowUpHQ from './components/FollowUpHQ'
import BuildTool from './pages/BuildTool'
import LayoutTool from './pages/LayoutTool'
import Trash from './pages/Trash'
import Pipeline from './pages/Pipeline'
import CustomerDesigns from './pages/CustomerDesigns'
import Performance from './pages/Performance'
import ComingSoon from './pages/ComingSoon'
import { useIsAdmin } from './lib/useIsAdmin'
import { isRepBlocked } from './lib/repView'

// Tiny helper to avoid repeating <ProtectedRoute><AppLayout>…</AppLayout></ProtectedRoute>
// Soft guard (owner 10/20/26): a sales rep who types a removed sidebar page's URL lands on the Dashboard.
// Admins and in-lead pages (/clients/:id, /build) are never redirected.
function Protected({ children }) {
  return (
    <ProtectedRoute>
      <RepGuard>
        <AppLayout>{children}</AppLayout>
      </RepGuard>
    </ProtectedRoute>
  )
}

function RepGuard({ children }) {
  const isAdmin = useIsAdmin()
  const { pathname } = useLocation()
  if (isRepBlocked(isAdmin, pathname)) return <Navigate to="/dashboard" replace />
  return children
}

// Admins (and a failed role check) get today's full dashboard; a rep gets the calm one.
function DashboardRoute() {
  const isAdmin = useIsAdmin()
  if (isAdmin === null) return <div className="loading-screen">Loading…</div>
  return <Dashboard rep={isAdmin === false} />
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/dashboard"     element={<Protected><DashboardRoute /></Protected>} />
        <Route path="/clients"       element={<Protected><ClientsList /></Protected>} />
        <Route path="/clients/new"   element={<Protected><ClientNew /></Protected>} />
        <Route path="/clients/:id"   element={<Protected><ClientDetail /></Protected>} />

        <Route path="/pipeline"  element={<Protected><Pipeline /></Protected>} />
        <Route path="/projects"  element={<Protected><ActiveOrders /></Protected>} />
        <Route path="/followups" element={<Protected><Today /></Protected>} />
        <Route path="/calendar"  element={<Protected><FollowUpHQ /></Protected>} />
        <Route path="/quotes"    element={<Protected><AllQuotes /></Protected>} />
        <Route path="/build"     element={<Protected><BuildTool /></Protected>} />
        <Route path="/layout"    element={<Protected><LayoutTool /></Protected>} />
        <Route path="/trash"     element={<Protected><Trash /></Protected>} />
        <Route path="/designs"   element={<Protected><CustomerDesigns /></Protected>} />
        <Route path="/performance" element={<Protected><Performance /></Protected>} />
        <Route path="/documents" element={<Protected><Documents /></Protected>} />
        {/* legacy: the old global Renderings gallery now lives inside Document Hub */}
        <Route path="/renderings" element={<Navigate to="/documents" replace />} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  )
}
