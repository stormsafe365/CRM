// AppLayout: the app shell — 232px sidebar + sticky topbar + scroll canvas.
// Skinned to the StormSafe "premium industrial" design system (theme.css).
// All behavior (auth, due-follow-up badge, desktop reminders, search) is unchanged.

import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDueFollowups } from '../lib/useDueFollowups'
import { useTimedReminders } from '../lib/useTimedReminders'
import { isoToday } from '../lib/followups'
import { useUsers, userLabel } from '../lib/useUsers'
import { mountCursorFx } from '../lib/uiFx'
import CommandCenter from './CommandCenter'

// Lucide-style 2px-stroke icons, matched to the mockup sidebar.
const navItems = [
  {
    to: '/dashboard', label: 'Dashboard',
    icon: <><rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" /><rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" /></>,
  },
  {
    to: '/clients', label: 'Leads',
    icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  },
  {
    to: '/projects', label: 'Projects',
    icon: <><path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /></>,
  },
  {
    to: '/followups', label: 'Follow-Ups',
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  },
  {
    to: '/calendar', label: 'Follow-Up HQ',
    icon: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></>,
  },
  {
    to: '/pipeline', label: 'Pipeline',
    icon: <><path d="M3 4h18l-7 8v6l-4 2v-8z" /></>,
  },
  {
    to: '/quotes', label: 'Quotes',
    icon: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
  },
  {
    to: '/documents', label: 'Document Hub',
    icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M9 13h6M9 17h6" /></>,
  },
  {
    to: '/build', label: '3D Builder',
    icon: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="m3.3 7 8.7 5 8.7-5M12 22V12" /></>,
  },
  {
    to: '/layout', label: '2D Layout',
    icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></>,
  },
  {
    to: '/trash', label: 'Trash',
    icon: <><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
  },
]

