import type { BuiltinProviderPreset } from './types'

export const liteLLMPreset: BuiltinProviderPreset = {
  builtinId: 'litellm',
  name: 'LiteLLM',
  type: 'openai-chat',
  defaultBaseUrl: 'http://localhost:4000',
  homepage: 'https://docs.litellm.ai',
  apiKeyUrl: 'https://docs.litellm.ai/docs/providers',
  defaultModels: [
    {
      id: 'litellm-default',
      name: 'LiteLLM Default',
      icon: 'openai',
      enabled: true,
      contextLength: 128_000,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true
    }
  ],
  ui: {
    description: 'Enterprise AI gateway supporting 100+ LLM providers with unified OpenAI-compatible API',
    features: ['Multi-provider routing', 'Cost tracking', 'Load balancing', 'Retry logic']
  }
}
