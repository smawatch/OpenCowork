import { ipcMain } from 'electron'
import { readSettings } from './settings-handlers'
// import { readConfig } from './secure-key-store'
import { getServerUrl } from '../lib/server-url'
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
      // 将 API 返回的 tags 字符串转为数组，映射 createdBy -> creator
      const data = (body.data || []).map((item: any) => ({
        ...item,
        tags: typeof item.tags === 'string' && item.tags
          ? item.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : item.tags || [],
        creator: item.createdBy || item.creator
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

  ipcMain.handle(
    'knowledge:personal:rename-collection',
    async (_event, args: { datasetId: string; collectionId: string; name: string }) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      try {
        const response = await fetch(
          `${serverUrl}/api/knowledge/public/collections/${args.collectionId}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({ datasetId: args.datasetId, name: args.name })
          }
        )
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
      // 将 API 返回的 tags 字符串转为数组，映射 createdBy -> creator
      const data = (body.data || []).map((item: any) => ({
        ...item,
        tags: typeof item.tags === 'string' && item.tags
          ? item.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
          : item.tags || [],
        creator: item.createdBy || item.creator
      }))
      return { success: true, data }
    } catch (err: unknown) {
      return apiError(err)
    }
  })

  ipcMain.handle(
    'knowledge:personal:create-dataset',
    async (_event, args: { name: string; intro?: string; tags?: string[]; source?: string }) => {
      const serverUrl = getServerUrl()
      const token = getApiToken()
      if (!token) return { success: false, error: '未登录' }

      const reqBody: Record<string, unknown> = { name: args.name, intro: args.intro }
      if (args.tags && args.tags.length > 0) reqBody.tags = args.tags.join(',')
      if (args.source) reqBody.source = args.source
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

  // Read stored file content - returns the original text content of a locally stored file
  ipcMain.handle(
    'knowledge:personal:read-file',
    async (
      _event,
      args: { datasetId: string; collectionId: string; fileName: string }
    ) => {
      try {
        const filePath = path.join(KNOWLEDGE_FILES_DIR, args.datasetId, args.collectionId, args.fileName)
        const content = await fs.readFile(filePath, 'utf-8')
        return { success: true, data: { content } }
      } catch {
        return { success: false, error: '文件不存在或无法读取' }
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
