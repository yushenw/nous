import { getDb } from './database.js'
import type { Observation, MemoryScope, ObservationType } from '../types/index.js'

interface ObservationRow {
  id: number
  session_id: string
  project_path: string
  scope: string
  type: string
  title: string
  subtitle: string
  facts: string
  narrative: string
  concepts: string
  files_read: string
  files_modified: string
  content_hash: string
  importance_score: number
  created_at: number
}

function rowToObs(row: ObservationRow): Observation {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    scope: row.scope as MemoryScope,
    type: row.type as ObservationType,
    title: row.title,
    subtitle: row.subtitle,
    facts: JSON.parse(row.facts) as string[],
    narrative: row.narrative,
    concepts: JSON.parse(row.concepts) as string[],
    filesRead: JSON.parse(row.files_read) as string[],
    filesModified: JSON.parse(row.files_modified) as string[],
    contentHash: row.content_hash,
    importanceScore: row.importance_score,
    createdAt: row.created_at,
  }
}

export class ObservationStore {
  /**
   * Insert a new observation.
   * Returns the new row id, or null if content_hash already exists (dedup).
   */
  insert(obs: Omit<Observation, 'id'>): number | null {
    const db = getDb()
    try {
      const result = db.prepare(`
        INSERT INTO observations (
          session_id, project_path, scope, type,
          title, subtitle, facts, narrative,
          concepts, files_read, files_modified,
          content_hash, importance_score, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        obs.sessionId,
        obs.projectPath,
        obs.scope,
        obs.type,
        obs.title,
        obs.subtitle,
        JSON.stringify(obs.facts),
        obs.narrative,
        JSON.stringify(obs.concepts),
        JSON.stringify(obs.filesRead),
        JSON.stringify(obs.filesModified),
        obs.contentHash,
        obs.importanceScore,
        obs.createdAt,
      )
      return result.lastInsertRowid as number
    } catch (err: unknown) {
      // UNIQUE constraint violation on content_hash = duplicate, silently skip
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        return null
      }
      throw err
    }
  }

  /** Most recent observations for a project, ordered by created_at DESC */
  queryRecent(projectPath: string, limit: number): Observation[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM observations
      WHERE project_path = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectPath, limit) as ObservationRow[]
    return rows.map(rowToObs)
  }

  /** Top observations by importance score for a project */
  queryByImportance(projectPath: string, limit: number): Observation[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM observations
      WHERE project_path = ?
      ORDER BY importance_score DESC, created_at DESC
      LIMIT ?
    `).all(projectPath, limit) as ObservationRow[]
    return rows.map(rowToObs)
  }

  /** Global-scoped observations (scope = 'global') */
  queryGlobal(limit: number): Observation[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM observations
      WHERE scope = 'global'
      ORDER BY importance_score DESC, created_at DESC
      LIMIT ?
    `).all(limit) as ObservationRow[]
    return rows.map(rowToObs)
  }

  /**
   * Simple keyword search across title, subtitle, narrative, and concepts.
   * Optionally filtered to a specific project.
   */
  search(query: string, projectPath?: string): Observation[] {
    const db = getDb()
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)

    if (terms.length === 0) return []

    // Build a LIKE condition for each term across multiple columns
    const conditions = terms
      .map(() => `(LOWER(title) LIKE ? OR LOWER(subtitle) LIKE ? OR LOWER(narrative) LIKE ? OR LOWER(concepts) LIKE ?)`)
      .join(' AND ')

    const likeArgs = terms.flatMap(t => {
      const pattern = `%${t}%`
      return [pattern, pattern, pattern, pattern]
    })

    if (projectPath) {
      const rows = db.prepare(`
        SELECT * FROM observations
        WHERE project_path = ? AND (${conditions})
        ORDER BY importance_score DESC, created_at DESC
        LIMIT 50
      `).all(projectPath, ...likeArgs) as ObservationRow[]
      return rows.map(rowToObs)
    } else {
      const rows = db.prepare(`
        SELECT * FROM observations
        WHERE ${conditions}
        ORDER BY importance_score DESC, created_at DESC
        LIMIT 50
      `).all(...likeArgs) as ObservationRow[]
      return rows.map(rowToObs)
    }
  }

  updateImportanceScore(id: number, score: number): void {
    const db = getDb()
    db.prepare(`
      UPDATE observations SET importance_score = ? WHERE id = ?
    `).run(score, id)
  }
}
