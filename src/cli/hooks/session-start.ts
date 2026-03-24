export {}

/**
 * session-start hook
 *
 * Ensures the worker is running, then fetches injection context and writes
 * it to stdout so Claude Code prepends it to the session's system prompt.
 *
 * Worker auto-start: if the worker is not responding, this hook spawns it
 * as a detached background process and waits up to 5 seconds for readiness.
 * This means the user never needs to start the worker manually.
 */

import { spawn } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'

const PORT = process.env.NOUS_PORT ?? '37888'
const WORKER_URL = `http://127.0.0.1:${PORT}`
const DATA_DIR = process.env.NOUS_DATA_DIR ?? join(homedir(), '.nous')
const WORKER_SCRIPT = join(DATA_DIR, 'scripts', 'worker-service.cjs')
const LOG_FILE = join(DATA_DIR, 'worker.log')

/** Returns true if the worker is up and ready. */
async function isWorkerReady(): Promise<boolean> {
  try {
    const resp = await fetch(`${WORKER_URL}/api/readiness`, {
      signal: AbortSignal.timeout(1000),
    })
    if (!resp.ok) return false
    const json = await resp.json() as { ready?: boolean }
    return json.ready === true
  } catch {
    return false
  }
}

/** Spawn the worker as a fully detached background process. */
function spawnWorker(): void {
  const { openSync } = require('fs') as typeof import('fs')
  const logFd = openSync(LOG_FILE, 'a')
  const child = spawn(process.execPath, [WORKER_SCRIPT], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, NOUS_PORT: PORT, NOUS_DATA_DIR: DATA_DIR },
  })
  child.unref()
}

/**
 * Ensure worker is running. Spawns it if needed and waits for readiness.
 * Returns true if the worker became ready within the timeout.
 */
async function ensureWorker(): Promise<boolean> {
  if (await isWorkerReady()) return true

  spawnWorker()

  // Poll for readiness up to 5 seconds
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 300))
    if (await isWorkerReady()) return true
  }
  return false
}

async function main(): Promise<void> {
  // Read stdin
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()
  if (!raw) process.exit(0)

  let hookData: unknown
  try {
    hookData = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  // 1. Ensure worker is running (auto-start if needed)
  const ready = await ensureWorker()
  if (!ready) process.exit(0)

  // 2. Notify worker about session start
  try {
    await fetch(`${WORKER_URL}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hookData),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Non-fatal
  }

  // 3. Fetch injection context and write to stdout
  try {
    const resp = await fetch(`${WORKER_URL}/api/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hookData),
      signal: AbortSignal.timeout(5000),
    })
    if (resp.ok) {
      const json = await resp.json() as { context?: string }
      if (json.context) process.stdout.write(json.context)
    }
  } catch {
    // Worker unavailable — proceed without context
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
