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
        // Find null terminator (2 bytes for UTF-16).
        // Must start at an even byte boundary — UTF-16LE chars are 2 bytes,
        // and a 0x00 byte in the high byte of a char (e.g. 'f' = 0x0066)
        // followed by the first 0x00 of the real terminator would cause
        // a false match at an odd offset, truncating the last character.
        let end = -1
        let searchStart = offset
        while (searchStart < buffer.length - 1) {
          const candidate = buffer.indexOf(Buffer.from([0, 0]), searchStart)
          if (candidate === -1) break
          if (candidate % 2 === 0) {
            end = candidate
            break
          }
          searchStart = candidate + 1
        }
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
