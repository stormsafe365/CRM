// FollowUpHQ — the redesigned Follow-Up HQ calendar, rebuilt natively in React
// from claude design's prototype and wired to live CRM data + our milestone
// engine (no iframe). Overview / Pipeline / Metrics tabs + client modal.
// Check-offs run the real gate-spawn engine (ssfuEngine) and share the ssfu_v8
// store with the client-portal Order Timeline, so the two stay in sync.
// Deferred for a later pass: Work Mode, tweaks panel.

import { createContext, useContext, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabase'
import { useUsers, userLabel } from '../lib/useUsers'
import { toggleFollowupForClient, setFollowupDate, exportStateJSON, importStateJSON } from '../lib/ssfuEngine'
import {
  buildModel, scoreTask, priorityBand, CATS, CAT_ORDER, CHANNELS, LANES, MILESTONES, MILESTONE_IDX,
  MONTHS, DOW, TODAY, parseISO, toISO, daysBetween, daysOverdue, daysStuck, relativeLabel, fmtDate, monthGrid,
} from '../lib/followupModel'
import './followup-hq.css'
import {
  Target, Columns3, BarChart3, Play, Users, Filter, Plus, X, ChevronLeft, ChevronRight, ChevronDown,
  Check, CheckCheck, AlertTriangle, Phone, Mail, Factory, Clock, MapPin, Zap, ArrowRight, ArrowLeft,
  Star, Package, Ruler, Stamp as StampIco, CalendarClock, BadgeCheck, Timer, ShieldAlert, FileCheck2,
  Receipt, Shovel, Truck, Activity, Flag, ClipboardCheck,
} from 'lucide-react'

const ICONS = {
  target: Target, 'columns-3': Columns3, 'bar-chart-3': BarChart3, play: Play, users: Users, filter: Filter,
  plus: Plus, x: X, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight, 'chevron-down': ChevronDown,
  check: Check, 'check-check': CheckCheck, 'alert-triangle': AlertTriangle, phone: Phone, mail: Mail,
  factory: Factory, clock: Clock, 'map-pin': MapPin, zap: Zap, 'arrow-right': ArrowRight, 'arrow-left': ArrowLeft,
  star: Star, package: Package, ruler: Ruler, stamp: StampIco, 'calendar-clock': CalendarClock,
  'badge-check': BadgeCheck, timer: Timer, 'shield-alert': ShieldAlert, 'file-check-2': FileCheck2,
  receipt: Receipt, shovel: Shovel, truck: Truck, activity: Activity, flag: Flag, 'clipboard-check': ClipboardCheck,
}
const Icon = ({ name, size = 16, color, style }) => {
  const C = ICONS[name]
  return C ? <C size={size} color={color} style={style} className="ico" strokeWidth={2} /> : null
}

const Ctx = createContext(null)
const useFuhq = () => useContext(Ctx)
const REP_PALETTE = ['var(--teal-500)', '#5A7CA0', '#A8814A', '#7C77A0', '#2E8E86', '#C98A2B', '#5A6A7E']

/* ---- small components ---- */
const Avatar = ({ repId, size = 26, ring }) => {
  const { repById } = useFuhq()
  const r = repById(repId)
  return (
    <span title={r.name} style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, background: r.color, color: '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-head)', fontWeight: 500, fontSize: size * 0.38, opacity: .92,
      boxShadow: ring ? '0 0 0 2px var(--panel)' : 'none',
    }}>{r.initials}</span>
  )
}
const Stamp = ({ children, color, style }) => (
  <span style={{ fontFamily: 'var(--font-head)', textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10.5, fontWeight: 400, color: color || 'var(--ink-3)', display: 'inline-flex', alignItems: 'center', gap: 7, ...style }}>{children}</span>
)
const ChannelChip = ({ channel, cat }) => {
  const ch = CHANNELS[channel], c = CATS[cat]
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 6px', borderRadius: 4, background: c.tint, color: c.color, fontFamily: 'var(--font-head)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 10, fontWeight: 400, whiteSpace: 'nowrap' }}>
      <Icon name={ch.icon} size={11} />{ch.label}
    </span>
  )
}
const CatDot = ({ cat, size = 7 }) => <span title={CATS[cat].label} style={{ width: size, height: size, borderRadius: '50%', background: CATS[cat].color, flexShrink: 0, display: 'inline-block' }} />
const PriorityPill = ({ score, showScore = true }) => {
  const b = priorityBand(score)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.color }} />
      <span style={{ fontFamily: 'var(--font-head)', textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 10, fontWeight: 400, color: 'var(--ink-3)' }}>{b.label}</span>
      {showScore && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: b.color, fontWeight: 500 }}>{score}</span>}
    </span>
  )
}
const CheckStamp = ({ done, onToggle, size = 24 }) => (
  <button onClick={(e) => { e.stopPropagation(); onToggle() }} aria-pressed={done} className={`ss-check ${done ? 'is-done' : ''}`}
    style={{ width: size, height: size, borderRadius: 5, flexShrink: 0, cursor: 'pointer', border: done ? 'none' : '2px solid var(--line-strong)', background: done ? 'var(--safe-500)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: 0 }}>
    {done && <Icon name="check" size={size * 0.6} />}
  </button>
)
const MilestoneTrack = ({ current, compact }) => {
  const ci = MILESTONE_IDX[current] ?? -1
  const cur = MILESTONES[ci]
  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {MILESTONES.map((m, i) => <span key={m.id} style={{ flex: 1, height: 3, borderRadius: 2, background: i < ci ? 'color-mix(in srgb, var(--safe-500) 55%, transparent)' : i === ci ? 'var(--accent)' : 'var(--line)' }} />)}
        </div>
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: 10.5, color: 'var(--ink-3)' }}>{cur ? `${cur.label} · ${ci + 1} of ${MILESTONES.length}` : 'Not started'}</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {MILESTONES.map((m, i) => {
        const done = i < ci, active = i === ci
        return (
          <Fragment key={m.id}>
            <span title={m.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap', background: active ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent', color: active ? 'var(--accent)' : done ? 'var(--ink-2)' : 'var(--ink-3)', fontFamily: 'var(--font-head)', textTransform: 'uppercase', letterSpacing: '.06em', fontSize: 9.5, fontWeight: 400 }}>
              {done && <Icon name="check" size={9} />}{m.label}
            </span>
            {i < MILESTONES.length - 1 && <span style={{ width: 5, height: 1, background: 'var(--line)', flexShrink: 0 }} />}
          </Fragment>
        )
      })}
    </div>
  )
}

