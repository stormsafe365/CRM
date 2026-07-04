// ClientsList: the main clients table. Search by name/phone/email/
// building size. Filter by status and by building type. Sort multiple ways.
// Live-updates via Supabase realtime — if your partner adds/edits a
// client, you see it without refreshing.

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { BUILDING_TYPES, buildingTypeLabel, sourceLabel, projectStageLabel } from '../lib/constants'
import { useUsers, userLabel } from '../lib/useUsers'
import { derivedProjectStage } from '../lib/projectStage'
import { readState } from '../lib/ssfuEngine'

// Tabs follow the sales funnel order. Each tab maps to one stage; the
// 'working' and 'dead' tabs also fold in legacy values so old rows land
// in the right place. 'all' shows everything.
const GROUPS = [
  { key: 'all',           label: 'All',               match: () => true },
  { key: 'new_lead',      label: 'New Lead',          match: (c) => c.status === 'new_lead' },
  { key: 'contacted',     label: 'Attempting Contact', match: (c) => c.status === 'contacted' },
  { key: 'working',       label: 'Working Leads',     match: (c) => ['working', 'quoted', 'follow_up'].includes(c.status) },
  { key: 'working_hot',   label: 'Hot Leads',         match: (c) => c.status === 'working_hot' },
  { key: 'contract_sent', label: 'Contract Sent',     match: (c) => c.status === 'contract_sent' },
  { key: 'ordered',       label: 'Ordered',           match: (c) => c.status === 'ordered' },
  { key: 'dead',          label: 'Dead',              match: (c) => ['dead', 'lost', 'cancelled'].includes(c.status) },
]

