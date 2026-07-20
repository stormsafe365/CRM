// Build the 2D layout / Approval Sheet builder from `layout-src/` into `public/layout/`.
//
// The design handoff ships as browser-Babel JSX loaded from a CDN. For the CRM we
// pre-compile the JSX with esbuild (no Babel at runtime) and vendor React locally,
// so the tool loads fast and works OFFLINE inside the packaged Electron app.
//
// To take a new design drop: replace the files in `layout-src/`, keep the
// `window.SS_LAYOUT` bridge block in app.jsx, then run `npm run build:layout`.

import { build } from 'esbuild'
import { cpSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'layout-src')
const out = join(root, 'public', 'layout')

if (!existsSync(src)) {
  console.error(`layout-src not found at ${src}`)
  process.exit(1)
}
mkdirSync(out, { recursive: true })

// Load order matters — each file attaches its exports to `window`.
const FILES = ['tweaks-panel', 'PlanDiagram', 'Elevation', 'Schedule', 'Editor', 'Sheet', 'app']
for (const f of FILES) {
  await build({
    entryPoints: [join(src, `${f}.jsx`)],
    outfile: join(out, `${f}.js`),
    logLevel: 'error',
  })
}

copyFileSync(join(src, 'data.js'), join(out, 'data.js'))
copyFileSync(join(src, 'styles.css'), join(out, 'styles.css'))
cpSync(join(src, 'assets'), join(out, 'assets'), { recursive: true })

// Vendor React 18 (production UMD) so there's no CDN dependency.
mkdirSync(join(out, 'vendor'), { recursive: true })
copyFileSync(join(root, 'node_modules/react/umd/react.production.min.js'), join(out, 'vendor/react.production.min.js'))
copyFileSync(join(root, 'node_modules/react-dom/umd/react-dom.production.min.js'), join(out, 'vendor/react-dom.production.min.js'))

console.log(`✓ 2D layout builder compiled → ${out}`)
