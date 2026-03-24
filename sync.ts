/**
 * sync.ts — copy built scripts to ~/.nous/ and ensure native dependencies are installed
 */

import { cpSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = join(__dirname, 'plugin', 'scripts')
const dataDir = process.env.NOUS_DATA_DIR ?? join(homedir(), '.nous')
const destDir = join(dataDir, 'scripts')

if (!existsSync(srcDir)) {
  console.error('[sync] plugin/scripts/ not found — run build first')
  process.exit(1)
}

// Copy built scripts
mkdirSync(destDir, { recursive: true })
cpSync(srcDir, destDir, { recursive: true })
console.log(`[sync] scripts copied to ${destDir}`)

// Ensure better-sqlite3 is installed in the data directory.
// It is marked external in the build so the CJS bundles require() it at runtime.
const pkgPath = join(dataDir, 'package.json')
if (!existsSync(pkgPath)) {
  writeFileSync(pkgPath, JSON.stringify({ name: 'nous-runtime', private: true }, null, 2))
}

const nmPath = join(dataDir, 'node_modules', 'better-sqlite3')
if (!existsSync(nmPath)) {
  console.log('[sync] installing better-sqlite3 (native dependency)...')
  execSync('npm install better-sqlite3 --save --no-audit --no-fund', {
    cwd: dataDir,
    stdio: 'inherit',
  })
  console.log('[sync] better-sqlite3 installed')
} else {
  console.log('[sync] better-sqlite3 already installed, skipping')
}
