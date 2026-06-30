import type { BuiltinProviderPreset } from './types'

/**
 * Enterprise Built-in LiteLLM Provider
 *
 * LiteLLM 作为企业 AI 网关
 */
export const liteLLMPreset: BuiltinProviderPreset = {
  builtinId: 'enterprise-litellm',
  name: '企业AI模型',
  type: 'openai-chat',
  // 企业 LiteLLM 服务地址
  defaultBaseUrl: 'http://192.168.77.100:4000/v1',
  homepage: 'https://docs.litellm.ai',
  // 只读模式:用户无法修改配置和查看密钥
  readonly: true,
  // LiteLLM Master Key (不展示给用户)
  defaultApiKey: 'sk-HIULIVoOhjNIyVK6e2hggQ',
  // 默认启用
  defaultEnabled: true,
  // 不需要用户输入 API Key (已内置)
  requiresApiKey: false,
  // 默认模型列表
  defaultModels: [
    {
      id: 'qwen3.7-plus',
      name: 'Qwen3.7-Plus',
      icon: 'qwen',
      enabled: true,
      contextLength: 262_144,
      maxOutputTokens: 8_192,
      supportsVision: true,
      supportsFunctionCall: true,
      inputPrice: 0.3,
      outputPrice: 1.2,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { thinking: { type: 'enabled' } },
        disabledBodyParams: { thinking: { type: 'disabled' } }
      }
    },
    {
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4 Flash',
      icon: 'deepseek',
      enabled: true,
      contextLength: 1_000_000,
      maxOutputTokens: 384_000,
      supportsVision: false,
      supportsFunctionCall: true,
      inputPrice: 0.14,
      outputPrice: 0.28,
      cacheCreationPrice: 0.14,
      cacheHitPrice: 0.0028,
      supportsThinking: true,
      thinkingConfig: {
        bodyParams: { enable_thinking: true },
        disabledBodyParams: { enable_thinking: false }
      }
    },
    {
      id: 'gpt-image-2-all',
      name: 'gpt-image-2-all',
      icon: 'openai',
      enabled: true,
      category: 'image',
      type: 'openai-images',
      supportsVision: true,
      supportsFunctionCall: false,
      inputPrice: 0.04,
      outputPrice: 0.08
    }
  ]
}
