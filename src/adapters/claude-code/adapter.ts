import { BaseAdapter } from '../base-adapter.js'
import type { HostEvent, HostEventPayload } from '../../types/index.js'
import { ContextBuilder } from '../../injection/context-builder.js'

// Raw hook payload as sent by Claude Code via stdin
interface ClaudeCodeHookRaw {
  session_id?: string
  hook_event_name?: string
  cwd?: string
  // PostToolUse fields
  tool_name?: string
  tool_input?: unknown
  tool_response?: unknown
  tool_use_id?: string
  // UserPromptSubmit fields
  message?: string
  // Stop fields
  stop_reason?: string
}

// Mapping from Claude Code hook event names to normalized types
const HOOK_EVENT_MAP: Record<string, HostEvent['type']> = {
  SessionStart: 'session_start',
  UserPromptSubmit: 'user_message',
  PostToolUse: 'tool_use',
  Stop: 'stop',
  SessionEnd: 'session_end',
}

export class ClaudeCodeAdapter extends BaseAdapter {
  readonly name = 'claude-code'
  private contextBuilder = new ContextBuilder()

  translateEvent(rawEvent: unknown): HostEvent | null {
    if (!rawEvent || typeof rawEvent !== 'object') return null

    const raw = rawEvent as ClaudeCodeHookRaw

    const hookName = raw.hook_event_name
    if (!hookName || !(hookName in HOOK_EVENT_MAP)) return null

    const type = HOOK_EVENT_MAP[hookName]
    if (!type) return null

    const sessionId = raw.session_id ?? 'unknown'
    const projectPath = raw.cwd ?? process.cwd()
    const timestamp = Date.now()

    let payload: HostEventPayload

    switch (type) {
      case 'session_start':
        payload = { type: 'session_start' }
        break

      case 'session_end':
        payload = { type: 'session_end' }
        break

      case 'user_message':
        payload = {
          type: 'user_message',
          content: raw.message ?? '',
        }
        break

      case 'tool_use':
        payload = {
          type: 'tool_use',
          toolName: raw.tool_name ?? 'unknown',
          toolInput: raw.tool_input ?? null,
          toolOutput: raw.tool_response ?? null,
          toolUseId: raw.tool_use_id ?? '',
        }
        break

      case 'stop':
        payload = {
          type: 'stop',
          lastAssistantMessage: raw.stop_reason,
        }
        break

      default:
        return null
    }

    return {
      type,
      sessionId,
      projectPath,
      timestamp,
      payload,
      hostMeta: {
        hookEventName: hookName,
        rawCwd: raw.cwd,
      },
    }
  }

  async buildInjectionContext(event: HostEvent): Promise<string | null> {
    // Only inject context at session start
    if (event.type !== 'session_start') return null
    return this.contextBuilder.build(event.projectPath)
  }
}
