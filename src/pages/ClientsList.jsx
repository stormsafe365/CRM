// ClientsList: the main clients table. Search by name/phone/email/
// building size. Filter by status and by building type. Sort multiple ways.
// Live-updates via Supabase realtime — if your partner adds/edits a
// client, you see it without refreshing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BUILDING_TYPES, buildingTypeLabel } from '../lib/constants'
import { useUsers, userLabel } from '../lib/useUsers'
import StatusPill from '../components/StatusPill'

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
  const [search, setSearch] = useState(searchParams.get('q') || '')
  const [buildingTypeFilter, setBuildingTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('updated_desc')

  function setGroup(key) {
    const sp = new URLSearchParams(searchParams)
    sp.set('view', key)
    setSearchParams(sp, { replace: true })
  }

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
    let result = clients

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
  }, [clients, search, group, buildingTypeFilter, sortBy])

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Clients</h1>
          <p className="muted">
            {visible.length} {visible.length === 1 ? 'client' : 'clients'}
            {' · '}{(GROUPS.find(x => x.key === group) || GROUPS[0]).label}
          </p>
        </div>
        <Link to="/clients/new" className="btn-primary">+ New Client</Link>
      </div>

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
            <span className="list-tab-count">{clients.filter(g.match).length}</span>
          </button>
        ))}
      </div>

      <div className="filters-bar">
        <input
          type="text"
          placeholder="Search by name, phone, email, or size…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="filter-search"
        />

        <select
          value={buildingTypeFilter}
          onChange={(e) => setBuildingTypeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All build types</option>
          {BUILDING_TYPES.map(b => (
            <option key={b.value} value={b.value}>{b.label}</option>
          ))}
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="filter-select"
        >
          <option value="updated_desc">Sort: Recently updated</option>
          <option value="created_desc">Sort: Recently added</option>
          <option value="first_contact_desc">Sort: First contact (newest)</option>
          <option value="follow_up_asc">Sort: Follow-up date (soonest)</option>
          <option value="name_asc">Sort: Name (A-Z)</option>
        </select>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="muted" style={{padding: '24px 0'}}>Loading clients…</div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {clients.length === 0
            ? <>No clients yet. <Link to="/clients/new">Add your first one</Link>.</>
            : 'No clients match your filters.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Location</th>
                <th>Building</th>
                <th>Status</th>
                <th>Follow-Up</th>
                <th>Primary Rep</th>
              </tr>
            </thead>
            <tbody key={group}>
              {visible.map((c, i) => (
                <tr
                  key={c.id}
                  onClick={() => navigate(`/clients/${c.id}`)}
                  className="row-clickable row-enter"
                  style={{ '--ri': Math.min(i, 14) }}
                >
                  <td>
                    <div className="cell-primary">{c.name || '—'}</div>
                    {c.email && <div className="cell-secondary">{c.email}</div>}
                  </td>
                  <td>{c.phone || '—'}</td>
                  <td>
                    {[c.city, c.state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td>
                    {c.building_size || c.building_type ? (
                      <>
                        {c.building_size && <div className="cell-primary">{c.building_size}</div>}
                        {c.building_type && <div className="cell-secondary">{buildingTypeLabel(c.building_type)}</div>}
                      </>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td><StatusPill status={c.status} /></td>
                  <td>
                    {c.follow_up_date
                      ? <FollowUpCell date={c.follow_up_date} />
                      : <span className="muted">—</span>}
                  </td>
                  <td>{userLabel(users, c.primary_rep)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
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
