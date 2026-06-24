import type { BuiltinProviderPreset } from './types'

/**
 * Enterprise Built-in LiteLLM Provider
 *
 * LiteLLM 作为企业 AI 网关
 */
export const liteLLMPreset: BuiltinProviderPreset = {
  builtinId: 'enterprise-litellm',
  name: '企业 AI 服务',
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
  // 模型列表完全通过 LiteLLM /v1/models 接口动态加载
  // 这里提供空数组,启动时会自动调用 API 获取
  defaultModels: [
    {
      id: 'qwen3.6-flash',
      name: 'Qwen3.6 Flash',
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
    }
    // ,{
    //   id: 'deepseek-v4-flash',
    //   name: 'deepseek-v4-flash',
    //   icon: 'qwen',
    //   enabled: true,
    //   contextLength: 262_144,
    //   maxOutputTokens: 8_192,
    //   supportsVision: true,
    //   supportsFunctionCall: true,
    //   inputPrice: 0.3,
    //   outputPrice: 1.2,
    //   supportsThinking: true,
    //   thinkingConfig: {
    //     bodyParams: { thinking: { type: 'enabled' } },
    //     disabledBodyParams: { thinking: { type: 'disabled' } }
    //   }
    // }
    ,
    {
      id: 'qwen-image-2.0',
      name: 'qwen-image-2.0',
      icon: 'qwen',
      enabled: true,
      category: 'image',
      supportsVision: true,
      supportsFunctionCall: false,
      inputPrice: 0.04,
      outputPrice: 0.08
    },
    // {
    //   id: 'gpt-image-2',
    //   name: 'GPT-Image 2',
    //   icon: 'openai',
    //   enabled: true,
    //   category: 'image',
    //   type: 'openai-images',
    //   supportsVision: true,
    //   supportsFunctionCall: false,
    //   inputPrice: 0.04,
    //   outputPrice: 0.08
    // }
  ]
}