export default function AppLayout({ children }) {
  const { user, signOut } = useAuth()
  const { users } = useUsers()
  const navigate = useNavigate()
  // Full-bleed pages (e.g. the 3D Builder, the Pipeline kanban) fill the whole
  // content area — no centered max-width column, no scroll padding. The page
  // manages its own internal scrolling.
  const path = useLocation().pathname
  // The lead detail page (/clients/<id>) is a full-bleed 2-column layout; the
  // Leads list (/clients) and new-lead form (/clients/new) are normal pages.
  const isLeadDetail = /^\/clients\/[^/]+$/.test(path) && path !== '/clients/new'
  const bleed = path.startsWith('/build') || path.startsWith('/pipeline') || path.startsWith('/calendar') || isLeadDetail
  const { count: dueCount, clients: dueClients } = useDueFollowups()
  const notifSupported = typeof window !== 'undefined' && 'Notification' in window
  const [notifPerm, setNotifPerm] = useState(notifSupported ? Notification.permission : 'unsupported')
  const [cmdOpen, setCmdOpen] = useState(false)

  // Clock-triggered pings for follow-ups with a specific time set today.
  useTimedReminders(notifPerm === 'granted')

  // Cursor ring/dot FX (matches the design mockup; auto-skips touch/reduced-motion).
  useEffect(() => { mountCursorFx() }, [])

  // Dashboard greeting has its own "Command Center" button — open the drawer.
  useEffect(() => {
    const open = () => setCmdOpen(true)
    window.addEventListener('ss:command-center', open)
    return () => window.removeEventListener('ss:command-center', open)
  }, [])

  // Tab title carries the due count even when the tab is backgrounded.
  useEffect(() => {
    document.title = dueCount > 0 ? `(${dueCount}) StormSafe CRM` : 'StormSafe CRM'
  }, [dueCount])

  // One calm desktop reminder per day, if the rep opted in.
  useEffect(() => {
    if (!notifSupported || notifPerm !== 'granted' || dueCount < 1) return
    const today = isoToday()
    if (localStorage.getItem('ss_lastNotified') === today) return
    localStorage.setItem('ss_lastNotified', today)
    const names = dueClients.slice(0, 4).map(c => c.name).join(', ')
    const note = new Notification(`${dueCount} follow-up${dueCount === 1 ? '' : 's'} to check in on`, {
      body: names + (dueClients.length > 4 ? `, +${dueClients.length - 4} more` : ''),
      icon: '/logo.png',
    })
    note.onclick = () => { window.focus(); navigate('/followups'); note.close() }
  }, [notifSupported, notifPerm, dueCount, dueClients, navigate])

  function enableReminders() {
    if (!notifSupported || Notification.permission !== 'default') return
    Notification.requestPermission().then(p => {
      setNotifPerm(p)
      localStorage.removeItem('ss_lastNotified')
    })
  }

  const bellTitle = notifPerm === 'granted' ? 'Follow-up reminders are on'
    : notifPerm === 'denied' ? 'Reminders blocked — turn on notifications for this site in your browser'
    : notifPerm === 'unsupported' ? 'Reminders not supported in this browser'
    : 'Enable daily follow-up reminders'

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const displayName = userLabel(users, user?.id) !== '—'
    ? userLabel(users, user?.id)
    : (user?.email?.split('@')[0] ?? 'User')
  const initials = displayName.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '··'

  function onSearch(e) {
    if (e.key === 'Enter') {
      const q = e.target.value.trim()
      navigate(q ? `/clients?q=${encodeURIComponent(q)}` : '/clients')
    }
  }

  return (
    <div className="app">
      {/* ============================ SIDEBAR ============================ */}
      <aside className="sidebar">
        <Link to="/dashboard" className="brand" title="StormSafe Steel" style={{ textDecoration: 'none' }}>
          <img className="brand-mark" src="/logo.png" alt="StormSafe Steel" />
          <div>
            <div className="brand-name">STORM<b>SAFE</b></div>
            <div className="brand-sub">STEEL</div>
          </div>
        </Link>

        <nav className="nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.label}
              className={({ isActive }) => isActive ? 'nav-item active' : 'nav-item'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                {item.icon}
              </svg>
              {item.label}
              {item.to === '/followups' && dueCount > 0 && (
                <span className="badge-count" style={{ position: 'static', marginLeft: 'auto', border: 'none' }}>
                  {dueCount > 9 ? '9+' : dueCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="user-pill" onClick={handleSignOut} title="Click to sign out"
            style={{ width: '100%', textAlign: 'left', font: 'inherit' }}>
            <div className="avatar md">{initials}</div>
            <div className="user-meta">
              <div className="nm">{displayName}</div>
              <div className="rl">Sales Rep</div>
            </div>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#6B7E92" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <div className="online"><span className="dot" />Online</div>
        </div>
      </aside>

      {/* ============================ MAIN ============================ */}
      <div className="main">
        <header className="topbar">
          <div style={{ width: 120 }} />
          <div className="search">
            <svg className="lead" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input type="text" placeholder="Search clients, counties, projects…" onKeyDown={onSearch} />
            <span className="kbd">⌘ K</span>
          </div>
          <div className="top-actions">
            <button className="cmd-launch" onClick={() => setCmdOpen(true)} title="Command Center — what needs attention">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6 7 18.2l1.9-5.8L4 8.8h6.1z" /></svg>
              <span>Command Center</span>
            </button>
            {notifPerm !== 'unsupported' && (
              <button className="icon-btn" onClick={enableReminders} title={bellTitle}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
                {dueCount > 0 && <span className="badge-count">{dueCount > 9 ? '9+' : dueCount}</span>}
              </button>
            )}
            <Link to="/clients/new" className="icon-btn" title="New client">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </Link>
            <button className="icon-btn" onClick={handleSignOut} title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></svg>
            </button>
          </div>
        </header>

        <div className={bleed ? 'scroll flush' : 'scroll'}>
          <div className={bleed ? 'canvas bleed' : 'canvas'}>
            {children}
          </div>
        </div>
      </div>

      <CommandCenter open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  )
}
