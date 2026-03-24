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
会话结束时，一次 AI 调用生成一句话摘要
        ↓
下次打开 Claude Code
  — 最近话题、会话历史、上次停止的位置
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
Expertise — expert: typescript · familiar: rust · learning: tokio
Recent topics — nous, event-processor, mcp, sqlite

## Session History
### 实现 Phase 3 会话蒸馏，替换每次工具调用的 AI 分析 (today)
Mode: building · Topics: nous, digest, typescript
### 调试 better-sqlite3 native module 部署问题 (1d ago) [resolved]
Mode: debugging · Topics: nodejs, sqlite, deployment

## Last Session
**Summary:** 实现会话摘要生成器，每 session 仅一次 AI 调用
**Outcome:** resolved
```

Claude 在你说第一句话之前就已经知道这些。

---

## MCP 工具（可选）

配置 Nous MCP Server 后，Claude 可以在对话中主动查询你的历史：

```json
{
  "mcpServers": {
    "nous": {
      "command": "node",
      "args": ["~/.nous/scripts/mcp-server.cjs"]
    }
  }
}
```

可用工具：

| 工具 | 说明 |
|------|------|
| `recall("jwt auth")` | 搜索历史会话和稳定知识 |
| `resume("rust")` | 重建最近匹配会话的工作上下文 |
| `topics()` | 列出近期活跃话题及会话次数 |

使用示例：

```
你：    继续上次的 auth 工作
Claude：（调用 resume("auth")）
        上次你在实现 JWT refresh token 轮换。
        修改了 src/auth/jwt.ts，新建了 src/auth/refresh.ts。
        会话结束时还有一个测试没有通过。
        要从那个失败的测试开始吗？
```

---

## 配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| `NOUS_PORT` | `37888` | Worker HTTP 端口 |
| `NOUS_DATA_DIR` | `~/.nous` | 数据目录 |
| `ANTHROPIC_API_KEY` | — | 不设置时自动复用 Claude Code 的登录态 |

---

## 数据与隐私

- 所有数据存储在本地 `~/.nous/nous.db`（SQLite）
- 文件**内容**从不存储——只存路径、命令前缀（前 60 字符）和搜索词
- 会话摘要由 Claude 生成，使用与 Claude Code 相同的 auth
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

等积累 2-3 个真实会话后注入内容才会丰富。可以确认 Worker 是否正在运行：
```bash
curl http://127.0.0.1:37888/api/health
```

**Q：会话摘要用的是规则生成而非 AI？**

Nous 的 AI 调用复用 Claude Code 的登录态。确认已登录：
```bash
claude auth status
```

**Q：能跨项目使用吗？**

可以。用户模型是全局的，会话历史按项目路径分开存储，注入时只包含当前项目相关的内容。

---

## License

MIT
