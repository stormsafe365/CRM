// Sync the standalone 3D configurator's production build into the CRM.
//
// IMPORTANT: the CRM Electron app serves its BUILT `dist/` (via an internal
// static server), NOT `public/`. And the packaged app under `release/` serves a
// baked-in copy of `dist/`. So copying into public/build is not enough — the CRM
// must be rebuilt and the packaged resources refreshed. This script does the full
// chain so a single `npm run sync:builder` propagates everywhere:
//
//   1. build the configurator
//   2. copy its dist → CRM public/build          (dev server / source of truth)
//   3. npm run build (CRM)                        (public → dist, what Electron serves)
//   4. refresh release/.../resources/app/{dist,public}  (the packaged desktop CRM)
//
// After running, FULLY QUIT and relaunch the CRM app to pick it up.
// Override the configurator location with CONFIGURATOR_DIR if it moves.
import { execSync } from 'node:child_process'
import { cpSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const crmRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cfgDir =
  process.env.CONFIGURATOR_DIR ||
  resolve(crmRoot, '..', '3D Builder', 'configurator')

if (!existsSync(cfgDir)) {
  console.error(`Configurator not found at:\n  ${cfgDir}\nSet CONFIGURATOR_DIR to its path and retry.`)
  process.exit(1)
}

// 1. Build the configurator
console.log(`▸ Building configurator at ${cfgDir} …`)
execSync('npm run build', { cwd: cfgDir, stdio: 'inherit' })

// 2. Copy its dist → CRM public/build
const from = resolve(cfgDir, 'dist')
const pubBuild = resolve(crmRoot, 'public', 'build')
console.log(`▸ Copying ${from}\n       → ${pubBuild}`)
rmSync(pubBuild, { recursive: true, force: true })
cpSync(from, pubBuild, { recursive: true })

// 3. Rebuild the CRM so public/ → dist/ (what the Electron app actually serves)
console.log('▸ Rebuilding the CRM (public → dist) …')
execSync('npm run build', { cwd: crmRoot, stdio: 'inherit' })

// 4. Refresh the packaged desktop CRM's baked-in resources (if a release exists)
const releaseDir = resolve(crmRoot, 'release')
if (existsSync(releaseDir)) {
  for (const entry of readdirSync(releaseDir)) {
    const appDir = join(releaseDir, entry, 'resources', 'app')
    if (!existsSync(join(appDir, 'dist'))) continue
    console.log(`▸ Refreshing packaged app: ${appDir}`)
    for (const sub of ['dist', 'public']) {
      const src = resolve(crmRoot, sub)
      const dst = join(appDir, sub)
      if (existsSync(src)) { rmSync(dst, { recursive: true, force: true }); cpSync(src, dst, { recursive: true }) }
    }
  }
}

console.log('✓ Builder synced everywhere. FULLY QUIT and relaunch the CRM app to see it.')
