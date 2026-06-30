import { ipcMain, BrowserWindow, dialog } from 'electron'
import archiver from 'archiver'
import * as fs from 'fs'
import * as path from 'path'
import { getRecentLogFiles } from '../log-manager'

export function registerLogHandlers(): void {
  ipcMain.handle('log:export', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) {
      return { success: false, error: 'No focused window' }
    }

    const now = new Date()
    const p = (n: number): string => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}-${p(now.getMinutes())}-${p(now.getSeconds())}`
    const defaultName = `open-cowork-logs-${stamp}.zip`

    const result = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }]
    })

    if (result.canceled || !result.filePath) {
      return { success: false, error: 'Save canceled' }
    }

    try {
      const recentFiles = getRecentLogFiles()
      if (recentFiles.length === 0) {
        return { success: false, error: 'No log files found' }
      }

      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(result.filePath!)
        const archive = archiver('zip', { zlib: { level: 9 } })

        output.on('close', () => resolve())
        output.on('error', (err) => reject(err))

        archive.on('warning', (err) => {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
          reject(err)
        })
        archive.on('error', (err) => reject(err))

        archive.pipe(output)
        for (const filePath of recentFiles) {
          archive.file(filePath, { name: path.basename(filePath) })
        }
        void archive.finalize()
      })

      return { success: true, filePath: result.filePath, fileCount: recentFiles.length }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
