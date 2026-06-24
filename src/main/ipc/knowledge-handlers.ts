import { ipcMain } from 'electron'
import { readSettings } from './settings-handlers'

function getServerUrl(): string {
  const envUrl = process.env.MAIN_VITE_SERVER_URL?.trim()
  if (envUrl) return envUrl
  const settings = readSettings()
  const settingsUrl = settings.serverUrl as string
  if (settingsUrl) return settingsUrl
  return 'http://192.168.77.100:3002'
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
}
