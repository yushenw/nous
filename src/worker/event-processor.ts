import { getDb } from '../storage/database.js'
import { UserModelStore } from '../storage/user-model-store.js'
import { StableKnowledgeStore } from '../storage/stable-knowledge-store.js'
import { ClaudeProvider } from '../provider/claude.js'
import { extractSketch } from '../indexer/sketch-extractor.js'
import { OperationLogStore } from '../storage/operation-log-store.js'
import { aggregateTopics } from '../analyzer/topic-extractor.js'
import { classifySession } from '../analyzer/session-classifier.js'
import { DigestGenerator } from './digest-generator.js'
import { SessionDigestStore } from '../storage/session-digest-store.js'
import { analyzeBehavior } from '../analyzer/behavior-analyzer.js'
import type {
  HostEvent,
  UserMessagePayload,
  ToolUsePayload,
  UserModel,
} from '../types/index.js'

// Rough heuristic: map tool names to cognitive phase
function inferPhaseFromTool(toolName: string): UserModel['currentFocus']['phase'] {
  const name = toolName.toLowerCase()
  if (name.includes('bash') || name.includes('execute')) return 'implement'
  if (name.includes('read') || name.includes('glob') || name.includes('grep')) return 'explore'
  if (name.includes('edit') || name.includes('write')) return 'implement'
  return 'idle'
}

// Infer cognitive state from recent message content
function inferCognitiveState(content: string): UserModel['cognitiveState'] {
  const lower = content.toLowerCase()
  if (lower.includes('why') || lower.includes('debug') || lower.includes('error') || lower.includes('fix')) {
    return 'debugging'
  }
  if (lower.includes('how') || lower.includes('explore') || lower.includes('try') || lower.includes('what')) {
    return 'exploring'
  }
  if (lower.includes('implement') || lower.includes('add') || lower.includes('build') || lower.includes('create')) {
    return 'focused'
  }
  if (lower.includes('stuck') || lower.includes("can't") || lower.includes('not working')) {
    return 'stuck'
  }
  return 'unknown'
}

export class EventProcessor {
  private userModelStore = new UserModelStore()
  private skStore = new StableKnowledgeStore()
  private ai = new ClaudeProvider()
  private opLogStore = new OperationLogStore()
  private digestGenerator = new DigestGenerator()
  private digestStore = new SessionDigestStore()

