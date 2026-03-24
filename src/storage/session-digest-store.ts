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
    createdAt: row.created_at,
  }
}

export class SessionDigestStore {
  upsert(digest: Omit<SessionDigest, 'id'>): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO session_digests (
        session_id, project_path, summary, mode,
        topics, outcome, notable, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        summary   = excluded.summary,
        mode      = excluded.mode,
        topics    = excluded.topics,
        outcome   = excluded.outcome,
        notable   = excluded.notable
    `).run(
      digest.sessionId,
      digest.projectPath,
      digest.summary,
      digest.mode,
      JSON.stringify(digest.topics),
      digest.outcome,
      digest.notable ?? null,
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

  /** Search digests by topic keyword match. */
  search(query: string, projectPath?: string): SessionDigest[] {
    const db = getDb()
    const like = `%${query.toLowerCase()}%`
    const rows = projectPath
      ? db.prepare(`
          SELECT * FROM session_digests
          WHERE project_path = ?
            AND (LOWER(summary) LIKE ? OR LOWER(topics) LIKE ?)
          ORDER BY created_at DESC LIMIT 20
        `).all(projectPath, like, like) as SessionDigestRow[]
      : db.prepare(`
          SELECT * FROM session_digests
          WHERE LOWER(summary) LIKE ? OR LOWER(topics) LIKE ?
          ORDER BY created_at DESC LIMIT 20
        `).all(like, like) as SessionDigestRow[]
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
