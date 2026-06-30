import { toolRegistry } from '../agent/tool-registry'
import { IPC } from '../ipc/channels'
import { encodeToolError } from './tool-result-format'
import { estimateTokens } from '../format-tokens'
import { useKnowledgeStore } from '@renderer/stores/knowledge-store'
import type { ToolHandler } from './tool-types'

const MAX_CONTEXT_TOKENS = 4000
const MIN_SEMANTIC_SCORE = 0.5

interface ChunkResult {
  id?: string
  content: string
  document_title?: string
  chunk_index?: number
  score?: number
}

function buildContext(items: ChunkResult[]): string {
  const parts: string[] = []
  let tokens = 0

  for (const item of items) {
    const chunkTokens = estimateTokens(item.content)
    if (tokens + chunkTokens > MAX_CONTEXT_TOKENS) {
      if (parts.length === 0) {
        // Even the first chunk is too large, include it anyway
        parts.push(item.content)
      }
      break
    }
    parts.push(item.content)
    tokens += chunkTokens
  }

  return parts.join('\n\n---\n\n')
}

const localKbSearchHandler: ToolHandler = {
  definition: {
    name: 'LocalKnowledgeSearch',
    description:
      '搜索本地个人知识库（用户自己导入的PDF/Word/Markdown等文档）。当用户提问时，先调用此工具检索本地文档，基于检索结果回答。仅在未找到本地结果时，才尝试 EnterpriseKnowledgeSearch 或 WebSearch。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或问题'
        },
        topK: {
          type: 'number',
          description: '返回结果数量，默认 10'
        }
      },
      required: ['query']
    }
  },

  execute: async (input, ctx) => {
    const query = String(input.query ?? '').trim()
    if (!query) return encodeToolError('query 不能为空')

    // Respect user toggle
    const { localKbEnabled } = useKnowledgeStore.getState()
    if (!localKbEnabled) return '个人知识库未开启。如需使用，请在输入框 + 菜单中勾选"个人知识库"。如果用户需要搜索企业知识库，请使用 KnowledgeSearch 工具。'

    const topK = typeof input.topK === 'number' ? input.topK : 10

    // Try semantic search first (requires embedding index), fallback to keyword
    let results: ChunkResult[] = []
    let usedSemantic = false

    try {
      const r = (await ctx.ipc.invoke(IPC.KNOWLEDGE_LOCAL_SEARCH_SEMANTIC, {
        query,
        topK
      })) as { success: boolean; data?: ChunkResult[]; error?: string }

      if (r.success && r.data && r.data.length > 0) {
        results = r.data
        usedSemantic = true
      }
    } catch {
      // semantic search unavailable, fallback to keyword
    }

    // Fallback to keyword search
    if (!usedSemantic) {
      try {
        const r = (await ctx.ipc.invoke(IPC.KNOWLEDGE_LOCAL_SEARCH, {
          query
        })) as { success: boolean; data?: ChunkResult[] }

        if (r.success && r.data) {
          results = r.data
        }
      } catch {
        return encodeToolError('本地知识库搜索失败')
      }
    }

    // Filter by score (semantic) or relevance (keyword has no score)
    const filtered = usedSemantic
      ? results.filter((r) => (r.score ?? 0) >= MIN_SEMANTIC_SCORE)
      : results

    if (filtered.length === 0) {
      return '本地知识库中未找到与该问题相关的内容。'
    }

    // Build context with token budget
    const context = buildContext(filtered)

    const mode = usedSemantic ? '语义搜索' : '关键词搜索'
    return [
      `以下是本地知识库${mode}结果（共 ${filtered.length} 条匹配），请基于以下内容回答用户问题：`,
      '',
      context
    ].join('\n')
  },

  requiresApproval: () => false
}

let registered = false

export function registerLocalKbSearchTool(): void {
  if (registered) return
  registered = true
  toolRegistry.register(localKbSearchHandler)
}

export function unregisterLocalKbSearchTool(): void {
  if (!registered) return
  registered = false
  toolRegistry.unregister('LocalKnowledgeSearch')
}
