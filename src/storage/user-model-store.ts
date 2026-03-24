import { getDb } from './database.js'
import type { UserModel, ExpertiseLevel } from '../types/index.js'

// Row shape as stored in SQLite (all JSON fields are strings)
interface UserModelRow {
  id: number
  user_id: string
  expertise: string
  working_style: string
  blind_spots: string
  dead_ends: string
  current_focus: string
  cognitive_state: string
  updated_at: number
}

function rowToModel(row: UserModelRow): UserModel {
  return {
    userId: row.user_id,
    updatedAt: row.updated_at,
    expertise: JSON.parse(row.expertise) as Record<string, ExpertiseLevel>,
    workingStyle: JSON.parse(row.working_style) as UserModel['workingStyle'],
    blindSpots: JSON.parse(row.blind_spots) as string[],
    deadEnds: JSON.parse(row.dead_ends) as string[],
    currentFocus: JSON.parse(row.current_focus) as UserModel['currentFocus'],
    cognitiveState: row.cognitive_state as UserModel['cognitiveState'],
  }
}

export class UserModelStore {
  get(): UserModel | null {
    const db = getDb()
    const row = db
      .prepare('SELECT * FROM user_model WHERE id = 1')
      .get() as UserModelRow | undefined
    return row ? rowToModel(row) : null
  }

  upsert(model: UserModel): void {
    const db = getDb()
    db.prepare(`
      INSERT INTO user_model (
        id, user_id, expertise, working_style,
        blind_spots, dead_ends, current_focus,
        cognitive_state, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        user_id = excluded.user_id,
        expertise = excluded.expertise,
        working_style = excluded.working_style,
        blind_spots = excluded.blind_spots,
        dead_ends = excluded.dead_ends,
        current_focus = excluded.current_focus,
        cognitive_state = excluded.cognitive_state,
        updated_at = excluded.updated_at
    `).run(
      model.userId,
      JSON.stringify(model.expertise),
      JSON.stringify(model.workingStyle),
      JSON.stringify(model.blindSpots),
      JSON.stringify(model.deadEnds),
      JSON.stringify(model.currentFocus),
      model.cognitiveState,
      model.updatedAt,
    )
  }

  updateFocus(focus: UserModel['currentFocus']): void {
    const db = getDb()
    db.prepare(`
      UPDATE user_model SET current_focus = ?, updated_at = ? WHERE id = 1
    `).run(JSON.stringify(focus), Date.now())
  }

  updateCognitiveState(state: UserModel['cognitiveState']): void {
    const db = getDb()
    db.prepare(`
      UPDATE user_model SET cognitive_state = ?, updated_at = ? WHERE id = 1
    `).run(state, Date.now())
  }

  addBlindSpot(pattern: string): void {
    const db = getDb()
    const model = this.get()
    if (!model) return

    if (model.blindSpots.includes(pattern)) return

    // Keep the most recent MAX_BLIND_SPOTS entries
    const MAX_BLIND_SPOTS = 20
    const updated = [...model.blindSpots, pattern].slice(-MAX_BLIND_SPOTS)

    db.prepare(`
      UPDATE user_model SET blind_spots = ?, updated_at = ? WHERE id = 1
    `).run(JSON.stringify(updated), Date.now())
  }

  addDeadEnd(approach: string): void {
    const db = getDb()
    const model = this.get()
    if (!model) return

    if (!model.deadEnds.includes(approach)) {
      model.deadEnds.push(approach)
      db.prepare(`
        UPDATE user_model SET dead_ends = ?, updated_at = ? WHERE id = 1
      `).run(JSON.stringify(model.deadEnds), Date.now())
    }
  }

  updateExpertise(topic: string, level: ExpertiseLevel): void {
    const db = getDb()
    const model = this.get()
    if (!model) return

    model.expertise[topic] = level
    db.prepare(`
      UPDATE user_model SET expertise = ?, updated_at = ? WHERE id = 1
    `).run(JSON.stringify(model.expertise), Date.now())
  }
}
