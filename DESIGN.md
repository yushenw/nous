# Nous — 初步设计文档

> 日期：2026-03-23
> 一句话定位：不是记忆系统，是用户感知系统。像推荐算法一样持续建模开发者，预测意图，按需提供认知辅助，让 AI 真正懂你。

---

## 一、核心理念

### 范式转变

| 传统记忆系统 | Nous |
|------------|------|
| 记录事件，按时间回放 | 建模用户，按意图感知 |
| 固定注入 N 条观察 | 动态按需拉取上下文 |
| "你上次做了什么" | "你是什么样的人，现在想做什么" |
| 推送模式 | 拉取模式 + 意图预取 |

核心比喻：TikTok 不存"你看过哪些视频"，它存的是"你是什么样的人"。Nous 不存"你改了哪个文件"，它存的是"你是什么样的开发者，当前关注什么"。

---

## 二、用户模型（User Model）

Nous 的核心资产是持续更新的用户模型，而不是事件日志：

```typescript
interface UserModel {
  // 稳定特征（慢变）
  expertise: Record<string, 'deep' | 'mid' | 'shallow'>  // { rust: 'deep', react: 'mid' }
  working_style: {
    prefers_tdd: boolean
    function_size: 'small' | 'medium' | 'large'
    comments_habit: 'none' | 'sparse' | 'detailed'
    refactor_first: boolean
    // ...
  }
  blind_spots: string[]  // 反复出错的模式

  // 动态状态（快变）
  current_focus: {
    project_goal: string
    current_phase: 'explore' | 'implement' | 'debug' | 'refactor'
    known_blockers: string[]
  }
  cognitive_state: 'exploring' | 'focused' | 'debugging' | 'stuck'

  // 工作模式（统计涌现）
  patterns: {
    peak_hours: number[]
    avg_session_length: number
    topic_switch_frequency: number
  }
}
```

---

## 三、动态上下文注入

**当前 claude-mem 的问题**：SessionStart 固定注入 N 条观察，浪费 token 且不精准。

**Nous 的设计**：

```
SessionStart
  → 注入极简用户画像摘要（<200 token）
  → 模型收到 recall() 工具

对话中（模型自主决策）：
  → 需要历史决策？调用 recall("auth architecture decisions")
  → 需要用户偏好？调用 recall("user coding style")
  → 需要踩坑记录？调用 recall("gotchas in payment module")

意图感知预取（可选）：
  → UserPromptSubmit 后，用第一条消息做语义检索
  → 把最相关的记忆静默追加到系统提示
  → 模型感知不到注入，但有了上下文
```

核心原则：**模型知道自己不知道什么，然后主动去取**，而不是被动接收大量可能无关的上下文。

---

## 四、多层信号建模

像推荐系统一样，从多维信号持续更新用户模型：

| 信号类型 | 来源 | 建模内容 |
|---------|------|---------|
| 显式信号 | 用户直接说的 | 明确偏好、目标 |
| 隐式行为 | 接受/拒绝/撤销建议 | 真实偏好 vs 表达偏好 |
| 工具调用序列 | 解题策略模式 | 思维方式、工作习惯 |
| 时间模式 | 会话时长、话题切换 | 认知状态 |
| 错误模式 | 反复出现的 bug / 反复问同类问题 | 知识盲区 |

---

## 五、分层记忆架构

```
永久知识层（Stable Knowledge）
  存储：架构决策、踩坑记录、用户偏好、领域规律
  特性：不受数量淘汰，始终可检索
  来源：AI 从工作记忆中蒸馏，或用户手动 pin

工作记忆层（Working Memory）
  存储：当前项目上下文、近期发现、活跃任务
  特性：时间衰减，按重要性评分
  来源：日常工具调用、对话分析

事件日志层（Event Log）
  存储：原始操作记录
  特性：一般不注入，但可供检索
  来源：所有 Hook 事件
```

---

## 六、架构设计

### 分层抽象（跨平台核心设计原则）

```
┌─────────────────────────────────────┐
│          Host Adapter Layer          │
│  ClaudeCodeAdapter | ClawAdapter     │  ← 各宿主的 Hook/Event 翻译
├─────────────────────────────────────┤
│       Signal Normalization           │  ← 统一事件格式 HostEvent
├─────────────────────────────────────┤
│         User Model Engine            │  ← 核心，宿主无关
│   perception + intent modeling       │
├─────────────────────────────────────┤
│         Memory Store Layer           │
│   SQLite (结构化) + LanceDB (向量)    │  ← 存储抽象，可换后端
├─────────────────────────────────────┤
│       Injection Protocol             │
│  SystemPrompt | ToolResult | RAG     │  ← 各宿主注入方式不同
└─────────────────────────────────────┘
```

