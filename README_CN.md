# Nous

**Claude Code 的用户感知层插件。** Nous 在后台静默观察你的每次编程会话，逐渐建立起对你这个开发者的认知模型，并在每次新会话开始时把这些背景知识注入 Claude 的系统提示，让 Claude 始终"记得你是谁、在做什么、上次到哪了"。

[English](./README.md)

---

## 核心问题

Claude Code 每个会话都是全新的，没有跨会话记忆。你每次开新会话都要重新解释：

- 项目背景是什么
- 上次做到哪里了
- 你偏好什么技术栈
- 当前在解决什么 bug

Nous 就是要自动解决这个问题，无需用户手动操作。

---

## 架构

```
Claude Code（宿主）
    │  hooks (stdin/stdout)
    ▼
[Hook Scripts] ── HTTP ──► [Worker 服务 :37888]
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
   （轻量结构化记录）      （AI 生成摘要）
         │                     │
         └──────────┬──────────┘
                    ▼
     user_model / stable_knowledge / knowledge_items
     （用户画像 / 稳定知识 / 知识询问追踪）

[MCP Server] ── stdio ──► Claude（工具调用层）
```

---

## 工作原理

### 1. Hook 拦截 — 被动观察

Claude Code 提供四个 hook 点，Nous 全部接入：

| Hook | 触发时机 | Nous 做什么 |
|------|---------|------------|
| `SessionStart` | 新会话开始 | 拉取历史上下文注入系统提示 |
| `UserPromptSubmit` | 用户发消息 | 缓冲消息，每积累 5 条触发知识提取 |
| `PostToolUse` | 每次工具调用后 | 提取轻量 sketch 写入 `operation_log` |
| `Stop` / `SessionEnd` | 会话结束 | 触发 AI 生成 session digest |

**关键设计约束：** hook 必须快速响应（Claude Code 在等待），因此工具调用记录是同步且无 AI 的，AI 分析放到会话结束后异步处理。

### 2. Sketch 提取 — 结构化记录工具行为

不记录原始内容（太大），只提取"骨架"：

```
Read    src/storage/session-digest-store.ts:1-50
Edit    src/storage/session-digest-store.ts (modify ~3L)
Bash    bun test → exit 0
Grep    "aggregateTopics" [*.ts]
```

每条 sketch 包含：工具名、文件路径/命令前缀/查询词、是否失败、改动行数等。这是整个系统的原始数据源。

### 3. Digest 生成 — 用 AI 理解一次会话

会话结束时，把所有 sketch 喂给一个 Claude 模型（默认 Haiku），生成结构化摘要：

```json
{
  "summary": "修复了 session-digest-store.ts 中 recall 多词搜索 bug",
  "mode": "debugging",
  "domain": "tooling",
  "topics": ["storage", "recall", "search", "digest"],
  "outcome": "resolved",
  "notable": "用户在发现 LIKE 模式不支持多词后立即定位到 search 方法"
}
```

digest 是系统的核心知识单元，后续所有查询都基于它。

### 4. 知识询问追踪 — 跨会话学习

每积累 5 条消息，Nous 从对话中提取概念和 how-to，并通过 Jaccard 相似度去重：

- 重复询问的问题权重累增：`weight = 1.0 + category_base + 0.5 × 重复次数`
- 纯概念（WAL 模式、Jaccard 相似度）无论在哪个项目问的，都全局浮现
- 项目相关的 how-to 在对应目录下权重加成
- 结果自动写入 `~/user_memory/`，随时打开复习

```
~/user_memory/
  knowledge_index.md       # 全局 top-30，按权重排序，每次提取后更新
  2026-03-28/
    knowledge_log.md       # 今日提取的条目，追加写入
```

### 5. 上下文注入 — 让新会话"知道历史"

新会话开始时，`SessionStart` hook 调用 `/api/context`，将 Markdown 块注入系统提示。Claude 在你说第一句话之前就已经看到这些：

```
## Developer Profile
Active domains — web-backend, tooling
Phase — implement
Recent topics — worker, event-processor, sqlite

## Recent Questions
- [concept ×3] Jaccard 相似度 (~/pjs/nous) — 两个集合交集/并集的比值，>0.6 认为内容相似
- [howto ×2]   SQLite WAL 模式 (~/pjs/nous) — 先写日志再写主库，允许并发读
- [concept ×1] BetterSqlite3 vs sqlite3 (~/pjs/nous) — 同步库，高频查询性能更优

## Session History
### 实现知识询问追踪系统 (today)
Mode: building · Topics: worker, storage, knowledge
### 调试 recall 多词搜索 bug (1d ago) [resolved]
Mode: debugging · Topics: storage, recall, sqlite

## Last Session
**Summary:** 实现会话摘要生成器，每 session 仅一次 AI 调用
**Outcome:** resolved
```

### 6. User Model — 渐进式建立用户画像

从所有历史 digest 中持续提取：

- **活跃领域** — 从各会话的 `domain` 字段推断（web-backend、systems、tooling…）
- **工作风格** — debug 比例、当前所处阶段（explore / implement / debug）
- **盲点** — 从 `notable` 字段识别出的反复踩坑模式
- **知识兴趣** — 你反复询问的内容，按重复次数加权

