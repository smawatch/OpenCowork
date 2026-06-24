import { liteLLMPreset } from '@renderer/stores/providers/litellm'

export type { BuiltinProviderPreset } from './types'

import { baiduCodingPreset, baiduPreset } from './baidu'
import { routinAiPlanPreset, routinAiPreset } from './routin-ai'
import { openaiPreset } from './openai'
import { anthropicPreset } from './anthropic'
import { longcatPreset } from './longcat'
import { googlePreset } from './google'
import { deepseekPreset } from './deepseek'
import { openrouterPreset } from './openrouter'
import { ollamaPreset } from './ollama'
import { azureOpenaiPreset } from './azure-openai'
import { moonshotCodingPreset, moonshotPreset } from './moonshot'
import { qwenCodingPreset, qwenPreset } from './qwen'
import { minimaxCodingPreset, minimaxPreset } from './minimax'
import { siliconflowPreset } from './siliconflow'
import { giteeAiPreset } from './gitee-ai'
import { codexOAuthPreset } from './codex-oauth'
import { copilotOAuthPreset } from './copilot-oauth'
import { xiaomiCodingPreset, xiaomiPreset } from './xiaomi'
import { bigmodelCodingPreset, bigmodelPreset } from './bigmodel'
import { volcenginePreset } from './volcengine'
import type { BuiltinProviderPreset } from './types'

export const builtinProviderPresets: BuiltinProviderPreset[] = [
  baiduPreset,
  baiduCodingPreset,
  liteLLMPreset,
  routinAiPreset,
  routinAiPlanPreset,
  openaiPreset,
  anthropicPreset,
  longcatPreset,
  googlePreset,
  deepseekPreset,
  openrouterPreset,
  ollamaPreset,
  azureOpenaiPreset,
  moonshotCodingPreset,
  moonshotPreset,
  qwenCodingPreset,
  qwenPreset,
  minimaxCodingPreset,
  minimaxPreset,
  siliconflowPreset,
  giteeAiPreset,
  codexOAuthPreset,
  copilotOAuthPreset,
  xiaomiCodingPreset,
  xiaomiPreset,
  bigmodelCodingPreset,
  bigmodelPreset,
  volcenginePreset
]
