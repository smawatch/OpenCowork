import { ipcMain, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { McpManager } from '../mcp/mcp-manager'
import type { McpServerConfig } from '../mcp/mcp-types'

const DATA_DIR = path.join(os.homedir(), '.open-cowork')
const MCP_FILE = path.join(DATA_DIR, 'mcp-servers.json')
const MCP_OVERRIDES_FILE = path.join(DATA_DIR, 'mcp-builtin-overrides.json')

// Resolve figma-pilot-mcp command at runtime to use bundled Electron Node.js
function getFigmaPilotCommand(): { command: string; args: string[] } {
  // asarUnpack: resources/** → extracted to app.asar.unpacked/resources/
  const launcherScript = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'figma-mcp-launcher.js')
    : path.join(app.getAppPath(), 'resources', 'figma-mcp-launcher.js')

  return {
    command: process.execPath,  // Electron's built-in Node.js
    args: [launcherScript]
  }
}

// ── Built-in MCP servers ──

const BUILTIN_MCP_SERVERS: McpServerConfig[] = [
  {
    id: 'builtin-cowork-server-mcp',
    name: 'cowork-server-mcp',
    enabled: true,
    transport: 'streamable-http',
    url: 'http://192.168.77.100:3002/mcp',
    autoFallback: true,
    description: '企业内置MCP（提供常用后台数据查询能力）',
    builtin: true,
    createdAt: 0
  },
  // {
  //   id: 'builtin-apifox-new-mcp',
  //   name: 'apifox-new-mcp',
  //   enabled: true,
  //   transport: 'streamable-http',
  //   url: 'https://apifox.com/api/v1/mcp',
  //   headers: {
  //     Authorization: 'Bearer afxp_43bf60reS4NW3DSr9IpBMNDfViOpx3wxzsIY',
  //     'X-Apifox-Api-Version': '2025-09-01'
  //   },
  //   autoFallback: true,
  //   description: '企业内置MCP（提供后台接口文档能力）',
  //   builtin: true,
  //   createdAt: 0
  // },
  {
    id: 'builtin-figma-pilot',
    name: 'Figma Pilot',
    enabled: true,
    transport: 'stdio',
    command: '',  // Resolved dynamically in readServers below
    args: [],
    description: 'Figma 设计自动化（读写 Figma 文档、导出素材、设计系统分析），需要结合 Figma 桌面端运行并导入配套插件。',
    builtin: true,
    createdAt: 0
  }
]

// ── Persistence helpers ──

function readUserServers(): McpServerConfig[] {
  try {
    if (fs.existsSync(MCP_FILE)) {
      return JSON.parse(fs.readFileSync(MCP_FILE, 'utf-8'))
    }
  } catch {
    // Return empty on any error
  }
  return []
}

// ── Built-in server enabled-override persistence ──
// Built-in servers are defined in code and cannot be modified,
// but the user can toggle their enabled state. Those toggles are persisted here.

function readBuiltinOverrides(): Record<string, { enabled: boolean }> {
  try {
    if (fs.existsSync(MCP_OVERRIDES_FILE)) {
      return JSON.parse(fs.readFileSync(MCP_OVERRIDES_FILE, 'utf-8'))
    }
  } catch {
    // Return empty on any error
  }
  return {}
}

function writeBuiltinOverride(id: string, override: { enabled: boolean }): void {
  const overrides = readBuiltinOverrides()
  overrides[id] = override
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(MCP_OVERRIDES_FILE, JSON.stringify(overrides, null, 2), 'utf-8')
  } catch (err) {
    console.error('[MCP] Write overrides error:', err)
  }
}

