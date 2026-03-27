import express from 'express'
import { Database } from '../storage/database.js'
import { ClaudeCodeAdapter } from '../adapters/claude-code/adapter.js'
import { EventProcessor } from './event-processor.js'
import { RecallTool } from '../injection/recall-tool.js'
import { ContextBuilder } from '../injection/context-builder.js'
import { config } from '../config.js'
import type { HostEvent } from '../types/index.js'

// Initialize database eagerly so readiness check is accurate
let dbReady = false
try {
  Database.getInstance()
  dbReady = true
} catch (err) {
  console.error('[nous] database initialization failed:', err)
}

const app = express()
app.use(express.json({ limit: '2mb' }))

const adapter = new ClaudeCodeAdapter()
const processor = new EventProcessor()
const recallTool = new RecallTool()
const contextBuilder = new ContextBuilder()

// ---------------------------------------------------------------------------
// Health & readiness
// ---------------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/readiness', (_req, res) => {
  if (dbReady) {
    res.json({ ready: true })
  } else {
    res.status(503).json({ ready: false, reason: 'database not initialized' })
  }
})

// ---------------------------------------------------------------------------
// Hook receiver
// ---------------------------------------------------------------------------

app.post('/api/hook', (req, res) => {
  if (!dbReady) {
    res.status(503).json({ error: 'not ready' })
    return
  }

  const rawEvent = req.body as unknown

  // Allow either a pre-normalized HostEvent or a raw Claude Code hook payload
  let event: HostEvent | null = null

  // Check if it already looks like a HostEvent (has .type and .payload)
  if (
    rawEvent &&
    typeof rawEvent === 'object' &&
    'type' in (rawEvent as object) &&
    'payload' in (rawEvent as object)
  ) {
    event = rawEvent as HostEvent
  } else {
    event = adapter.translateEvent(rawEvent)
  }

  if (!event) {
    res.status(400).json({ error: 'unrecognized event format' })
    return
  }

  try {
    switch (event.type) {
      case 'session_start':
        processor.processSessionStart(event)
        break
      case 'user_message':
        processor.processUserMessage(event)
        break
      case 'tool_use':
        processor.processToolUse(event)
        break
      case 'stop':
        processor.processStop(event)
        break
      case 'session_end':
        processor.processSessionEnd(event)
        break
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[nous] hook processing error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// Context endpoint (called by session-start hook, returns injection string)
// ---------------------------------------------------------------------------

app.post('/api/context', async (req, res) => {
  if (!dbReady) {
    res.status(503).json({ error: 'not ready' })
    return
  }

  const rawEvent = req.body as unknown
  let event: HostEvent | null = adapter.translateEvent(rawEvent)

  if (!event) {
    // Try treating it as a plain object with projectPath
    const body = rawEvent as Record<string, unknown>
    if (body.projectPath && typeof body.projectPath === 'string') {
      event = {
        type: 'session_start',
        sessionId: (body.sessionId as string) ?? 'unknown',
        projectPath: body.projectPath,
        timestamp: Date.now(),
        payload: { type: 'session_start' },
        hostMeta: {},
      }
    }
  }

  if (!event) {
    res.status(400).json({ error: 'invalid request' })
    return
  }

  try {
    const context = await adapter.buildInjectionContext(event)
    res.json({ context: context ?? '' })
  } catch (err) {
    console.error('[nous] context build error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// Recall endpoint (for MCP recall() tool)
// ---------------------------------------------------------------------------

app.get('/api/recall', (req, res) => {
  if (!dbReady) {
    res.status(503).json({ error: 'not ready' })
    return
  }

  const query = (req.query.q as string) ?? ''
  const projectPath = req.query.project as string | undefined

  if (!query.trim()) {
    res.status(400).json({ error: 'q parameter required' })
    return
  }

  try {
    const result = recallTool.recall(query, projectPath)
    res.json(result)
  } catch (err) {
    console.error('[nous] recall error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// Resume endpoint
// ---------------------------------------------------------------------------

app.get('/api/resume', (req, res) => {
  if (!dbReady) { res.status(503).json({ error: 'not ready' }); return }
  const topic = req.query.topic as string | undefined
  const projectPath = req.query.project as string | undefined
  try {
    const result = recallTool.resume(topic, projectPath)
    res.json(result)
  } catch (err) {
    console.error('[nous] resume error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// Topics endpoint
// ---------------------------------------------------------------------------

app.get('/api/topics', (req, res) => {
  if (!dbReady) { res.status(503).json({ error: 'not ready' }); return }
  const projectPath = req.query.project as string | undefined
  try {
    const result = recallTool.topics(projectPath)
    res.json(result)
  } catch (err) {
    console.error('[nous] topics error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// Prompt context endpoint — called by user-prompt-submit hook
// ---------------------------------------------------------------------------

app.post('/api/prompt-context', (req, res) => {
  if (!dbReady) { res.status(503).json({ error: 'not ready' }); return }

  const body = req.body as { message?: string; project_path?: string }
  const message = body.message ?? ''
  const projectPath = body.project_path ?? ''

  try {
    const context = contextBuilder.buildPromptContext(message, projectPath)
    res.json({ context: context ?? '' })
  } catch (err) {
    console.error('[nous] prompt-context error:', err)
    res.status(500).json({ error: 'internal error' })
  }
})

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[nous] worker listening on http://127.0.0.1:${config.port}`)
})
