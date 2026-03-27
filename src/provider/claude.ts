import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AIProvider } from './base.js'

const execFileAsync = promisify(execFile)

// JSON shape returned by `claude -p --output-format json`
interface ClaudeJsonResult {
  type: string
  subtype: string
  is_error: boolean
  result: string
}

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude'
  private model: string

  constructor(model = 'haiku') {
    this.model = model
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--model', this.model,
      '--tools', '',
      '--no-session-persistence',
    ]

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt)
    }

    const { stdout } = await execFileAsync('claude', args, {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })

    const parsed = JSON.parse(stdout.trim()) as ClaudeJsonResult

    if (parsed.is_error) {
      throw new Error(`claude -p returned error: ${parsed.result}`)
    }

    return parsed.result
  }
}