/** Strip sensitive fields from built-in servers for client display */
function sanitizeBuiltin(config: McpServerConfig): McpServerConfig {
  if (!config.builtin) return config
  const base: McpServerConfig = {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    description: config.description,
    builtin: config.builtin,
    transport: config.transport,
    createdAt: config.createdAt
  }
  // Pass through transport-specific connectivity fields for UI display
  if (config.transport === 'stdio') {
    base.command = config.command
    base.args = config.args
  } else if (config.transport === 'streamable-http' || config.transport === 'sse') {
    base.url = config.url
  }
  if (config.autoFallback !== undefined) {
    base.autoFallback = config.autoFallback
  }
  return base
}

/**
 * Merge built-in servers with user-configured ones.
 * - internal (sanitize = false): full config, used for auto-connect.
 * - client-facing (sanitize = true):  built-in servers included but sensitive fields stripped.
 * Built-in server enabled state can be overridden by user toggles persisted in MCP_OVERRIDES_FILE.
 */
function readServers(sanitize = false): McpServerConfig[] {
  const userServers = readUserServers()
  const merged = [...userServers.filter((s) => !s.builtin)]
  const overrides = readBuiltinOverrides()

  for (const builtin of BUILTIN_MCP_SERVERS) {
    const config = { ...builtin }
    // Resolve dynamic command for figma-pilot (uses bundled Electron Node.js)
    if (builtin.id === 'builtin-figma-pilot') {
      const figmaCmd = getFigmaPilotCommand()
      config.command = figmaCmd.command
      config.args = figmaCmd.args
      // NODE_PATH helps the child Node.js process find modules in the asar
      const nodePaths: string[] = []
      const asarModules = path.join(process.resourcesPath, 'app.asar', 'node_modules')
      const unpackedModules = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
      if (fs.existsSync(unpackedModules)) nodePaths.push(unpackedModules)
      if (fs.existsSync(asarModules)) nodePaths.push(asarModules)
      if (nodePaths.length > 0) {
        config.env = {
          ELECTRON_RUN_AS_NODE: '1',
          NODE_PATH: nodePaths.join(path.delimiter) + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '')
        }
      } else {
        config.env = { ELECTRON_RUN_AS_NODE: '1' }
      }
    }
    // Apply user's enabled toggle if it was previously persisted
    if (overrides[builtin.id]) {
      config.enabled = overrides[builtin.id].enabled
    }
    merged.push(sanitize ? sanitizeBuiltin(config) : config)
  }

  return merged
}

function writeServers(servers: McpServerConfig[]): void {
  // Never persist built-in servers — they are read-only and defined in code
  const toPersist = servers.filter((s) => !s.builtin)

  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(MCP_FILE, JSON.stringify(toPersist, null, 2), 'utf-8')
  } catch (err) {
    console.error('[MCP] Write error:', err)
  }
}

export async function autoConnectMcpServers(mcpManager: McpManager): Promise<void> {
  const servers = readServers().filter((server) => server.enabled)

  await Promise.allSettled(
    servers.map(async (server) => {
      try {
        await mcpManager.connectServer(server)
      } catch (err) {
        console.error(`[MCP] Auto-connect failed for ${server.name} (${server.id}):`, err)
      }
    })
  )
}

// ── Register IPC handlers ──

