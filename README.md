# Nous

**A user perception layer for Claude Code.** Nous silently observes your coding sessions, builds a model of you as a developer, and injects relevant context at the start of every session — so Claude always knows who you are, what you're working on, and where you left off.

[中文文档](./README_CN.md)

---

## The Problem

Claude Code starts fresh every session. Every time you open a new conversation, you have to re-explain:

- What the project is about
- What you were working on last time
- Your preferred tech stack
- The bug you were in the middle of debugging

Nous solves this automatically, without any manual effort.

---

## Architecture

```
Claude Code (host)
    │  hooks (stdin/stdout)
    ▼
[Hook Scripts] ── HTTP ──► [Worker Service :37888]
                                │
                    ┌───────────┼────────────┐
                    ▼           ▼            ▼
            EventProcessor  ContextBuilder  KnowledgeWriter
                    │
            [SQLite ~/.nous/nous.db]
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
   operation_log         session_digests
   (lightweight records)  (AI-generated summaries)
         │                     │
         └──────────┬──────────┘
                    ▼
     user_model / stable_knowledge / knowledge_items
     (user profile / stable knowledge / inquiry tracking)

[MCP Server] ── stdio ──► Claude (active tool calls)
```

---

## How It Works

### 1. Hook Interception — Passive Observation

Claude Code exposes four hook points; Nous connects to all of them:

| Hook | Trigger | What Nous does |
|------|---------|----------------|
| `SessionStart` | New session begins | Pull history and inject into system prompt |
| `UserPromptSubmit` | User sends a message | Buffer messages; trigger knowledge extraction every 5 |
| `PostToolUse` | After each tool call | Extract a lightweight sketch into `operation_log` |
| `Stop` / `SessionEnd` | Session ends | Trigger AI digest generation |

**Key design constraint:** hooks must respond fast (Claude Code waits), so tool-call recording is synchronous and AI-free. AI analysis runs asynchronously after the session ends.

### 2. Sketch Extraction — Structured Behavior Recording

File contents are never stored. Only structural "sketches" are extracted:

```
Read    src/storage/session-digest-store.ts:1-50
Edit    src/storage/session-digest-store.ts (modify ~3L)
Bash    bun test → exit 0
Grep    "aggregateTopics" [*.ts]
```

Each sketch contains: tool name, file path / command prefix / search query, success/failure, lines changed. This is the raw data source for the entire system.

### 3. Digest Generation — AI Understanding Per Session

At session end, all sketches are fed to a Claude model (default: Haiku), producing a structured summary:

```json
{
  "summary": "Fixed recall multi-word search bug in session-digest-store.ts",
  "mode": "debugging",
  "domain": "tooling",
  "topics": ["storage", "recall", "search", "digest"],
  "outcome": "resolved",
  "notable": "User pinpointed the LIKE pattern limitation immediately"
}
```

Digests are the system's core knowledge unit — all queries are built on them.

### 4. Knowledge Inquiry Tracking — Cross-Session Learning

Every 5 messages, Nous extracts concepts and how-tos from the conversation, then deduplicates with Jaccard similarity:

- Repeated questions accumulate weight: `weight = 1.0 + category_base + 0.5 × repeat_count`
- Pure concepts (WAL mode, Jaccard similarity) surface globally across all projects
- Project-specific how-tos are boosted when you're working in that directory
- Results are auto-written to `~/user_memory/` as Markdown — open anytime to review

```
~/user_memory/
  knowledge_index.md       # global top-30 by weight, always current
  2026-03-28/
    knowledge_log.md       # items extracted today, append-only
```

### 5. Context Injection — New Sessions Know History

At session start, the `SessionStart` hook calls `/api/context` and injects a Markdown block into the system prompt. Claude sees this before you type a word:

```
## Developer Profile
Active domains — web-backend, tooling
Phase — implement
Recent topics — worker, event-processor, sqlite

## Recent Questions
- [concept ×3] Jaccard similarity (~/pjs/nous) — intersection/union ratio; >0.6 considered similar
- [howto ×2]   SQLite WAL mode (~/pjs/nous) — write log first; allows concurrent reads
- [concept ×1] BetterSqlite3 vs sqlite3 (~/pjs/nous) — synchronous, better for high-freq queries

## Session History
### Implemented knowledge inquiry tracking system (today)
Mode: building · Topics: worker, storage, knowledge
### Debugged recall multi-word search bug (1d ago) [resolved]
Mode: debugging · Topics: storage, recall, sqlite

## Last Session
**Summary:** Implemented session digest generator, one AI call per session
**Outcome:** resolved
```

### 6. User Model — Incremental Developer Profile

Derived from all historical digests and accumulated over time:

- **Active domains** — inferred from `domain` field across sessions (web-backend, systems, tooling…)
- **Working style** — debug-heavy vs. build-heavy, current phase (explore / implement / debug)
- **Blind spots** — recurring patterns flagged in the `notable` field
- **Knowledge interests** — what you keep asking about, weighted by repetition

---

## Layered Memory Design

