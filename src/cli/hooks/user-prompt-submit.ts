export {}

/**
 * user-prompt-submit hook
 *
 * 1. Forward the event to the worker for user model updates.
 * 2. Fetch topic-relevant context based on the user's message and write it
 *    to stdout so Claude Code appends it to the system prompt.
 */

const WORKER_URL = `http://127.0.0.1:${process.env.NOUS_PORT ?? '37888'}`

async function main(): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer)
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim()

  if (!raw) process.exit(0)

  let hookData: Record<string, unknown>
  try {
    hookData = JSON.parse(raw) as Record<string, unknown>
  } catch {
    process.exit(0)
  }

  // 1. Forward event to worker (fire-and-forget style)
  fetch(`${WORKER_URL}/api/hook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(hookData),
    signal: AbortSignal.timeout(2000),
  }).catch(() => {/* worker unavailable */})

  // 2. Fetch prompt-aware context injection
  try {
    const resp = await fetch(`${WORKER_URL}/api/prompt-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: hookData['message'] ?? '',
        project_path: hookData['cwd'] ?? '',
      }),
      signal: AbortSignal.timeout(3000),
    })

    if (resp.ok) {
      const json = await resp.json() as { context?: string }
      if (json.context) {
        process.stdout.write(json.context)
      }
    }
  } catch {
    // Worker unavailable — proceed without additional context
  }

  process.exit(0)
}

main().catch(() => process.exit(0))
