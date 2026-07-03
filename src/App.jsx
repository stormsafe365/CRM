// App: routing wired to AuthProvider so every route can see auth state.
// AppLayout wraps every protected page so the header is consistent.

import { Routes, Route, Navigate } from 'react-router-dom'
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
import Renderings from './pages/Renderings'
import FollowUpHQ from './components/FollowUpHQ'
import BuildTool from './pages/BuildTool'
import LayoutTool from './pages/LayoutTool'
import Trash from './pages/Trash'
import Pipeline from './pages/Pipeline'
import ComingSoon from './pages/ComingSoon'

// Tiny helper to avoid repeating <ProtectedRoute><AppLayout>…</AppLayout></ProtectedRoute>
function Protected({ children }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/dashboard"     element={<Protected><Dashboard /></Protected>} />
        <Route path="/clients"       element={<Protected><ClientsList /></Protected>} />
        <Route path="/clients/new"   element={<Protected><ClientNew /></Protected>} />
        <Route path="/clients/:id"   element={<Protected><ClientDetail /></Protected>} />

        <Route path="/pipeline"  element={<Protected><Pipeline /></Protected>} />
        <Route path="/projects"  element={<Protected><ActiveOrders /></Protected>} />
        <Route path="/followups" element={<Protected><Today /></Protected>} />
        <Route path="/calendar"  element={<Protected><FollowUpHQ /></Protected>} />
        <Route path="/quotes"    element={<Protected><AllQuotes /></Protected>} />
        <Route path="/renderings" element={<Protected><Renderings /></Protected>} />
        <Route path="/build"     element={<Protected><BuildTool /></Protected>} />
        <Route path="/layout"    element={<Protected><LayoutTool /></Protected>} />
        <Route path="/trash"     element={<Protected><Trash /></Protected>} />
        <Route path="/documents" element={<Protected><AllQuotes /></Protected>} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AuthProvider>
  )
}
