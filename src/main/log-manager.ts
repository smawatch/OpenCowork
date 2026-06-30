import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { release } from 'os'
import { app } from 'electron'
import * as http from 'http'
import * as https from 'https'
import { getCrashLogDir } from './crash-logger'

const LOG_DIR = getCrashLogDir()
const LOG_RETENTION_DAYS = 7

const LOG_FILE_RE = /^(?:app|crash)-(\d{4})-(\d{2})-(\d{2})\.log$/

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

function getLocalDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function formatLocalISO(now: Date): string {
  const offset = -now.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const h = pad(Math.floor(Math.abs(offset) / 60))
  const m = pad(Math.abs(offset) % 60)
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `.${pad(now.getMilliseconds(), 3)}${sign}${h}:${m}`
  )
}

function ensureLogDir(): void {
  mkdirSync(LOG_DIR, { recursive: true })
}

function getLogFilePath(now: Date): string {
  return join(LOG_DIR, `app-${getLocalDate(now)}.log`)
}

function getAppVersionSafe(): string {
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}

interface AppLogEntry {
  timestamp: string
  level: string
  message: string
  pid: number
  appVersion: string
  platform: string
  osRelease: string
  versions: { electron?: string; node?: string; chrome?: string; v8?: string }
  meta?: unknown
}

const _origConsole = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console)
}

function writeAppLog(level: string, message: string, meta?: unknown): void {
  try {
    ensureLogDir()
    const now = new Date()
    const entry: AppLogEntry = {
      timestamp: formatLocalISO(now),
      level,
      message,
      pid: process.pid,
      appVersion: getAppVersionSafe(),
      platform: process.platform,
      osRelease: release(),
      versions: {
        electron: process.versions.electron,
        node: process.versions.node,
        chrome: process.versions.chrome,
        v8: process.versions.v8
      }
    }
    if (meta !== undefined) {
      entry.meta = meta
    }
    appendFileSync(getLogFilePath(now), `${JSON.stringify(entry)}\n`, 'utf8')
  } catch (err) {
    _origConsole.error('[LogManager] writeAppLog failed:', err)
  }
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
}

// ---- HTTP request interception ----

function safeUrlForLog(url: string | URL): string {
  try {
    const u = typeof url === 'string' ? new URL(url) : url
    // redact sensitive query params but keep the path structure
    return `${u.protocol}//${u.host}${u.pathname}`
  } catch {
    return String(url).slice(0, 200)
  }
}

function installHttpRequestInterceptor(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  httpModule: any,
  moduleName: string
): void {
  const origRequest: (
    options: http.RequestOptions | string | URL,
    callback?: (res: http.IncomingMessage) => void
  ) => http.ClientRequest = httpModule.request.bind(httpModule)

  const wrappedRequest = function (
    options: http.RequestOptions | string | URL,
    callback?: (res: http.IncomingMessage) => void
  ): http.ClientRequest {
    const startTime = Date.now()
    const method =
      (typeof options === 'object' ? (options as http.RequestOptions).method : 'GET') || 'GET'
    const urlStr =
      typeof options === 'string'
        ? options
        : typeof options === 'object' && (options as http.RequestOptions).hostname
          ? `${(options as http.RequestOptions).protocol || `${moduleName}:`}//${(options as http.RequestOptions).hostname}:${(options as http.RequestOptions).port || (moduleName === 'https' ? 443 : 80)}${(options as http.RequestOptions).path || '/'}`
          : String(options)

    const logResponse = (res: http.IncomingMessage) => {
      const duration = Date.now() - startTime
      const statusCode = res.statusCode ?? 0
      const level = statusCode >= 400 ? 'error' : 'info'
      writeAppLog(level, `HTTP ${method} ${statusCode} ${duration}ms`, {
        module: moduleName,
        url: safeUrlForLog(urlStr),
        method,
        statusCode,
        durationMs: duration
      })
      if (callback) callback.call(httpModule, res)
    }

    const req: http.ClientRequest = origRequest(options, callback ? logResponse : undefined)

    req.on('error', (err: Error) => {
      const duration = Date.now() - startTime
      writeAppLog('error', `HTTP ${method} failed`, {
        module: moduleName,
        url: safeUrlForLog(urlStr),
        method,
        durationMs: duration,
        error: err.message
      })
    })

    return req
  }

  Object.defineProperty(httpModule, 'request', {
    value: wrappedRequest,
    writable: true,
    configurable: true
  })
}

