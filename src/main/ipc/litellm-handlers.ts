import { ipcMain, net } from 'electron'

interface LiteLLMModelItem {
  id: string
  object: string
  created: number
  owned_by: string
  root: string
  parent: string | null
  max_tokens?: number
  max_input_tokens?: number
  max_output_tokens?: number
  litellm_provider?: string
  mode?: string
  supports_vision?: boolean
  supports_function_calling?: boolean
}

interface LiteLLMModelResponse {
  object: string
  data: LiteLLMModelItem[]
}

export function registerLiteLLMHandlers(): void {
  ipcMain.handle(
    'litellm:discover-models',
    async (
      _event,
      args: { baseUrl: string; apiKey: string }
    ): Promise<{ models?: unknown[]; error?: string }> => {
      try {
        const normalizedBaseUrl = args.baseUrl.replace(/\/+$/, '')
        const url = `${normalizedBaseUrl}/v1/models`

        // Use Electron's net module (no CORS restrictions)
        const response = await net.fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${args.apiKey}`,
            'Content-Type': 'application/json'
          }
        })

        if (!response.ok) {
          return {
            error: `LiteLLM API returned ${response.status}: ${response.statusText}`
          }
        }

        const data: LiteLLMModelResponse = await response.json()

        const models = data.data.map((model) => {
          const contextLength = model.max_input_tokens || model.max_tokens || 128_000
          const maxOutputTokens = model.max_output_tokens || 8_192

          return {
            id: model.id,
            name: model.id,
            icon: 'openai',
            enabled: true,
            contextLength,
            maxOutputTokens,
            supportsVision: model.supports_vision === true,
            supportsFunctionCall: model.supports_function_calling === true,
            supportsThinking: false,
            type: 'openai-chat'
          }
        })

        return { models }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )
}
