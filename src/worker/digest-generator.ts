import { ClaudeProvider } from '../provider/claude.js'
import { aggregateTopics, buildPathBlocklist } from '../analyzer/topic-extractor.js'
import { classifySession } from '../analyzer/session-classifier.js'
import { config } from '../config.js'
import type { OperationSketch, SessionDigest, SessionMode } from '../types/index.js'

// Maximum number of sketch entries to include in the prompt
const MAX_SKETCH_ENTRIES = 40

/**
 * Render an OperationSketch as a compact human-readable line.
 * Used to build the operation log section of the digest prompt.
 */
function renderSketch(sketch: OperationSketch): string {
  const d = sketch.descriptor
  const tool = sketch.toolName.padEnd(10)

  if (d.path) {
    const range = d.lineRange ? `:${d.lineRange[0]}-${d.lineRange[1]}` : ''
    const change = d.changeType ? ` (${d.changeType}${d.linesChanged ? ` ~${d.linesChanged}L` : ''})` : ''
    const flag = d.isNewFile ? ' [new]' : d.failed ? ' [failed]' : ''
    return `${tool} ${d.path}${range}${change}${flag}`
  }
  if (d.commandPrefix) {
    const status = d.exitCode !== undefined ? ` → exit ${d.exitCode}` : ''
    const fail = d.failed ? ' [FAIL]' : ''
    return `${tool} ${d.commandPrefix}${status}${fail}`
  }
  if (d.query) {
    return `${tool} "${d.query}"`
  }
  if (d.domain) {
    return `${tool} ${d.domain}${d.urlPath ?? ''}`
  }
  return tool.trim()
}

/**
 * Build the digest prompt from operation sketches and user prompt.
 * Keeps token cost low by sampling sketches when the log is long.
 */
function buildPrompt(
  sketches: OperationSketch[],
  userPrompt: string,
  preClassifiedMode: SessionMode,
  preClassifiedTopics: string[],
): string {
  // Sample evenly if log is long
  const sampled = sketches.length <= MAX_SKETCH_ENTRIES
    ? sketches
    : sampleEvenly(sketches, MAX_SKETCH_ENTRIES)

  const logLines = sampled.map(renderSketch).join('\n')

  return `Summarize this AI session in one sentence and classify it.

User's opening message: ${userPrompt || '(not recorded)'}

Operation log (${sketches.length} total, showing ${sampled.length}):
${logLines}

Pre-classified mode: ${preClassifiedMode}
Pre-classified topics: ${preClassifiedTopics.join(', ') || 'none'}

Respond with JSON only, no markdown fences:
{
  "summary": "one sentence describing what the user did/learned/built",
  "mode": "${['qa', 'learning', 'building', 'debugging', 'research', 'mixed'].join('|')}",
  "domain": "the technical domain: web-frontend|web-backend|systems|ml|data|devops|tooling|mobile|general",
  "topics": ["topic1", "topic2"],
  "outcome": "resolved|abandoned|ongoing",
  "notable": "optional: a recurring pattern or blind spot worth remembering, or null"
}`
}

function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)])
}

export class DigestGenerator {
  private ai = new ClaudeProvider(config.model)

  /**
   * Generate a SessionDigest from the operation log of a completed session.
   * Returns null if there is nothing meaningful to summarize.
   */
  async generate(
    sessionId: string,
    projectPath: string,
    sketches: OperationSketch[],
    userPrompt: string,
  ): Promise<Omit<SessionDigest, 'id'> | null> {
    if (sketches.length === 0 && !userPrompt) return null

    // Use rule-based classification as fallback / hint for AI
    const preMode = classifySession(sketches)
    const preTopics = aggregateTopics(sketches, 8, projectPath)

    const prompt = buildPrompt(sketches, userPrompt, preMode, preTopics)

    let raw: string
    try {
      raw = await this.ai.complete(prompt)
    } catch {
      // AI unavailable — fall back to rule-based digest, no notable
      return {
        sessionId,
        projectPath,
        summary: userPrompt ? `Session: ${userPrompt.slice(0, 120)}` : 'Session completed',
        mode: preMode,
        topics: preTopics,
        outcome: 'ongoing',
        domain: undefined,
        createdAt: Date.now(),
      }
    }

    // Parse JSON — strip markdown fences if present
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>
    } catch {
      return null
    }

    const aiTopics = Array.isArray(parsed.topics)
      ? (parsed.topics as unknown[]).filter((t): t is string => typeof t === 'string')
      : preTopics

    // Merge AI topics with rule-based ones (AI is authoritative, rules fill gaps)
    // Filter out path components that the AI may have included (e.g. "home", "liaix", "pjs")
    const pathBlocklist = buildPathBlocklist(projectPath)
    const mergedTopics = [...new Set([...aiTopics, ...preTopics])]
      .filter(t => !pathBlocklist.has(t))
      .slice(0, 10)

    return {
      sessionId,
      projectPath,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      mode: isSessionMode(parsed.mode) ? parsed.mode : preMode,
      topics: mergedTopics,
      outcome: isOutcome(parsed.outcome) ? parsed.outcome : 'ongoing',
      notable: typeof parsed.notable === 'string' && parsed.notable !== 'null'
        ? parsed.notable
        : undefined,
      domain: typeof parsed.domain === 'string' ? parsed.domain : undefined,
      createdAt: Date.now(),
    }
  }
}

function isSessionMode(v: unknown): v is SessionMode {
  return typeof v === 'string' && ['qa', 'learning', 'building', 'debugging', 'research', 'mixed'].includes(v)
}

function isOutcome(v: unknown): v is SessionDigest['outcome'] {
  return typeof v === 'string' && ['resolved', 'abandoned', 'ongoing'].includes(v)
}
