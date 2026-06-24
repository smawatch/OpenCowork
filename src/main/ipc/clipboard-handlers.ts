import { clipboard, ipcMain } from 'electron'
import { CLIPBOARD_READ_FILE_PATHS } from '../../shared/ipc-channels'

export function registerClipboardHandlers(): void {
  ipcMain.handle(CLIPBOARD_READ_FILE_PATHS, (): string[] => {
    try {
      // Read clipboard contents - Windows FileNameW format
      const clipboardContent = clipboard.readBuffer('FileNameW')
      
      if (clipboardContent.length === 0) {
        console.log('[Clipboard] No FileNameW data in clipboard')
        return []
      }

      // Parse Windows clipboard format for file paths
      // FileNameW format: null-terminated UTF-16 strings, double null-terminated
      const paths: string[] = []
      const buffer = Buffer.from(clipboardContent)
      let offset = 0
      
      while (offset < buffer.length) {
        // Find null terminator (2 bytes for UTF-16)
        let end = buffer.indexOf(Buffer.from([0, 0]), offset)
        if (end === -1) end = buffer.length
        
        const segment = buffer.slice(offset, end).toString('utf16le')
        if (segment) {
          paths.push(segment)
        }
        
        offset = end + 2
        
        // Check for double null terminator (end of list)
        if (offset < buffer.length && buffer[offset] === 0 && buffer[offset + 1] === 0) {
          break
        }
      }

      console.log('[Clipboard] Read file paths:', paths)
      return paths
    } catch (error) {
      console.error('[Clipboard] Error reading file paths:', error)
      return []
    }
  })
}