export function registerMcpHandlers(mcpManager: McpManager): void {
  // List all configured MCP servers (built-in shown with sensitive fields stripped)
  ipcMain.handle('mcp:list', () => {
    return readServers(true)
  })

  // Add a new MCP server config
  ipcMain.handle('mcp:add', (_event, config: McpServerConfig) => {
    if (BUILTIN_MCP_SERVERS.some((b) => b.id === config.id)) {
      return { success: false, error: 'Cannot add a server with the same ID as a built-in MCP server' }
    }
    const servers = readServers()
    servers.push(config)
    writeServers(servers)
    return { success: true }
  })

  // Update an MCP server config
  ipcMain.handle(
    'mcp:update',
    (_event, { id, patch }: { id: string; patch: Partial<McpServerConfig> }) => {
      const servers = readServers()
      const idx = servers.findIndex((s) => s.id === id)
      if (idx === -1) return { success: false, error: 'Server not found' }
      if (servers[idx].builtin) {
        // Built-in servers: only allow toggling the enabled state
        const allowedKeys = new Set(['enabled'])
        const patchKeys = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined)
        if (patchKeys.some((k) => !allowedKeys.has(k))) {
          return { success: false, error: 'Cannot modify a built-in MCP server. Only enabled/disabled can be toggled.' }
        }
        if ('enabled' in patch) {
          writeBuiltinOverride(id, { enabled: !!patch.enabled })
        }
        return { success: true }
      }
      servers[idx] = { ...servers[idx], ...patch }
      writeServers(servers)
      return { success: true }
    }
  )

  // Remove an MCP server config
  ipcMain.handle('mcp:remove', async (_event, id: string) => {
    const server = readServers().find((s) => s.id === id)
    if (!server) return { success: false, error: 'Server not found' }
    if (server.builtin) return { success: false, error: 'Cannot remove a built-in MCP server' }

    await mcpManager.disconnectServer(id)
    const servers = readUserServers().filter((s) => s.id !== id)
    writeServers(servers)
    return { success: true }
  })

  // Connect to an MCP server
  ipcMain.handle('mcp:connect', async (_event, id: string) => {
    const servers = readServers()
    const config = servers.find((s) => s.id === id)
    if (!config) return { success: false, error: 'Server not found' }

    try {
      await mcpManager.connectServer(config)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })

  // Disconnect from an MCP server
  ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
    await mcpManager.disconnectServer(id)
    return { success: true }
  })

  // Get server status
  ipcMain.handle('mcp:status', (_event, id: string) => {
    return mcpManager.getStatus(id)
  })

  // Get full server info (status + capabilities)
  ipcMain.handle('mcp:server-info', (_event, id: string) => {
    return mcpManager.getServerInfo(id)
  })

  // Get all servers info (built-in shown with sensitive fields stripped)
  ipcMain.handle('mcp:all-servers-info', () => {
    const servers = readServers(true)
    return servers.map((config) => {
      const info = mcpManager.getServerInfo(config.id)
      return {
        config,
        status: info?.status ?? 'disconnected',
        tools: info?.tools ?? [],
        resources: info?.resources ?? [],
        prompts: info?.prompts ?? [],
        error: info?.error
      }
    })
  })

  // List tools for a specific server
  ipcMain.handle('mcp:list-tools', (_event, id: string) => {
    return mcpManager.getTools(id)
  })

  // Call a tool on an MCP server
  ipcMain.handle(
    'mcp:call-tool',
    async (
      _event,
      {
        serverId,
        toolName,
        args
      }: { serverId: string; toolName: string; args: Record<string, unknown> }
    ) => {
      try {
        const result = await mcpManager.callTool(serverId, toolName, args)
        return { success: true, result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    }
  )

  // Read a resource from an MCP server
  ipcMain.handle(
    'mcp:read-resource',
    async (_event, { serverId, uri }: { serverId: string; uri: string }) => {
      try {
        const result = await mcpManager.readResource(serverId, uri)
        return { success: true, result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    }
  )

  // List resources for a server
  ipcMain.handle('mcp:list-resources', (_event, id: string) => {
    return mcpManager.getResources(id)
  })

  // Get a prompt from an MCP server
  ipcMain.handle(
    'mcp:get-prompt',
    async (
      _event,
      {
        serverId,
        promptName,
        args
      }: { serverId: string; promptName: string; args?: Record<string, string> }
    ) => {
      try {
        const result = await mcpManager.getPrompt(serverId, promptName, args)
        return { success: true, result }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    }
  )

  // List prompts for a server
  ipcMain.handle('mcp:list-prompts', (_event, id: string) => {
    return mcpManager.getPrompts(id)
  })

  // Refresh capabilities for a server
  ipcMain.handle('mcp:refresh-capabilities', async (_event, id: string) => {
    try {
      await mcpManager.refreshCapabilities(id)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: msg }
    }
  })
}
