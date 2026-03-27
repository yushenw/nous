import BetterSqlite3 from 'better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { config } from '../config.js'

const DDL = `
-- user_model table: single row, continuously updated
CREATE TABLE IF NOT EXISTS user_model (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  expertise TEXT NOT NULL DEFAULT '{}',
  working_style TEXT NOT NULL DEFAULT '{}',
  blind_spots TEXT NOT NULL DEFAULT '[]',
  dead_ends TEXT NOT NULL DEFAULT '[]',
  current_focus TEXT NOT NULL DEFAULT '{}',
  cognitive_state TEXT NOT NULL DEFAULT 'unknown',
  updated_at INTEGER NOT NULL
);

-- sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  project_path TEXT NOT NULL,
  user_prompt TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);

-- observations table: working memory layer
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'project',
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  facts TEXT NOT NULL DEFAULT '[]',
  narrative TEXT NOT NULL,
  concepts TEXT NOT NULL DEFAULT '[]',
  files_read TEXT NOT NULL DEFAULT '[]',
  files_modified TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL UNIQUE,
  importance_score REAL NOT NULL DEFAULT 1.0,
  created_at INTEGER NOT NULL
);

-- session_summaries table
CREATE TABLE IF NOT EXISTS session_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  request TEXT NOT NULL DEFAULT '',
  investigated TEXT NOT NULL DEFAULT '',
  learned TEXT NOT NULL DEFAULT '',
  completed TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  distilled_knowledge_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

-- operation_log table: lightweight per-tool-call index (no AI, no content)
CREATE TABLE IF NOT EXISTS operation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_path TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  descriptor TEXT NOT NULL DEFAULT '{}',
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oplog_session ON operation_log (session_id);
CREATE INDEX IF NOT EXISTS idx_oplog_project_ts ON operation_log (project_path, timestamp);

-- session_digests table: one AI-generated digest per session
CREATE TABLE IF NOT EXISTS session_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  project_path TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'mixed',
  topics TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL DEFAULT 'ongoing',
  notable TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_digests_project ON session_digests (project_path, created_at);

-- indexes for observations
CREATE INDEX IF NOT EXISTS idx_obs_project_path ON observations (project_path);
CREATE INDEX IF NOT EXISTS idx_obs_created_at ON observations (created_at);
CREATE INDEX IF NOT EXISTS idx_obs_type ON observations (type);
CREATE INDEX IF NOT EXISTS idx_obs_importance ON observations (importance_score);
CREATE INDEX IF NOT EXISTS idx_obs_scope ON observations (scope);

-- knowledge_items table: cross-session knowledge inquiry tracking
CREATE TABLE IF NOT EXISTS knowledge_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'concept',
  weight REAL NOT NULL DEFAULT 1.0,
  ask_count INTEGER NOT NULL DEFAULT 1,
  project_path TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  session_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ki_project ON knowledge_items (project_path, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_ki_weight ON knowledge_items (weight);
`

export class Database {
  private static instance: Database | null = null
  public readonly db: BetterSqlite3.Database
  private _ready = false

  private constructor() {
    const dataDir = config.dataDir
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    const dbPath = join(dataDir, 'nous.db')
    this.db = new BetterSqlite3(dbPath)

    // Enable WAL mode for better concurrent read performance
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.db.pragma('synchronous = NORMAL')

    this.migrate()
    this._ready = true
  }

  static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database()
    }
    return Database.instance
  }

  get ready(): boolean {
    return this._ready
  }

  private migrate(): void {
    // Execute all DDL statements in a single transaction
    this.db.exec(DDL)

    // Migrate: add new columns to sessions table if they don't exist yet
    const sessionCols = (this.db.pragma('table_info(sessions)') as Array<{name: string}>).map(c => c.name)
    if (!sessionCols.includes('topics')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN topics TEXT NOT NULL DEFAULT '[]'`)
    }
    if (!sessionCols.includes('mode')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'mixed'`)
    }

    // Migrate: add domain column to session_digests if not exists
    const digestCols = (this.db.pragma('table_info(session_digests)') as Array<{name: string}>).map(c => c.name)
    if (!digestCols.includes('domain')) {
      this.db.exec(`ALTER TABLE session_digests ADD COLUMN domain TEXT`)
    }
  }

  close(): void {
    this.db.close()
    Database.instance = null
  }
}

// Convenience export: get the singleton db instance directly
export function getDb(): BetterSqlite3.Database {
  return Database.getInstance().db
}
