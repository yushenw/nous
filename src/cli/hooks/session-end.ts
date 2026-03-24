export {}

/**
 * session-end hook
 * Forwards both Stop and SessionEnd events to the nous worker.
 * The worker triggers session summary generation and knowledge distillation.
 * Runs silently (no stdout output).
 */

const WORKER_URL = `http://127.0.0.1:${process.env.NOUS_PORT ?? '37888'}`

async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()

  if (!raw) {
    process.exit(0)
  }

  let hookData: unknown
  try {
    hookData = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  try {
    await fetch(`${WORKER_URL}/api/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(hookData),
      signal: AbortSignal.timeout(3000),
    })
  } catch {
    // Worker unavailable — silently skip
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
