// AppLayout: vertical icon sidebar + top bar. Matches the prototype shell.
// Nav mirrors the prototype's six destinations; screens not yet built route
// to a styled "coming soon" placeholder so the nav always looks complete.

import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDueFollowups } from '../lib/useDueFollowups'
import { useTimedReminders } from '../lib/useTimedReminders'
import { isoToday } from '../lib/followups'

const navItems = [
  {
    to: '/dashboard', title: 'Dashboard',
    icon: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  },
  {
    to: '/pipeline', title: 'Sales Pipeline',
    icon: <><path d="M4 6h16M4 12h10M4 18h6"/></>,
  },
  {
    to: '/projects', title: 'Active Orders',
    icon: <><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/></>,
  },
  {
    to: '/followups', title: 'Today — Follow-ups',
    icon: <><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></>,
  },
  {
    to: '/clients', title: 'Customers',
    icon: <><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0111 0M16 6.5a3 3 0 010 5.6M19 19a4.8 4.8 0 00-3-4.4"/></>,
  },
  {
    to: '/quotes', title: 'All Quotes',
    icon: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h6M10 17h6"/></>,
  },
]

export default function AppLayout({ children }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const { count: dueCount, clients: dueClients } = useDueFollowups()
  const notifSupported = typeof window !== 'undefined' && 'Notification' in window
  const [notifPerm, setNotifPerm] = useState(notifSupported ? Notification.permission : 'unsupported')

  // Clock-triggered pings for follow-ups that have a specific time set today.
  // Open-app coverage; the daily email handles closed-app.
  useTimedReminders(notifPerm === 'granted')

  // Tab title carries the due count even when the tab is in the background.
  useEffect(() => {
    document.title = dueCount > 0 ? `(${dueCount}) StormSafe CRM` : 'StormSafe CRM'
  }, [dueCount])

  // One calm desktop reminder per day, only if the rep opted in.
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
      localStorage.removeItem('ss_lastNotified') // allow today's reminder right after opting in
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

  const initials = user?.email
    ? user.email.split('@')[0].slice(0, 2).toUpperCase()
    : '··'

  function onSearch(e) {
    if (e.key === 'Enter') {
      const q = e.target.value.trim()
      navigate(q ? `/clients?q=${encodeURIComponent(q)}` : '/clients')
    }
  }

  return (
    <div className="app">
      <aside className="side">
        <Link to="/dashboard" className="brand-mark" title="StormSafe Steel">
          <img className="brand-logo" src="/logo.png" alt="StormSafe Steel" />
        </Link>
        <nav className="nav">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={item.title}
              className={({ isActive }) => isActive ? 'nav-btn active' : 'nav-btn'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                {item.icon}
              </svg>
              {item.to === '/followups' && dueCount > 0 && (
                <span className="nav-badge">{dueCount > 9 ? '9+' : dueCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <button className="avatar" onClick={handleSignOut} title={`${user?.email ?? ''} — click to sign out`}>
            {initials}
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <Link to="/dashboard" className="wordmark">
            <span className="s">STORM</span>SAFE STEEL
          </Link>
          <div className="mfr-badge">Mfr split &nbsp;<b>CA / CCI</b></div>
          <div className="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>
            </svg>
            <input placeholder="Search clients, counties…" onKeyDown={onSearch} />
          </div>
          <div className="top-actions">
            {notifPerm !== 'unsupported' && (
              <button
                onClick={enableReminders}
                className={`icon-btn bell ${notifPerm === 'granted' ? 'on' : ''}`}
                title={bellTitle}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.7 21a2 2 0 01-3.4 0"/>
                </svg>
                {dueCount > 0 && <span className="bell-dot" />}
              </button>
            )}
            <Link to="/clients/new" className="icon-btn" title="New client">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </Link>
            <button onClick={handleSignOut} className="icon-btn" title="Sign out">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l-5-5 5-5M5 12h12"/>
              </svg>
            </button>
          </div>
        </div>

        {children}
      </main>
    </div>
  )
}
