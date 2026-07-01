import { ipcMain } from 'electron'
import { readSettings } from './settings-handlers'
// import { readConfig } from './secure-key-store'
import { getServerUrl } from '../lib/server-url'
import {
  createLocalDocument,
  listLocalDocuments,
  listLocalChunks,
  deleteLocalDocument,
  searchLocalDocuments,
  saveChunkEmbedding,
  getAllChunksWithEmbeddings,
  getDocumentEmbeddedCount,
  getChunksWithoutEmbeddings,
  replaceDocumentChunks,
  setCleaningStatus,
  getCleaningStatus
} from '../db/local-knowledge-dao'
import { parseFileText } from '../lib/file-parser'
import { cleanupMarkdown } from '../lib/cleanup-md'
import {
  embedTexts,
  searchByEmbedding,
  rerankDocuments,
  type ChunkWithEmbedding
} from '../lib/embedding'

export function registerKnowledgeHandlers(): void {
  ipcMain.handle('knowledge:list-datasets', async () => {
    const serverUrl = getServerUrl()
    const settings = readSettings()
    const token =
      typeof settings.authToken === 'string' && settings.authToken.trim()
        ? settings.authToken.trim()
        : ''

    console.log(
      `[知识库] 获取知识库列表 | serverUrl=${serverUrl} | token前20位=${token ? token.slice(0, 20) + '...' : '无'}`
    )

    if (!token) {
      console.warn('[知识库] 未登录，无Token')
      return { success: false, error: '未登录' }
    }

    const url = `${serverUrl}/api/knowledge/public/datasets`
    console.log(`[知识库] GET ${url}`)

    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const body = await response.json()
      console.log(`[知识库] 响应 ${response.status}:`, JSON.stringify(body).slice(0, 300))

      if (!response.ok) {
        return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
      }
      return { success: true, data: body.data }
    } catch (err: any) {
      console.error(`[知识库] 请求失败:`, err.message || err)
      return { success: false, error: err.message || '网络错误' }
    }
  })

  ipcMain.handle(
    'knowledge:list-collections',
    async (_event, args: { kbId: string }) => {
      const serverUrl = getServerUrl()
      const settings = readSettings()
      const token =
        typeof settings.authToken === 'string' && settings.authToken.trim()
          ? settings.authToken.trim()
          : ''

      console.log(`[知识库] 获取数据集 | kbId=${args.kbId} | serverUrl=${serverUrl} | token前20位=${token ? token.slice(0, 20) + '...' : '无'}`)

      if (!token) {
        console.warn('[知识库] 未登录，无Token')
        return { success: false, error: '未登录' }
      }

      const url = `${serverUrl}/api/knowledge/public/datasets/${args.kbId}/collections`
      console.log(`[知识库] GET ${url}`)

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const body = await response.json()
        console.log(`[知识库] 响应 ${response.status}:`, JSON.stringify(body).slice(0, 300))

        if (!response.ok) {
          return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
        }
        return { success: true, data: body.data, total: body.total }
      } catch (err: any) {
        console.error(`[知识库] 请求失败:`, err.message || err)
        return { success: false, error: err.message || '网络错误' }
      }
    }
  )

  ipcMain.handle(
    'knowledge:list-chunks',
    async (_event, args: { collectionId: string }) => {
      const serverUrl = getServerUrl()
      const settings = readSettings()
      const token =
        typeof settings.authToken === 'string' && settings.authToken.trim()
          ? settings.authToken.trim()
          : ''

      console.log(`[知识库] 获取分块 | collectionId=${args.collectionId} | serverUrl=${serverUrl}`)

      if (!token) {
        console.warn('[知识库] 未登录，无Token')
        return { success: false, error: '未登录' }
      }

      const url = `${serverUrl}/api/knowledge/public/collections/${args.collectionId}/data`
      console.log(`[知识库] GET ${url}`)

      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        })
        const body = await response.json()
        console.log(`[知识库] 响应 ${response.status}:`, JSON.stringify(body).slice(0, 300))

        if (!response.ok) {
          return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
        }
        return { success: true, data: body.data, total: body.total }
      } catch (err: any) {
        console.error(`[知识库] 请求失败:`, err.message || err)
        return { success: false, error: err.message || '网络错误' }
      }
    }
  )

  ipcMain.handle(
    'knowledge:search',
    async (_event, args: { query: string; datasetIds?: string[]; topK?: number; score?: number }) => {
      const serverUrl = getServerUrl()
      const settings = readSettings()
      const token =
        typeof settings.authToken === 'string' && settings.authToken.trim()
          ? settings.authToken.trim()
          : ''

      console.log(`[知识库] 检索 | query=${args.query} | topK=${args.topK ?? 5}`)

      if (!token) {
        return { success: false, error: '未登录' }
      }

      const url = `${serverUrl}/api/knowledge/public/search`
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            query: args.query,
            datasetIds: args.datasetIds ?? [],
            topK: args.topK ?? 5,
            score: args.score ?? 0.6
          })
        })
        const body = await response.json()
        console.log(`[知识库] 检索响应 ${response.status}:`, JSON.stringify(body).slice(0, 300))

        if (!response.ok) {
          return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
        }
        return { success: true, data: body.data }
      } catch (err: any) {
        console.error(`[知识库] 检索失败:`, err.message || err)
        return { success: false, error: err.message || '网络错误' }
      }
    }
  )

  // Local Knowledge Base handlers
  ipcMain.handle('knowledge:local:create', async (_event, args: { title: string; content: string }) => {
    try {
      const doc = createLocalDocument(args.title, args.content)
      return { success: true, data: doc }
    } catch (err: any) {
      console.error('[本地知识库] 创建失败:', err.message || err)
      return { success: false, error: err.message || '创建失败' }
    }
  })

  ipcMain.handle('knowledge:local:list', async () => {
    try {
      const docs = listLocalDocuments()
      return { success: true, data: docs }
    } catch (err: any) {
      console.error('[本地知识库] 列表失败:', err.message || err)
      return { success: false, error: err.message || '列表失败' }
    }
  })

  ipcMain.handle('knowledge:local:get-chunks', async (_event, args: { documentId: string }) => {
    try {
      const chunks = listLocalChunks(args.documentId)
      return { success: true, data: chunks }
    } catch (err: any) {
      console.error('[本地知识库] 获取分块失败:', err.message || err)
      return { success: false, error: err.message || '获取分块失败' }
    }
  })

  ipcMain.handle('knowledge:local:delete', async (_event, args: { id: string }) => {
    try {
      const deleted = deleteLocalDocument(args.id)
      return deleted
        ? { success: true }
        : { success: false, error: '文档不存在' }
    } catch (err: any) {
      console.error('[本地知识库] 删除失败:', err.message || err)
      return { success: false, error: err.message || '删除失败' }
    }
  })

  ipcMain.handle('knowledge:local:search', async (_event, args: { query: string }) => {
    try {
      const results = searchLocalDocuments(args.query)
      return { success: true, data: results }
    } catch (err: any) {
      console.error('[本地知识库] 搜索失败:', err.message || err)
      return { success: false, error: err.message || '搜索失败' }
    }
  })

  ipcMain.handle('knowledge:local:import-file', async (_event, args: { filePath: string; title: string }) => {
    try {
      const text = await parseFileText(args.filePath)
      if (!text.trim()) return { success: false, error: '无法提取文件内容' }

      const doc = createLocalDocument(args.title, text)

      // Background LLM cleanup — uses separate cleanup config
      const storeSettings = readSettings()
      const persistedState = (storeSettings['opencowork-settings'] as any)?.state
      const apiKey = (persistedState?.cleanupApiKey as string) || ''
      const baseUrl = (persistedState?.cleanupBaseUrl as string) || ''
      const model = (persistedState?.cleanupModel as string) || ''

      const doClean = apiKey && model && text.length > 200 && text.length <= 500_000
      console.log(`[本地知识库] LLM 清洗检查: apiKey=${apiKey ? 'yes' : 'no'} model=${model || 'no'} len=${text.length} doClean=${doClean}`)
      if (doClean) {
        setCleaningStatus(doc.id, 'cleaning')
        console.log(`[本地知识库] 开始 LLM 清洗 (${text.length} 字符)...`)
        const t0 = Date.now()
        cleanupMarkdown(text, apiKey, baseUrl, model)
          .then((cleaned) => {
            replaceDocumentChunks(doc.id, cleaned)
            setCleaningStatus(doc.id, 'done')
            console.log(`[本地知识库] LLM 清洗完成: ${doc.id} (${Date.now() - t0}ms)`)
          })
          .catch((err: any) => {
            setCleaningStatus(doc.id, 'error')
            console.warn(`[本地知识库] LLM 清洗失败: ${doc.id} (${Date.now() - t0}ms)`, err.message)
          })
      }

      return { success: true, data: doc }
    } catch (err: any) {
      console.error('[本地知识库] 导入文件失败:', err.message || err)
      return { success: false, error: err.message || '导入失败' }
    }
  })

  ipcMain.handle('knowledge:local:embed', async (_event, args: { documentId: string }) => {
    try {
      const chunks = getChunksWithoutEmbeddings(args.documentId)
      if (chunks.length === 0) return { success: false, error: '没有需要索引的分块' }

      const storeSettings = readSettings()
      const persistedState = (storeSettings['opencowork-settings'] as any)?.state
      const apiKey = (persistedState?.embeddingApiKey as string) || 'sk-ws-H.RXHPLPH.c3ew.MEUCIQD1K6lOYD_ChOs21FyrXohsPf88gfsv6Q6Zpjf6XipAWQIgRG1hMto8MGxQtbO6M5DED0eghKhbFqIBGoMc9RsrGZ0'
      const baseUrl = (persistedState?.embeddingBaseUrl as string) || 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
      const model = (persistedState?.embeddingModel as string) || 'text-embedding-v4'

      if (!apiKey) return { success: false, error: '未配置 API Key' }

      const texts = chunks.map((c) => c.content)
      const embeddings = await embedTexts(texts, apiKey, baseUrl, model)

      for (let i = 0; i < chunks.length; i++) {
        saveChunkEmbedding(chunks[i].id, embeddings[i])
      }

      return { success: true, data: { count: chunks.length } }
    } catch (err: any) {
      console.error('[本地知识库] 向量化失败:', err.message || err)
      return { success: false, error: err.message || '向量化失败' }
    }
  })

  ipcMain.handle('knowledge:local:search-semantic', async (_event, args: { query: string; topK?: number }) => {
    try {
      console.log('[本地知识库] 语义搜索开始:', args.query)
      const storeSettings = readSettings()
      const persistedState = (storeSettings['opencowork-settings'] as any)?.state
      const apiKey = (persistedState?.embeddingApiKey as string) || 'sk-ws-H.RXHPLPH.c3ew.MEUCIQD1K6lOYD_ChOs21FyrXohsPf88gfsv6Q6Zpjf6XipAWQIgRG1hMto8MGxQtbO6M5DED0eghKhbFqIBGoMc9RsrGZ0'
      const baseUrl = (persistedState?.embeddingBaseUrl as string) || 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
      const model = (persistedState?.embeddingModel as string) || 'text-embedding-v4'

      if (!apiKey) {
        console.log('[本地知识库] 语义搜索跳过: 未配置 API Key')
        return { success: false, error: '未配置 API Key' }
      }

      const allChunks = getAllChunksWithEmbeddings()
      if (allChunks.length === 0) {
        console.log('[本地知识库] 语义搜索跳过: 没有已索引的数据')
        return { success: false, error: '没有已索引的数据' }
      }

      const queryEmbeddings = await embedTexts([args.query], apiKey, baseUrl, model)

      const chunksForSearch: ChunkWithEmbedding[] = allChunks
        .filter((c) => c.embedding)
        .map((c) => ({ id: c.id, content: c.content, embedding: c.embedding! }))

      // Coarse: embedding search → top 20
      const coarse = searchByEmbedding(queryEmbeddings[0], chunksForSearch, 20)
      const targetK = args.topK ?? 10
      console.log(`[本地知识库] Embedding 粗筛: ${coarse.length} 条候选 (从 ${chunksForSearch.length} 个已索引分块)`)

      // Fine: rerank if configured
      const rerankKey = (persistedState?.rerankApiKey as string) || 'sk-ws-H.RXHPLPH.c3ew.MEUCIQD1K6lOYD_ChOs21FyrXohsPf88gfsv6Q6Zpjf6XipAWQIgRG1hMto8MGxQtbO6M5DED0eghKhbFqIBGoMc9RsrGZ0'
      const rerankUrl = (persistedState?.rerankBaseUrl as string) || 'https://dashscope.aliyuncs.com/compatible-api/v1/reranks'
      const rerankModel = (persistedState?.rerankModel as string) || 'qwen3-rerank'

      if (rerankKey && rerankUrl && rerankModel && coarse.length > 1) {
        try {
          console.log(`[本地知识库] 开始 Rerank (${rerankModel}): ${coarse.length} 条 → top ${targetK}`)
          const docs = coarse.map((c) => c.content)
          const reranked = await rerankDocuments(args.query, docs, rerankKey, rerankUrl, rerankModel, targetK)
          const topScore = reranked[0]?.score ?? 0
          console.log(`[本地知识库] Rerank 完成: ${reranked.length} 条, 最高分 ${topScore}`)
          return {
            success: true,
            data: reranked.map((r) => ({
              id: coarse[r.index]?.id || '',
              content: r.content,
              score: Math.round(r.score * 100) / 100
            }))
          }
        } catch (err: any) {
          console.warn('[本地知识库] Rerank 失败，降级使用 Embedding 结果:', err.message)
        }
      } else {
        const reason = !rerankKey ? '未配置' : !rerankUrl ? '未配置 URL' : !rerankModel ? '未配置 Model' : '候选数不足'
        console.log(`[本地知识库] 跳过 Rerank (${reason})，直接返回 Embedding 结果`)
      }

      return {
        success: true,
        data: coarse.slice(0, targetK).map((r) => ({
          id: r.id,
          content: r.content,
          score: Math.round(r.score * 100) / 100
        }))
      }
    } catch (err: any) {
      console.error('[本地知识库] 语义搜索失败:', err.message || err)
      return { success: false, error: err.message || '语义搜索失败' }
    }
  })

  ipcMain.handle('knowledge:local:embedded-status', async (_event, args: { documentId: string }) => {
    try {
      const total = listLocalChunks(args.documentId).length
      const embedded = getDocumentEmbeddedCount(args.documentId)
      return { success: true, data: { total, embedded } }
    } catch (err: any) {
      return { success: false, error: err.message || '获取状态失败' }
    }
  })

  ipcMain.handle('knowledge:local:cleaning-status', async (_event, args: { documentId: string }) => {
    try {
      const status = getCleaningStatus(args.documentId) || 'ready'
      return { success: true, data: { status } }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}
