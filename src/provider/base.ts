// AIProvider: abstraction over different AI backends
export interface AIProvider {
  name: string
  complete(prompt: string, systemPrompt?: string): Promise<string>
}
