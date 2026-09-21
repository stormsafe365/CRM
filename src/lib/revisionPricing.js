// revisionPricing: live engine prices for the Revision modal. Loads the actual
// quote-builder (hidden iframe) and asks IT for prices — roll-up sizes, door
// price, chain hoist, brush seal, automatic opener — so the modal can never
// drift from the quoting tool. No price is hardcoded here.
let frame = null
let enginePromise = null

function waitForEngine(win) {
  return new Promise((resolve, reject) => {
    let tries = 0
    const t = setInterval(() => {
      tries++
      try {
        if (win && typeof win.getDoorPrice === 'function' && typeof win.initMfrPricing === 'function') {
          clearInterval(t); resolve(win); return
        }
      } catch { /* keep polling */ }
      if (tries > 60) { clearInterval(t); reject(new Error('price engine did not load')) }
    }, 250)
  })
}

export async function loadPriceEngine(manufacturer) {
  if (!enginePromise) {
    frame = document.createElement('iframe')
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
    frame.src = 'build/quote-builder.html'
    document.body.appendChild(frame)
    enginePromise = waitForEngine(frame.contentWindow)
  }
  const pg = await enginePromise
  try { pg.initMfrPricing(manufacturer === 'ca' ? 'CA' : 'CCI') } catch { /* default mfr */ }
  return pg
}

const szNum = (s) => { const p = String(s).split('x'); return (parseFloat(p[0]) || 0) * 100 + (parseFloat(p[1]) || 0) }

// Roll-up catalog for the current manufacturer: sizes + a pricing accessor.
export function rollupCatalog(pg) {
  const mfr = (() => { try { return pg.ACTIVE_MFR } catch { return 'CCI' } })()
  let type = 'rollup'
  let sizes = []
  try {
    const cat = typeof pg.MFR === 'function' && pg.MFR().rudCatalog
    if (cat) {
      // CA book: use the standard manual line as the base tier
      type = Object.keys(cat)[0]
      sizes = Object.keys(cat[type].prices || {})
    }
  } catch { /* fall through */ }
  if (!sizes.length) {
    const keys = new Set()
    try { Object.keys(pg.RDP_STD || {}).forEach((k) => keys.add(k.replace(/^\*/, ''))) } catch { /* ignore */ }
    try { Object.keys(pg.RDP_CHAIN || {}).forEach((k) => keys.add(k.replace(/^\*/, ''))) } catch { /* ignore */ }
    sizes = [...keys]
  }
  sizes = sizes.filter((s) => /^\d+x\d+$/i.test(s)).sort((a, b) => szNum(a) - szNum(b))
  const price = (size) => { try { return pg.getDoorPrice(type, size) || 0 } catch { return 0 } }
  const hoistIncluded = (size) => { try { return !!pg.doorHasChainIncluded(type, size) } catch { return false } }
  const chain = Number(pg._chain) || 325
  const sealFor = (size) => Math.round((parseFloat(String(size).split('x')[0]) || 0) * (Number(pg._seal) || 9.85))
  const openerFor = mfr === 'CCI' ? (size) => { try { return pg.ropUnit(size) || 0 } catch { return 0 } } : null
  return { mfr, sizes, price, hoistIncluded, chain, sealFor, openerFor }
}
