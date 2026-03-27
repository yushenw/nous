import { UserModelStore } from '../storage/user-model-store.js'
import { SessionDigestStore } from '../storage/session-digest-store.js'
import { KnowledgeStore } from '../storage/knowledge-store.js'
import { getDb } from '../storage/database.js'
import type { SessionDigest } from '../types/index.js'

const MS_PER_DAY = 86_400_000

export class ContextBuilder {
  private userModelStore = new UserModelStore()
  private digestStore = new SessionDigestStore()
  private knowledgeStore = new KnowledgeStore()

  /**
   * Build the full injection context for a SessionStart event.
   * Structured as terse Markdown to minimize token cost.
   * Returns null if there is no meaningful context to inject.
   */
  async build(projectPath: string): Promise<string | null> {
    const sections: string[] = []

    const profile = this.buildProfileSection(projectPath)
    if (profile) sections.push(profile)

    const history = this.buildHistorySection(projectPath)
    if (history) sections.push(history)

    const lastSession = this.buildLastSessionSection(projectPath)
    if (lastSession) sections.push(lastSession)

    const knowledgeSnap = this.buildKnowledgeSnapshot(projectPath)
    if (knowledgeSnap) sections.push(knowledgeSnap)

    if (sections.length === 0) return null
    return sections.join('\n\n')
  }

  /**
   * Build context enriched by the user's first message of the session.
   * Called from UserPromptSubmit hook to inject topic-relevant history.
   * Returns additional context to append, or null.
   */
  buildPromptContext(userMessage: string, projectPath: string): string | null {
    if (!userMessage.trim()) return null

    // Extract keywords from the message for matching
    const keywords = extractKeywords(userMessage)
    if (keywords.length === 0) return null

    const query = keywords.slice(0, 4).join(' ')
    const relevant = this.digestStore.search(query, projectPath)
      .filter(d => d.projectPath === projectPath)
      .slice(0, 3)

    if (relevant.length === 0) return null

    const lines = ['## Relevant Past Sessions']
    for (const d of relevant) {
      const age = formatAge(d.createdAt)
      lines.push(`- **${d.summary}** (${age}) — ${d.topics.slice(0, 4).join(', ')}`)
    }
    return lines.join('\n')
  }

  // ---------------------------------------------------------------------------
  // Section builders
  // ---------------------------------------------------------------------------

  private buildProfileSection(projectPath: string): string | null {
    const model = this.userModelStore.get()
    if (!model) return null

    const lines: string[] = ['## Developer Profile']

    // Recent interests from session domains
    if (model.interests.trending.length) {
      lines.push(`Active domains — ${model.interests.trending.join(', ')}`)
    } else if (model.interests.recent.length) {
      lines.push(`Recent domains — ${model.interests.recent.join(', ')}`)
    }

    // Working style — only show non-null values
    const style = model.workingStyle
    const styleNotes: string[] = []
    if (style.prefersTDD === true) styleNotes.push('prefers TDD')
    if (style.prefersTDD === false) styleNotes.push('tends to debug at runtime')
    if (style.commentsHabit === 'detailed') styleNotes.push('writes detailed comments')
    if (style.commentsHabit === 'none') styleNotes.push('minimal comments')
    if (style.refactorFirst === true) styleNotes.push('refactors before adding features')
    if (styleNotes.length) lines.push(`Style — ${styleNotes.join(', ')}`)

    // Current focus
    const focus = model.currentFocus
    if (focus.phase !== 'idle') lines.push(`Phase — ${focus.phase}`)
    if (focus.projectGoal) lines.push(`Goal — ${focus.projectGoal}`)
    if (focus.knownBlockers.length) lines.push(`Blockers — ${focus.knownBlockers.join('; ')}`)

    // Cognitive state
    if (model.cognitiveState !== 'unknown') lines.push(`State — ${model.cognitiveState}`)

    // Topic momentum from recent digests (last 7 days)
    const recentDigests = this.digestStore.getRecent(projectPath, 20)
    const momentum = getTopicMomentum(recentDigests)
    if (momentum.length) lines.push(`Recent topics — ${momentum.join(', ')}`)

    // Recurring issues (blind spots, max 3)
    if (model.blindSpots.length) {
      lines.push(`Recurring issues — ${model.blindSpots.slice(-3).join('; ')}`)
    }

    // Only emit section if there's actual content beyond the header
    return lines.length > 1 ? lines.join('\n') : null
  }

