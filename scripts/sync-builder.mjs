// Sync the standalone 3D configurator's production build into the CRM so the
// /build tab serves the latest. The configurator stays its own app (GitHub +
// Cloudflare + Electron); this just rebuilds it and copies its dist into
// public/build/. Run from the CRM root:  npm run sync:builder
//
// Override the configurator location with CONFIGURATOR_DIR if it ever moves.
import { execSync } from 'node:child_process'
import { cpSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const crmRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cfgDir =
  process.env.CONFIGURATOR_DIR ||
  resolve(crmRoot, '..', '3D Builder', 'configurator')

if (!existsSync(cfgDir)) {
  console.error(`Configurator not found at:\n  ${cfgDir}\nSet CONFIGURATOR_DIR to its path and retry.`)
  process.exit(1)
}

console.log(`▸ Building configurator at ${cfgDir} …`)
execSync('npm run build', { cwd: cfgDir, stdio: 'inherit' })

const from = resolve(cfgDir, 'dist')
const to = resolve(crmRoot, 'public', 'build')
console.log(`▸ Copying ${from}\n       → ${to}`)
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
console.log('✓ Builder synced into public/build. Reload the CRM /build tab.')