const QuickActions = ({ task, onComplete, onSnooze, size = 'sm', onAct }) => {
  const ch = CHANNELS[task.channel], big = size === 'lg'
  const Btn = ({ icon, label, kind, onClick, primary }) => (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} className={`qa-btn ${primary ? 'is-primary' : ''} ${kind || ''}`} style={{ flex: big ? 1 : 'initial', padding: big ? '12px 14px' : '7px 11px', fontSize: big ? 13 : 12 }}>
      <Icon name={icon} size={big ? 17 : 14} />{label}
    </button>
  )
  return (
    <div style={{ display: 'flex', gap: big ? 10 : 7, flexWrap: 'wrap' }}>
      <Btn icon={ch.icon} label={ch.verb} primary onClick={() => onAct && onAct('contact')} />
      {task.channel !== 'email' && <Btn icon="mail" label="Email" onClick={() => onAct && onAct('email')} />}
      <Btn icon="check" label="Complete" kind="done" onClick={() => onComplete(task.id)} />
      <Btn icon="clock" label="Snooze" onClick={() => onSnooze(task.id)} />
    </div>
  )
}

const NextActionRow = ({ task, onComplete, onSnooze, onOpen, rank, expanded, onToggle }) => {
  const { clientById, score } = useFuhq()
  const c = clientById(task.client); if (!c) return null
  const s = score(task), b = priorityBand(s), od = daysOverdue(task.date), cat = CATS[task.cat]
  return (
    <div className={`na-row ${expanded ? 'is-exp' : ''}`}>
      <button className="na-head" onClick={onToggle} aria-expanded={expanded}>
        <span className="na-rank">{rank}</span>
        <span className="na-dot" style={{ background: cat.color }} title={cat.label} />
        <span className="na-client">{c.name}</span>
        {od > 0 && <span className="na-od">{od}d</span>}
        <span className="na-spacer" />
        <span className="na-prio-dot" style={{ background: b.color }} title={`${b.label} · ${s}`} />
        <Icon name="chevron-down" size={14} style={{ color: 'var(--ink-3)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />
      </button>
      {!expanded && <div className="na-teaser">{task.action}</div>}
      {expanded && (
        <div className="na-body">
          <div className="na-action">{task.action}</div>
          <div className="na-reason">{task.reason}</div>
          <div className="na-meta">
            <ChannelChip channel={task.channel} cat={task.cat} />
            <span><Icon name="map-pin" size={11} />{c.city}</span>
            <PriorityPill score={s} />
            {c.real && <span className="real-tag">Real order</span>}
          </div>
          <div className="na-foot">
            <Avatar repId={c.rep} size={24} ring />
            <div className="na-qa"><QuickActions task={task} onComplete={onComplete} onSnooze={onSnooze} /></div>
            <button className="na-open" onClick={(e) => { e.stopPropagation(); onOpen(c.id) }}>Timeline<Icon name="arrow-right" size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

const ClientCard = ({ client, onOpen }) => {
  const { tasks, score } = useFuhq()
  const open = tasks.filter(t => t.client === client.id && !t.done).map(t => ({ t, s: score(t) })).sort((a, b) => b.s - a.s)
  const nba = open[0]?.t, s = open[0]?.s || 0, od = nba ? daysOverdue(nba.date) : 0
  return (
    <div onClick={() => onOpen(client.id)} className="pc-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="pc-name">{client.name}{client.vip && <Icon name="star" size={12} color="#C98A2B" style={{ marginLeft: 5 }} />}</div>
          <div className="pc-building">{[client.mfr, client.building].filter(Boolean).join(' · ')}</div>
        </div>
        <Avatar repId={client.rep} size={24} />
      </div>
      <div className="pc-loc"><Icon name="map-pin" size={11} />{[client.city, client.county].filter(Boolean).join(', ')}</div>
      {nba ? (
        <div className="pc-nba">
          <div className="pc-nba-label"><Icon name="zap" size={11} />Next required action</div>
          <div className="pc-nba-action">{nba.action}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <ChannelChip channel={nba.channel} cat={nba.cat} />
            {od > 0 ? <span className="overdue-tag"><Icon name="alert-triangle" size={11} />{od}d overdue</span> : <span className="due-tag">{relativeLabel(nba.date)}</span>}
          </div>
        </div>
      ) : <div className="pc-clear"><Icon name="check" size={13} />All caught up</div>}
      <div className="pc-foot">
        <PriorityPill score={s} />
        <span className="pc-value">${(client.value / 1000).toFixed(0)}k</span>
        {open.length > 0 && <span className="pc-open">{open.length} open</span>}
      </div>
      <div className="pc-track"><MilestoneTrack current={client.milestone} compact /></div>
    </div>
  )
}

/* ---- views ---- */
const STAT_FILTERS = {
  overdue: { label: 'Overdue', test: t => daysOverdue(t.date) > 0 },
  calls: { label: 'Calls due', test: t => t.channel === 'call' && t.date <= TODAY },
  emails: { label: 'Emails due', test: t => t.channel === 'email' && t.date <= TODAY },
  mfg: { label: 'Mfg tasks', test: t => t.cat === 'manufacturer' && t.date <= TODAY },
}
const MissionBar = ({ tasks, active, onPick }) => {
  const open = tasks.filter(t => !t.done)
  const n = (k) => open.filter(STAT_FILTERS[k].test).length
  const todayOpen = open.filter(t => t.date <= TODAY).length
  const cards = [
    { key: 'overdue', label: 'Overdue', value: n('overdue'), icon: 'alert-triangle', tone: n('overdue') ? 'crit' : 'ok' },
    { key: 'calls', label: 'Calls due', value: n('calls'), icon: 'phone', tone: 'neutral' },
    { key: 'emails', label: 'Emails due', value: n('emails'), icon: 'mail', tone: 'neutral' },
    { key: 'mfg', label: 'Mfg tasks', value: n('mfg'), icon: 'factory', tone: 'neutral' },
    { key: null, label: 'Est. workload', value: `${Math.max(15, todayOpen * 8)}m`, icon: 'clock', tone: 'neutral', static: true },
  ]
  return (
    <div className="mission">
      <div className="mission-head">
        <div>
          <Stamp color="var(--ink-3)">Today’s Mission · {MONTHS[parseISO(TODAY).getMonth()]} {parseISO(TODAY).getDate()}</Stamp>
          <h2 className="mission-title">{todayOpen ? `${todayOpen} follow-ups need you today` : 'You’re all caught up'}</h2>
        </div>
      </div>
      <div className="mission-cards">
        {cards.map(c => c.static
          ? <div key={c.label} className={`m-card tone-${c.tone} is-static`}><Icon name={c.icon} size={17} /><div className="m-val">{c.value}</div><div className="m-lbl">{c.label}</div></div>
          : <button key={c.label} onClick={() => onPick(active === c.key ? null : c.key)} className={`m-card tone-${c.tone} ${active === c.key ? 'is-active' : ''}`}><Icon name={c.icon} size={17} /><div className="m-val">{c.value}</div><div className="m-lbl">{c.label}</div><span className="m-pick"><Icon name={active === c.key ? 'check' : 'filter'} size={11} /></span></button>)}
      </div>
    </div>
  )
}
const MissionView = ({ tasks, year, month, setYM, onComplete, onSnooze, onOpen, drag }) => {
  const { clientById, score } = useFuhq()
  const [dragOver, setDragOver] = useState(null)
  const [statFilter, setStatFilter] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  let open = tasks.filter(t => !t.done).sort((a, b) => score(b) - score(a) || a.date.localeCompare(b.date))
  if (statFilter && STAT_FILTERS[statFilter]) open = open.filter(STAT_FILTERS[statFilter].test)
  const byDate = {}; tasks.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t) })
  const cells = monthGrid(year, month)
  return (
    <div className="mission-wrap">
      <MissionBar tasks={tasks} active={statFilter} onPick={(k) => { setStatFilter(k); setExpandedId(null) }} />
      <div className="mission-grid">
        <section className="na-pane">
          <div className="pane-row">
            <h3 className="pane-title">NEXT ACTIONS</h3>
            {statFilter ? <button className="na-filter-chip" onClick={() => setStatFilter(null)}>{STAT_FILTERS[statFilter].label}<Icon name="x" size={12} /></button> : <span className="pane-sub">{open.length} open</span>}
          </div>
          <div className="na-scroll">
            {open.map((t, i) => <NextActionRow key={t.id} task={t} rank={i + 1} expanded={expandedId === t.id} onToggle={() => setExpandedId(id => id === t.id ? null : t.id)} onComplete={onComplete} onSnooze={onSnooze} onOpen={onOpen} />)}
            {!open.length && <div className="empty-clear"><Icon name="check-check" size={26} />{statFilter ? 'No tasks in this group.' : 'Nothing open. Every follow-up is handled.'}</div>}
          </div>
        </section>
        <section className="cal-pane">
          <div className="pane-row">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}><h3 className="pane-title">{MONTHS[month].toUpperCase()}</h3><span className="pane-sub">{year}</span></div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="fuhq-ib" onClick={() => setYM(month === 0 ? [year - 1, 11] : [year, month - 1])}><Icon name="chevron-left" size={16} /></button>
              <button className="ghost-btn" onClick={() => setYM([parseISO(TODAY).getFullYear(), parseISO(TODAY).getMonth()])}>Today</button>
              <button className="fuhq-ib" onClick={() => setYM(month === 11 ? [year + 1, 0] : [year, month + 1])}><Icon name="chevron-right" size={16} /></button>
            </div>
          </div>
          <div className="cal-legend">{CAT_ORDER.map(k => <span key={k}><CatDot cat={k} />{CATS[k].label}</span>)}<span><span className="leg-od" />Overdue</span></div>
          <div className="cal-dow">{DOW.map(d => <div key={d} className="cal-dow-cell">{d}</div>)}</div>
          <div className="cal-grid">
            {cells.map(cell => {
              const items = (byDate[cell.iso] || []).slice().sort((a, b) => a.done - b.done)
              const isToday = cell.iso === TODAY, isOver = dragOver === cell.iso
              return (
                <div key={cell.iso}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(cell.iso) }}
                  onDragLeave={() => setDragOver(o => o === cell.iso ? null : o)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(null); drag.onDropDay(cell.iso) }}
                  className={`cal-cell ${cell.inMonth ? '' : 'is-out'} ${isToday ? 'is-today' : ''} ${isOver ? 'is-over' : ''}`}>
                  <div className="cal-cell-head">
                    <span className={`cal-daynum ${isToday ? 'is-today' : ''}`}>{cell.day}</span>
                    {items.length > 0 && <span className="cal-count">{items.filter(f => !f.done).length || '✓'}</span>}
                  </div>
                  <div className="cal-cell-body">
                    {items.slice(0, 4).map(t => {
                      const c = clientById(t.client); if (!c) return null
                      const od = daysOverdue(t.date) > 0 && !t.done
                      return (
                        <div key={t.id} draggable onDragStart={(e) => drag.onDragStart(e, t.id)} onDragEnd={drag.onDragEnd}
                          onClick={(e) => { e.stopPropagation(); onOpen(c.id) }} className="cal-chip"
                          style={{ borderLeft: `3px solid ${od ? 'var(--storm-500)' : CATS[t.cat].color}`, opacity: t.done ? .45 : 1 }}>
                          <Icon name={CHANNELS[t.channel].icon} size={10} color={od ? 'var(--storm-500)' : CATS[t.cat].color} />
                          <span className="cal-chip-name">{c.name.split(' ').slice(-1)[0]}</span>
                        </div>
                      )
                    })}
                    {items.length > 4 && <div className="cal-more">+{items.length - 4} more</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
const PipelineView = ({ tasks, onOpen }) => {
  const { clients, score } = useFuhq()
  return (
    <div className="pipe-wrap">
      <div className="pipe-cols">
        {LANES.map(lane => {
          const cl = clients.filter(c => c.lane === lane.id).sort((a, b) => {
            const sa = Math.max(0, ...tasks.filter(t => t.client === a.id && !t.done).map(score))
            const sb = Math.max(0, ...tasks.filter(t => t.client === b.id && !t.done).map(score))
            return sb - sa
          })
          const value = cl.reduce((s, c) => s + (c.value || 0), 0)
          return (
            <div key={lane.id} className="pipe-col">
              <div className="pipe-col-head" style={{ borderTop: `2px solid ${lane.accent}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon name={lane.icon} size={13} color={lane.accent} /><span className="pipe-col-title">{lane.label}</span></div>
                <div className="pipe-col-meta"><span>{cl.length} build{cl.length !== 1 ? 's' : ''}</span><span>${(value / 1000).toFixed(0)}k</span></div>
              </div>
              <div className="pipe-col-body">
                {cl.map(c => <ClientCard key={c.id} client={c} onOpen={onOpen} />)}
                {!cl.length && <div className="pipe-empty">No builds here</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
const MetricsView = ({ tasks, onOpen }) => {
  const { clients, score } = useFuhq()
  const [sel, setSel] = useState(null)
  const byLane = (id) => clients.filter(c => c.lane === id)
  const active = clients.filter(c => c.milestone !== 'complete')
  const ready = byLane('install')
  const stuck = clients.filter(c => daysStuck(c) > 14)
  const avgDelay = stuck.length ? Math.round(stuck.map(daysStuck).reduce((a, b) => a + b, 0) / stuck.length) : 0
  const doneTasks = tasks.filter(t => t.done && t.date === TODAY)
  const cb = (id) => clients.find(c => c.id === id)
  const doneClients = [...new Set(doneTasks.map(t => t.client))].map(cb).filter(Boolean)
  const tiles = [
    { key: 'active', label: 'Active Orders', value: active.length, icon: 'package', sub: `${clients.length} total in system`, list: active },
    { key: 'plans', label: 'Waiting on Plans', value: byLane('plans').length, icon: 'ruler', tone: byLane('plans').length ? 'warn' : '', list: byLane('plans') },
    { key: 'permit', label: 'Permitting', value: byLane('permit').length, icon: 'stamp', list: byLane('permit') },
    { key: 'sched', label: 'Scheduling / Awaiting Install', value: byLane('sched').length, icon: 'calendar-clock', list: byLane('sched') },
    { key: 'ready', label: 'Installed', value: ready.length, icon: 'badge-check', tone: 'good', list: ready },
    { key: 'done', label: 'Tasks Completed Today', value: doneTasks.length, icon: 'check-check', tone: 'good', list: doneClients },
  ]
  const atRisk = clients.filter(c => daysStuck(c) > 45 || tasks.some(t => t.client === c.id && !t.done && score(t) >= 45))
  const riskVal = atRisk.reduce((s, c) => s + (c.value || 0), 0)
  const selTile = tiles.find(t => t.key === sel)
  const nbaFor = (id) => { const o = tasks.filter(t => t.client === id && !t.done).map(t => ({ t, s: score(t) })).sort((a, b) => b.s - a.s); return o[0]?.t }
  return (
    <div className="metrics-wrap">
      <div className="pane-row" style={{ marginBottom: 16 }}><h3 className="pane-title">METRICS DASHBOARD</h3><span className="pane-sub">{sel ? 'Click a client to open their timeline' : 'Live pipeline health · click a tile to drill in'}</span></div>
      <div className="metrics-grid">
        {tiles.map(t => (
          <button key={t.label} onClick={() => setSel(s => s === t.key ? null : t.key)} className={`metric-tile ${t.tone || ''} ${sel === t.key ? 'is-sel' : ''}`}>
            <div className="metric-top"><Icon name={t.icon} size={18} /><Icon name="chevron-right" size={15} style={{ marginLeft: 'auto', opacity: sel === t.key ? 1 : .4, transform: sel === t.key ? 'rotate(90deg)' : 'none', transition: 'transform 160ms' }} /></div>
            <div className="metric-val">{t.value}</div><div className="metric-lbl">{t.label}</div>{t.sub && <div className="metric-sub">{t.sub}</div>}
          </button>
        ))}
      </div>
      {selTile ? (
        <div className="metric-detail">
          <div className="metric-detail-head"><span><Icon name={selTile.icon} size={15} />{selTile.label}</span><span className="pane-sub">{selTile.list.length} {selTile.list.length === 1 ? 'client' : 'clients'}</span></div>
          <div className="metric-detail-list">
            {selTile.list.map(c => { const nba = nbaFor(c.id); return (
              <button key={c.id} className="md-row" onClick={() => onOpen(c.id)}>
                <Avatar repId={c.rep} size={26} ring />
                <div style={{ minWidth: 0, flex: 1 }}><div className="md-name">{c.name}{c.real && <span className="real-tag" style={{ marginLeft: 7 }}>Real order</span>}</div><div className="md-sub">{[c.building, c.city].filter(Boolean).join(' · ')}</div></div>
                <div className="md-right"><span className="md-val">${(c.value / 1000).toFixed(0)}k</span>{nba ? <span className="md-action">{nba.action}</span> : <span className="md-clear"><Icon name="check" size={12} />clear</span>}</div>
                <Icon name="arrow-right" size={15} style={{ color: 'var(--ink-3)' }} />
              </button>
            )})}
            {!selTile.list.length && <div className="md-empty">No clients in this group right now.</div>}
          </div>
        </div>
      ) : (
        <div className="risk-band">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Icon name="shield-alert" size={18} color="var(--storm-500)" /><div><div className="risk-title">{atRisk.length} job{atRisk.length !== 1 ? 's' : ''} at risk</div><div className="risk-sub">Long-stuck or critical orders — ${(riskVal / 1000).toFixed(0)}k of pipeline value</div></div></div>
          <div className="risk-clients">{atRisk.map(c => <button key={c.id} className="risk-chip" onClick={() => onOpen(c.id)}>{c.name}</button>)}</div>
        </div>
      )}
    </div>
  )
}

const ClientModal = ({ clientId, onClose, onComplete, onSnooze, onReschedule, onAct }) => {
  const { clientById, score, tasks } = useFuhq()
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    // The app's cursor-FX applies `cursor:none` globally and draws a custom
    // ring/dot at z-401 — BELOW this modal — so over the modal there's no visible
    // cursor. Disable the FX while the modal is open (it covers the screen anyway),
    // restore on close. This reliably brings the real, clickable cursor back.
    const el = document.documentElement
    const hadFx = el.classList.contains('cursor-fx-active')
    if (hadFx) el.classList.remove('cursor-fx-active')
    return () => { window.removeEventListener('keydown', onKey); if (hadFx) el.classList.add('cursor-fx-active') }
  }, [onClose])
  const c = clientById(clientId); if (!c) return null
  const lane = LANES.find(l => l.id === c.lane) || LANES[0]
  const mine = tasks.filter(t => t.client === clientId).slice().sort((a, b) => a.date.localeCompare(b.date))
  const open = mine.filter(t => !t.done)
  const nbaArr = open.map(t => ({ t, s: score(t) })).sort((a, b) => b.s - a.s)
  const nba = nbaArr[0]?.t, nbaScore = nbaArr[0]?.s || 0
  return createPortal(
    <div className="fuhq-overlay" onClick={onClose}>
      <div className="fuhq-dialog" onClick={e => e.stopPropagation()}>
        <div className="cm">
          <div className="cm-head">
            <div className="cm-head-pattern" />
            <img src="/seal.png" alt="" aria-hidden="true" className="cm-seal" />
            <div className="cm-head-inner">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <Stamp color="var(--teal-300)">{[c.mfr, c.model].filter(Boolean).join(' · ')} · ordered {fmtDate(c.ordered)}{c.real ? ' · REAL ORDER' : ''}</Stamp>
                  <h2 className="cm-name">{c.name}{c.vip && <Icon name="star" size={16} color="#C98A2B" style={{ marginLeft: 8 }} />}</h2>
                  <div className="cm-sub">
                    <span><Icon name="map-pin" size={13} />{[c.city, c.county].filter(Boolean).join(', ')}</span>
                    {c.phone && <span style={{ fontFamily: 'var(--font-mono)' }}>{c.phone}</span>}
                    <span className="cm-lane"><Icon name={lane.icon} size={12} color={lane.accent} />{lane.label}</span>
                  </div>
                </div>
                <button className="fuhq-iconbtn-dark" onClick={onClose}><Icon name="x" size={20} /></button>
              </div>
              <div className="cm-spec">
                {[['Building', c.building || '—'], ['Area', c.sqft || '—'], ['Rated', c.wind || '—'], ['Value', '$' + (c.value || 0).toLocaleString()]].map((s, i) => (
                  <div key={i} className="cm-spec-cell"><div className="cm-spec-l">{s[0]}</div><div className="cm-spec-v" style={{ fontFamily: i >= 2 ? 'var(--font-mono)' : 'var(--font-body)', color: i === 2 ? 'var(--teal-300)' : '#fff' }}>{s[1]}</div></div>
                ))}
              </div>
            </div>
          </div>
          {nba && (
            <div className="cm-nba">
              <div style={{ minWidth: 0 }}>
                <div className="cm-nba-label"><Icon name="zap" size={13} color="var(--accent)" />Next best action <PriorityPill score={nbaScore} /></div>
                <div className="cm-nba-action">{nba.action}</div>
                <div className="cm-nba-reason">{nba.reason}</div>
              </div>
              <div><QuickActions task={nba} onComplete={onComplete} onSnooze={onSnooze} onAct={onAct} /></div>
            </div>
          )}
          <div className="cm-section"><Stamp>Smart timeline</Stamp><div style={{ marginTop: 12 }}><MilestoneTrack current={c.milestone} /></div></div>
          <div className="cm-tasks">
            <Stamp>Follow-ups · {open.length} open</Stamp>
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {mine.map(t => {
                const od = daysOverdue(t.date) > 0 && !t.done
                return (
                  <div key={t.id} className={`cm-task ${t.done ? 'is-done' : ''}`}>
                    <CheckStamp done={t.done} onToggle={() => onComplete(t.id)} size={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <ChannelChip channel={t.channel} cat={t.cat} />
                        <input type="date" className="cm-task-datepick" value={t.date} title="Change this follow-up's date"
                          onClick={e => e.stopPropagation()} onChange={e => onReschedule(t.id, e.target.value)} />
                        <span className="cm-task-date" style={{ color: od ? 'var(--storm-500)' : 'var(--ink-3)' }}>{relativeLabel(t.date)}</span>
                        {!t.done && <PriorityPill score={score(t)} showScore={false} />}
                      </div>
                      <div className="cm-task-action">{t.action}</div>
                      <div className="cm-task-reason">{t.reason}</div>
                    </div>
                  </div>
                )
              })}
              {!mine.length && <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '14px 0' }}>No follow-ups yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* ---- main app shell + data ---- */
const ORDERED_STATUSES = ['ordered', 'deposit_paid', 'scheduled', 'installed', 'done']

// Grouped filter bar (ported from the updated prototype).
const FILTER_GROUPS = [
  { label: 'Quick', filters: [{ id: 'today', label: 'Today', test: (t) => t.date === TODAY }] },
  { label: 'Customer Actions', filters: [
    { id: 'calls', label: 'Calls Due', test: (t) => t.channel === 'call' },
    { id: 'emails', label: 'Emails Due', test: (t) => t.channel === 'email' },
    { id: 'custResp', label: 'Customer Response', test: (t, c) => c?.waitingOn === 'customer' },
  ] },
  { label: 'Waiting On', filters: [
    { id: 'wCustomer', label: 'Customer', test: (t, c) => c?.waitingOn === 'customer' },
    { id: 'wManufacturer', label: 'Manufacturer', test: (t, c) => c?.waitingOn === 'manufacturer' },
    { id: 'wEngineering', label: 'Engineering', test: (t, c) => c?.waitingOn === 'engineering' },
    { id: 'wPlans', label: 'Plans', test: (t, c) => c?.waitingOn === 'plans' },
    { id: 'wPermit', label: 'Permit', test: (t, c) => c?.waitingOn === 'permit' },
    { id: 'wScheduling', label: 'Scheduling', test: (t, c) => c?.waitingOn === 'scheduling' },
    { id: 'wInstall', label: 'Installation', test: (t, c) => c?.waitingOn === 'installation' },
  ] },
  { label: 'Needs Attention', filters: [
    { id: 'overdue', label: 'Overdue', test: (t) => daysOverdue(t.date) > 0 },
    { id: 'behind', label: 'Behind Schedule', test: (t, c) => c && daysStuck(c) > 30 },
    { id: 'noActivity', label: 'No Activity 7+', test: (t, c, ctx) => ctx.neglected.has(c?.id) },
    { id: 'review', label: 'Needs Review', test: (t, c) => c && daysStuck(c) > 90 },
  ] },
  { label: 'This Week', filters: [
    { id: 'installWeek', label: 'Install This Week', test: (t, c) => { if (!c?.installDate) return false; const d = daysBetween(c.installDate, TODAY); return d >= 0 && d <= 7 } },
    { id: 'warranty', label: 'Warranty', test: (t, c) => c?.milestone === 'complete' },
  ] },
]
const ALL_FILTERS = FILTER_GROUPS.flatMap(g => g.filters)

export default function FollowUpHQ() {
  const { users } = useUsers()
  const [crmClients, setCrmClients] = useState([])
  const [model, setModel] = useState({ clients: [], tasks: [] })
  const [view, setView] = useState('mission')
  const [ym, setYm] = useState([parseISO(TODAY).getFullYear(), parseISO(TODAY).getMonth()])
  const [repF, setRepF] = useState(new Set())
  const [filters, setFilters] = useState(new Set())
  const [modalId, setModalId] = useState(null)
  const [toast, setToast] = useState(null)
  const dragId = useRef(null)

  // Load CRM clients → CRM-shaped list (ordered leads drive the calendar).
  useEffect(() => {
    let cancelled = false
    async function load() {
      const [cRes, qRes] = await Promise.all([
        supabase.from('clients').select('*').order('updated_at', { ascending: false }),
        supabase.from('quotes').select('client_id,total_amount,quote_date'),
      ])
      if (cancelled || cRes.error) return
      const valueBy = {}
      for (const q of (qRes.data || [])) {
        const cur = valueBy[q.client_id]
        if (!cur || (q.quote_date || '') >= cur.d) valueBy[q.client_id] = { d: q.quote_date || '', v: q.total_amount || 0 }
      }
      const list = (cRes.data || [])
        .filter(c => !c.deleted_at && ORDERED_STATUSES.includes(c.status))
        .map(c => ({
          crmId: c.id, name: c.name, phone: c.phone || '', city: c.city || '', county: c.county || '',
          building: [c.building_size, c.building_type].filter(Boolean).join(' '),
          rep: c.primary_rep || null, value: valueBy[c.id]?.v || 0, stage: c.status,
          ordered: c.order_date || null, mfr: c.order_mfr || c.building_mfr || null, planKey: c.order_plan || null,
          bucket: c.order_bucket || null, foundation: c.order_foundation || null, permitting: c.order_permitting || null,
          exempt: !!c.order_exempt, siteReady: !!c.order_site_ready,
        }))
        .filter(c => c.ordered) // need an order date to build a timeline
      setCrmClients(list)
    }
    load()
    const ch = supabase.channel('fuhq-clients').on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, load).subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [])

  // Build the UI model whenever CRM data changes.
  useEffect(() => { setModel(buildModel(crmClients)) }, [crmClients])
  const rebuild = () => setModel(buildModel(crmClients))

  // Reps derived from the ordered clients' assigned reps.
  const reps = useMemo(() => {
    const seen = new Map()
    crmClients.forEach((c, i) => {
      const id = c.rep
      if (id && !seen.has(id)) {
        const name = userLabel(users, id)
        const nm = name && name !== '—' ? name : 'Rep'
        seen.set(id, { id, name: nm, initials: (nm.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('') || '?').toUpperCase(), color: REP_PALETTE[seen.size % REP_PALETTE.length] })
      }
    })
    return [...seen.values()]
  }, [crmClients, users])
  const repById = (id) => reps.find(r => r.id === id) || { id, name: 'Unassigned', initials: '–', color: '#5A6A7E' }

  const clientById = (id) => model.clients.find(c => c.id === id)
  const score = (task) => scoreTask(task, clientById(task.client)).score
  const ctx = { clients: model.clients, tasks: model.tasks, reps, repById, clientById, score }

  // "neglected" = active orders with no follow-up activity in the recent window.
  const neglected = useMemo(() => {
    const set = new Set()
    for (const c of model.clients) {
      if (c.milestone === 'complete') continue
      const active = model.tasks.some(t => { if (t.client !== c.id || t.done) return false; const d = daysBetween(t.date, TODAY); return d >= -30 && d <= 7 })
      if (!active) set.add(c.id)
    }
    return set
  }, [model])
  const filterCtx = { neglected }
  const filtered = useMemo(() => model.tasks.filter(task => {
    const c = clientById(task.client)
    if (repF.size && (!c || !repF.has(c.rep))) return false
    if (filters.size) for (const fid of filters) { const f = ALL_FILTERS.find(x => x.id === fid); if (f && !f.test(task, c, filterCtx)) return false }
    return true
  }), [model, repF, filters, neglected])

  // mutations (persist through the engine; rebuild re-derives lanes/milestones/spawns)
  const fireToast = (kind) => { const m = kind === 'email' ? 'Email draft opened' : 'Calling…'; setToast(m); setTimeout(() => setToast(x => x === m ? null : x), 1700) }
  const complete = (taskId) => { const t = model.tasks.find(x => x.id === taskId); if (!t) return; toggleFollowupForClient(t.client, taskId); rebuild() }
  const snooze = (taskId) => { const t = model.tasks.find(x => x.id === taskId); if (!t) return; setFollowupDate(taskId, toISO(new Date(parseISO(t.date).getTime() + 2 * 86400000))); rebuild() }
  const moveDate = (iso) => { if (dragId.current) { setFollowupDate(dragId.current, iso); dragId.current = null; rebuild() } }
  const reschedule = (taskId, iso) => { if (!iso) return; setFollowupDate(taskId, iso); rebuild() }
  const drag = { onDragStart: (e, id) => { dragId.current = id; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move' }, onDragEnd: () => { dragId.current = null }, onDropDay: moveDate }
  const toggleSet = (setter, val) => setter(s => { const n = new Set(s); n.has(val) ? n.delete(val) : n.add(val); return n })

  const overdueCount = model.tasks.filter(x => !x.done && daysOverdue(x.date) > 0).length

  // Export / import the calendar store (to share with design, back up, etc.).
  const exportData = () => {
    const blob = new Blob([exportStateJSON()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `StormSafe-FollowUpHQ-data-${TODAY}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url)
    fireToast('Calendar data exported')
  }
  const importData = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'
    inp.onchange = () => {
      const file = inp.files && inp.files[0]; if (!file) return
      const r = new FileReader()
      r.onload = () => {
        try {
          const s = JSON.parse(r.result)
          if (!s || !Array.isArray(s.followups) || !Array.isArray(s.clients)) throw new Error('bad')
          if (!window.confirm(`Replace the calendar with the imported file? (${s.clients.length} clients, ${s.followups.length} follow-ups)`)) return
          importStateJSON(r.result); rebuild(); fireToast('Calendar imported')
        } catch { fireToast('That file isn’t a valid calendar export') }
      }
      r.readAsText(file)
    }
    inp.click()
  }

  return (
    <Ctx.Provider value={ctx}>
      <div className="fuhq">
        <header className="fuhq-topbar">
          <div className="fuhq-brand">
            <img className="brand-seal" src="/seal.png" alt="StormSafe Steel" width="40" height="40" />
            <div><div className="fuhq-bname">STORMSAFE STEEL</div><div className="fuhq-bsub">Follow-Up HQ</div></div>
          </div>
          <nav className="tabs">
            {[['mission', 'Overview', 'target'], ['pipeline', 'Pipeline', 'columns-3'], ['metrics', 'Metrics', 'bar-chart-3']].map(([id, lbl, ic]) => (
              <button key={id} onClick={() => setView(id)} className={`tab ${view === id ? 'is-active' : ''}`}><Icon name={ic} size={16} />{lbl}{id === 'mission' && overdueCount > 0 && <span className="tab-badge">{overdueCount}</span>}</button>
            ))}
          </nav>
          <div className="topbar-right">
            <span className="pane-sub">{model.clients.length} active order{model.clients.length !== 1 ? 's' : ''}</span>
            <button className="ghost-btn" onClick={exportData} title="Download all calendar data as JSON to share">Export</button>
            <button className="ghost-btn" onClick={importData} title="Load calendar data from a JSON file (replaces current)">Import</button>
          </div>
        </header>

        <div className="filterbar">
          <div className="filter-group">
            <span className="filter-label"><Icon name="users" size={13} />Crew</span>
            <div className="avatar-row">
              <button onClick={() => setRepF(new Set())} className={`rep-all ${repF.size === 0 ? 'is-on' : ''}`}>All reps</button>
              {reps.map(r => (
                <button key={r.id} onClick={() => toggleSet(setRepF, r.id)} title={r.name} className={`avatar-toggle ${repF.size && !repF.has(r.id) ? 'is-dim' : ''} ${repF.has(r.id) ? 'is-on' : ''}`} style={{ '--rc': r.color }}><Avatar repId={r.id} size={28} /></button>
              ))}
            </div>
          </div>
          <div className="filter-divider" />
          <div className="filter-group filter-scroll">
            <span className="filter-label"><Icon name="filter" size={13} />Filter</span>
            <div className="chip-row">
              {FILTER_GROUPS.map((g, gi) => (
                <Fragment key={g.label}>
                  {gi > 0 && <span className="filter-sep" />}
                  <span className="filter-grouplbl">{g.label}</span>
                  {g.filters.map(f => <button key={f.id} onClick={() => toggleSet(setFilters, f.id)} className="filter-chip" data-on={filters.has(f.id) ? '1' : '0'}>{f.label}</button>)}
                </Fragment>
              ))}
            </div>
          </div>
          <div className="filter-right">{(repF.size || filters.size) ? <button className="clear-btn" onClick={() => { setRepF(new Set()); setFilters(new Set()) }}><Icon name="x" size={13} />Clear</button> : null}</div>
        </div>

        <main className="fuhq-main">
          <div key={view} className="view-anim">
            {view === 'mission' && <MissionView tasks={filtered} year={ym[0]} month={ym[1]} setYM={setYm} onComplete={complete} onSnooze={snooze} onOpen={setModalId} drag={drag} />}
            {view === 'pipeline' && <PipelineView tasks={filtered} onOpen={setModalId} />}
            {view === 'metrics' && <MetricsView tasks={filtered} onOpen={setModalId} />}
          </div>
        </main>

        {modalId && <ClientModal clientId={modalId} onClose={() => setModalId(null)} onComplete={complete} onSnooze={snooze} onReschedule={reschedule} onAct={fireToast} />}
        {toast && <div className="fuhq-toast"><Icon name="check" size={14} />{toast}</div>}
      </div>
    </Ctx.Provider>
  )
}
