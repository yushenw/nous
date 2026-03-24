import { getDb } from './database.js'
import type { StableKnowledge, MemoryScope, ObservationType } from '../types/index.js'

interface StableKnowledgeRow {
  id: number
  project_path: string | null
  scope: string
  type: string
  title: string
  content: string
  concepts: string
  source_observation_ids: string
  pinned_by_user: number
  created_at: number
  updated_at: number
}

function rowToKnowledge(row: StableKnowledgeRow): StableKnowledge {
  return {
    id: row.id,
    projectPath: row.project_path,
    scope: row.scope as MemoryScope,
    type: row.type as ObservationType,
    title: row.title,
    content: row.content,
    concepts: JSON.parse(row.concepts) as string[],
    sourceObservationIds: JSON.parse(row.source_observation_ids) as number[],
    pinnedByUser: row.pinned_by_user === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class StableKnowledgeStore {
  /** Insert a new stable knowledge entry and return its id */
  insert(knowledge: Omit<StableKnowledge, 'id'>): number {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO stable_knowledge (
        project_path, scope, type, title, content,
        concepts, source_observation_ids, pinned_by_user,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      knowledge.projectPath,
      knowledge.scope,
      knowledge.type,
      knowledge.title,
      knowledge.content,
      JSON.stringify(knowledge.concepts),
      JSON.stringify(knowledge.sourceObservationIds),
      knowledge.pinnedByUser ? 1 : 0,
      knowledge.createdAt,
      knowledge.updatedAt,
    )
    return result.lastInsertRowid as number
  }

  /**
   * Get all stable knowledge for a given project.
   * Pass null to get global knowledge only.
   */
  getAll(projectPath: string | null): StableKnowledge[] {
    const db = getDb()
    if (projectPath === null) {
      return this.getGlobal()
    }
    const rows = db.prepare(`
      SELECT * FROM stable_knowledge
      WHERE project_path = ? OR project_path IS NULL
      ORDER BY pinned_by_user DESC, updated_at DESC
    `).all(projectPath) as StableKnowledgeRow[]
    return rows.map(rowToKnowledge)
  }

  /** Get global knowledge entries (project_path IS NULL) */
  getGlobal(): StableKnowledge[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM stable_knowledge
      WHERE project_path IS NULL
      ORDER BY pinned_by_user DESC, updated_at DESC
    `).all() as StableKnowledgeRow[]
    return rows.map(rowToKnowledge)
  }

  /** Mark a knowledge entry as pinned (will never be pruned) */
  pin(id: number): void {
    const db = getDb()
    db.prepare(`
      UPDATE stable_knowledge SET pinned_by_user = 1, updated_at = ? WHERE id = ?
    `).run(Date.now(), id)
  }

  /** Keyword search across title and content */
  search(query: string): StableKnowledge[] {
    const db = getDb()
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)

    if (terms.length === 0) return []

    const conditions = terms
      .map(() => `(LOWER(title) LIKE ? OR LOWER(content) LIKE ? OR LOWER(concepts) LIKE ?)`)
      .join(' AND ')

    const likeArgs = terms.flatMap(t => {
      const pattern = `%${t}%`
      return [pattern, pattern, pattern]
    })

    const rows = db.prepare(`
      SELECT * FROM stable_knowledge
      WHERE ${conditions}
      ORDER BY pinned_by_user DESC, updated_at DESC
      LIMIT 50
    `).all(...likeArgs) as StableKnowledgeRow[]
    return rows.map(rowToKnowledge)
  }
}
