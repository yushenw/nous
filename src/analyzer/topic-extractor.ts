import type { OperationSketch } from '../types/index.js'

// Weight multipliers by tool type — write operations signal stronger topic commitment
const TOOL_WEIGHTS: Record<string, number> = {
  Write: 3,
  Edit: 3,
  Bash: 2,
  Read: 1,
  WebFetch: 1,
  WebSearch: 2,
  Glob: 0.5,
  Grep: 0.5,
}

// Common stop words to filter out from topic extraction
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'but', 'not', 'with', 'from', 'by', 'as', 'be', 'it', 'this',
  'that', 'are', 'was', 'were', 'has', 'have', 'had', 'do', 'does',
  'how', 'what', 'why', 'when', 'where', 'which', 'who', 'will', 'can',
  'src', 'lib', 'dist', 'node_modules', 'index', 'main', 'mod',
])

export interface TopicWeight {
  topic: string
  weight: number
}

/**
 * Extract weighted topic keywords from a single operation sketch.
 * Returns an array of { topic, weight } pairs, may be empty.
 */
export function extractTopicsFromSketch(sketch: OperationSketch): TopicWeight[] {
  const toolWeight = TOOL_WEIGHTS[sketch.toolName] ?? 1
  const topics: TopicWeight[] = []
  const d = sketch.descriptor

  if (d.path) {
    for (const topic of topicsFromPath(d.path)) {
      topics.push({ topic, weight: toolWeight })
    }
  }

  if (d.query) {
    for (const topic of topicsFromText(d.query)) {
      topics.push({ topic, weight: toolWeight * 0.8 })
    }
  }

  if (d.commandPrefix) {
    for (const topic of topicsFromCommand(d.commandPrefix)) {
      topics.push({ topic, weight: toolWeight * 0.7 })
    }
  }

  if (d.domain) {
    const topic = domainToTopic(d.domain)
    if (topic) topics.push({ topic, weight: 0.5 })
  }

  return topics
}

/**
 * Aggregate topics from a collection of sketches.
 * Returns topics sorted by total weight, deduplicated.
 */
export function aggregateTopics(sketches: OperationSketch[], topN = 10): string[] {
  const weights = new Map<string, number>()

  for (const sketch of sketches) {
    for (const { topic, weight } of extractTopicsFromSketch(sketch)) {
      weights.set(topic, (weights.get(topic) ?? 0) + weight)
    }
  }

  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([topic]) => topic)
}

// --- Internal extraction helpers ---

function topicsFromPath(filePath: string): string[] {
  // Normalize separators and split
  const parts = filePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(p => p && !p.startsWith('.') && p !== '~')

  const topics: string[] = []
  for (const part of parts) {
    // Strip extensions and split on common delimiters
    const base = part.replace(/\.[^.]+$/, '')
    const tokens = base.split(/[-_.]/).filter(t => t.length >= 2)
    for (const token of tokens) {
      const t = token.toLowerCase()
      if (!STOP_WORDS.has(t) && /^[a-z][a-z0-9]*$/.test(t) && t.length <= 20) {
        topics.push(t)
      }
    }
  }
  return [...new Set(topics)]
}

function topicsFromText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\-_/.,;:'"()\[\]{}|<>?!@#$%^&*+=~`]+/)
    .filter(t => t.length >= 3 && t.length <= 30 && !STOP_WORDS.has(t) && /^[a-z0-9]+$/.test(t))
    .slice(0, 8) // cap to avoid query spam
}

// Map common CLI commands and package names to topic keywords
const COMMAND_TOPIC_MAP: Array<[RegExp, string]> = [
  [/^cargo\b/, 'rust'],
  [/\bnpm\b|\bbun\b|\byarn\b|\bpnpm\b/, 'nodejs'],
  [/\bpython\b|\bpip\b|\buv\b/, 'python'],
  [/\bgit\b/, 'git'],
  [/\bdocker\b/, 'docker'],
  [/\bkubectl\b|\bhelm\b/, 'kubernetes'],
  [/\bgo\b|\bgotest\b/, 'go'],
  [/\bjava\b|\bmaven\b|\bgradle\b/, 'java'],
  [/\bruby\b|\bbundle\b/, 'ruby'],
]

function topicsFromCommand(cmd: string): string[] {
  const topics: string[] = []
  const lower = cmd.toLowerCase()
  for (const [pattern, topic] of COMMAND_TOPIC_MAP) {
    if (pattern.test(lower)) topics.push(topic)
  }
  // Also extract the base command name as a topic if it looks meaningful
  const baseCmd = lower.split(/\s+/)[0] ?? ''
  if (baseCmd.length >= 3 && !STOP_WORDS.has(baseCmd) && !/^(cd|ls|rm|mv|cp|cat|echo|export|source)$/.test(baseCmd)) {
    topics.push(baseCmd)
  }
  return [...new Set(topics)]
}

function domainToTopic(domain: string): string | null {
  // Map well-known docs domains to readable topic labels
  const domainMap: Record<string, string> = {
    'docs.rs': 'rust',
    'doc.rust-lang.org': 'rust',
    'developer.mozilla.org': 'webdev',
    'nodejs.org': 'nodejs',
    'react.dev': 'react',
    'nextjs.org': 'nextjs',
    'docs.python.org': 'python',
    'kubernetes.io': 'kubernetes',
    'docs.docker.com': 'docker',
  }
  return domainMap[domain] ?? null
}
