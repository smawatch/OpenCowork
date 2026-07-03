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
import * as fs from 'fs/promises'
import * as path from 'path'
import { homedir } from 'os'
import { dialog } from 'electron'

const KNOWLEDGE_FILES_DIR = path.join(homedir(), '.open-cowork', 'knowledge-files')

function getApiToken(): string {
  const settings = readSettings()
  return typeof settings.authToken === 'string' && settings.authToken.trim()
    ? settings.authToken.trim()
    : ''
}

function apiError(err: unknown): { success: false; error: string } {
  const message = err instanceof Error ? err.message : '网络错误'
  console.error('[个人知识库] 请求失败:', message)
  return { success: false, error: message }
}

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
      // 将 API 返回的 tags 字符串转为数组
      const data = (body.data || []).map((item: any) => ({
        ...item,
        tags: typeof item.tags === 'string' && item.tags
          ? item.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : item.tags || []
      }))
      return { success: true, data }
    } catch (err: any) {
      console.error(`[知识库] 请求失败:`, err.message || err)
      return { success: false, error: err.message || '网络错误' }
    }
  })

  ipcMain.handle('knowledge:list-collections', async (_event, args: { kbId: string; parentId?: string }) => {
    const serverUrl = getServerUrl()
    const settings = readSettings()
    const token =
      typeof settings.authToken === 'string' && settings.authToken.trim()
        ? settings.authToken.trim()
        : ''

    console.log(
      `[知识库] 获取数据集 | kbId=${args.kbId} | parentId=${args.parentId || 'root'} | serverUrl=${serverUrl}`
    )

    if (!token) {
      console.warn('[知识库] 未登录，无Token')
      return { success: false, error: '未登录' }
    }

    const params = new URLSearchParams()
    if (args.parentId) params.set('parentId', args.parentId)
    const qs = params.toString()
    const url = `${serverUrl}/api/knowledge/public/datasets/${args.kbId}/collections${qs ? '?' + qs : ''}`
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
  })

  ipcMain.handle('knowledge:list-chunks', async (_event, args: { collectionId: string }) => {
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
  })

  ipcMain.handle(
    'knowledge:search',
    async (
      _event,
      args: { query: string; datasetIds?: string[]; topK?: number; score?: number }
    ) => {
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
  ipcMain.handle(
    'knowledge:local:create',
    async (_event, args: { title: string; content: string }) => {
      try {
        const doc = createLocalDocument(args.title, args.content)
        return { success: true, data: doc }
      } catch (err: any) {
        console.error('[本地知识库] 创建失败:', err.message || err)
        return { success: false, error: err.message || '创建失败' }
      }
    }
  )

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
      return deleted ? { success: true } : { success: false, error: '文档不存在' }
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

  ipcMain.handle(
    'knowledge:local:import-file',
    async (_event, args: { filePath: string; title: string }) => {
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
        console.log(
          `[本地知识库] LLM 清洗检查: apiKey=${apiKey ? 'yes' : 'no'} model=${model || 'no'} len=${text.length} doClean=${doClean}`
        )
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
              console.warn(
                `[本地知识库] LLM 清洗失败: ${doc.id} (${Date.now() - t0}ms)`,
                err.message
              )
            })
        }

        return { success: true, data: doc }
      } catch (err: any) {
        console.error('[本地知识库] 导入文件失败:', err.message || err)
        return { success: false, error: err.message || '导入失败' }
      }
    }
  )

  ipcMain.handle('knowledge:local:embed', async (_event, args: { documentId: string }) => {
    try {
      const chunks = getChunksWithoutEmbeddings(args.documentId)
      if (chunks.length === 0) return { success: false, error: '没有需要索引的分块' }

      const storeSettings = readSettings()
      const persistedState = (storeSettings['opencowork-settings'] as any)?.state
      const apiKey =
        (persistedState?.embeddingApiKey as string) ||
        'sk-ws-H.RXHPLPH.c3ew.MEUCIQD1K6lOYD_ChOs21FyrXohsPf88gfsv6Q6Zpjf6XipAWQIgRG1hMto8MGxQtbO6M5DED0eghKhbFqIBGoMc9RsrGZ0'
      const baseUrl =
        (persistedState?.embeddingBaseUrl as string) ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
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

  ipcMain.handle(
    'knowledge:local:search-semantic',
    async (_event, args: { query: string; topK?: number }) => {
      try {
        console.log('[本地知识库] 语义搜索开始:', args.query)
        const storeSettings = readSettings()
        const persistedState = (storeSettings['opencowork-settings'] as any)?.state
        const apiKey =
          (persistedState?.embeddingApiKey as string) ||
          'sk-ws-H.RXHPLPH.c3ew.MEUCIQD1K6lOYD_ChOs21FyrXohsPf88gfsv6Q6Zpjf6XipAWQIgRG1hMto8MGxQtbO6M5DED0eghKhbFqIBGoMc9RsrGZ0'
        const baseUrl =
          (persistedState?.embeddingBaseUrl as string) ||
          'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'
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
        console.log(
          `[本地知识库] Embedding 粗筛: ${coarse.length} 条候选 (从 ${chunksForSearch.length} 个已索引分块)`
        )

        // Fine: rerank if configured
        const rerankKey =
          (persistedState?.rerankApiKey as string) ||
          'sk-ws-H.RXHPLPH.c3ew.MEUCIQD1K6lOYD_ChOs21FyrXohsPf88gfsv6Q6Zpjf6XipAWQIgRG1hMto8MGxQtbO6M5DED0eghKhbFqIBGoMc9RsrGZ0'
        const rerankUrl =
          (persistedState?.rerankBaseUrl as string) ||
          'https://dashscope.aliyuncs.com/compatible-api/v1/reranks'
        const rerankModel = (persistedState?.rerankModel as string) || 'qwen3-rerank'

        if (rerankKey && rerankUrl && rerankModel && coarse.length > 1) {
          try {
            console.log(
              `[本地知识库] 开始 Rerank (${rerankModel}): ${coarse.length} 条 → top ${targetK}`
            )
            const docs = coarse.map((c) => c.content)
            const reranked = await rerankDocuments(
              args.query,
              docs,
              rerankKey,
              rerankUrl,
              rerankModel,
              targetK
            )
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
          const reason = !rerankKey
            ? '未配置'
            : !rerankUrl
              ? '未配置 URL'
              : !rerankModel
                ? '未配置 Model'
                : '候选数不足'
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
    }
  )

  ipcMain.handle(
    'knowledge:local:embedded-status',
    async (_event, args: { documentId: string }) => {
      try {
        const total = listLocalChunks(args.documentId).length
        const embedded = getDocumentEmbeddedCount(args.documentId)
        return { success: true, data: { total, embedded } }
      } catch (err: any) {
        return { success: false, error: err.message || '获取状态失败' }
      }
    }
  )

  ipcMain.handle(
    'knowledge:local:cleaning-status',
    async (_event, args: { documentId: string }) => {
      try {
        const status = getCleaningStatus(args.documentId) || 'ready'
        return { success: true, data: { status } }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // ==================== 个人知识库 API handlers ====================

  ipcMain.handle(
    'knowledge:personal:delete-collections',
    async (_event, args: { datasetId: string; collectionIds: string[] }) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      try {
        const response = await fetch(`${serverUrl}/api/knowledge/public/collections`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ datasetId: args.datasetId, collectionIds: args.collectionIds })
        })
        const body = await response.json()
        if (!response.ok) {
          return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
        }
        return { success: true, message: body.message }
      } catch (err: unknown) {
        return apiError(err)
      }
    }
  )

  ipcMain.handle('knowledge:personal:delete-dataset', async (_event, args: { id: string }) => {
    const serverUrl = getServerUrl()
    const token = getApiToken()
    if (!token) return { success: false, error: '未登录' }

    try {
      const response = await fetch(`${serverUrl}/api/knowledge/public/datasets/${args.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const body = await response.json()
      if (!response.ok) {
        return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
      }
      return { success: true }
    } catch (err: unknown) {
      return apiError(err)
    }
  })

  ipcMain.handle(
    'knowledge:personal:update-dataset',
    async (_event, args: { id: string; name?: string; intro?: string; tags?: string[] }) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      const reqBody: Record<string, unknown> = {}
      if (args.name !== undefined) reqBody.name = args.name
      if (args.intro !== undefined) reqBody.intro = args.intro
      if (args.tags !== undefined) reqBody.tags = args.tags.join(',')

      try {
        const response = await fetch(`${serverUrl}/api/knowledge/public/datasets/${args.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(reqBody)
        })
        const body = await response.json()
        if (!response.ok) {
          return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
        }
        return { success: true }
      } catch (err: unknown) {
        return apiError(err)
      }
    }
  )

  ipcMain.handle('knowledge:personal:list-datasets', async () => {
    const serverUrl = getServerUrl()
    const token = getApiToken()
    console.log(
      `[知识库] 获取个人知识库列表 | serverUrl=${serverUrl} | token=${token ? '有' : '无'}`
    )
    if (!token) return { success: false, error: '未登录' }

    try {
      const url = `${serverUrl}/api/knowledge/public/datasets/personal`
      console.log(`[知识库] GET ${url}`)
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const body = await response.json()
      console.log(`[知识库] 列表响应 ${response.status}:`, JSON.stringify(body).slice(0, 500))
      if (!response.ok) {
        return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
      }
      // 将 API 返回的 tags 字符串转为数组
      const data = (body.data || []).map((item: any) => ({
        ...item,
        tags: typeof item.tags === 'string' && item.tags
          ? item.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : item.tags || []
      }))
      return { success: true, data }
    } catch (err: unknown) {
      return apiError(err)
    }
  })

  ipcMain.handle(
    'knowledge:personal:create-dataset',
    async (_event, args: { name: string; intro?: string; tags?: string[] }) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      const reqBody: Record<string, unknown> = { name: args.name, intro: args.intro }
      if (args.tags && args.tags.length > 0) reqBody.tags = args.tags.join(',')
      console.log('[知识库] 创建知识库 请求体:', JSON.stringify(reqBody))

      try {
        const response = await fetch(`${serverUrl}/api/knowledge/public/datasets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(reqBody)
        })
        const body = await response.json()
        if (!response.ok) {
          return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
        }
        return { success: true, data: body.data }
      } catch (err: unknown) {
        return apiError(err)
      }
    }
  )

  ipcMain.handle(
    'knowledge:personal:import-file',
    async (
      _event,
      args: {
        datasetId: string
        fileName: string
        fileBuffer: ArrayBuffer
        trainingType?: string
        parentId?: string
      }
    ) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      try {
        const { fileName } = args
        const buf = Buffer.from(args.fileBuffer)

        // 手动构建 multipart/form-data 请求体，确保文件名正确传递
        const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).slice(2)}`
        const parts: Buffer[] = []

        parts.push(Buffer.from(`--${boundary}\r\n`))
        parts.push(
          Buffer.from(
            `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`
          )
        )
        parts.push(buf)
        parts.push(Buffer.from('\r\n'))

        if (args.trainingType) {
          parts.push(Buffer.from(`--${boundary}\r\n`))
          parts.push(Buffer.from(`Content-Disposition: form-data; name="trainingType"\r\n\r\n${args.trainingType}\r\n`))
        }
        if (args.parentId) {
          parts.push(Buffer.from(`--${boundary}\r\n`))
          parts.push(Buffer.from(`Content-Disposition: form-data; name="parentId"\r\n\r\n${args.parentId}\r\n`))
        }
        parts.push(Buffer.from(`--${boundary}--\r\n`))

        const body = Buffer.concat(parts)

        const response = await fetch(
          `${serverUrl}/api/knowledge/public/datasets/${args.datasetId}/collections/file`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`
            },
            body
          }
        )
        const respBody = await response.json()
        if (!response.ok) {
          return {
            success: false,
            error: respBody.error || respBody.message || `HTTP ${response.status}`
          }
        }

        // Save local copy for download
        console.log('[知识库] 导入响应数据:', JSON.stringify(respBody.data).slice(0, 500))
        const collectionId = respBody.data?.collectionId || respBody.data?.id
        console.log('[知识库] 提取的 collectionId:', collectionId)
        if (collectionId) {
          try {
            const dir = path.join(KNOWLEDGE_FILES_DIR, args.datasetId, collectionId)
            await fs.mkdir(dir, { recursive: true })
            await fs.writeFile(path.join(dir, fileName), buf)
            console.log(`[知识库] 已保存本地文件副本: ${dir}/${fileName}`)
          } catch (saveErr) {
            console.warn('[知识库] 保存本地文件失败:', saveErr)
          }
        } else {
          console.warn('[知识库] 无法提取 collectionId，跳过本地保存')
        }

        return { success: true, data: respBody.data }
      } catch (err: unknown) {
        return apiError(err)
      }
    }
  )

  ipcMain.handle(
    'knowledge:personal:create-text-collection',
    async (
      _event,
      args: {
        datasetId: string
        name: string
        text: string
        trainingType?: string
        qaPrompt?: string
        chunkSettingMode?: string
        parentId?: string
        metadata?: Record<string, unknown>
      }
    ) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      const body: Record<string, unknown> = {
        name: args.name,
        text: args.text,
        trainingType: args.trainingType || 'chunk',
        chunkSettingMode: args.chunkSettingMode || 'auto'
      }
      if (args.qaPrompt) body.qaPrompt = args.qaPrompt
      if (args.parentId) body.parentId = args.parentId
      if (args.metadata) body.metadata = args.metadata

      try {
        const response = await fetch(
          `${serverUrl}/api/knowledge/public/datasets/${args.datasetId}/collections/text`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
          }
        )
        const respBody = await response.json()
        if (!response.ok) {
          return {
            success: false,
            error: respBody.error || respBody.message || `HTTP ${response.status}`
          }
        }

        console.log('[知识库] 创建文本文档响应:', JSON.stringify(respBody.data).slice(0, 500))
        return { success: true, data: respBody.data }
      } catch (err: unknown) {
        return apiError(err)
      }
    }
  )

  ipcMain.handle(
    'knowledge:personal:create-folder',
    async (
      _event,
      args: {
        datasetId: string
        name: string
        parentId?: string
        metadata?: Record<string, unknown>
      }
    ) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      try {
        const body: Record<string, unknown> = {
          name: args.name,
          type: 'folder'
        }
        if (args.parentId) body.parentId = args.parentId
        if (args.metadata) body.metadata = args.metadata

        const response = await fetch(
          `${serverUrl}/api/knowledge/public/datasets/${args.datasetId}/collections`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify(body)
          }
        )
        const respBody = await response.json()
        if (!response.ok) {
          return {
            success: false,
            error: respBody.error || respBody.message || `HTTP ${response.status}`
          }
        }
        return { success: true, data: respBody.data }
      } catch (err: unknown) {
        return apiError(err)
      }
    }
  )

  // Download file handler - opens save dialog and saves file to user-selected location
  ipcMain.handle(
    'knowledge:personal:download-file',
    async (
      _event,
      args: {
        datasetId: string
        collectionId: string
        fileName: string
      }
    ) => {
      try {
        const sourcePath = path.join(
          KNOWLEDGE_FILES_DIR,
          args.datasetId,
          args.collectionId,
          args.fileName
        )

        // Check if file exists
        try {
          await fs.access(sourcePath)
        } catch {
          return { success: false, error: '文件不存在' }
        }

        // Read file buffer
        const fileBuffer = await fs.readFile(sourcePath)

        // Show save dialog
        const result = await dialog.showSaveDialog({
          title: '保存文件',
          defaultPath: args.fileName,
          properties: ['createDirectory']
        })

        if (result.canceled || !result.filePath) {
          return { success: false, error: '已取消' }
        }

        // Save to selected location
        await fs.writeFile(result.filePath, fileBuffer)

        return { success: true, data: { path: result.filePath } }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '下载失败'
        console.error('[知识库] 下载文件失败:', message)
        return { success: false, error: message }
      }
    }
  )

  // List stored files handler - returns list of files stored locally
  ipcMain.handle(
    'knowledge:personal:list-files',
    async (_event, args: { datasetId: string }) => {
      try {
        const datasetDir = path.join(KNOWLEDGE_FILES_DIR, args.datasetId)

        try {
          await fs.access(datasetDir)
        } catch {
          return { success: true, data: [] }
        }

        const collections = await fs.readdir(datasetDir)
        const files: Array<{ collectionId: string; fileName: string }> = []

        for (const collectionId of collections) {
          const collectionDir = path.join(datasetDir, collectionId)
          const stat = await fs.stat(collectionDir)
          if (stat.isDirectory()) {
            const fileNames = await fs.readdir(collectionDir)
            for (const fileName of fileNames) {
              files.push({ collectionId, fileName })
            }
          }
        }

        return { success: true, data: files }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '获取文件列表失败'
        console.error('[知识库] 获取文件列表失败:', message)
        return { success: false, error: message }
      }
    }
  )
}
