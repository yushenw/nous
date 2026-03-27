# Nous

**An AI user perception system for Claude Code.** Not a memory log — a continuously updated model of you as a developer. Nous observes your behavior silently, builds a profile over time, and injects relevant context at the start of every session so Claude always knows where you left off.

[中文文档](./README_CN.md)

---

## How it works

```
You work normally with Claude Code
        ↓
Nous records every tool call in < 1ms (no AI, no content stored)
  — which files you read, what commands you ran, what you searched
        ↓
During the session: every 5 messages, knowledge items are extracted
  — concepts you asked about, how-to questions, project-specific insights
  — written to ~/user_memory/ automatically
        ↓
When the session ends, one AI call generates a digest
  — summary, mode, domain, notable patterns
        ↓
Next time you open Claude Code
  — session history, recent questions, and last stopping point
    are automatically injected into the system prompt
  — Claude knows the context without you explaining anything
```

**Stores structure, not content.** File paths, command prefixes, search queries — never file contents. The model reconstructs meaning from structure using its world knowledge.

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

That's it. The script:
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

## What gets injected

After a few sessions, every new Claude Code session automatically starts with context like:

```
## Developer Profile
Active domains — web-backend, tooling
Style — tends to debug at runtime
Phase — implement
Recent topics — worker, event-processor, sqlite

## Recent Questions
- [concept ×3] Jaccard 相似度 (~/pjs/nous) — 两个集合交集/并集的比值，>0.6 认为内容相似
- [howto ×2]   SQLite WAL 模式 (~/pjs/nous) — 先写日志再写主库，允许并发读
- [concept ×1] BetterSqlite3 vs sqlite3 (~/pjs/nous) — 同步库，高频查询性能更优

## Session History
### Implemented knowledge inquiry tracking system (today)
Mode: building · Topics: worker, storage, knowledge
### Debugged recall multi-word search bug (1d ago) [resolved]
Mode: debugging · Topics: storage, recall, sqlite

## Last Session
**Summary:** Implemented session digest generator, one AI call per session
**Outcome:** resolved
```

Claude sees this before you say a word.

---

## Knowledge Tracking

Nous automatically tracks questions and concepts you encounter across sessions.

**How it works:**
- Every 5 messages, Nous extracts knowledge items (concepts, how-tos, project insights) from the conversation
- Items are deduplicated with Jaccard similarity — repeated questions increase weight
- Written to `~/user_memory/` automatically — open anytime to review

**Retrieval is path-aware:**
- Pure concepts (Jaccard similarity, WAL mode) float globally regardless of project
- Project-specific how-tos are boosted when you're in that project directory
- Each item shows which directory it came from, so you can find related source files

**Files written automatically:**
```
~/user_memory/
  knowledge_index.md          # global top-30 by weight, always up-to-date
  2026-03-28/
    knowledge_log.md          # items extracted today, append-only
```

---

## MCP Tools (optional)

If you configure the Nous MCP Server, Claude can actively query your history mid-conversation:

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

Available tools:

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

Yes. The user model is global. Session history is stored per project path, and only the current project's sessions are injected. Pure concept knowledge items surface across all projects regardless of where they were captured.

**Q: Where are knowledge items written, and how do I review them?**

Auto-written to `~/user_memory/`. `knowledge_index.md` is a global top-30 index, updated after every extraction. Open it anytime to review, or use the `review()` MCP tool mid-conversation.

---

## License

MIT
