import { toolRegistry } from '../agent/tool-registry'
import { IPC } from '../ipc/channels'
import { encodeToolError } from './tool-result-format'
import { useKnowledgeStore } from '@renderer/stores/knowledge-store'
import type { ToolHandler } from './tool-types'

const knowledgeSearchHandler: ToolHandler = {
  definition: {
    name: 'EnterpriseKnowledgeSearch',
    description:
      '搜索企业知识库（远程API）。仅在用户已在+菜单中勾选了企业知识库数据集时才可使用。若未勾选企业知识库，禁止调用此工具，改用 LocalKnowledgeSearch 搜索本地文档。',
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
      return '未选择企业知识库。请尝试调用 LocalKnowledgeSearch 工具搜索用户个人导入的本地文档。'
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
      return '知识库中未找到与该问题相关的内容，请使用自有知识回答。'
    }

    const resultText = items
      .map(
        (item, i) =>
          `【结果${i + 1}】来源: ${item.source || '未知'} | 相似度: ${Math.round(item.score * 100)}%\n${item.content}`
      )
      .join('\n\n---\n\n')
    return [
      `以下是知识库检索结果（共 ${items.length} 条），请基于以下内容回答用户问题并引用来源：`,
      '',
      resultText
    ].join('\n')
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
  toolRegistry.unregister('EnterpriseKnowledgeSearch')
}
