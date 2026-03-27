import { getDb } from './database.js'
import type { KnowledgeItem, KnowledgeCategory, RawKnowledgeItem } from '../types/index.js'

// Category base weight bonuses
const CATEGORY_BASE: Record<KnowledgeCategory, number> = {
  concept: 1.5,
  howto:   0.8,
  project: 0.3,
}

// Jaccard similarity on word sets (words length >= 2)
function jaccard(a: string, b: string): number {
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter(w => w.length >= 2))
  const wa = words(a)
  const wb = words(b)
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  const union = wa.size + wb.size - inter
  return union === 0 ? 1 : inter / union
}

interface KnowledgeRow {
  id: number
  title: string
  content: string
  category: string
  weight: number
  ask_count: number
  project_path: string
  tags: string
  session_ids: string
  created_at: number
  last_seen_at: number
}

function rowToItem(r: KnowledgeRow): KnowledgeItem {
  return {
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category as KnowledgeCategory,
    weight: r.weight,
    askCount: r.ask_count,
    projectPath: r.project_path,
    tags: JSON.parse(r.tags) as string[],
    sessionIds: JSON.parse(r.session_ids) as string[],
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  }
}

export class KnowledgeStore {
  /**
   * Upsert a raw knowledge item from AI output.
   * If a similar item (Jaccard >= 0.55) exists, increment count + raise weight.
   * Returns {isNew, id} to let caller track which items were inserted.
   */
  upsert(raw: RawKnowledgeItem, projectPath: string, sessionId: string): { isNew: boolean, id: number } {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM knowledge_items').all() as KnowledgeRow[]

    const existing = rows.find(r => jaccard(r.title, raw.title) >= 0.55)
    const now = Date.now()

    if (existing) {
      const newCount = existing.ask_count + 1
      const newWeight = existing.weight + CATEGORY_BASE[raw.category as KnowledgeCategory] * 0.5
      const sessionIds = JSON.parse(existing.session_ids) as string[]
      if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId)

      db.prepare(`
        UPDATE knowledge_items
        SET ask_count=?, weight=?, session_ids=?, last_seen_at=?, content=?
        WHERE id=?
      `).run(newCount, newWeight, JSON.stringify(sessionIds), now, raw.content, existing.id)
      return { isNew: false, id: existing.id }
    } else {
      const baseWeight = 1.0 + CATEGORY_BASE[raw.category as KnowledgeCategory]
      const result = db.prepare(`
        INSERT INTO knowledge_items (title, content, category, weight, ask_count, project_path, tags, session_ids, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
      `).run(
        raw.title, raw.content, raw.category, baseWeight,
        projectPath,
        JSON.stringify(raw.tags),
        JSON.stringify([sessionId]),
        now, now,
      )
      return { isNew: true, id: result.lastInsertRowid as number }
    }
  }

  /**
   * Get top items sorted by path-weighted display score.
   * Concepts are globally relevant; project-specific items prefer current path.
   */
  getTopByScore(limit: number, currentProject: string): KnowledgeItem[] {
    const db = getDb()
    const rows = db.prepare('SELECT * FROM knowledge_items').all() as KnowledgeRow[]
    const now = Date.now()

    const scored = rows.map(r => {
      const item = rowToItem(r)
      const daysSince = (now - r.last_seen_at) / 86_400_000

      // Concepts decay slowly; project items decay faster
      const decayExp = item.category === 'concept' ? 0.2 : 0.4
      const recencyFactor = 1 / (1 + Math.pow(Math.max(daysSince, 0.01), decayExp))

      let pathFactor: number
      if (item.category === 'concept') {
        pathFactor = 1.3
      } else if (item.projectPath === currentProject) {
        pathFactor = 1.5
      } else {
        pathFactor = item.category === 'project' ? 0.6 : 0.9
      }

      return { item, score: item.weight * recencyFactor * pathFactor }
    })

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.item)
  }

  /** Keyword search across title, content, tags. Optionally filter by project. */
  search(query: string, projectPath?: string, category?: KnowledgeCategory): KnowledgeItem[] {
    const db = getDb()
    const terms = query.toLowerCase().split(/\W+/).filter(t => t.length >= 2)
    const rows = db.prepare('SELECT * FROM knowledge_items ORDER BY weight DESC').all() as KnowledgeRow[]

    return rows
      .filter(r => {
        if (category && r.category !== category) return false
        if (projectPath && r.project_path !== projectPath && r.category === 'project') return false
        if (terms.length === 0) return true
        const text = `${r.title} ${r.content} ${r.tags}`.toLowerCase()
        return terms.some(t => text.includes(t))
      })
      .map(rowToItem)
  }

  getAll(): KnowledgeItem[] {
    const db = getDb()
    return (db.prepare('SELECT * FROM knowledge_items ORDER BY weight DESC').all() as KnowledgeRow[])
      .map(rowToItem)
  }
}
