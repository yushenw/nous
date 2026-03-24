import { getDb } from './database.js'
import type { OperationSketch, SketchDescriptor } from '../types/index.js'

interface OperationLogRow {
  id: number
  session_id: string
  project_path: string
  tool_name: string
  descriptor: string
  timestamp: number
}

function rowToSketch(row: OperationLogRow): OperationSketch {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectPath: row.project_path,
    toolName: row.tool_name,
    descriptor: JSON.parse(row.descriptor) as SketchDescriptor,
    timestamp: row.timestamp,
  }
}

export class OperationLogStore {
  insert(sketch: Omit<OperationSketch, 'id'>): number {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO operation_log (session_id, project_path, tool_name, descriptor, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      sketch.sessionId,
      sketch.projectPath,
      sketch.toolName,
      JSON.stringify(sketch.descriptor),
      sketch.timestamp,
    )
    return result.lastInsertRowid as number
  }

  /** All sketches for a session, ordered chronologically. */
  getBySession(sessionId: string): OperationSketch[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM operation_log WHERE session_id = ? ORDER BY timestamp ASC
    `).all(sessionId) as OperationLogRow[]
    return rows.map(rowToSketch)
  }

  /** Recent sketches for a project within a time window. */
  getByProject(projectPath: string, afterMs: number, limit = 200): OperationSketch[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM operation_log
      WHERE project_path = ? AND timestamp > ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(projectPath, afterMs, limit) as OperationLogRow[]
    return rows.map(rowToSketch).reverse()
  }

  /** Count of tool calls per name for a session (for mode classification). */
  toolCountsBySession(sessionId: string): Record<string, number> {
    const db = getDb()
    const rows = db.prepare(`
      SELECT tool_name, COUNT(*) as cnt
      FROM operation_log WHERE session_id = ?
      GROUP BY tool_name
    `).all(sessionId) as Array<{ tool_name: string; cnt: number }>
    return Object.fromEntries(rows.map(r => [r.tool_name, r.cnt]))
  }
}
