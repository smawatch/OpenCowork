import type { AIModelConfig } from './types'
import { ipcClient } from '../ipc/ipc-client'

/**
 * Fetch available models from LiteLLM API via main process IPC
 * Uses Electron's net module in main process to avoid CORS issues
 * @param baseUrl LiteLLM base URL (e.g., http://localhost:4000)
 * @param apiKey LiteLLM Master Key
 * @returns List of AIModelConfig
 */
export async function discoverLiteLLMModels(
  baseUrl: string,
  apiKey: string
): Promise<AIModelConfig[]> {
  const result = (await ipcClient.invoke('litellm:discover-models', {
    baseUrl,
    apiKey
  })) as { models?: AIModelConfig[]; error?: string }

  if (result.error) {
    throw new Error(result.error)
  }

  return result.models || []
}

/**
 * Check if a provider is a LiteLLM provider
 */
export function isLiteLLMProvider(builtinId?: string): boolean {
  return builtinId === 'enterprise-litellm'
}
