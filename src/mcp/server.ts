import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { homedir } from 'os'
import { Database } from '../storage/database.js'
import { RecallTool } from '../injection/recall-tool.js'

// Initialize database before handling any requests
Database.getInstance()

const recallTool = new RecallTool()

const server = new McpServer({
  name: 'nous',
  version: '0.1.0',
})

server.tool(
  'recall',
  'Search past sessions, stable knowledge, and observations by keyword or topic.',
  {
    query: z.string().describe('Search query — keywords, topic names, or a short description'),
    project_path: z.string().optional().describe('Limit results to a specific project directory'),
  },
  async ({ query, project_path }) => {
    try {
      const result = recallTool.recall(query, project_path)
      return { content: [{ type: 'text' as const, text: result.markdown }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text' as const, text: `Error running recall: ${msg}` }], isError: true }
    }
  },
)

server.tool(
  'resume',
  "Reconstruct the context of the most recent session matching a topic or project. Use this when the user says \"continue\", \"resume\", or asks about previous work.",
  {
    topic: z.string().optional().describe('Topic or keyword to resume (omit to resume the latest session)'),
    project_path: z.string().optional().describe('Project directory to scope the search'),
  },
  async ({ topic, project_path }) => {
    try {
      const result = recallTool.resume(topic, project_path)
      return { content: [{ type: 'text' as const, text: result.markdown }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text' as const, text: `Error running resume: ${msg}` }], isError: true }
    }
  },
)

server.tool(
  'topics',
  "List the user's recently active topics with session counts. Useful for understanding current focus areas.",
  {
    project_path: z.string().optional().describe('Project directory to scope (omit for global)'),
  },
  async ({ project_path }) => {
    try {
      const result = recallTool.topics(project_path)
      return { content: [{ type: 'text' as const, text: result.markdown }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text' as const, text: `Error running topics: ${msg}` }], isError: true }
    }
  },
)

server.tool(
  'review',
  'Review knowledge items accumulated across sessions, sorted by importance weight. Optionally filter by project, category, or search query.',
  {
    project_path: z.string().optional().describe('Filter to a specific project directory (omit for cross-project)'),
    category: z.enum(['concept', 'howto', 'project']).optional().describe('Filter by category'),
    query: z.string().optional().describe('Search keyword to filter items'),
    limit: z.number().optional().describe('Max items to show (default 20)'),
  },
  async ({ project_path, category, query, limit }) => {
    try {
      const { KnowledgeStore } = await import('../storage/knowledge-store.js')
      const store = new KnowledgeStore()

      let items
      if (query) {
        items = store.search(query, project_path, category as import('../types/index.js').KnowledgeCategory | undefined)
      } else if (project_path) {
        items = store.getTopByScore(limit ?? 20, project_path)
      } else {
        items = store.getAll().slice(0, limit ?? 20)
      }

      if (category) items = items.filter(i => i.category === category)

      if (items.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No knowledge items found.' }] }
      }

      const shortPath = (p: string) => p.replace(homedir(), '~')

      const lines = [`## Knowledge Review (${items.length} items)\n`]
      for (const item of items) {
        const repeat = item.askCount > 1 ? ` ×${item.askCount}` : ''
        const tags = item.tags.length ? ` · ${item.tags.join(', ')}` : ''
        lines.push(`### [${item.category}${repeat}] ${item.title} — weight ${item.weight.toFixed(1)}`)
        lines.push(item.content)
        lines.push(`\`${shortPath(item.projectPath)}\`${tags}`)
        lines.push('')
      }

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true }
    }
  },
)

// Start the server over stdio (Claude Code MCP protocol)
async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error('[nous-mcp] fatal error:', err)
  process.exit(1)
})
