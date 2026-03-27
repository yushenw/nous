# Nous

**Claude Code 的 AI 用户感知系统。** 不是记忆日志——而是对你这个开发者持续更新的用户模型。Nous 在后台静默观察你的使用行为，随时间积累画像，在每次会话开始时自动注入相关上下文，让 Claude 始终知道你上次停在哪里。

[English](./README.md)

---

## 工作原理

```
你正常使用 Claude Code
        ↓
Nous 在 < 1ms 内记录每次工具调用（无 AI，不存内容）
  — 读了哪些文件、执行了什么命令、搜索了什么关键词
        ↓
会话中：每积累 5 条消息，自动提取知识点
  — 你询问的概念、how-to 问题、项目相关见解
  — 自动写入 ~/user_memory/
        ↓
会话结束时，一次 AI 调用生成摘要
  — 一句话总结、模式分类、技术领域、值得注意的模式
        ↓
下次打开 Claude Code
  — 会话历史、最近提问、上次停止位置
    自动注入系统提示
  — Claude 不需要你解释背景，直接进入状态
```

**只存结构，不存内容。** 文件路径、命令前缀、搜索词——从不存储文件内容本身。模型用世界知识从结构中重建语义。

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

## 注入效果

积累几个会话后，每次新开 Claude Code 会话，系统提示里会自动包含：

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
### 实现知识询问追踪系统 (today)
Mode: building · Topics: worker, storage, knowledge
### 调试 recall 多词搜索 bug (1d ago) [resolved]
Mode: debugging · Topics: storage, recall, sqlite

## Last Session
**Summary:** 实现会话摘要生成器，每 session 仅一次 AI 调用
**Outcome:** resolved
```

Claude 在你说第一句话之前就已经知道这些。

---

## 知识追踪

Nous 自动追踪你跨会话中询问的问题和遇到的概念。

**工作方式：**
- 每积累 5 条消息，自动从对话中提取知识点（概念、how-to、项目见解）
- 通过 Jaccard 相似度去重——重复询问的问题权重累增
- 自动写入 `~/user_memory/`，随时打开复习

**召回带路径感知：**
- 纯概念（Jaccard 相似度、WAL 模式）无论在哪个项目问的都全局浮现
- 项目相关的 how-to 在对应目录下权重加成
- 每条记录标注来源目录，方便找到相关源文件重新温习

**自动写入的文件：**
```
~/user_memory/
  knowledge_index.md          # 全局 top-30，按权重排序，每次提取后更新
  2026-03-28/
    knowledge_log.md          # 今日提取的条目，追加写入
```

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

可用工具：

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