---

## 分层记忆设计

```
operation_log     ←  工作记忆    （原始操作流水，< 1ms/次）
session_digests   ←  短期记忆    （每次会话的浓缩摘要）
knowledge_items   ←  询问记忆    （跨会话问题与概念）
stable_knowledge  ←  长期记忆    （值得永久保留的技术决策/发现）
user_model        ←  元认知      （对开发者本身的理解）
```

---

## 环境要求

- [Claude Code](https://claude.ai/download) 已安装并登录
- Node.js >= 18

---

## 安装

### 方式一 — 一行命令安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/yushenw/nous/main/install.sh | sh
```

脚本会自动完成：
- 将预构建脚本下载到 `~/.nous/`
- 安装原生 SQLite 依赖
- 将 hooks 注册到 `~/.claude/settings.json`

首次打开 Claude Code 时 Worker 自动启动，无需任何手动操作。

### 方式二 — 从源码安装

需要先安装 [Bun](https://bun.sh)。

```bash
git clone https://github.com/yushenw/nous.git
cd nous
bun install
bun run build-and-sync
```

然后将以下 hooks 配置合并到 `~/.claude/settings.json`：

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

重新打开一个 Claude Code 会话即可。

---

## MCP 工具（可选）

配置 Nous MCP Server 后，Claude 可以在对话中主动查询你的历史：

```json
{
  "mcpServers": {
    "nous": {
      "command": "node",
      "args": ["/home/yourname/.nous/scripts/mcp-server.cjs"]
    }
  }
}
```

将 `/home/yourname` 替换为你的实际 home 目录（`echo $HOME`）。

| 工具 | 说明 |
|------|------|
| `recall("jwt auth")` | 搜索历史会话和稳定知识 |
| `resume("rust")` | 重建最近匹配会话的工作上下文 |
| `topics()` | 列出近期活跃话题及会话次数 |
| `review()` | 按权重查看积累的知识条目 |

使用示例：

```
你：    展示最近关于 sqlite 的知识记录
Claude：（调用 review(query="sqlite")）
        [howto ×3] SQLite upsert 语法 — weight 2.9
        INSERT INTO ... ON CONFLICT(id) DO UPDATE SET col = excluded.col
        ~/pjs/nous · sqlite, sql

        [concept ×1] SQLite WAL 模式 — weight 2.5
        Write-Ahead Logging 允许写操作进行时并发读。
        ~/pjs/nous · sqlite, concurrency, performance
```

---

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `NOUS_PORT` | `37888` | Worker HTTP 端口 |
| `NOUS_DATA_DIR` | `~/.nous` | SQLite 数据库目录 |
| `NOUS_MODEL` | `haiku` | 用于 digest 和知识提取的 Claude 模型 |
| `NOUS_MEMORY_DIR` | `~/user_memory` | 知识 markdown 文件的写入目录 |
| `ANTHROPIC_API_KEY` | — | 不设置时自动复用 Claude Code 的登录态 |

---

## 数据与隐私

- 所有数据存储在本地 `~/.nous/nous.db`（SQLite）
- 文件**内容**从不存储——只存路径、命令前缀（前 60 字符）和搜索词
- 会话摘要和知识提取由 Claude 生成，使用与 Claude Code 相同的 auth
- 不向任何第三方服务发送数据

查看已录制的内容：

```bash
node -e "
const db = require('better-sqlite3')(require('os').homedir()+'/.nous/nous.db');
db.prepare('SELECT tool_name, descriptor FROM operation_log ORDER BY timestamp DESC LIMIT 20').all()
  .forEach(r => console.log(r.tool_name, JSON.parse(r.descriptor)));
"
```

---

## 更新

```bash
# 方式一 — 重新执行安装脚本
curl -fsSL https://raw.githubusercontent.com/yushenw/nous/main/install.sh | sh

# 方式二 — 从源码更新
cd nous && git pull && bun run build-and-sync
```

下次打开 Claude Code 时 Worker 自动加载新版本。

---

## 卸载

```bash
# 从 ~/.claude/settings.json 中删除 "hooks" 字段
# 然后清理数据
pkill -f worker-service.cjs || true
rm -rf ~/.nous
```

---

## 常见问题

**Q：打开 Claude Code 没有看到历史注入？**

等积累 2-3 个真实会话后注入内容才会丰富。确认 Worker 是否正在运行：
```bash
curl http://127.0.0.1:37888/api/health
```

**Q：会话摘要用的是规则生成而非 AI？**

Nous 的 AI 调用复用 Claude Code 的登录态。确认已登录：
```bash
claude auth status
```

**Q：能跨项目使用吗？**

可以。用户模型是全局的，会话历史按项目路径分开存储，注入时只包含当前项目相关的内容。纯概念类知识条目不受项目限制，会在所有项目中浮现。

**Q：知识条目写在哪里，如何复习？**

自动写入 `~/user_memory/`。`knowledge_index.md` 是全局索引，每次提取后自动更新，打开即可复习。也可通过 MCP 工具 `review()` 在对话中直接查看。

---

## License

MIT
