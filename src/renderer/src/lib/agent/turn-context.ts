import type { ContentBlock, UnifiedMessage } from '../api/types'
import type { IPCClient } from '../tools/tool-types'
import { useKnowledgeStore } from '../../stores/knowledge-store'
import { IPC } from '../ipc/channels'

export interface TurnContextOptions {
  planMode?: boolean
}

function buildTurnContextText(options: TurnContextOptions): string | null {
  if (!options.planMode) return null

  return [
    '<turn-context>',
    '<plan-mode>enabled; inspect and write plans only unless implementation is explicitly approved for this turn.</plan-mode>',
    '</turn-context>'
  ].join('\n')
}

function prependTextToContent(content: UnifiedMessage['content'], text: string): UnifiedMessage['content'] {
  if (typeof content === 'string') return `${text}\n\n${content}`

  const contextBlock: ContentBlock = { type: 'text', text }
  return [contextBlock, ...content]
}

export function prependTurnContextToLastUserMessage(
  messages: UnifiedMessage[],
  options: TurnContextOptions
): UnifiedMessage[] {
  const contextText = buildTurnContextText(options)
  if (!contextText) return messages

  const lastUserIndex = messages.reduce((index, message, currentIndex) => {
    return message.role === 'user' ? currentIndex : index
  }, -1)

  if (lastUserIndex < 0) return messages

  return messages.map((message, index) => {
    if (index !== lastUserIndex) return message
    return {
      ...message,
      content: prependTextToContent(message.content, contextText)
    }
  })
}

function extractUserQuery(messages: UnifiedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'user') continue
    if (typeof msg.content === 'string') return msg.content
    const textBlocks = msg.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    return textBlocks.map((b) => b.text).join('\n')
  }
  return ''
}

export async function applyKnowledgeBaseSearch(
  messages: UnifiedMessage[],
  ipc: IPCClient
): Promise<UnifiedMessage[]> {
  const state = useKnowledgeStore.getState()
  const selectedIds = state.selectedDatasetIds
  if (selectedIds.length === 0) return messages

  const query = extractUserQuery(messages)
  if (!query.trim()) return messages

  const names = state.datasetNames ?? {}
  const selectedNames = selectedIds.map((id) => names[id] || id)
  console.log(`[知识库] 自动检索 | 查询="${query.slice(0, 50)}" | 知识库=[${selectedNames.join(', ')}]`)

  try {
    console.log(`[知识库] 开始检索...`)
    const result = (await ipc.invoke(IPC.KNOWLEDGE_SEARCH, {
      query,
      datasetIds: selectedIds,
      topK: 5,
      score: 0.5
    })) as {
      success: boolean
      data?: Array<{ content: string; source: string; score: number }>
      error?: string
    }

    console.log(`[知识库] 检索结果:`, {
      success: result.success,
      count: result.data?.length ?? 0,
      error: result.error,
      items: result.data?.map((d) => ({
        source: d.source,
        score: Math.round(d.score * 100) + '%',
        contentPreview: d.content?.slice(0, 80) + '...'
      }))
    })

    if (!result.success || !result.data || result.data.length === 0) {
      console.log(`[知识库] 无结果返回，将不带知识库上下文发送`)
      return messages
    }

    const items = result.data
    const contextText = [
      '<knowledge-base-results>',
      '以下是从知识库中检索到的相关内容，请基于这些内容回答用户问题：',
      '',
      ...items.map(
        (item, i) =>
          `[${i + 1}] 来源: ${item.source || '未知'} | 相似度: ${Math.round(item.score * 100)}%\n${item.content}`
      ),
      '</knowledge-base-results>'
    ].join('\n')

    console.log(`[知识库] 已插入上下文，长度: ${contextText.length} 字符`)
    console.log(`[知识库] 上下文内容:\n${contextText}`)

    const lastUserIndex = messages.reduce((index, message, currentIndex) => {
      return message.role === 'user' ? currentIndex : index
    }, -1)

    if (lastUserIndex < 0) return messages

    return messages.map((message, index) => {
      if (index !== lastUserIndex) return message
      return {
        ...message,
        content: prependTextToContent(message.content, contextText)
      }
    })
  } catch {
    // Search failed silently — let the LLM answer without KB context
    return messages
  }
}
