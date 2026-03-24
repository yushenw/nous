import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { AIProvider } from './base.js'

// Default model to use for all completions
const DEFAULT_MODEL = 'claude-3-5-haiku-20241022'

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude'
  private model: ReturnType<ReturnType<typeof createAnthropic>>

  constructor(modelId = DEFAULT_MODEL) {
    // If ANTHROPIC_API_KEY is set, use it directly.
    // Otherwise let the SDK pick up Claude Code CLI auth automatically.
    const anthropic = process.env.ANTHROPIC_API_KEY
      ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : createAnthropic()

    this.model = anthropic(modelId)
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      prompt,
      ...(systemPrompt ? { system: systemPrompt } : {}),
    })
    return text
  }
}
