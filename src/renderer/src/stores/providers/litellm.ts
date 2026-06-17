import type { BuiltinProviderPreset } from './types'

/**
 * Enterprise Built-in LiteLLM Provider
 *
 * LiteLLM 作为企业 AI 网关,所有模型通过 /v1/models API 动态获取。
 * 不在 preset 中硬编码任何模型。
 */
export const liteLLMPreset: BuiltinProviderPreset = {
  builtinId: 'enterprise-litellm',
  name: '企业 AI 服务',
  type: 'openai-chat',
  // 企业 LiteLLM 服务地址
  defaultBaseUrl: 'http://192.168.77.100:4000',
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
  defaultModels: []
}