// The seven pipeline stages the inline "Change Stage" control offers.
const CHANGE_STAGES = [
  { key: 'new_lead', label: 'New Lead' },
  { key: 'contacted', label: 'Attempting' },
  { key: 'working', label: 'Working' },
  { key: 'working_hot', label: 'Hot' },
  { key: 'contract_sent', label: 'Contract Sent' },
  { key: 'ordered', label: 'Ordered' },
  { key: 'dead', label: 'Dead' },
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
  const requested = searchParams.get('view') || 'all'
  const group = GROUPS.some(g => g.key === requested) ? requested : 'all'
  const stageFilter = searchParams.get('stage') || null   // project-stage filter (only meaningful when view=ordered)
  const repFilter = searchParams.get('rep') || 'all'   // 'all' | a user id
  const [search, setSearch] = useState(searchParams.get('q') || '')
  // Mirror the top-bar search (?q=…) into the filter. Navigating to /clients?q=…
  // while already on this page doesn't remount, so the useState initializer alone
  // would ignore it — this keeps the box + results in sync with the query.
  const qParam = searchParams.get('q') || ''
  useEffect(() => { setSearch(qParam) }, [qParam])
  const [buildingTypeFilter, setBuildingTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('updated_desc')
  // Follow-Up HQ milestone store — drives the DERIVED project stage so this list
  // matches the Dashboard "Project Stage" box exactly. Refresh on tab focus.
  const [ssfu, setSsfu] = useState(() => readState())
  useEffect(() => {
    const refresh = () => setSsfu(readState())
    window.addEventListener('focus', refresh)
    window.addEventListener('storage', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh) }
  }, [])

  function setGroup(key) {
    const sp = new URLSearchParams(searchParams)
    sp.set('view', key)
    sp.delete('stage')   // switching the funnel tab clears any project-stage filter
    setSearchParams(sp, { replace: true })
  }
  function clearStage() {
    const sp = new URLSearchParams(searchParams)
    sp.delete('stage')
    setSearchParams(sp, { replace: true })
  }

  // Expand-for-detail drawer — one open row at a time.
  const [expanded, setExpanded] = useState(null)
  const [expandedQuote, setExpandedQuote] = useState(null) // { id, total } — the open row's latest quote
  // Any filter change closes the open drawer.
  useEffect(() => { setExpanded(null) }, [group, repFilter, search, buildingTypeFilter, sortBy])
  // Lazily fetch the open lead's latest (non-deleted) quote total for the drawer.
  useEffect(() => {
    if (!expanded) { setExpandedQuote(null); return }
    let cancelled = false
    supabase.from('quotes')
      .select('total_amount, deleted_at, quote_date')
      .eq('client_id', expanded)
      .order('quote_date', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        if (cancelled) return
        const live = (data || []).filter(q => !q.deleted_at)
        setExpandedQuote({ id: expanded, total: live[0]?.total_amount ?? null })
      })
    return () => { cancelled = true }
  }, [expanded])

  async function changeStage(client, status) {
    if (client.status === status) return
    const { error } = await supabase.from('clients').update({ status }).eq('id', client.id)
    if (error) setError(error.message)
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

    // Project-stage filter (from clicking a stage in the Dashboard box) — only for
    // ordered clients, using the same derived stage the dashboard shows.
    if (stageFilter && group === 'ordered') {
      result = result.filter(c => derivedProjectStage(c, ssfu) === stageFilter)
    }

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
  }, [repScoped, search, group, stageFilter, ssfu, buildingTypeFilter, sortBy])

  return (
    <>
      <div className="page-head">
        <div className="left">
          <div className="eyebrow-lime">{(repTabs.find(t => t.key === repFilter) || repTabs[0]).label}</div>
          <h1>Leads</h1>
          <div className="sub">
            {visible.length} {visible.length === 1 ? 'lead' : 'leads'}
            {' · '}{(GROUPS.find(x => x.key === group) || GROUPS[0]).label}
            {stageFilter && group === 'ordered' && (
              <span className="stage-filter-chip" onClick={clearStage} role="button" title="Clear stage filter">
                {' · '}{projectStageLabel(stageFilter)} <span aria-hidden>✕</span>
              </span>
            )}
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

      <div className="lead-chips" ref={tabsRef}>
        {GROUPS.map(g => (
          <button
            key={g.key}
            data-tab={g.key}
            className={`lead-chip${group === g.key ? ' on' : ''}`}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
            <span className="lead-chip-count">{repScoped.filter(g.match).length}</span>
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
          <table className="dt lead-table">
            <thead>
              <tr>
                <th>Client</th><th>Stage</th><th>Building</th><th>Temp</th><th>Rep</th><th>Follow-Up</th><th>Source</th><th aria-label="Expand"></th>
              </tr>
            </thead>
            <tbody key={`${repFilter}-${group}`}>
              {visible.map((c, i) => {
                const t = tempInfo(c.lead_temperature)
                const loc = [c.city, c.state].filter(Boolean).join(', ')
                const repName = userLabel(users, c.primary_rep)
                const isOpen = expanded === c.id
                const toggle = () => setExpanded(isOpen ? null : c.id)
                return (
                  <Fragment key={c.id}>
                    <tr onClick={toggle} className={`lead-row row-enter${isOpen ? ' open' : ''}`} style={{ '--ri': Math.min(i, 14) }}>
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
                            {c.building_size && <div className="num" style={{ color: 'var(--fg)' }}>{c.building_size}</div>}
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
                      <td className="lead-chev-cell">
                        <button className={`lead-chevron${isOpen ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggle() }} aria-label={isOpen ? 'Collapse' : 'Expand'}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={isOpen ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'} /></svg>
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="lead-drawer-row">
                        <td colSpan={8}>
                          <LeadDrawer
                            c={c} loc={loc}
                            quote={expandedQuote?.id === c.id ? expandedQuote.total : undefined}
                            onChangeStage={changeStage}
                            onOpenPortal={() => navigate(`/clients/${c.id}`)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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

// Inline expand-for-detail drawer beneath a lead row: contact, project spec, an
// inline stage changer, and a jump to the client portal.
function LeadDrawer({ c, loc, quote, onChangeStage, onOpenPortal }) {
  const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString())
  const ic = (d) => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
  return (
    <div className="lead-drawer">
      <div className="lead-drawer-grid">
        <div>
          <div className="lead-drawer-label">Contact</div>
          <div className="lead-contact">
            {c.phone && <div className="lead-contact-row">{ic(<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />)}{c.phone}</div>}
            {c.email && <div className="lead-contact-row">{ic(<><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 5L2 7" /></>)}{c.email}</div>}
            {loc && <div className="lead-contact-row">{ic(<><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>)}{loc}</div>}
            {!c.phone && !c.email && !loc && <div className="muted" style={{ fontSize: 13 }}>No contact info yet.</div>}
          </div>
        </div>
        <div>
          <div className="lead-drawer-label">Project Spec</div>
          <div className="lead-spec">
            <div className="lead-spec-row"><span>Building</span><span className="num" style={{ color: 'var(--fg)' }}>{c.building_size || '—'}</span></div>
            <div className="lead-spec-row"><span>Type</span><span style={{ color: 'var(--cyan)' }}>{c.building_type ? buildingTypeLabel(c.building_type) : '—'}</span></div>
            <div className="lead-spec-row"><span>Current quote</span><span className="num" style={{ color: 'var(--lime)' }}>{quote === undefined ? '…' : money(quote)}</span></div>
          </div>
        </div>
      </div>
      <div className="lead-drawer-foot">
        <div className="lead-change">
          <div className="lead-drawer-label">Change Stage</div>
          <div className="lead-stage-btns">
            {CHANGE_STAGES.map(s => (
              <button key={s.key} className={`lead-stage-btn${c.status === s.key ? ' on' : ''}`} onClick={() => onChangeStage(c, s.key)}>{s.label}</button>
            ))}
          </div>
        </div>
        <button className="lead-portal-btn" onClick={onOpenPortal}>
          {ic(<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6M10 14 21 3" /></>)}
          Open Client Portal
        </button>
      </div>
    </div>
  )
}
