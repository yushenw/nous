import type { OperationSketch, SessionMode } from '../types/index.js'

interface ToolCounts {
  reads: number       // Read + Glob + Grep
  writes: number      // Write + Edit
  executes: number    // Bash
  searches: number    // WebSearch + WebFetch
  total: number
}

function countTools(sketches: OperationSketch[]): ToolCounts {
  let reads = 0, writes = 0, executes = 0, searches = 0
  for (const s of sketches) {
    switch (s.toolName) {
      case 'Read': case 'Glob': case 'Grep': reads++; break
      case 'Write': case 'Edit': writes++; break
      case 'Bash': executes++; break
      case 'WebSearch': case 'WebFetch': searches++; break
    }
  }
  return { reads, writes, executes, searches, total: sketches.length }
}

/**
 * Classify a session's activity mode from its operation log.
 *
 * Classification rules (evaluated in priority order):
 * - debugging:  Bash failure(s) present + Edit/Write after them
 * - building:   write-heavy (writes >= 30% of total, executes present)
 * - learning:   search-heavy (searches >= 20%) or read-heavy with no writes
 * - research:   reads >> writes, no executes
 * - qa:         very few tool calls (user is mostly chatting)
 * - mixed:      fallback
 */
export function classifySession(sketches: OperationSketch[]): SessionMode {
  if (sketches.length === 0) return 'qa'

  const c = countTools(sketches)

  // qa: minimal tool use — mostly conversational
  if (c.total <= 3) return 'qa'

  // debugging: bash failures followed by edits
  if (hasDebugPattern(sketches)) return 'debugging'

  const writeRatio = c.writes / c.total
  const searchRatio = c.searches / c.total
  const readRatio = c.reads / c.total

  // building: significant write activity with execution
  if (writeRatio >= 0.25 && c.executes >= 1) return 'building'

  // learning: search-heavy or pure reading (no writes)
  if (searchRatio >= 0.2 || (readRatio >= 0.6 && c.writes === 0)) return 'learning'

  // research: reading with some searches, minimal writing
  if (readRatio >= 0.5 && writeRatio <= 0.1) return 'research'

  // building with writes but no exec (e.g. config editing)
  if (writeRatio >= 0.3) return 'building'

  return 'mixed'
}

/**
 * Returns true if the session shows a debug pattern:
 * at least one failed Bash execution followed by a file edit.
 */
function hasDebugPattern(sketches: OperationSketch[]): boolean {
  let sawFailure = false
  for (const s of sketches) {
    if (s.toolName === 'Bash' && s.descriptor.failed) {
      sawFailure = true
    } else if (sawFailure && (s.toolName === 'Edit' || s.toolName === 'Write')) {
      return true
    }
  }
  return false
}
