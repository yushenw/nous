import { getDb } from './database.js'
import type { SessionDigest, SessionMode } from '../types/index.js'

interface SessionDigestRow {
  id: number
  session_id: string
  project_path: string
  summary: string
  mode: string
  topics: string
  outcome: string
  notable: string | null
  domain: string | null
  created_at: number
}

function rowToDigest(row: SessionDigestRow): SessionDigest {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    summary: row.summary,
    mode: row.mode as SessionMode,
    topics: JSON.parse(row.topics) as string[],
    outcome: row.outcome as SessionDigest['outcome'],
    notable: row.notable ?? undefined,
    domain: row.domain ?? undefined,
    createdAt: row.created_at,
  }
}

export class SessionDigestStore {
  upsert(digest: Omit<SessionDigest, 'id'>): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO session_digests (
        session_id, project_path, summary, mode,
        topics, outcome, notable, domain, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        summary   = excluded.summary,
        mode      = excluded.mode,
        topics    = excluded.topics,
        outcome   = excluded.outcome,
        notable   = excluded.notable,
        domain    = excluded.domain
    `).run(
      digest.sessionId,
      digest.projectPath,
      digest.summary,
      digest.mode,
      JSON.stringify(digest.topics),
      digest.outcome,
      digest.notable ?? null,
      digest.domain ?? null,
      digest.createdAt,
    )
  }

  /** Most recent digests for a project, newest first. */
  getRecent(projectPath: string, limit = 20): SessionDigest[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM session_digests
      WHERE project_path = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(projectPath, limit) as SessionDigestRow[]
    return rows.map(rowToDigest)
  }

  /** Search digests by topic keyword match. Splits multi-word queries and ANDs each term. */
  search(query: string, projectPath?: string): SessionDigest[] {
    const db = getDb()
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return []

    // Build per-term conditions (each term must appear in summary OR topics)
    const termConditions = terms
      .map(() => `(LOWER(summary) LIKE ? OR LOWER(topics) LIKE ?)`)
      .join(' AND ')
    const likeArgs = terms.flatMap(t => [`%${t}%`, `%${t}%`])

    const rows = projectPath
      ? db.prepare(`
          SELECT * FROM session_digests
          WHERE project_path = ? AND (${termConditions})
          ORDER BY created_at DESC LIMIT 20
        `).all(projectPath, ...likeArgs) as SessionDigestRow[]
      : db.prepare(`
          SELECT * FROM session_digests
          WHERE ${termConditions}
          ORDER BY created_at DESC LIMIT 20
        `).all(...likeArgs) as SessionDigestRow[]
    return rows.map(rowToDigest)
  }

  /** Global recent digests across all projects. */
  getGlobal(limit = 30): SessionDigest[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM session_digests ORDER BY created_at DESC LIMIT ?
    `).all(limit) as SessionDigestRow[]
    return rows.map(rowToDigest)
  }
}
