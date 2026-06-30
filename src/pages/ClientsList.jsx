// ClientsList: the main clients table. Search by name/phone/email/
// building size. Filter by status and by building type. Sort multiple ways.
// Live-updates via Supabase realtime — if your partner adds/edits a
// client, you see it without refreshing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BUILDING_TYPES, buildingTypeLabel, sourceLabel } from '../lib/constants'
import { useUsers, userLabel } from '../lib/useUsers'

// Tabs follow the sales funnel order. Each tab maps to one stage; the
// 'working' and 'dead' tabs also fold in legacy values so old rows land
// in the right place. 'all' shows everything.
const GROUPS = [
  { key: 'new_lead',      label: 'New Lead',          match: (c) => c.status === 'new_lead' },
  { key: 'contacted',     label: 'Attempting Contact', match: (c) => c.status === 'contacted' },
  { key: 'working',       label: 'Working Leads',     match: (c) => ['working', 'quoted', 'follow_up'].includes(c.status) },
  { key: 'working_hot',   label: 'Hot Leads',         match: (c) => c.status === 'working_hot' },
  { key: 'contract_sent', label: 'Contract Sent',     match: (c) => c.status === 'contract_sent' },
  { key: 'ordered',       label: 'Ordered',           match: (c) => c.status === 'ordered' },
  { key: 'dead',          label: 'Dead',              match: (c) => ['dead', 'lost', 'cancelled'].includes(c.status) },
  { key: 'all',           label: 'All',               match: () => true },
]

// Lead-temperature → heat bar (matches the design's 6-stop gauge).
const TEMP_KEYS = ['cold', 'warm', 'hot', 'ready', 'pending_deposit', 'ordered']
const TEMP_LABELS = ['Cold', 'Warm', 'Hot', 'Ready', 'Pending', 'Ordered']
const TEMP_COLORS = ['#6FC9E8', '#8FD14F', '#FFB547', '#FF5C5C', '#A06BFF', '#22C55E']
function tempInfo(key) {
  const i = TEMP_KEYS.indexOf(key)
  if (i < 0) return { pct: 0, label: '—', color: 'var(--fg-3)' }
  return { pct: Math.max(8, Math.round((i / (TEMP_KEYS.length - 1)) * 100)), label: TEMP_LABELS[i], color: TEMP_COLORS[i] }
}

// Sales status → compact design pill ([label, pill-class]).
const STAGE_PILL = {
  new_lead: ['New Lead', 'pill-lime'], contacted: ['Attempting', 'pill-cyan'],
  working: ['Working', 'pill-amber'], working_hot: ['Hot', 'pill-red'],
  contract_sent: ['Contract Sent', 'pill-violet'], ordered: ['Ordered', 'pill-lime'],
  dead: ['Dead', 'pill-steel'], quoted: ['Working', 'pill-amber'], follow_up: ['Working', 'pill-amber'],
  lost: ['Dead', 'pill-steel'], cancelled: ['Dead', 'pill-steel'],
}
function StagePill({ status }) {
  const [lbl, cls] = STAGE_PILL[status] || ['—', 'pill-steel']
  return <span className={`pill-sm ${cls}`}><span className="dot" />{lbl}</span>
}
function initialsOf(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '·'
}