```
operation_log     ←  working memory    (raw operation stream, < 1ms per call)
session_digests   ←  short-term memory (condensed per-session summaries)
knowledge_items   ←  inquiry memory    (cross-session questions and concepts)
stable_knowledge  ←  long-term memory  (technical decisions worth keeping)
user_model        ←  metacognition     (understanding of you as a developer)
```

---

## Requirements

- [Claude Code](https://claude.ai/download) installed and logged in
- Node.js >= 18

---

## Installation

### Option 1 — One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/yushenw/nous/main/install.sh | sh
```

The script:
- Downloads pre-built scripts to `~/.nous/`
- Installs the native SQLite dependency
- Registers hooks in `~/.claude/settings.json`

The Worker starts automatically the first time you open Claude Code. No manual steps needed.

### Option 2 — Install from source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/yushenw/nous.git
cd nous
bun install
bun run build-and-sync
```

Then register the hooks in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart":     [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ~/.nous/scripts/session-start.cjs" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ~/.nous/scripts/user-prompt-submit.cjs" }] }],
    "PostToolUse":      [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ~/.nous/scripts/post-tool-use.cjs" }] }],
    "Stop":             [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ~/.nous/scripts/session-end.cjs" }] }],
    "SessionEnd":       [{ "matcher": "", "hooks": [{ "type": "command", "command": "node ~/.nous/scripts/session-end.cjs" }] }]
  }
}
```

Open a new Claude Code session — done.

---

## MCP Tools (optional)

Configure the Nous MCP Server to let Claude actively query your history mid-conversation:

```json
{
  "mcpServers": {
    "nous": {
      "command": "node",
      "args": ["/Users/yourname/.nous/scripts/mcp-server.cjs"]
    }
  }
}
```

Replace `/Users/yourname` with your actual home directory (`echo $HOME`).

| Tool | Description |
|------|-------------|
| `recall("jwt auth")` | Search past sessions and stable knowledge |
| `resume("rust")` | Reconstruct the context of the last matching session |
| `topics()` | List recently active topics with session counts |
| `review()` | Review accumulated knowledge items sorted by weight |

Example:

```
You:    show me recent knowledge items about sqlite
Claude: (calls review(query="sqlite"))
        [howto ×3] SQLite upsert syntax — weight 2.9
        INSERT INTO ... ON CONFLICT(id) DO UPDATE SET col = excluded.col
        ~/pjs/nous · sqlite, sql

        [concept ×1] SQLite WAL mode — weight 2.5
        Write-Ahead Logging allows concurrent reads during writes.
        ~/pjs/nous · sqlite, concurrency, performance
```

---

## Configuration

| Environment variable | Default | Description |
|----------------------|---------|-------------|
| `NOUS_PORT` | `37888` | Worker HTTP port |
| `NOUS_DATA_DIR` | `~/.nous` | SQLite database directory |
| `NOUS_MODEL` | `haiku` | Claude model for digest and knowledge extraction |
| `NOUS_MEMORY_DIR` | `~/user_memory` | Directory for auto-generated knowledge markdown files |
| `ANTHROPIC_API_KEY` | — | Omit to reuse Claude Code's login session |

---

## Privacy

- All data is stored locally in `~/.nous/nous.db` (SQLite)
- File **contents** are never stored — only paths, command prefixes (first 60 chars), and search queries
- Session digests and knowledge extraction are generated by Claude using the same auth as your Claude Code session
- Nothing is sent to third-party services

To inspect what's recorded:

```bash
node -e "
const db = require('better-sqlite3')(require('os').homedir()+'/.nous/nous.db');
db.prepare('SELECT tool_name, descriptor FROM operation_log ORDER BY timestamp DESC LIMIT 20').all()
  .forEach(r => console.log(r.tool_name, JSON.parse(r.descriptor)));
"
```

---

## Updating

```bash
# Option 1 — re-run the installer
curl -fsSL https://raw.githubusercontent.com/yushenw/nous/main/install.sh | sh

# Option 2 — from source
cd nous && git pull && bun run build-and-sync
```

The Worker picks up new scripts automatically on next Claude Code launch.

---

## Uninstall

```bash
# Remove hooks from ~/.claude/settings.json (delete the "hooks" key)
# Then clean up data
pkill -f worker-service.cjs || true
rm -rf ~/.nous
```

---

## FAQ

**Q: No context injected when I open Claude Code?**

Context becomes rich after 2–3 real sessions. Check the Worker is running:
```bash
curl http://127.0.0.1:37888/api/health
```

**Q: Session digests using rule-based generation instead of AI?**

Nous reuses Claude Code's login session. Confirm you're logged in:
```bash
claude auth status
```

**Q: Does it work across projects?**

Yes. The user model is global. Session history is stored per project path — only the current project's sessions are injected. Pure concept knowledge items surface across all projects regardless of where they were captured.

**Q: Where are knowledge items written, and how do I review them?**

Auto-written to `~/user_memory/`. `knowledge_index.md` is a global top-30 index updated after every extraction. Open it anytime, or use the `review()` MCP tool mid-conversation.

---

## License

MIT
