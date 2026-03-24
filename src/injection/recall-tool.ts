import { ObservationStore } from '../storage/observation-store.js'
import { StableKnowledgeStore } from '../storage/stable-knowledge-store.js'
import { SessionDigestStore } from '../storage/session-digest-store.js'
import { OperationLogStore } from '../storage/operation-log-store.js'
import type { Observation, StableKnowledge, SessionDigest, OperationSketch } from '../types/index.js'

export interface RecallResult {
  markdown: string
  totalHits: number
}

export class RecallTool {
  private obsStore = new ObservationStore()
  private skStore = new StableKnowledgeStore()
  private digestStore = new SessionDigestStore()
  private opLogStore = new OperationLogStore()

  /**
   * Search stable knowledge, observations, and session digests for the query.
   * Returns formatted Markdown suitable for injection into model context.
   */
  recall(query: string, projectPath?: string): RecallResult {
    const knowledge = this.skStore.search(query)
    const observations = this.obsStore.search(query, projectPath)
    const digests = this.digestStore.search(query, projectPath)

    const sections: string[] = []
    if (knowledge.length > 0) sections.push(this.formatKnowledge(knowledge))
    if (digests.length > 0) sections.push(this.formatDigests(digests))
    if (observations.length > 0) sections.push(this.formatObservations(observations))

    const totalHits = knowledge.length + digests.length + observations.length

    if (sections.length === 0) {
      return { markdown: `_No results found for: "${query}"_`, totalHits: 0 }
    }

    const markdown = [
      `## Recall: "${query}"`,
      `> ${totalHits} result(s) found`,
      '',
      sections.join('\n\n'),
    ].join('\n')

    return { markdown, totalHits }
  }

  /**
   * Reconstruct the context of the most recent session matching a topic.
   * Returns a Markdown block describing what was happening and where it stopped.
   */
  resume(topic?: string, projectPath?: string): RecallResult {
    // Find matching digests
    const digests = topic
      ? this.digestStore.search(topic, projectPath)
      : this.digestStore.getRecent(projectPath ?? '', 5)

    if (digests.length === 0) {
      return {
        markdown: topic
          ? `_No past sessions found for topic: "${topic}"_`
          : '_No past sessions found._',
        totalHits: 0,
      }
    }

    // Use the most recent matching digest
    const digest = digests[0]
    const sketches = this.opLogStore.getBySession(digest.sessionId)

    const sections: string[] = [
      `## Resume: ${digest.summary}`,
      `> Session from ${formatAge(digest.createdAt)} · mode: ${digest.mode} · outcome: ${digest.outcome}`,
      '',
      `**Topics:** ${digest.topics.join(', ')}`,
    ]

    // List files that were modified — these are the re-read candidates
    const modifiedFiles = [
      ...new Set(
        sketches
          .filter(s => (s.toolName === 'Edit' || s.toolName === 'Write') && s.descriptor.path)
          .map(s => s.descriptor.path as string),
      ),
    ]
    if (modifiedFiles.length > 0) {
      sections.push(`**Files modified:** ${modifiedFiles.map(f => `\`${f}\``).join(', ')}`)
    }

    // Render last few sketches as operation log
    if (sketches.length > 0) {
      const tail = sketches.slice(-8)
      const logLines = tail.map(renderSketch)
      sections.push('**Last operations:**')
      sections.push('```')
      sections.push(logLines.join('\n'))
      sections.push('```')
    }

    if (digest.outcome !== 'resolved') {
      sections.push(`> Warning: Session ended with outcome: **${digest.outcome}** — there may be unfinished work.`)
    }

    return { markdown: sections.join('\n'), totalHits: 1 }
  }

  /**
   * List recent active topics with session counts.
   */
  topics(projectPath?: string): RecallResult {
    const digests = projectPath
      ? this.digestStore.getRecent(projectPath, 50)
      : this.digestStore.getGlobal(50)

    if (digests.length === 0) {
      return { markdown: '_No sessions recorded yet._', totalHits: 0 }
    }

    const now = Date.now()
    const MS_PER_DAY = 86_400_000

    // Count topic occurrences with recency weighting
    const topicStats = new Map<string, { count: number; lastSeen: number }>()
    for (const digest of digests) {
      const weight = (now - digest.createdAt) < 7 * MS_PER_DAY ? 2 : 1
      for (const topic of digest.topics) {
        const existing = topicStats.get(topic) ?? { count: 0, lastSeen: 0 }
        topicStats.set(topic, {
          count: existing.count + weight,
          lastSeen: Math.max(existing.lastSeen, digest.createdAt),
        })
      }
    }

    const sorted = [...topicStats.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 15)

    const lines = sorted.map(([topic, { count, lastSeen }]) => {
      const age = formatAge(lastSeen)
      return `- **${topic}** — ${count} sessions, last active ${age}`
    })

    const markdown = ['## Active Topics', ...lines].join('\n')
    return { markdown, totalHits: sorted.length }
  }

  // --- Formatters ---

  private formatKnowledge(items: StableKnowledge[]): string {
    const lines = ['### Stable Knowledge']
    for (const item of items) {
      const pinned = item.pinnedByUser ? ' [pinned]' : ''
      lines.push(`#### [${item.type}] ${item.title}${pinned}`)
      lines.push(item.content)
    }
    return lines.join('\n')
  }

  private formatDigests(items: SessionDigest[]): string {
    const lines = ['### Past Sessions']
    for (const item of items) {
      const age = formatAge(item.createdAt)
      lines.push(`#### ${item.summary} (${age})`)
      lines.push(`Mode: ${item.mode} · Topics: ${item.topics.join(', ')} · Outcome: ${item.outcome}`)
    }
    return lines.join('\n')
  }

  private formatObservations(items: Observation[]): string {
    const lines = ['### Working Memory']
    for (const obs of items) {
      lines.push(`#### [${obs.type}] ${obs.title}`)
      if (obs.subtitle) lines.push(`_${obs.subtitle}_`)
      lines.push(obs.narrative)
      if (obs.facts.length > 0) {
        lines.push('**Key facts:**')
        for (const fact of obs.facts) lines.push(`- ${fact}`)
      }
    }
    return lines.join('\n')
  }
}

// --- Shared helpers ---

function renderSketch(sketch: OperationSketch): string {
  const d = sketch.descriptor
  const tool = sketch.toolName.padEnd(10)
  if (d.path) {
    const change = d.changeType ? ` (${d.changeType})` : ''
    const flag = d.failed ? ' [failed]' : ''
    return `${tool} ${d.path}${change}${flag}`
  }
  if (d.commandPrefix) {
    const fail = d.failed ? ' [FAIL]' : ''
    return `${tool} ${d.commandPrefix}${fail}`
  }
  if (d.query) return `${tool} "${d.query}"`
  if (d.domain) return `${tool} ${d.domain}${d.urlPath ?? ''}`
  return tool.trim()
}

function formatAge(ts: number): string {
  const diffMs = Date.now() - ts
  const diffDays = Math.floor(diffMs / 86_400_000)
  if (diffDays === 0) return 'today'
  if (diffDays === 1) return '1d ago'
  return `${diffDays}d ago`
}