export default function ClientsList() {
  const navigate = useNavigate()
  const { users } = useUsers()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('view') || 'new_lead'
  const group = GROUPS.some(g => g.key === requested) ? requested : 'new_lead'
  const repFilter = searchParams.get('rep') || 'all'   // 'all' | a user id
  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [buildingTypeFilter, setBuildingTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('updated_desc')

  function setGroup(key) {
    const sp = new URLSearchParams(searchParams)
    sp.set('view', key)
    setSearchParams(sp, { replace: true })
  }
  function setRep(key) {
    const sp = new URLSearchParams(searchParams)
    if (key === 'all') sp.delete('rep'); else sp.set('rep', key)
    setSearchParams(sp, { replace: true })
  }

  // Rep tabs: All Leads + one per user, by primary rep. Built from the real
  // users list so it reads "Jenna's Leads" / "Joshua's Leads" automatically.
  const firstNameOf = (u) => (u.display_name || u.email || 'Rep').split(/[\s@]/)[0]
  const liveClients = clients.filter(c => !c.deleted_at)
  const repTabs = [
    { key: 'all', label: 'All StormSafe Leads', count: liveClients.length },
    // Only reps who actually own leads get a tab — keeps stray/empty accounts
    // (e.g. a duplicate login) from cluttering the row.
    ...users
      .map(u => ({ key: u.id, label: `${firstNameOf(u)}'s Leads`, count: liveClients.filter(c => c.primary_rep === u.id).length }))
      .filter(t => t.count > 0),
  ]
  // Everything below is scoped to the selected rep first, then by status.
  const repScoped = useMemo(
    () => (repFilter === 'all' ? clients : clients.filter(c => c.primary_rep === repFilter)),
    [clients, repFilter]
  )

  // Sliding active-tab indicator (Emil-style spring). Measure the active
  // tab and move the pill behind it with a transform.
  const tabsRef = useRef(null)
  const [ind, setInd] = useState({ left: 0, width: 0, ready: false })
  useLayoutEffect(() => {
    const host = tabsRef.current
    if (!host) return
    const el = host.querySelector(`[data-tab="${group}"]`)
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth, ready: true })
  }, [group, clients.length])

  // Same sliding indicator for the rep tab row.
  const repTabsRef = useRef(null)
  const [repInd, setRepInd] = useState({ left: 0, width: 0, ready: false })
  useLayoutEffect(() => {
    const host = repTabsRef.current
    if (!host) return
    const el = host.querySelector(`[data-reptab="${repFilter}"]`)
    if (el) setRepInd({ left: el.offsetLeft, width: el.offsetWidth, ready: true })
  }, [repFilter, users.length, clients.length])

  // Initial load + realtime subscription
  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('updated_at', { ascending: false })

      if (cancelled) return
      if (error) {
        setError(error.message)
      } else {
        setClients(data ?? [])
      }
      setLoading(false)
    }

    load()

    const channel = supabase
      .channel('clients-list')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'clients' },
        () => load()
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [])

  // Apply search + filters + sort in memory. For a few hundred clients
  // this is plenty fast; if the list ever grows huge we'd push this
  // down into the DB query.
  const visible = useMemo(() => {
    let result = repScoped.filter(c => !c.deleted_at)   // hide soft-deleted leads (recoverable in Trash)

    const g = GROUPS.find(x => x.key === group) || GROUPS[0]
    result = result.filter(g.match)

    if (buildingTypeFilter !== 'all') {
      result = result.filter(c => c.building_type === buildingTypeFilter)
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(c =>
        (c.name && c.name.toLowerCase().includes(q)) ||
        (c.phone && c.phone.toLowerCase().includes(q)) ||
        (c.email && c.email.toLowerCase().includes(q)) ||
        (c.building_size && c.building_size.toLowerCase().includes(q))
      )
    }

    const sorted = [...result]
    if (sortBy === 'updated_desc') {
      sorted.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
    } else if (sortBy === 'created_desc') {
      sorted.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    } else if (sortBy === 'first_contact_desc') {
      // Most recent first contact first; nulls sink to bottom.
      sorted.sort((a, b) => {
        if (!a.first_contact_date && !b.first_contact_date) return 0
        if (!a.first_contact_date) return 1
        if (!b.first_contact_date) return -1
        return b.first_contact_date.localeCompare(a.first_contact_date)
      })
    } else if (sortBy === 'follow_up_asc') {
      // Soonest follow-up first; nulls sink to bottom.
      sorted.sort((a, b) => {
        if (!a.follow_up_date && !b.follow_up_date) return 0
        if (!a.follow_up_date) return 1
        if (!b.follow_up_date) return -1
        return a.follow_up_date.localeCompare(b.follow_up_date)
      })
    } else if (sortBy === 'name_asc') {
      sorted.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    }
    return sorted
  }, [repScoped, search, group, buildingTypeFilter, sortBy])

  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">{(repTabs.find(t => t.key === repFilter) || repTabs[0]).label}</div>
          <h1>Leads</h1>
          <div className="sub">
            {visible.length} {visible.length === 1 ? 'lead' : 'leads'}
            {' · '}{(GROUPS.find(x => x.key === group) || GROUPS[0]).label}
          </div>
        </div>
        <div className="right">
          <Link to="/clients/new" className="btn btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New Lead
          </Link>
        </div>
      </div>

      {repTabs.length > 1 && (
        <div className="list-tabs" ref={repTabsRef} style={{ marginBottom: 10 }}>
          {repInd.ready && (
            <span className="list-tab-ind" style={{ transform: `translateX(${repInd.left}px)`, width: repInd.width }} />
          )}
          {repTabs.map(t => (
            <button
              key={t.key}
              data-reptab={t.key}
              className={`list-tab${repFilter === t.key ? ' on' : ''}`}
              onClick={() => setRep(t.key)}
            >
              {t.label}
              <span className="list-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="list-tabs" ref={tabsRef}>
        {ind.ready && (
          <span
            className="list-tab-ind"
            style={{ transform: `translateX(${ind.left}px)`, width: ind.width }}
          />
        )}
        {GROUPS.map(g => (
          <button
            key={g.key}
            data-tab={g.key}
            className={`list-tab${group === g.key ? ' on' : ''}`}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
            <span className="list-tab-count">{repScoped.filter(g.match).length}</span>
          </button>
        ))}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <section className="tile">
        <div className="tile-head">
          <h3>Active Pipeline</h3>
          <div className="right" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="notes-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <input type="text" placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select value={buildingTypeFilter} onChange={(e) => setBuildingTypeFilter(e.target.value)} style={SEL}>
              <option value="all">All build types</option>
              {BUILDING_TYPES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={SEL}>
              <option value="updated_desc">Recently updated</option>
              <option value="created_desc">Recently added</option>
              <option value="first_contact_desc">First contact (newest)</option>
              <option value="follow_up_asc">Follow-up (soonest)</option>
              <option value="name_asc">Name (A–Z)</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="muted" style={{ padding: 24 }}>Loading leads…</div>
        ) : visible.length === 0 ? (
          <div className="list-empty">
            {clients.length === 0
              ? <>No leads yet. <Link to="/clients/new">Add your first one</Link>.</>
              : 'No leads match your filters.'}
          </div>
        ) : (
          <table className="dt">
            <thead>
              <tr>
                <th>Client</th><th>Stage</th><th>Building</th><th>Temp</th><th>Rep</th><th>Follow-Up</th><th>Source</th>
              </tr>
            </thead>
            <tbody key={`${repFilter}-${group}`}>
              {visible.map((c, i) => {
                const t = tempInfo(c.lead_temperature)
                const loc = [c.city, c.state].filter(Boolean).join(', ')
                const repName = userLabel(users, c.primary_rep)
                return (
                  <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)} className="lead-row row-enter" style={{ '--ri': Math.min(i, 14) }}>
                    <td>
                      <div className="client">
                        <div className="avatar xs">{initialsOf(c.name)}</div>
                        <div>
                          <div className="nm">{c.name || '—'}</div>
                          <div className="sb">{[loc, c.email].filter(Boolean).join(' · ') || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td><StagePill status={c.status} /></td>
                    <td>
                      {c.building_size || c.building_type ? (
                        <>
                          {c.building_size && <div style={{ color: 'var(--fg)' }}>{c.building_size}</div>}
                          {c.building_type && <div style={{ color: 'var(--fg-3)', fontSize: 11.5, marginTop: 2 }}>{buildingTypeLabel(c.building_type)}</div>}
                        </>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="heat">
                        <div className="bar"><i style={{ width: `${t.pct}%` }} /></div>
                        <span className="lbl" style={{ color: t.color }}>{t.label}</span>
                      </div>
                    </td>
                    <td>
                      {repName && repName !== '—'
                        ? <div className="client"><div className="avatar xs">{initialsOf(repName)}</div><span style={{ fontSize: 13 }}>{repName}</span></div>
                        : <span className="muted">—</span>}
                    </td>
                    <td>{c.follow_up_date ? <FollowUpCell date={c.follow_up_date} /> : <span className="muted">—</span>}</td>
                    <td>{c.source ? <span className="cat-tag">{sourceLabel(c.source)}</span> : <span className="muted">—</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}

// Inline style for the lead-list filter selects (design tokens, no extra CSS).
const SEL = {
  background: 'var(--inset)', border: '1px solid var(--line)', color: 'var(--fg-2)',
  borderRadius: 'var(--r-md)', padding: '9px 12px', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
}

// Small helper that colors follow-up dates: red if overdue, amber if today,
// normal otherwise. Helps you scan the list and spot what needs attention.
function FollowUpCell({ date }) {
  const today = new Date().toISOString().slice(0, 10)
  let className = ''
  if (date < today) className = 'follow-up-overdue'
  else if (date === today) className = 'follow-up-today'

  const [y, m, d] = date.split('-')
  const formatted = `${m}/${d}/${y}`

  return <span className={className}>{formatted}</span>
}