function installFetchInterceptor(): void {
  if (typeof globalThis.fetch !== 'function') return

  const origFetch = globalThis.fetch.bind(globalThis)

  globalThis.fetch = async function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const startTime = Date.now()
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = init?.method || 'GET'

    try {
      const response = await origFetch(input, init)
      const duration = Date.now() - startTime
      const level = response.status >= 400 ? 'error' : 'info'
      writeAppLog(level, `FETCH ${method} ${response.status} ${duration}ms`, {
        type: 'fetch',
        url: safeUrlForLog(url),
        method,
        statusCode: response.status,
        durationMs: duration
      })
      return response
    } catch (err) {
      const duration = Date.now() - startTime
      writeAppLog('error', `FETCH ${method} failed`, {
        type: 'fetch',
        url: safeUrlForLog(url),
        method,
        durationMs: duration,
        error: err instanceof Error ? err.message : String(err)
      })
      throw err
    }
  }
}

function cleanOldLogs(): void {
  try {
    const files = readdirSync(LOG_DIR)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cutoff = today.getTime() - LOG_RETENTION_DAYS * 86400000

    for (const name of files) {
      const match = name.match(LOG_FILE_RE)
      if (!match) continue
      const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      if (fileDate.getTime() < cutoff) {
        unlinkSync(join(LOG_DIR, name))
        _origConsole.log(`[LogManager] cleaned old log: ${name}`)
      }
    }
  } catch {
    // silently ignore cleanup failures
  }
}

export function getRecentLogFiles(): string[] {
  try {
    const files = readdirSync(LOG_DIR)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cutoff = today.getTime() - LOG_RETENTION_DAYS * 86400000
    const result: string[] = []

    for (const name of files) {
      const match = name.match(LOG_FILE_RE)
      if (!match) continue
      const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      if (fileDate.getTime() >= cutoff) {
        result.push(join(LOG_DIR, name))
      }
    }
    return result.sort()
  } catch {
    return [join(LOG_DIR, `app-${getLocalDate(new Date())}.log`)]
  }
}

export function initLogManager(): void {
  ensureLogDir()
  cleanOldLogs()
  ensureLogDir()

  console.log = (...args: unknown[]) => {
    _origConsole.log(...args)
    writeAppLog('info', formatConsoleArgs(args))
  }

  console.warn = (...args: unknown[]) => {
    _origConsole.warn(...args)
    writeAppLog('warn', formatConsoleArgs(args))
  }

  console.error = (...args: unknown[]) => {
    _origConsole.error(...args)
    writeAppLog('error', formatConsoleArgs(args))
  }

  process.on('uncaughtException', (err) => {
    writeAppLog('error', `Uncaught exception: ${err.message}`, {
      name: err.name,
      stack: err.stack
    })
    _origConsole.error('Uncaught exception:', err)
  })

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason)
    writeAppLog('error', `Unhandled rejection: ${message}`, {
      reason: reason instanceof Error ? { name: reason.name, stack: reason.stack } : String(reason)
    })
    _origConsole.error('Unhandled rejection:', reason)
  })

  installFetchInterceptor()
  try {
    installHttpRequestInterceptor(http, 'http')
    installHttpRequestInterceptor(https, 'https')
  } catch {
    // Node.js 22+ has non-configurable http.request — skip silently
  }

  writeAppLog('info', 'App log manager initialized', {
    appVersion: getAppVersionSafe(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    v8: process.versions.v8,
    arch: process.arch
  })
}

export function logApiCall(meta: {
  method: string
  url: string
  statusCode: number
  durationMs: number
  error?: string
  requestId?: string
}): void {
  const level = meta.statusCode >= 400 || meta.error ? 'error' : 'info'
  const label = meta.statusCode === 0 ? 'failed' : `${meta.statusCode}`
  writeAppLog(level, `API ${meta.method} ${label} ${meta.durationMs}ms`, {
    type: 'api-call',
    ...meta,
    url: safeUrlForLog(meta.url)
  })
}

export function getLogDir(): string {
  return LOG_DIR
}
