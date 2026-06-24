import { readSettings } from '../ipc/settings-handlers'

const DEFAULT_SERVER_URL = 'http://192.168.77.100:3002'

export function getServerUrl(): string {
  const envUrl = process.env.MAIN_VITE_SERVER_URL?.trim()
  if (envUrl) return envUrl
  const settings = readSettings()
  const settingsUrl = settings.serverUrl as string
  if (settingsUrl) return settingsUrl
  return DEFAULT_SERVER_URL
}