  /** Mark session as active in the sessions table */
  processSessionStart(event: HostEvent): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO sessions (session_id, project_path, status, started_at)
      VALUES (?, ?, 'active', ?)
      ON CONFLICT(session_id) DO UPDATE SET status = 'active'
    `).run(event.sessionId, event.projectPath, event.timestamp)

    // Ensure user model exists with defaults
    const existing = this.userModelStore.get()
    if (!existing) {
      const defaultModel: UserModel = {
        userId: 'default',
        updatedAt: Date.now(),
        expertise: {},
        workingStyle: {
          prefersTDD: null,
          commentsHabit: null,
          refactorFirst: null,
        },
        blindSpots: [],
        deadEnds: [],
        currentFocus: {
          projectGoal: null,
          phase: 'idle',
          knownBlockers: [],
        },
        cognitiveState: 'unknown',
      }
      this.userModelStore.upsert(defaultModel)
    }
  }

  /** Store user prompt and update currentFocus heuristics */
  processUserMessage(event: HostEvent): void {
    const payload = event.payload as UserMessagePayload
    const db = getDb()

    // Store the first user message as the session's user_prompt
    db.prepare(`
      UPDATE sessions SET user_prompt = ?
      WHERE session_id = ? AND user_prompt IS NULL
    `).run(payload.content, event.sessionId)

    const cogState = inferCognitiveState(payload.content)
    this.userModelStore.updateCognitiveState(cogState)

    const model = this.userModelStore.get()
    if (model) {
      this.userModelStore.updateFocus({
        ...model.currentFocus,
        phase: cogState === 'debugging' ? 'debug' : cogState === 'focused' ? 'implement' : 'explore',
      })
    }
  }

  /**
   * Capture tool use event: extract a lightweight sketch and store it.
   * Synchronous, no AI — designed to complete in < 1ms.
   */
  processToolUse(event: HostEvent): void {
    const payload = event.payload as ToolUsePayload

    // Extract lightweight structural descriptor — synchronous, no AI
    const descriptor = extractSketch(payload.toolName, payload.toolInput, payload.toolOutput)

    // Skip tools that carry no indexable signal
    if (descriptor.skipped) return

    this.opLogStore.insert({
      sessionId: event.sessionId,
      projectPath: event.projectPath,
      toolName: payload.toolName,
      descriptor,
      timestamp: event.timestamp,
    })

    // Incrementally update session topics and mode (every 5 tool calls to amortize cost)
    this.maybeUpdateSessionStats(event.sessionId, event.projectPath)

    // Update current focus phase from tool type heuristic
    const model = this.userModelStore.get()
    if (model) {
      const phase = inferPhaseFromTool(payload.toolName)
      if (phase !== 'idle') {
        this.userModelStore.updateFocus({ ...model.currentFocus, phase })
      }
    }
  }

  /** Trigger session digest generation */
  processStop(event: HostEvent): void {
    this.flushSessionStats(event.sessionId)
    this.generateDigest(event).catch((err: unknown) => {
      console.error('[nous] digest generation failed:', err)
    })
  }

  /** Mark session completed */
  processSessionEnd(event: HostEvent): void {
    const db = getDb()
    db.prepare(`
      UPDATE sessions SET status = 'completed', ended_at = ? WHERE session_id = ?
    `).run(event.timestamp, event.sessionId)
    this.flushSessionStats(event.sessionId)
  }

  // ---------------------------------------------------------------------------
  // Private session stats helpers (synchronous, no AI)
  // ---------------------------------------------------------------------------

  /**
   * Update session-level topics and mode classification.
   * Called every N tool uses to amortize the cost of reading the full operation log.
   */
  private maybeUpdateSessionStats(sessionId: string, projectPath: string): void {
    const db = getDb()

    // Read current tool count for this session
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM operation_log WHERE session_id = ?
    `).get(sessionId) as { cnt: number }

    // Update every 5 tool calls
    if (row.cnt % 5 !== 0) return

    const sketches = this.opLogStore.getBySession(sessionId)
    const topics = aggregateTopics(sketches, 8)
    const mode = classifySession(sketches)

    db.prepare(`
      UPDATE sessions SET topics = ?, mode = ? WHERE session_id = ?
    `).run(JSON.stringify(topics), mode, sessionId)

    // Mirror to user model's fast-changing state
    const model = this.userModelStore.get()
    if (model && topics.length > 0) {
      this.userModelStore.updateFocus({
        ...model.currentFocus,
        projectGoal: model.currentFocus.projectGoal,
      })
    }
  }

  /** Flush final session stats — called at session end to ensure accuracy. */
  flushSessionStats(sessionId: string): void {
    const db = getDb()
    const sketches = this.opLogStore.getBySession(sessionId)
    if (sketches.length === 0) return

    const topics = aggregateTopics(sketches, 8)
    const mode = classifySession(sketches)

    db.prepare(`
      UPDATE sessions SET topics = ?, mode = ? WHERE session_id = ?
    `).run(JSON.stringify(topics), mode, sessionId)
  }

  // ---------------------------------------------------------------------------
  // Private async AI helpers
  // ---------------------------------------------------------------------------

  private async generateDigest(event: HostEvent): Promise<void> {
    const db = getDb()

    const session = db.prepare(`
      SELECT user_prompt FROM sessions WHERE session_id = ?
    `).get(event.sessionId) as { user_prompt: string | null } | undefined

    const userPrompt = session?.user_prompt ?? ''
    const sketches = this.opLogStore.getBySession(event.sessionId)

    const digest = await this.digestGenerator.generate(
      event.sessionId,
      event.projectPath,
      sketches,
      userPrompt,
    )

    if (!digest) return

    this.digestStore.upsert(digest)

    await this.maybeUpdateUserModel(event.projectPath)

    // Update session record with final mode and topics
    db.prepare(`
      UPDATE sessions SET mode = ?, topics = ? WHERE session_id = ?
    `).run(digest.mode, JSON.stringify(digest.topics), event.sessionId)

    // If the digest surfaced a notable pattern, add it to the user model
    if (digest.notable) {
      this.userModelStore.addBlindSpot(digest.notable)
    }

    // Distill high-value sessions into stable knowledge
    if (digest.outcome === 'resolved' && digest.mode === 'building') {
      await this.distillFromDigest(event, digest)
    }
  }

  /**
   * Periodically refresh the slow-changing user model from accumulated digests.
   * Triggered every 5 completed sessions to amortize the aggregation cost.
   */
  private async maybeUpdateUserModel(projectPath: string): Promise<void> {
    const db = getDb()

    // Count total digests to decide whether to refresh
    const row = db.prepare(`
      SELECT COUNT(*) as cnt FROM session_digests WHERE project_path = ?
    `).get(projectPath) as { cnt: number }

    // Refresh every 5 sessions
    if (row.cnt % 5 !== 0) return

    // Pull recent digests (last 90 days) for analysis
    const digests = this.digestStore.getRecent(projectPath, 200)
    if (digests.length === 0) return

    const snapshot = analyzeBehavior(digests)

    const current = this.userModelStore.get()
    if (!current) return

    // Merge new expertise into existing (don't downgrade existing knowledge)
    const mergedExpertise = { ...current.expertise }
    for (const [topic, level] of Object.entries(snapshot.expertise)) {
      const rank = { deep: 2, mid: 1, shallow: 0 } as const
      const currentRank = current.expertise[topic] !== undefined
        ? rank[current.expertise[topic]]
        : -1
      if (rank[level] > currentRank) {
        mergedExpertise[topic] = level
      }
    }

    // Merge working style (only update nulls — don't override user-set preferences)
    const mergedStyle: UserModel['workingStyle'] = {
      prefersTDD: current.workingStyle.prefersTDD ?? snapshot.workingStyle.prefersTDD,
      commentsHabit: current.workingStyle.commentsHabit ?? snapshot.workingStyle.commentsHabit,
      refactorFirst: current.workingStyle.refactorFirst ?? snapshot.workingStyle.refactorFirst,
    }

    // Update focus with topic momentum (what user is working on lately)
    const updatedFocus: UserModel['currentFocus'] = {
      ...current.currentFocus,
      projectGoal: current.currentFocus.projectGoal,
      knownBlockers: current.currentFocus.knownBlockers,
    }

    this.userModelStore.upsert({
      ...current,
      expertise: mergedExpertise,
      workingStyle: mergedStyle,
      currentFocus: updatedFocus,
      updatedAt: Date.now(),
    })
  }

  private async distillFromDigest(
    event: HostEvent,
    digest: Omit<import('../types/index.js').SessionDigest, 'id'>,
  ): Promise<void> {
    // Only distill building sessions that produced actual file changes
    const sketches = this.opLogStore.getBySession(event.sessionId)
    const editedFiles = [...new Set(
      sketches
        .filter(s => (s.toolName === 'Edit' || s.toolName === 'Write') && s.descriptor.path)
        .map(s => s.descriptor.path as string)
    )]

    if (editedFiles.length === 0) return

    const prompt = `A coding session just completed. Decide if it produced durable knowledge worth preserving.

Session summary: ${digest.summary}
Topics: ${digest.topics.join(', ')}
Files modified: ${editedFiles.join(', ')}

If yes, respond with JSON:
{
  "title": "concise title",
  "content": "what was built/decided and why it matters",
  "type": "decision|feature|bugfix|discovery"
}

If not worth preserving, respond with: {"skip": true}`

    let parsed: Record<string, unknown>
    try {
      const raw = await this.ai.complete(prompt)
      const match = raw.match(/\{[\s\S]*\}/)
      if (!match) return
      parsed = JSON.parse(match[0]) as Record<string, unknown>
    } catch {
      return
    }

    if (parsed.skip === true) return

    const now = Date.now()
    this.skStore.insert({
      projectPath: event.projectPath,
      scope: 'project',
      type: (parsed.type as import('../types/index.js').ObservationType) ?? 'discovery',
      title: (parsed.title as string) ?? digest.summary,
      content: (parsed.content as string) ?? '',
      concepts: digest.topics,
      sourceObservationIds: [],
      pinnedByUser: false,
      createdAt: now,
      updatedAt: now,
    })
  }
}
