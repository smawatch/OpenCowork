import { ipcMain, app, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// asarUnpack: resources/** → extracted to app.asar.unpacked/resources/
// Dev: <project>/resources/figma-pilot-plugin/
// Packaged: resources/app.asar.unpacked/resources/figma-pilot-plugin/
const PLUGIN_SOURCE_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'figma-pilot-plugin')
  : path.join(app.getAppPath(), 'resources', 'figma-pilot-plugin')

function getFigmaDevPluginDir(): string | null {
  const platform = os.platform()
  const home = os.homedir()

  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'Figma', 'Desktop', 'development', 'figma-pilot')
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Figma', 'Desktop', 'development', 'figma-pilot')
  }
  // Linux — Figma not officially supported, but try common paths
  return path.join(home, '.config', 'Figma', 'Desktop', 'development', 'figma-pilot')
}

function getFigmaDevPluginParentDir(): string | null {
  const platform = os.platform()
  const home = os.homedir()

  if (platform === 'win32') {
    return path.join(os.homedir(), 'AppData', 'Roaming', 'Figma', 'Desktop', 'development')
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Figma', 'Desktop', 'development')
  }
  return path.join(home, '.config', 'Figma', 'Desktop', 'development')
}

function checkPluginInstalled(): boolean {
  const pluginDir = getFigmaDevPluginDir()
  if (!pluginDir) return false
  const manifestPath = path.join(pluginDir, 'manifest.json')
  return fs.existsSync(manifestPath)
}

function installPlugin(): { success: boolean; message: string; pluginDir?: string } {
  const pluginDir = getFigmaDevPluginDir()
  if (!pluginDir) {
    return { success: false, message: 'Cannot determine Figma plugin directory on this platform' }
  }

  // Check source files exist
  const manifestPath = path.join(PLUGIN_SOURCE_DIR, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    return { success: false, message: `Plugin source not found at ${PLUGIN_SOURCE_DIR}. Please reinstall the application.` }
  }

  try {
    // Create parent directories
    const parentDir = getFigmaDevPluginParentDir()
    if (parentDir && !fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }

    // Remove old plugin if exists
    if (fs.existsSync(pluginDir)) {
      fs.rmSync(pluginDir, { recursive: true, force: true })
    }

    // Copy plugin files
    fs.mkdirSync(pluginDir, { recursive: true })
    copyDirSync(PLUGIN_SOURCE_DIR, pluginDir)

    return { success: true, message: 'Plugin installed successfully', pluginDir }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: `Failed to install plugin: ${msg}` }
  }
}

function copyDirSync(src: string, dest: string): void {
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function registerFigmaPluginHandlers(): void {
  ipcMain.handle('figma-plugin:status', () => {
    const installed = checkPluginInstalled()
    const pluginDir = getFigmaDevPluginDir()
    return { installed, pluginDir }
  })

  ipcMain.handle('figma-plugin:install', () => {
    return installPlugin()
  })

  ipcMain.handle('figma-plugin:open-dev-dir', () => {
    const parentDir = getFigmaDevPluginParentDir()
    if (parentDir && fs.existsSync(parentDir)) {
      void shell.openPath(parentDir)
      return { success: true }
    }
    // Create and open
    try {
      if (parentDir && !fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }
      if (parentDir) void shell.openPath(parentDir)
      return { success: true }
    } catch {
      return { success: false, error: 'Cannot open Figma plugins directory' }
    }
  })
}
