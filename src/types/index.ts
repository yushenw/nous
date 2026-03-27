// HostEvent: normalized event emitted by all Adapters
export interface HostEvent {
  type: 'session_start' | 'session_end' | 'user_message' | 'tool_use' | 'stop'
  sessionId: string
  projectPath: string
  timestamp: number
  payload: HostEventPayload
  hostMeta: Record<string, unknown>
}

export type HostEventPayload =
  | SessionStartPayload
  | SessionEndPayload
  | UserMessagePayload
  | ToolUsePayload
  | StopPayload

export interface SessionStartPayload {
  type: 'session_start'
}

export interface SessionEndPayload {
  type: 'session_end'
}

export interface UserMessagePayload {
  type: 'user_message'
  content: string
}

export interface ToolUsePayload {
  type: 'tool_use'
  toolName: string
  toolInput: unknown
  toolOutput: unknown
  toolUseId: string
}

export interface StopPayload {
  type: 'stop'
  lastAssistantMessage?: string
}

// UserModel: the core asset — continuously updated developer profile
export interface UserModel {
  userId: string  // hash of machine id + user
  updatedAt: number

  // Slow-changing: interests derived from session domains
  interests: { recent: string[], trending: string[] }
  workingStyle: {
    prefersTDD: boolean | null
    commentsHabit: 'none' | 'sparse' | 'detailed' | null
    refactorFirst: boolean | null
  }

  // Accumulated knowledge about the user
  blindSpots: string[]   // recurring mistakes / repeated questions
  deadEnds: string[]     // approaches tried and found to be dead ends

  // Fast-changing: current session state
  currentFocus: {
    projectGoal: string | null
    phase: 'explore' | 'implement' | 'debug' | 'refactor' | 'idle'
    knownBlockers: string[]
  }

  cognitiveState: 'exploring' | 'focused' | 'debugging' | 'stuck' | 'unknown'
}

// ObservationType: what kind of observation this is
export type ObservationType =
  | 'decision'   // architecture / design decision
  | 'bugfix'     // bug found and fixed
  | 'feature'    // new feature implemented
  | 'discovery'  // something learned or explored
  | 'refactor'   // code restructuring
  | 'change'     // general change
  | 'failure'    // approach tried but failed

// MemoryScope: where this memory lives
export type MemoryScope = 'global' | 'project' | 'session'

// Observation: working memory item (fast-changing, time-decaying)
export interface Observation {
  id?: number
  sessionId: string
  projectPath: string
  scope: MemoryScope
  type: ObservationType
  title: string
  subtitle: string
  facts: string[]
  narrative: string
  concepts: string[]
  filesRead: string[]
  filesModified: string[]
  contentHash: string
  importanceScore: number
  createdAt: number
}

// SessionSummary: end-of-session digest
export interface SessionSummary {
  id?: number
  sessionId: string
  projectPath: string
  request: string
  investigated: string
  learned: string
  completed: string
  nextSteps: string
  distilledKnowledgeIds: number[]  // StableKnowledge created from this session
  createdAt: number
}

// OperationSketch: lightweight structural descriptor of a single tool call.
// Stores shape, not content — paths, queries, exit codes, not file contents.
export interface OperationSketch {
  id?: number
  sessionId: string
  projectPath: string
  toolName: string
  descriptor: SketchDescriptor
  timestamp: number
}

// SketchDescriptor: structured metadata extracted from tool input/output.
// Fields are optional and tool-specific; unused fields are omitted.
export interface SketchDescriptor {
  // File-related tools (Read, Write, Edit, Glob)
  path?: string
  lineRange?: [number, number]
  changeType?: 'add' | 'modify' | 'delete'
  linesChanged?: number
  isNewFile?: boolean
  // Bash
  commandPrefix?: string   // first 60 chars of the command
  exitCode?: number
  failed?: boolean
  // WebSearch
  query?: string
  // WebFetch
  domain?: string
  urlPath?: string
  // Generic
  skipped?: boolean        // true if this tool type is not worth indexing
}

// SessionDigest: AI-generated summary produced once at session end.
// Replaces the old per-tool-call observation generation.
export interface SessionDigest {
  id?: number
  sessionId: string
  projectPath: string
  summary: string          // one-sentence description of what happened
  mode: SessionMode        // classified activity type
  topics: string[]         // extracted topic keywords
  outcome: 'resolved' | 'abandoned' | 'ongoing'
  notable?: string         // optional: pattern worth adding to blind spots
  domain?: string          // technical domain of the session
  createdAt: number
}

export type SessionMode = 'qa' | 'learning' | 'building' | 'debugging' | 'research' | 'mixed'

// KnowledgeCategory: type of knowledge item
export type KnowledgeCategory = 'concept' | 'howto' | 'project'

// KnowledgeItem: a question or concept worth remembering across sessions
export interface KnowledgeItem {
  id?: number
  title: string              // short concept/question name, e.g. "Jaccard 相似度"
  content: string            // concise explanation, 1-3 sentences
  category: KnowledgeCategory
  weight: number             // accumulated importance score
  askCount: number           // how many times asked/seen
  projectPath: string        // which project directory this was asked in
  tags: string[]             // topic tags
  sessionIds: string[]       // source session ids
  createdAt: number
  lastSeenAt: number
}

// RawKnowledgeItem: AI output before storage (no weight/count fields)
export interface RawKnowledgeItem {
  title: string
  content: string
  category: KnowledgeCategory
  tags: string[]
}
