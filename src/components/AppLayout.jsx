// AppLayout: vertical icon sidebar + top bar. Matches the prototype shell.
// Nav mirrors the prototype's six destinations; screens not yet built route
// to a styled "coming soon" placeholder so the nav always looks complete.

import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
    to: '/documents', title: 'Documents',
    icon: <><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 13h6M10 17h6"/></>,
  },
]

export default function AppLayout({ children }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

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
