# Changelog

All notable changes to Nous are documented here.

## [0.2.0] — 2026-03-28

### Added
- **Knowledge inquiry tracking** — automatically extracts questions and concepts from conversations every 5 messages; writes to `~/user_memory/` without waiting for session end
- **Path-aware multi-factor recall** — concepts surface globally; project how-tos are boosted in their source directory; each item records which project it came from
- **MCP `review` tool** — query accumulated knowledge items by project, category, or keyword
- **Session domain classification** — each digest now includes a `domain` field (`web-backend`, `systems`, `tooling`, etc.) replacing the noisy file-path-based expertise model
- **Centralised config module** (`src/config.ts`) — all env vars (`NOUS_PORT`, `NOUS_DATA_DIR`, `NOUS_MODEL`, `NOUS_MEMORY_DIR`) defined in one place
- `NOUS_MODEL` env var — configure the Claude model used for digest and knowledge extraction (default: `haiku`)
- `NOUS_MEMORY_DIR` env var — configure the knowledge markdown output directory (default: `~/user_memory`)
- `.env.example` for onboarding

### Changed
- **Removed `expertise` field** from user model — replaced by `interests` (derived from session domains) which is more meaningful and noise-free
- Session-start context injection now shows `Active domains` and `Recent Questions` instead of file-path-derived expertise keywords
- `buildPathBlocklist` exported from `topic-extractor.ts` and applied at digest merge time to prevent AI-generated path components from leaking into stored topics

### Fixed
- Path components (`home`, `liaix`, `pjs`, project name) no longer appear in user expertise or session topics — filtered at the point where AI topics are merged with rule-based topics

## [0.1.0] — 2026-03-14

### Added
- Initial open-source release
- Silent operation log recording (< 1ms per tool call, no content stored)
- One AI call per session generates a structured digest (summary, mode, topics, outcome, notable)
- Automatic context injection at session start: developer profile, stable knowledge, session history
- `recall`, `resume`, `topics` MCP tools
- Stable knowledge distillation from high-value sessions
- Blind spot tracking from recurring notable patterns
- SQLite storage with WAL mode; all data local to `~/.nous/`
- One-line installer (`install.sh`) with GitHub release download
