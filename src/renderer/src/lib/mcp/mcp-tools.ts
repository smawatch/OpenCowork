import { toolRegistry } from '../agent/tool-registry'
import type { ToolHandler, ToolContext } from '../tools/tool-types'
import type { McpServerConfig, McpTool, McpResource } from './types'
import { IPC } from '../ipc/channels'

/**
 * MCP Tool & Resource Bridge — dynamically maps MCP server tools and resources
 * to ToolHandlers registered in the global tool registry.
 *
 * Tool naming:
 *   Tools:     `mcp__{serverId}__{toolName}`
 *   Resources: `mcp__{serverId}__resource__{resourceName}`
 * This avoids conflicts between different servers and with built-in tools.
 */

const MCP_TOOL_PREFIX = 'mcp__'

/** Track registered MCP tool/resource names for cleanup */
let _registeredMcpNames: string[] = []

/** Build a prefixed tool name */
function mcpToolName(serverId: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}__${toolName}`
}

/** Parse server ID and original tool name from a prefixed tool name */
export function parseMcpToolName(
  prefixedName: string
): { serverId: string; toolName: string } | null {
  if (!prefixedName.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = prefixedName.slice(MCP_TOOL_PREFIX.length)
  const sepIdx = rest.indexOf('__')
  if (sepIdx === -1) return null
  return {
    serverId: rest.slice(0, sepIdx),
    toolName: rest.slice(sepIdx + 2)
  }
}

/** Check if a tool name is an MCP tool */
export function isMcpTool(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

/**
 * Register MCP tools for all active servers.
 * Each MCP tool becomes a ToolHandler that calls mcp:call-tool via IPC.
 */
export function registerMcpTools(
  activeServers: McpServerConfig[],
  toolsMap: Record<string, McpTool[]>
): void {
  // Unregister any previously registered MCP tools/resources first
  unregisterMcpTools()

  const newNames: string[] = []

  for (const server of activeServers) {
    const tools = toolsMap[server.id]
    if (!tools?.length) continue

    for (const mcpTool of tools) {
      const name = mcpToolName(server.id, mcpTool.name)

      const handler: ToolHandler = {
        definition: {
          name,
          description: `[MCP: ${server.name}] ${mcpTool.description ?? mcpTool.name}`,
          inputSchema: {
            type: 'object',
            properties: (mcpTool.inputSchema?.properties as Record<string, unknown>) ?? {},
            required: (mcpTool.inputSchema?.required as string[]) ?? []
          }
        },
        execute: async (input: Record<string, unknown>, ctx: ToolContext) => {
          try {
            const result = await ctx.ipc.invoke(IPC.MCP_CALL_TOOL, {
              serverId: server.id,
              toolName: mcpTool.name,
              args: input
            })
            const res = result as { success: boolean; result?: unknown; error?: string }
            if (!res.success) {
              return JSON.stringify({ error: res.error ?? 'MCP tool call failed' })
            }
            return JSON.stringify(res.result)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return JSON.stringify({ error: `MCP tool "${mcpTool.name}" failed: ${msg}` })
          }
        },
        requiresApproval: () => true
      }

      toolRegistry.register(handler)
      newNames.push(name)
    }
  }

  _registeredMcpNames = newNames
}

/** Build a resource tool name: mcp__{serverId}__resource__{resourceName} */
function mcpResourceToolName(serverId: string, resourceName: string): string {
  return `${MCP_TOOL_PREFIX}${serverId}__resource__${resourceName}`
}

/**
 * Register MCP resources as tools for all active servers.
 * Each resource becomes a read-only ToolHandler that calls mcp:read-resource via IPC.
 */
export function registerMcpResources(
  activeServers: McpServerConfig[],
  resourcesMap: Record<string, McpResource[]>
): void {
  for (const server of activeServers) {
    const resources = resourcesMap[server.id]
    if (!resources?.length) continue

    for (const resource of resources) {
      const name = mcpResourceToolName(server.id, resource.name)

      const handler: ToolHandler = {
        definition: {
          name,
          description: `[MCP: ${server.name}] Resource: ${resource.name}${resource.description ? ` — ${resource.description}` : ''} (${resource.mimeType ?? 'unknown'})`,
          inputSchema: {
            type: 'object',
            properties: {}
          }
        },
        execute: async (_input: Record<string, unknown>, ctx: ToolContext) => {
          try {
            const result = await ctx.ipc.invoke(IPC.MCP_READ_RESOURCE, {
              serverId: server.id,
              uri: resource.uri
            })
            const res = result as { success: boolean; result?: unknown; error?: string }
            if (!res.success) {
              return JSON.stringify({ error: res.error ?? 'MCP resource read failed' })
            }
            return JSON.stringify(res.result)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return JSON.stringify({ error: `MCP resource "${resource.name}" failed: ${msg}` })
          }
        },
        requiresApproval: () => true
      }

      toolRegistry.register(handler)
      _registeredMcpNames.push(name)
    }
  }
}

/** Unregister all previously registered MCP tools and resources */
export function unregisterMcpTools(): void {
  for (const name of _registeredMcpNames) {
    toolRegistry.unregister(name)
  }
  _registeredMcpNames = []
}

/** Check if any MCP tools or resources are currently registered */
export function isMcpToolsRegistered(): boolean {
  return _registeredMcpNames.length > 0
}

/** Get count of currently registered MCP tools and resources */
export function getMcpToolCount(): number {
  return _registeredMcpNames.length
}
