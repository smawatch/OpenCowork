import { toolRegistry } from '../agent/tool-registry'
import { IPC } from '../ipc/channels'
import { encodeStructuredToolResult, encodeToolError } from './tool-result-format'
import type { ToolHandler } from './tool-types'

function unavailable(name: string, details: string): ReturnType<typeof encodeStructuredToolResult> {
  return encodeStructuredToolResult({
    status: 'unavailable',
    tool: name,
    reason: details
  })
}

const powerShellHandler: ToolHandler = {
  definition: {
    name: 'PowerShell',
    description: 'Execute a command through Windows PowerShell.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds' }
      },
      required: ['command']
    }
  },
  execute: async (input, ctx) => {
    if (window.electron.process.platform !== 'win32') {
      return unavailable('PowerShell', 'PowerShell is only exposed on Windows.')
    }
    const command = String(input.command ?? '')
    if (!command.trim()) return encodeToolError('PowerShell requires command')
    const result = await ctx.ipc.invoke(IPC.SHELL_EXEC, {
      command,
      timeout: input.timeout,
      cwd: ctx.workingFolder,
      shell: 'powershell.exe'
    })
    return encodeStructuredToolResult({ result })
  },
  requiresApproval: () => true
}

const monitorHandler: ToolHandler = {
  definition: {
    name: 'Monitor',
    description:
      'Run a background command and monitor its output through OpenCowork background tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run in the background' },
        description: { type: 'string', description: 'Short monitor description' }
      },
      required: ['command']
    }
  },
  execute: async (input, ctx) => {
    const command = String(input.command ?? '')
    if (!command.trim()) return encodeToolError('Monitor requires command')
    const result = await ctx.ipc.invoke(IPC.PROCESS_SPAWN, {
      command,
      cwd: ctx.workingFolder,
      metadata: {
        source: 'monitor-tool',
        sessionId: ctx.sessionId,
        toolUseId: ctx.currentToolUseId,
        description: input.description
      }
    })
    return encodeStructuredToolResult({ result })
  },
  requiresApproval: () => true
}

export function registerCodeCompatibleTools(): void {
  if (window.electron.process.platform === 'win32') {
    toolRegistry.register(powerShellHandler)
  }
  toolRegistry.register(monitorHandler)
}
