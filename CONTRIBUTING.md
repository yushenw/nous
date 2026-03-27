# Contributing to Nous

## Development setup

Requires [Bun](https://bun.sh) and Node.js >= 18.

```bash
git clone https://github.com/yushenw/nous.git
cd nous
bun install
```

Build the plugin scripts:

```bash
bun run build
```

Type-check without building:

```bash
bun run typecheck
```

## Project structure

```
src/
  config.ts              Central configuration (env vars)
  types/index.ts         All TypeScript interfaces
  storage/               SQLite stores (one file per table)
  analyzer/              Pure functions: behavior analysis, topic extraction
  worker/                Background service: event processor, digest generator
  injection/             Context builder for session-start injection
  mcp/server.ts          MCP tool server (recall, resume, topics, review)
  cli/hooks/             Hook entry points compiled to plugin/scripts/
  provider/claude.ts     Claude CLI wrapper (AI calls)
  adapters/              Translates raw hook payloads to HostEvent
```

## Key design constraints

- **No content stored** — only file paths, command prefixes, search queries.
- **< 1ms per tool call** — `processToolUse` must stay synchronous and fast.
- **One AI call per session** — `generateDigest` runs once at session end.
- **Incremental knowledge** — `extractKnowledgeIncremental` runs async, never blocks hooks.

## Running locally

Start the worker:

```bash
node plugin/scripts/worker-service.cjs
```

Send a test event:

```bash
curl -X POST http://localhost:37888/api/hook \
  -H "Content-Type: application/json" \
  -d '{"type":"session_start","sessionId":"test","projectPath":"/tmp","timestamp":0,"payload":{"type":"session_start"},"hostMeta":{}}'
```

## Submitting changes

1. Fork the repository and create a branch from `main`.
2. Keep commits focused — one logical change per commit.
3. Run `bun run typecheck` before submitting.
4. Open a pull request with a clear description of the change and why.

## Reporting bugs

Open an issue at https://github.com/yushenw/nous/issues with:
- Steps to reproduce
- Expected vs actual behaviour
- Output of `curl http://127.0.0.1:37888/api/health`
- Node.js and Claude Code versions
