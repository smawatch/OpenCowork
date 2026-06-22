import { toolRegistry } from '../agent/tool-registry'
import { IPC } from '../ipc/channels'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import { useKnowledgeStore } from '@renderer/stores/knowledge-store'
import type { ToolHandler } from './tool-types'

const knowledgeSearchHandler: ToolHandler = {
  definition: {
    name: 'KnowledgeSearch',
    description:
      '搜索知识库，根据关键词或问题检索相关文档片段。返回最匹配的内容摘要、来源文件和相似度评分。如果用户已选择特定知识库，则只搜索已选的知识库。',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词或问题'
        },
        datasetIds: {
          type: 'array',
          items: { type: 'string' },
          description: '可选，指定搜索的知识库 ID 列表，不传则使用用户在菜单中已选择的知识库，若也未选择则搜索所有可见知识库'
        },
        topK: {
          type: 'number',
          description: '返回结果数量，默认 5'
        },
        score: {
          type: 'number',
          description: '最低相似度阈值 0~1，默认 0.7'
        }
      },
      required: ['query']
    }
  },

  execute: async (input, ctx) => {
    const query = String(input.query ?? '').trim()
    if (!query) return encodeToolError('query 不能为空')

    // If user specified datasetIds, use them; otherwise use the selected ones from the menu
    const explicitIds = Array.isArray(input.datasetIds) ? input.datasetIds : []
    const selectedIds = explicitIds.length > 0 ? explicitIds : useKnowledgeStore.getState().selectedDatasetIds

    // No KBs selected — tell agent to proceed without KB results
    if (selectedIds.length === 0) {
      return encodeStructuredToolResult({ message: '未选择知识库，请使用自有知识回答' })
    }

    console.log(`[知识库搜索] 开始检索 | query=${query} | selectedIds=${JSON.stringify(selectedIds)}`)

    const result = (await ctx.ipc.invoke(IPC.KNOWLEDGE_SEARCH, {
      query,
      datasetIds: selectedIds,
      topK: typeof input.topK === 'number' ? input.topK : 5,
      score: typeof input.score === 'number' ? input.score : 0.6
    })) as {
      success: boolean
      data?: Array<{
        id: string
        content: string
        source: string
        score: number
        datasetId: string
      }>
      error?: string
    }

    if (!result.success) {
      return encodeToolError(result.error || '知识库检索失败')
    }

    const items = result.data ?? []
    if (items.length === 0) {
      return encodeStructuredToolResult({ message: '未找到相关内容' })
    }

    const resultText = items
      .map(
        (item, i) =>
          `【结果${i + 1}】来源: ${item.source || '未知'} | 相似度: ${Math.round(item.score * 100)}%\n${item.content}`
      )
      .join('\n\n---\n\n')
    return encodeStructuredToolResult({ query, results: resultText, count: items.length })
  },

  requiresApproval: () => false
}

let registered = false

export function registerKnowledgeSearchTool(): void {
  if (registered) return
  registered = true
  toolRegistry.register(knowledgeSearchHandler)
}

export function unregisterKnowledgeSearchTool(): void {
  if (!registered) return
  registered = false
  toolRegistry.unregister('KnowledgeSearch')
}
