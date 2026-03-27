import { join } from 'path'
import { homedir } from 'os'

/**
 * Central configuration — all values read from environment variables with sensible defaults.
 *
 * NOUS_PORT        Worker HTTP port                    default: 37888
 * NOUS_DATA_DIR    SQLite database directory           default: ~/.nous
 * NOUS_MODEL       Claude model for AI calls           default: haiku
 * NOUS_MEMORY_DIR  User memory markdown directory      default: ~/user_memory
 */
export const config = {
  port:      parseInt(process.env.NOUS_PORT       ?? '37888', 10),
  dataDir:   process.env.NOUS_DATA_DIR  ?? join(homedir(), '.nous'),
  model:     process.env.NOUS_MODEL     ?? 'haiku',
  memoryDir: process.env.NOUS_MEMORY_DIR ?? join(homedir(), 'user_memory'),
} as const
