import { toolRegistry } from '../agent/tool-registry'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import type { ToolHandler } from './tool-types'
import { listDatasets, listCollections, importFileToDataset } from '@renderer/lib/knowledge/kb-api-client'
import { useChatStore } from '@renderer/stores/chat-store'

// ==================== get_my_kb_list ====================

const getMyKbListHandler: ToolHandler = {
  definition: {
    name: 'get_my_kb_list',
    description:
      '获取当前用户可写入的个人知识库列表。仅返回个人知识库，不包含企业知识库、只读知识库和公共知识库。当用户说"保存到知识库"、"加入知识库"、"存到知识库"等意图时需要调用此工具。',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },

  execute: async (_input, ctx) => {
    try {
      const result = await listDatasets(ctx.ipc)
      if (!result.success) {
        return encodeToolError(result.error || '获取知识库列表失败')
      }
      const personal = (result.data ?? []).filter(
        (kb) => !kb.systemTag || kb.systemTag === '个人'
      )
      return encodeStructuredToolResult(
        personal.map((kb) => ({ id: kb.id, name: kb.name }))
      )
    } catch (err: unknown) {
      return encodeToolError(err instanceof Error ? err.message : '获取知识库列表失败')
    }
  },

  requiresApproval: () => false
}

// ==================== get_kb_tree ====================

const getKbTreeHandler: ToolHandler = {
  definition: {
    name: 'get_kb_tree',
    description:
      '获取指定知识库的目录树。返回根目录和所有子目录。当用户指定了知识库但未指定目录时，需要调用此工具让用户选择。',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: {
          type: 'string',
          description: '知识库 ID'
        }
      },
      required: ['kbId']
    }
  },

  execute: async (input, ctx) => {
    const kbId = String(input.kbId ?? '')
    if (!kbId) return encodeToolError('缺少知识库 ID')

    try {
      const result = await listCollections(ctx.ipc, kbId)
      if (!result.success) {
        return encodeToolError(result.error || '获取目录树失败')
      }
      const all = result.data ?? []
      // 构建目录树，只返回文件夹
      const folderMap = new Map<string, { id: string; name: string; parentId?: string | null; children: any[] }>()
      for (const item of all) {
        if (item.type === 'folder') {
          folderMap.set(item.id, { id: item.id, name: item.name, parentId: item.parentId, children: [] })
        }
      }
      const roots: any[] = []
      for (const f of folderMap.values()) {
        if (f.parentId && folderMap.has(f.parentId)) {
          folderMap.get(f.parentId)!.children.push(f)
        } else {
          roots.push(f)
        }
      }
      return encodeStructuredToolResult([
        { id: '', name: '根目录', children: [] as any[] },
        ...roots
      ])
    } catch (err: unknown) {
      return encodeToolError(err instanceof Error ? err.message : '获取目录树失败')
    }
  },

  requiresApproval: () => false
}

// ==================== save_chat_to_kb ====================

