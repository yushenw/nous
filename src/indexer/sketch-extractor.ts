import type { SketchDescriptor } from '../types/index.js'

// Tools whose calls carry no useful structural information worth indexing.
const SKIP_TOOLS = new Set([
  'TodoRead', 'TodoWrite', 'AskUserQuestion', 'Skill',
  'ListMcpResourcesTool', 'SlashCommand', 'ExitPlanMode', 'EnterPlanMode',
])

/**
 * Extract a lightweight structural descriptor from a tool call.
 * Returns { skipped: true } for tools that carry no indexable signal.
 * Never throws — falls back to minimal descriptor on unexpected input.
 */
export function extractSketch(
  toolName: string,
  toolInput: unknown,
  toolOutput: unknown,
): SketchDescriptor {
  if (SKIP_TOOLS.has(toolName)) return { skipped: true }

  const input = (toolInput && typeof toolInput === 'object') ? toolInput as Record<string, unknown> : {}
  const output = (toolOutput && typeof toolOutput === 'object') ? toolOutput as Record<string, unknown> : {}

  switch (toolName) {
    case 'Read':
      return extractRead(input)
    case 'Write':
      return extractWrite(input)
    case 'Edit':
      return extractEdit(input, output)
    case 'Glob':
      return extractGlob(input)
    case 'Grep':
      return extractGrep(input)
    case 'Bash':
      return extractBash(input, output)
    case 'WebSearch':
      return extractWebSearch(input)
    case 'WebFetch':
      return extractWebFetch(input)
    default:
      return extractGeneric(toolName, input)
  }
}

function extractRead(input: Record<string, unknown>): SketchDescriptor {
  const path = asString(input.file_path)
  const offset = asNumber(input.offset)
  const limit = asNumber(input.limit)
  const desc: SketchDescriptor = { path }
  if (offset !== undefined && limit !== undefined) {
    desc.lineRange = [offset, offset + limit]
  } else if (offset !== undefined) {
    desc.lineRange = [offset, offset + 2000]
  }
  return desc
}

function extractWrite(input: Record<string, unknown>): SketchDescriptor {
  const path = asString(input.file_path)
  const content = asString(input.content) ?? ''
  return {
    path,
    isNewFile: true,
    linesChanged: content.split('\n').length,
  }
}

function extractEdit(input: Record<string, unknown>, output: Record<string, unknown>): SketchDescriptor {
  const path = asString(input.file_path)
  const oldStr = asString(input.old_string) ?? ''
  const newStr = asString(input.new_string) ?? ''
  const failed = typeof output.error === 'string' || output.type === 'error'

  let changeType: SketchDescriptor['changeType'] = 'modify'
  if (!oldStr && newStr) changeType = 'add'
  else if (oldStr && !newStr) changeType = 'delete'

  return {
    path,
    changeType,
    linesChanged: Math.max(oldStr.split('\n').length, newStr.split('\n').length),
    failed: failed || undefined,
  }
}

function extractGlob(input: Record<string, unknown>): SketchDescriptor {
  return { query: asString(input.pattern) }
}

function extractGrep(input: Record<string, unknown>): SketchDescriptor {
  const pattern = asString(input.pattern)
  const glob = asString(input.glob)
  return { query: glob ? `${pattern} [${glob}]` : pattern }
}

function extractBash(input: Record<string, unknown>, output: Record<string, unknown>): SketchDescriptor {
  const command = asString(input.command) ?? ''
  const commandPrefix = command.slice(0, 60).replace(/\s+/g, ' ').trim()

  // Detect exit code from output
  let exitCode: number | undefined
  let failed: boolean | undefined
  const outputText = asString(output) ?? asString(output.stdout) ?? ''
  if (typeof output.exit_code === 'number') {
    exitCode = output.exit_code
    failed = exitCode !== 0 || undefined
  } else if (outputText.includes('error') || outputText.includes('Error')) {
    failed = true
  }

  return { commandPrefix, exitCode, failed }
}

function extractWebSearch(input: Record<string, unknown>): SketchDescriptor {
  return { query: asString(input.query) }
}

function extractWebFetch(input: Record<string, unknown>): SketchDescriptor {
  const url = asString(input.url) ?? ''
  try {
    const u = new URL(url)
    return { domain: u.hostname, urlPath: u.pathname.slice(0, 80) }
  } catch {
    return { urlPath: url.slice(0, 80) }
  }
}

function extractGeneric(toolName: string, input: Record<string, unknown>): SketchDescriptor {
  // Best-effort: pick up file_path or query if present
  const path = asString(input.file_path) ?? asString(input.path)
  const query = asString(input.query) ?? asString(input.q)
  if (path) return { path }
  if (query) return { query }
  return {}
}

// --- Helpers ---

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined
}