### 标准化事件接口

```typescript
interface HostEvent {
  type: 'tool_use' | 'user_message' | 'session_start' | 'session_end'
  payload: NormalizedPayload
  hostMeta: Record<string, unknown>  // 宿主特有信息，不影响核心层
}
```

每个宿主只需实现一个 Adapter，把自己的事件格式翻译成 `HostEvent`，核心层完全不关心宿主。

---

## 七、技术选型

| 模块 | 选型 | 原因 |
|------|------|------|
| 运行时 | Bun | 速度快，原生 TypeScript |
| 构建 | esbuild | 快、单文件输出 |
| 结构化存储 | SQLite (better-sqlite3) | 轻量、无依赖 |
| 向量存储 | LanceDB 或 sqlite-vec | 纯 JS/Rust，**无需独立 Python 进程**（取代 ChromaDB） |
| AI 调用抽象 | Vercel AI SDK Provider | 成熟、统一接口、支持流式、Provider 可插拔 |
| 语言 | TypeScript (strict) | 类型安全 |

**关键改进**：用 LanceDB/sqlite-vec 替代 ChromaDB，消除 Python 守护进程依赖，大幅简化部署。

---

## 八、AI Provider 抽象

支持多 Provider，统一接口：

- **Claude**（默认，使用 Claude Code CLI auth，无需额外密钥）
- **Gemini**（`NOUS_GEMINI_API_KEY`）
- **OpenRouter**（`NOUS_OPENROUTER_API_KEY`，可用免费模型）
- **Ollama**（本地模型，隐私敏感场景）

---

## 九、跨目录 / 跨项目记忆衔接（Feature: Context Bridge）

### 问题

当前所有记忆系统（包括 claude-mem）的记忆都绑定在项目目录下。切换项目就是切换记忆，即使两个项目高度相关（如从 A 项目切换到调用 A 的 B 项目），上下文完全断裂。

### 目标

让开发者在切换项目或重新打开 AI 时，能**无缝衔接上次的工作状态**，不需要重新解释背景。

### 设计方案

#### 9.1 自动上下文桥接（主动感知）

SessionStart 时，自动分析：
- 当前目录是否与近期活跃项目有关联（git remote、package.json dependencies、import 路径等）
- 用户上次会话是在哪个目录、做什么
- 如果检测到关联，自动拉取跨项目的相关记忆注入上下文

```
打开 ~/pjs/nous ← 系统自动检测
  → 发现上次活跃会话在 ~/pjs/claude-mem（2小时前）
  → 发现两个项目主题相关（AI 记忆系统）
  → 自动注入：「上次你在 claude-mem 分析了架构问题，
               最后讨论了推荐系统式的用户建模方案，
               当前项目 nous 是基于此的重构」
  → Claude 无需用户解释，直接进入工作状态
```

#### 9.2 被动唤醒（Slash 命令）

用户主动触发时快速重建上下文：

```
/resume          → 分析意图，注入最相关的跨项目历史，快速进入工作状态
/resume <项目名>  → 明确指定从哪个项目衔接
/context bridge  → 显示检测到的项目关联，让用户确认后注入
```

#### 9.3 全局记忆 vs 项目记忆

引入作用域概念：

```
global scope：用户画像、跨项目通用的偏好、技术栈专长
project scope：项目特定的架构决策、踩坑记录、当前任务
session scope：本次会话的工作记忆，会话结束后蒸馏入上层
```

检索时，`global` 记忆始终可用，`project` 记忆按当前目录或关联性自动选取。

#### 9.4 项目关联图谱

自动构建项目间的关联关系：
- 相同 git remote organization
- 互相 import / 依赖
- 用户在同一时期频繁切换
- 用户明确声明（`/link project-a project-b`）

切换项目时，沿关联图谱检索相关记忆，而不是硬切断。

---

## 十、优先级规划

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 抽象层架构 + ClaudeCode Adapter | 基础骨架 |
| P0 | User Model 数据结构 + 存储层 | 核心资产 |
| P0 | 动态 recall() 工具注入 | 替代固定注入 |
| P1 | 意图感知预取（UserPromptSubmit RAG） | 体验提升 |
| P1 | Context Bridge（跨项目衔接）| 解决核心痛点 |
| P1 | /resume 命令 | 被动衔接入口 |
| P2 | 重要性评分 + 时间衰减 | 记忆质量优化 |
| P2 | Viewer UI | 可观测性 |
| P3 | OpenClaw Adapter | 跨平台扩展 |
| P3 | Ollama Provider | 本地模型支持 |