const saveChatToKbHandler: ToolHandler = {
  definition: {
    name: 'save_chat_to_kb',
    description:
      '保存聊天内容到个人知识库。将指定的内容生成为 Markdown 文档并上传到知识库指定目录。仅支持个人知识库，不支持企业知识库。调用此工具前，必须先调用 get_my_kb_list 让用户选择知识库，再调用 get_kb_tree 让用户选择目录，不可跳过目录选择步骤。parentId 必须传值，不可省略。',
    inputSchema: {
      type: 'object',
      properties: {
        kbId: {
          type: 'string',
          description: '目标知识库 ID'
        },
        parentId: {
          type: 'string',
          description: '目标目录 ID（由 get_kb_tree 返回）。必须先调用 get_kb_tree 让用户选择目录，然后将所选目录 ID 传入。如果用户选择根目录，传空字符串。'
        },
        title: {
          type: 'string',
          description: '文档标题，不含 .md 后缀。优先使用会话标题或用户问题摘要'
        },
        content: {
          type: 'string',
          description: '要保存的 Markdown 内容。应包含用户问题和 AI 回答'
        }
      },
      required: ['kbId', 'parentId', 'title', 'content']
    }
  },

  execute: async (input, ctx) => {
    const kbId = String(input.kbId ?? '')
    const parentId = input.parentId ? String(input.parentId) : undefined
    const title = String(input.title ?? '').slice(0, 100)
    const content = String(input.content ?? '')

    if (!kbId) return encodeToolError('缺少知识库 ID')
    if (!title) return encodeToolError('缺少文档标题')
    if (!content) return encodeToolError('缺少文档内容')

    // 验证是个人知识库
    try {
      const kbResult = await listDatasets(ctx.ipc)
      if (kbResult.success) {
        const kb = (kbResult.data ?? []).find((k) => k.id === kbId)
        if (kb && kb.systemTag && kb.systemTag !== '个人') {
          return encodeToolError('企业知识库为只读知识库，不允许保存 AI 对话内容，请选择个人知识库。')
        }
      }
    } catch {
      // 继续执行，信任用户选择
    }

    try {
      const sessionId = ctx.sessionId
      let sessionTitle = title
      let userQuestion = ''

      // 尝试获取会话信息来完善 Markdown
      if (sessionId) {
        try {
          const store = useChatStore.getState()
          const idx = store.sessionsById[sessionId]
          if (idx !== undefined) {
            const session = store.sessions[idx]
            if (session) {
              sessionTitle = session.title || sessionTitle
              // 找到第一条用户消息
              for (const msg of session.messages) {
                if (msg.role === 'user') {
                  const c = msg.content
                  userQuestion = typeof c === 'string' ? c : (c as any[]).map((b: any) => b.text || '').join(' ').trim()
                  if (userQuestion) break
                }
              }
            }
          }
        } catch { /* silent */ }
      }

      // 优化标题：如果会话标题是 New Conversation 或空，用用户问题作为标题
      let finalTitle = sessionTitle
      if (!finalTitle || finalTitle === 'New Conversation' || finalTitle.startsWith('New Conversation')) {
        if (userQuestion) {
          // 用用户问题的前30个字符，去掉换行和问号
          finalTitle = userQuestion.slice(0, 30).replace(/[\n?]/g, '').trim()
        }
      }
      finalTitle = finalTitle || title

      // 清理 content 中重复的标题和问题
      let cleanContent = content.trim()
      if (userQuestion) {
        // 移除开头可能重复的标题（如 ## 查询CO-FIT项目ID）
        cleanContent = cleanContent.replace(/^(#+\s*[^\n]+\n*)+/, '').trim()
        // 移除 "### 问题\n\n{问题}\n\n### 回答\n\n" 模式
        const escapedQuestion = userQuestion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        cleanContent = cleanContent.replace(
          new RegExp(`^###\\s*问题\\s*\\n*\\n*${escapedQuestion}\\s*\\n*\\n*###\\s*回答\\s*\\n*\\n*`),
          ''
        ).trim()
      }

      // 构建 Markdown
      const markdown = userQuestion
        ? `# ${finalTitle}\n\nQ:\n${userQuestion}\n\nA:\n${cleanContent}`
        : `# ${finalTitle}\n\n${cleanContent}`

      // 编码为 .md 文件并上传
      const encoder = new TextEncoder()
      const buffer = encoder.encode(markdown).buffer as ArrayBuffer

      const result = await importFileToDataset(ctx.ipc, {
        datasetId: kbId,
        fileName: `${title}.md`,
        fileBuffer: buffer,
        trainingType: 'chunk',
        parentId
      })

      if (!result.success) {
        return encodeToolError(result.error || '保存失败，请稍后重试')
      }

      return encodeStructuredToolResult({
        success: true,
        message: '已保存到知识库',
        kbId,
        title: `${title}.md`,
        parentId: parentId || '根目录'
      })
    } catch (err: unknown) {
      return encodeToolError(err instanceof Error ? err.message : '保存失败，请稍后重试')
    }
  },

  requiresApproval: () => false
}

// ==================== register ====================

export function registerKbSaveTools(): void {
  toolRegistry.register(getMyKbListHandler)
  toolRegistry.register(getKbTreeHandler)
  toolRegistry.register(saveChatToKbHandler)
}
