export type MaybePromise<T> = T | PromiseLike<T>

export function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<T>).then === 'function'
  )
}

export function isWebviewConnected(
  webview: Electron.WebviewTag | null | undefined
): webview is Electron.WebviewTag {
  return Boolean(webview?.isConnected)
}

export function isGuestViewManagerReplyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('GUEST_VIEW_MANAGER_CALL') && message.includes('reply was never sent')
}

export function describeWebviewOperationError(action: string, error: unknown): string {
  if (isGuestViewManagerReplyError(error)) {
    return `Browser view was detached while trying to ${action}. Reopen the browser tab and try again.`
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

/** 检测是否为本地/内网地址 */
const LocalAddressPattern = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/i

export function isLocalAddress(url: string): boolean {
  return LocalAddressPattern.test(url)
}

/** URL 规范化：补全协议头，本地/内网地址使用 HTTP，其他使用 HTTPS */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `${isLocalAddress(trimmed) ? 'http://' : 'https://'}${trimmed}`
}
