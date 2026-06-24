import { ipcMain } from 'electron'
import { readSettings, replaceSettingsForSync } from './settings-handlers'

function getServerUrl(): string {
  return process.env.MAIN_VITE_SERVER_URL?.trim() || ''
}

function clearAuthToken(): void {
  const settings = readSettings()
  settings.authToken = ''
  replaceSettingsForSync(settings)
}

async function knowledgeFetch(
  url: string,
  options: RequestInit = {}
): Promise<{ success: boolean; data?: any; total?: number; error?: string; code?: string }> {
  const settings = readSettings()
  const token =
    typeof settings.authToken === 'string' && settings.authToken.trim()
      ? settings.authToken.trim()
      : ''

  if (!token) {
    return { success: false, error: '未登录' }
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        Authorization: `Bearer ${token}`
      }
    })
    const body = await response.json()

    if (response.status === 401) {
      console.warn('[知识库] 401 Unauthorized — 令牌已失效，清除认证信息')
      clearAuthToken()
      return { success: false, error: '令牌已失效，请重新登录', code: 'UNAUTHORIZED' }
    }

    if (!response.ok) {
      return { success: false, error: body.error || body.message || `HTTP ${response.status}` }
    }

    return { success: true, data: body.data, total: body.total }
  } catch (err: any) {
    console.error(`[知识库] 请求失败:`, err.message || err)
    return { success: false, error: err.message || '网络错误' }
  }
}

export function registerKnowledgeHandlers(): void {
  ipcMain.handle('knowledge:list-datasets', async () => {
    const serverUrl = getServerUrl()
    const url = `${serverUrl}/api/knowledge/public/datasets`
    console.log(`[知识库] GET ${url}`)
    return knowledgeFetch(url)
  })

  ipcMain.handle('knowledge:list-collections', async (_event, args: { kbId: string }) => {
    const serverUrl = getServerUrl()
    const url = `${serverUrl}/api/knowledge/public/datasets/${args.kbId}/collections`
    console.log(`[知识库] GET ${url}`)
    return knowledgeFetch(url)
  })

  ipcMain.handle('knowledge:list-chunks', async (_event, args: { collectionId: string }) => {
    const serverUrl = getServerUrl()
    const url = `${serverUrl}/api/knowledge/public/collections/${args.collectionId}/data`
    console.log(`[知识库] GET ${url}`)
    return knowledgeFetch(url)
  })

  ipcMain.handle(
    'knowledge:search',
    async (_event, args: { query: string; datasetIds?: string[]; topK?: number; score?: number }) => {
      const serverUrl = getServerUrl()
      const url = `${serverUrl}/api/knowledge/public/search`
      console.log(`[知识库] POST ${url} | query=${args.query}`)
      return knowledgeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: args.query,
          datasetIds: args.datasetIds ?? [],
          topK: args.topK ?? 5,
          score: args.score ?? 0.6
        })
      })
    }
  )
}
