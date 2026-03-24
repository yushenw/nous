import type { SessionDigest, UserModel, ExpertiseLevel, SessionMode } from '../types/index.js'

const MS_PER_DAY = 86_400_000

// Thresholds for expertise level classification
const EXPERTISE_THRESHOLDS = {
  expert: 20,    // topic appears in 20+ sessions
  mid: 8,        // topic appears in 8+ sessions
  shallow: 3,    // topic appears in 3+ sessions (below = not worth recording)
}

export interface BehaviorSnapshot {
  expertise: Record<string, ExpertiseLevel>
  workingStyle: UserModel['workingStyle']
  primaryMode: SessionMode
  peakHours: number[]
  topicMomentum: string[]   // topics active in the last 7 days
}

/**
 * Derive a behavior snapshot from recent session digests.
 * Pure function — reads digests, produces updated model fields.
 * No AI calls, no side effects.
 */
export function analyzeBehavior(
  digests: SessionDigest[],
  recentDays = 90,
): BehaviorSnapshot {
  const now = Date.now()
  const cutoff = now - recentDays * MS_PER_DAY
  const relevant = digests.filter(d => d.createdAt >= cutoff)

  return {
    expertise: deriveExpertise(relevant),
    workingStyle: deriveWorkingStyle(relevant),
    primaryMode: derivePrimaryMode(relevant),
    peakHours: derivePeakHours(relevant),
    topicMomentum: deriveTopicMomentum(relevant),
  }
}

// Count topic occurrences across all digests, weighted by recency
function deriveExpertise(digests: SessionDigest[]): Record<string, ExpertiseLevel> {
  const counts = new Map<string, number>()
  const now = Date.now()

  for (const digest of digests) {
    // Recency weight: sessions in the last 30 days count double
    const age = now - digest.createdAt
    const weight = age < 30 * MS_PER_DAY ? 2 : 1

    for (const topic of digest.topics) {
      counts.set(topic, (counts.get(topic) ?? 0) + weight)
    }
  }

  const expertise: Record<string, ExpertiseLevel> = {}
  for (const [topic, count] of counts.entries()) {
    if (count >= EXPERTISE_THRESHOLDS.expert) {
      expertise[topic] = 'deep'
    } else if (count >= EXPERTISE_THRESHOLDS.mid) {
      expertise[topic] = 'mid'
    } else if (count >= EXPERTISE_THRESHOLDS.shallow) {
      expertise[topic] = 'shallow'
    }
    // Below shallow threshold — not enough signal, omit
  }
  return expertise
}

// Infer working style preferences from session mode distribution
function deriveWorkingStyle(digests: SessionDigest[]): UserModel['workingStyle'] {
  if (digests.length === 0) {
    return { prefersTDD: null, commentsHabit: null, refactorFirst: null }
  }

  const modeCount = countModes(digests)
  const total = digests.length

  // Heuristic: if >30% of sessions are debugging mode,
  // user likely isn't doing TDD (they find bugs at runtime)
  const debugRatio = (modeCount.debugging ?? 0) / total
  const prefersTDD = debugRatio < 0.15 && total >= 10 ? true
    : debugRatio > 0.3 && total >= 10 ? false
    : null

  // refactorFirst: high proportion of pure-read sessions followed by edit-heavy sessions
  // This is a weak signal — mark only with sufficient data
  const refactorFirst = null // Requires sequence analysis, leave for future

  return {
    prefersTDD,
    commentsHabit: null,  // Cannot infer from operation log alone
    refactorFirst,
  }
}

function derivePrimaryMode(digests: SessionDigest[]): SessionMode {
  if (digests.length === 0) return 'mixed'
  const counts = countModes(digests)
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return (sorted[0]?.[0] as SessionMode) ?? 'mixed'
}

function derivePeakHours(digests: SessionDigest[]): number[] {
  const hourCounts = new Array<number>(24).fill(0)
  for (const d of digests) {
    const hour = new Date(d.createdAt).getHours()
    hourCounts[hour]++
  }
  const max = Math.max(...hourCounts)
  if (max === 0) return []
  // Return hours that have at least 40% of peak activity
  return hourCounts
    .map((count, hour) => ({ hour, count }))
    .filter(({ count }) => count >= max * 0.4)
    .map(({ hour }) => hour)
}

// Topics active in the most recent 7 days, ranked by frequency
function deriveTopicMomentum(digests: SessionDigest[]): string[] {
  const now = Date.now()
  const recent = digests.filter(d => d.createdAt >= now - 7 * MS_PER_DAY)
  const counts = new Map<string, number>()
  for (const d of recent) {
    for (const t of d.topics) {
      counts.set(t, (counts.get(t) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([t]) => t)
}

function countModes(digests: SessionDigest[]): Partial<Record<SessionMode, number>> {
  const counts: Partial<Record<SessionMode, number>> = {}
  for (const d of digests) {
    counts[d.mode] = (counts[d.mode] ?? 0) + 1
  }
  return counts
}
