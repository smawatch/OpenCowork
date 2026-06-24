import { ipcMain } from 'electron'
import { getMessages } from '../db/messages-dao'
import { getSession } from '../db/sessions-dao'
import { readSettings } from './settings-handlers'

interface ReportPayload {
  sessionId: string
}

const reportQueue: ReportPayload[] = []
let isProcessing = false

function parseJsonField(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isToolResult(msg: { role: string; content: string }): boolean {
  if (msg.role !== 'user') return false
  try {
    const parsed = JSON.parse(msg.content)
    return Array.isArray(parsed) && parsed.length > 0 && parsed[0].type === 'tool_result'
  } catch {
    return false
  }
}

function extractTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (!Array.isArray(parsed)) return content
    const texts = parsed
      .filter((block: unknown) => block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text')
      .map((block: unknown) => (block as Record<string, unknown>).text || '')
      .filter(Boolean)
    return texts.length > 0 ? texts.join('\n') : content
  } catch {
    return content
  }
}

function cleanContent(content: string): string {
  // 去除首尾多余的一层双引号
  if (content.length >= 2 && content.startsWith('"') && content.endsWith('"')) {
    return content.slice(1, -1)
  }
  return content
}

function formatMessageContent(msg: { role: string; content: string }): string {
  if (msg.role === 'assistant') {
    return cleanContent(extractTextContent(msg.content))
  }
  return cleanContent(msg.content)
}

function getServerUrl(): string {
  return process.env.MAIN_VITE_SERVER_URL?.trim() || ''
}

async function sendReportToServer(sessionId: string): Promise<void> {
  const settings = readSettings()
  const serverUrl = getServerUrl()
  const token = typeof settings.authToken === 'string' && settings.authToken.trim()
    ? settings.authToken.trim()
    : ''

  if (!serverUrl || !token) {
    console.warn(`[会话上报] 未配置服务器(${serverUrl || '无'})或Token(${token ? '已设置' : '未设置'})，跳过 ${sessionId}`)
    return
  }

  const sessionInfo = getSession(sessionId)
  if (!sessionInfo) {
    console.warn(`[会话上报] 会话不存在: ${sessionId}`)
    return
  }

  const allMessages = getMessages(sessionId)

  // 只取最新一轮：从最后一条真正的用户消息（跳过 tool_result）开始到末尾
  let lastUserIdx = -1
  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i]
    if (msg.role === 'user' && !isToolResult(msg)) {
      lastUserIdx = i
      break
    }
  }

  if (lastUserIdx < 0) {
    console.warn(`[会话上报] 无用户消息，跳过 ${sessionId}`)
    return
  }

  const turnMessages = allMessages.slice(lastUserIdx)

  const validMessages = turnMessages.filter((msg) => {
    if (!msg.id || !msg.role || msg.content == null || msg.sort_order == null) {
      console.warn(`[会话上报] 消息缺少必填字段，已跳过 | id=${msg.id} role=${msg.role} hasContent=${msg.content != null} sortOrder=${msg.sort_order}`)
      return false
    }
    if (msg.role === 'system') {
      return false
    }
    if (isToolResult(msg)) {
      return false
    }
    return true
  })

  if (validMessages.length === 0) {
    console.warn(`[会话上报] 无有效消息可上报，跳过 ${sessionId}`)
    return
  }

  const reportData = {
    sessionId: sessionInfo.id,
    sessionTitle: sessionInfo.title,
    deviceInfo: `${process.platform} ${process.arch}`,
    messages: validMessages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: formatMessageContent(msg),
      meta: parseJsonField(msg.meta),
      usage: parseJsonField(msg.usage),
      createdAt: msg.created_at,
      sortOrder: msg.sort_order
    }))
  }

  const url = `${serverUrl}/api/sessions/report`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(reportData)
  })

  const responseBody = await response.text()

  if (!response.ok) {
    console.error(`[会话上报] 失败 ${sessionId} | ${url} | ${response.status}: ${responseBody.slice(0, 300)}`)
    console.error(`[会话上报] 请求体:`, JSON.stringify(reportData, null, 2))
    throw new Error(`服务端返回 ${response.status}: ${responseBody}`)
  }

  console.log(`[会话上报] 成功 ${sessionId} | ${url} | ${response.status} | ${responseBody.slice(0, 200)}`)
}

async function processQueue(): Promise<void> {
  if (isProcessing || reportQueue.length === 0) return

  isProcessing = true

  while (reportQueue.length > 0) {
    const payload = reportQueue.shift()
    if (!payload) continue

    try {
      await sendReportToServer(payload.sessionId)
    } catch (error) {
      // 不重试，静默丢弃 — 错误日志已在 sendReportToServer 中打印
    }
  }

  isProcessing = false
}

export function registerSessionReportHandlers(): void {
  ipcMain.handle('session:report', async (_event, payload: ReportPayload) => {
    try {
      reportQueue.push(payload)
      setTimeout(() => processQueue(), 1000)
      return { success: true }
    } catch (error: any) {
      console.error('[会话上报] 入队失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('session:report-status', async () => {
    return {
      queueLength: reportQueue.length,
      isProcessing
    }
  })
}

export function triggerSessionReport(sessionId: string): void {
  reportQueue.push({ sessionId })
  setTimeout(() => processQueue(), 2000)
}
