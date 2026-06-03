// uiFx.js — framework-agnostic UI flourishes ported from the design mockup
// (layout.js + app.js): the cursor ring/dot, toasts, and popover menus.
// The CSS for these already lives in the design skin layer
// (.cursor-ring / .cursor-dot / .toast / .menu). These attach to document.body
// so they work the same way the vanilla mockup does.

/* ---------------- cursor FX (ring + dot) ---------------- */
let cursorMounted = false
export function mountCursorFx() {
  if (cursorMounted || typeof window === 'undefined') return
  if (window.matchMedia && (matchMedia('(hover: none)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches)) return
  cursorMounted = true
  const ring = document.createElement('div'); ring.className = 'cursor-ring'
  const dot = document.createElement('div'); dot.className = 'cursor-dot'
  document.body.appendChild(ring); document.body.appendChild(dot)
  document.documentElement.classList.add('cursor-fx-active')
  let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my, on = false
  const HOT = 'a,button,.nav-item,.chip,.doc-cat,.note,.spread-card,.stack-card,.q-row,.seg button,.notes-tab,.icon-btn,.menu-item,input,select,textarea,.kpi-card,.lead-row,.step,.temp-track,.temp-knob,.list-tab,.qd-card,.qd-nav,.qd-toggle button,[role="button"]'
  addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY
    if (!on) { on = true; ring.classList.add('on'); dot.classList.add('on') }
    const hot = !!(e.target.closest && e.target.closest(HOT))
    ring.classList.toggle('hot', hot); dot.classList.toggle('hot', hot)
  }, { passive: true })
  addEventListener('mouseleave', () => { on = false; ring.classList.remove('on'); dot.classList.remove('on') })
  addEventListener('mousedown', () => ring.classList.add('press'))
  addEventListener('mouseup', () => ring.classList.remove('press'))
  ;(function tick() {
    rx += (mx - rx) * 0.32; ry += (my - ry) * 0.32
    ring.style.transform = `translate(${rx}px,${ry}px)`
    dot.style.transform = `translate(${mx}px,${my}px)`
    requestAnimationFrame(tick)
  })()
}

/* ---------------- toast ---------------- */
const I_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>'
const I_CLOUD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16l-4-4-4 4M12 12v9"></path><path d="M20.4 14.9A5 5 0 0 0 18 5.5a6.5 6.5 0 0 0-12.3 2A4.5 4.5 0 0 0 6 16h1"></path></svg>'

export function toast(msg, kind) {
  let wrap = document.getElementById('ssToastWrap')
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; wrap.id = 'ssToastWrap'; document.body.appendChild(wrap) }
  const t = document.createElement('div')
  t.className = 'toast ' + (kind || '')
  t.innerHTML = (kind === 'success' ? I_CHECK : I_CLOUD) + '<span>' + msg + '</span>'
  wrap.appendChild(t)
  requestAnimationFrame(() => t.classList.add('show'))
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250) }, 2600)
}

/* ---------------- popover menu ---------------- */
let activeMenu = null
function closeMenu() {
  if (!activeMenu) return
  const m = activeMenu; activeMenu = null
  m.classList.remove('open')
  setTimeout(() => { if (m.parentNode) m.remove() }, 160)
}
export function openMenu(anchor, title, items) {
  closeMenu()
  const m = document.createElement('div')
  m.className = 'menu'
  let html = title ? `<div class="menu-title">${title}</div>` : ''
  items.forEach((it) => {
    if (it.sep) { html += '<div class="menu-sep"></div>'; return }
    html += `<div class="menu-item${it.cls ? ' ' + it.cls : ''}" data-act="${it.id}">${it.icon || ''}<span>${it.label}</span></div>`
  })
  m.innerHTML = html
  document.body.appendChild(m)
  const r = anchor.getBoundingClientRect()
  const mw = m.offsetWidth, mh = m.offsetHeight
  let left = r.left, top = r.bottom + 6
  if (left + mw > innerWidth - 12) left = r.right - mw
  if (top + mh > innerHeight - 12) top = r.top - mh - 6
  m.style.left = Math.max(12, left) + 'px'
  m.style.top = Math.max(12, top) + 'px'
  requestAnimationFrame(() => m.classList.add('open'))
  activeMenu = m
  m.addEventListener('click', (e) => {
    const item = e.target.closest('.menu-item')
    if (!item) return
    const found = items.find((x) => x.id === item.dataset.act)
    closeMenu()
    if (found && found.onClick) found.onClick()
  })
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (activeMenu && !e.target.closest('.menu') && !e.target.closest('[data-menu-anchor]')) closeMenu()
  })
  addEventListener('resize', closeMenu)
}

/* svg icon strings for menu items */
export const MENU_ICON = {
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M17 8l-5-5-5 5M12 3v12"></path></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path></svg>',
}