  private buildHistorySection(projectPath: string): string | null {
    const now = Date.now()

    // Tiered sampling: recent sessions in more detail, older ones compressed
    const tiers = [
      { afterMs: now - 1 * MS_PER_DAY, limit: 5 },
      { afterMs: now - 7 * MS_PER_DAY, limit: 4 },
      { afterMs: now - 30 * MS_PER_DAY, limit: 3 },
    ]

    const allDigests = this.digestStore.getRecent(projectPath, 30)
    const seen = new Set<string>()
    const collected: SessionDigest[] = []

    for (const tier of tiers) {
      const eligible = allDigests.filter(
        d => d.createdAt > tier.afterMs && !seen.has(d.sessionId),
      )
      for (const d of eligible.slice(0, tier.limit)) {
        seen.add(d.sessionId)
        collected.push(d)
      }
    }

    if (collected.length === 0) return null

    const lines = ['## Session History']
    for (const d of collected) {
      const age = formatAge(d.createdAt)
      const outcome = d.outcome !== 'resolved' ? ` [${d.outcome}]` : ''
      lines.push(`### ${d.summary} (${age})${outcome}`)
      lines.push(`Mode: ${d.mode} · Topics: ${d.topics.slice(0, 5).join(', ')}`)
    }
    return lines.join('\n')
  }

  private buildLastSessionSection(projectPath: string): string | null {
    const digests = this.digestStore.getRecent(projectPath, 1)
    if (digests.length === 0) return this.buildLastSessionFromDb(projectPath)

    const d = digests[0]
    const lines = ['## Last Session']
    lines.push(`**Summary:** ${d.summary}`)
    lines.push(`**Outcome:** ${d.outcome}`)
    if (d.notable) lines.push(`**Note:** ${d.notable}`)
    return lines.join('\n')
  }

  private buildKnowledgeSnapshot(projectPath: string): string | null {
    const items = this.knowledgeStore.getTopByScore(5, projectPath)
    if (items.length === 0) return null

    const lines = ['## Recent Questions']
    for (const item of items) {
      const project = projectPath === item.projectPath ? '' : ` (${item.projectPath.split('/').pop()})`
      const repeat = item.askCount > 1 ? ` ×${item.askCount}` : ''
      lines.push(`- [${item.category}${repeat}] **${item.title}**${project} — ${item.content.slice(0, 80)}`)
    }
    return lines.join('\n')
  }

  /** Fallback: read last session from legacy session_summaries table. */
  private buildLastSessionFromDb(projectPath: string): string | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT * FROM session_summaries WHERE project_path = ? ORDER BY created_at DESC LIMIT 1
    `).get(projectPath) as Record<string, string> | undefined

    if (!row) return null

    const lines = ['## Last Session']
    if (row['request']) lines.push(`**Request:** ${row['request']}`)
    if (row['completed']) lines.push(`**Completed:** ${row['completed']}`)
    if (row['next_steps']) lines.push(`**Next steps:** ${row['next_steps']}`)
    return lines.length > 1 ? lines.join('\n') : null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTopicMomentum(digests: SessionDigest[]): string[] {
  const now = Date.now()
  const counts = new Map<string, number>()
  for (const d of digests) {
    const weight = (now - d.createdAt) < 3 * MS_PER_DAY ? 3 : 1
    for (const t of d.topics) counts.set(t, (counts.get(t) ?? 0) + weight)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t)
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_.,;:'"()\[\]{}|<>?!@#$%^&*+=~`]+/)
    .filter(t => t.length >= 3 && !/^(the|a|an|is|in|on|for|of|and|or|how|what|why|can|will|this|that)$/.test(t))
}

function formatAge(ts: number): string {
  const diffDays = Math.floor((Date.now() - ts) / 86_400_000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return '1d ago'
  return `${diffDays}d ago`
}
