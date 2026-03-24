/**
 * build.ts — esbuild bundler script
 * Bundles all entry points into CommonJS for Node.js compatibility.
 * Output goes to plugin/scripts/ for deployment into ~/.nous/scripts/
 */

import { build, type BuildOptions } from 'esbuild'
import { mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, 'plugin', 'scripts')

mkdirSync(outDir, { recursive: true })

const commonOptions: BuildOptions = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  // better-sqlite3 is a native addon — mark it external
  external: ['better-sqlite3'],
  minify: false,
  sourcemap: false,
}

const entryPoints: Array<{ in: string; out: string }> = [
  {
    in: join(__dirname, 'src', 'worker', 'server.ts'),
    out: join(outDir, 'worker-service.cjs'),
  },
  {
    in: join(__dirname, 'src', 'cli', 'hooks', 'session-start.ts'),
    out: join(outDir, 'session-start.cjs'),
  },
  {
    in: join(__dirname, 'src', 'cli', 'hooks', 'user-prompt-submit.ts'),
    out: join(outDir, 'user-prompt-submit.cjs'),
  },
  {
    in: join(__dirname, 'src', 'cli', 'hooks', 'post-tool-use.ts'),
    out: join(outDir, 'post-tool-use.cjs'),
  },
  {
    in: join(__dirname, 'src', 'cli', 'hooks', 'session-end.ts'),
    out: join(outDir, 'session-end.cjs'),
  },
  {
    in: join(__dirname, 'src', 'mcp', 'server.ts'),
    out: join(outDir, 'mcp-server.cjs'),
  },
]

console.log('[build] bundling entries...')

for (const entry of entryPoints) {
  const outFile = entry.out
  await build({
    ...commonOptions,
    entryPoints: [entry.in],
    outfile: outFile,
  })
  console.log(`[build] -> ${outFile.replace(__dirname, '.')}`)
}

console.log('[build] done.')
