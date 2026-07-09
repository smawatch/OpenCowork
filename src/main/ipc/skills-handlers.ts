import { execFile } from 'child_process'
import { ipcMain, shell, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'
import { promisify } from 'util'
import { getDefaultApiUserAgent } from '../lib/api-user-agent'
import { readSettings } from './settings-handlers'
import {
  shouldEncrypt,
  isEncrypted,
  encryptContent,
  decryptContent
} from '../lib/skill-encryption'

const execFileAsync = promisify(execFile)

export interface MarketSkillInfo {
  id: string
  slug: string
  name: string
  description: string
  subtitle?: string
  category?: string
  tags: string[]
  downloads: number
  favorites?: number
  githubStars?: number
  securityLevel?: string
  sourceCredibility?: string
  updatedAt?: string
  filePath?: string
  url: string
  downloadUrl: string
  installCommand: string
  icon?: string
  author?: string
  version?: string
  views?: number
  fileSize?: number
  ratingCount?: number
  inLeaderboard?: boolean
  leaderboardRank?: number
  summary?: string
}

export interface MarketSkillDetail extends MarketSkillInfo {
  summary: string
  version: string
  views: number
  fileSize: number
  tags: string[]
  ratingCount: number
  inLeaderboard: boolean
  leaderboardRank: number
}

const SKILLS_MARKET_BASE_URL = 'https://hub.cocoloop.cn'
const SKILLS_MARKET_API_BASE_URL = 'https://api.cocoloop.cn/api/v1/store'
const SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills')
const SKILLS_FILENAME = 'SKILL.md'
const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.sh',
  '.bash',
  '.ps1',
  '.bat',
  '.cmd',
  '.rb',
  '.pl',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.cfg',
  '.ini',
  '.env'
])

/**
 * Recursively copy a directory from src to dest.
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Resolve the path to the bundled resources/skills/ directory.
 * - Dev: <project>/resources/skills/
 * - Production: <app>/resources/skills/ (asarUnpacked)
 */
function getBundledSkillsDir(): string {
  const isDev = !app.isPackaged

  if (isDev) {
    return path.join(app.getAppPath(), 'resources', 'skills')
  }

  const unpackedDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'skills')
  if (fs.existsSync(unpackedDir)) {
    return unpackedDir
  }

  return path.join(process.resourcesPath, 'resources', 'skills')
}

/**
 * Read version from a skill directory's _meta.json.
 * Returns a comparable array [major, minor, patch] or null if unavailable.
 */
function readSkillMeta(dir: string): Record<string, unknown> | null {
  try {
    const metaPath = path.join(dir, '_meta.json')
    if (!fs.existsSync(metaPath)) return null
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  } catch {
    return null
  }
}

function readSkillVersion(dir: string): number[] | null {
  try {
    const meta = readSkillMeta(dir)
    if (!meta) return null
    const v = meta.version as string | undefined
    if (!v) return null
    return v.split('.').map(Number)
  } catch {
    return null
  }
}

/** Compare two version arrays. Returns positive if a > b, negative if a < b, 0 if equal. */
function compareVersions(a: number[] | null, b: number[] | null): number {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0
    const vb = b[i] ?? 0
    if (va !== vb) return va - vb
  }
  return 0
}

/**
 * Sync built-in skills from resources/skills/ → ~/.agents/skills/.
 * - Skills with `autoInstall: true` in _meta.json → auto-install on first launch.
 * - Previously-installed skills → version-check and auto-update if newer.
 * - Other enterprise skills → skip (user installs manually from the Enterprise tab).
 */
function ensureBuiltinSkills(): void {
  try {
    const bundledDir = getBundledSkillsDir()
    if (!fs.existsSync(bundledDir)) {
      console.warn('[Skills] Bundled skills directory not found:', bundledDir)
      return
    }

    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true })
    }

    const entries = fs.readdirSync(bundledDir, { withFileTypes: true })
    let updated = 0
    let skipped = 0
    let created = 0

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sourceDir = path.join(bundledDir, entry.name)
      const targetDir = path.join(SKILLS_DIR, entry.name)

      if (fs.existsSync(targetDir)) {
        // Already installed → version check for updates
        const sourceVersion = readSkillVersion(sourceDir)
        const targetVersion = readSkillVersion(targetDir)

        if (compareVersions(sourceVersion, targetVersion) <= 0) {
          skipped++
          continue
        }

        fs.rmSync(targetDir, { recursive: true, force: true })
        copyDirRecursive(sourceDir, targetDir)
        updated++
        console.log(
          `[Skills] Updated builtin skill "${entry.name}" to v${sourceVersion?.join('.') ?? '?'}`
        )
      } else {
        // Not installed → only auto-install if _meta.json has autoInstall: true
        const meta = readSkillMeta(sourceDir)
        if (meta?.autoInstall === true) {
          copyDirRecursive(sourceDir, targetDir)
          created++
          console.log(`[Skills] Auto-installed enterprise skill "${entry.name}"`)
        }
      }
    }

    if (created > 0 || updated > 0) {
      console.log(
        `[Skills] Builtin skills: ${created} auto-installed, ${updated} updated, ${skipped} skipped`
      )
    }
  } catch (err) {
    console.error('[Skills] Failed to initialize builtin skills:', err)
  }
}

function ensureBuiltinSkill(name: string): { success: boolean; name?: string; error?: string } {
  try {
    const normalizedName = name.trim()
    if (!/^[a-z0-9-]+$/.test(normalizedName)) {
      return { success: false, error: 'Invalid built-in skill name' }
    }

    const bundledDir = getBundledSkillsDir()
    const sourceDir = path.join(bundledDir, normalizedName)
    const sourceManifest = path.join(sourceDir, SKILLS_FILENAME)
    if (!fs.existsSync(sourceManifest)) {
      return { success: false, error: `Built-in skill "${normalizedName}" was not found` }
    }

    if (!fs.existsSync(SKILLS_DIR)) {
      fs.mkdirSync(SKILLS_DIR, { recursive: true })
    }

    const targetDir = path.join(SKILLS_DIR, normalizedName)
    const targetManifest = path.join(targetDir, SKILLS_FILENAME)

    if (fs.existsSync(targetManifest)) {
      // Version check: only update if bundled version is newer
      const sourceVersion = readSkillVersion(sourceDir)
      const targetVersion = readSkillVersion(targetDir)
      if (compareVersions(sourceVersion, targetVersion) <= 0) {
        return { success: true, name: normalizedName }
      }
    }

    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    copyDirRecursive(sourceDir, targetDir)

    return { success: true, name: normalizedName }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export interface SkillInfo {
  name: string
  description: string
  version?: string
  builtin?: boolean
}

export interface EnterpriseRemoteSkill {
  name: string
  description: string
  version: string
  author?: string
  downloadUrl: string
  protected?: boolean  // built-in enterprise skills, not overwritable by upload
}

export interface ScanFileInfo {
  name: string
  size: number
  type: string
}

export interface RiskItem {
  severity: 'safe' | 'warning' | 'danger'
  category: string
  detail: string
  file: string
  line?: number
}

export interface ScanResult {
  name: string
  description: string
  files: ScanFileInfo[]
  risks: RiskItem[]
  skillMdContent: string
  scriptContents: { file: string; content: string }[]
}

/**
 * Extract a short description from SKILL.md content.
 * Parses YAML frontmatter for 'description' field first,
 * then falls back to the first non-empty, non-heading line.
 */
function extractDescription(content: string, fallback: string): string {
  // Try to parse YAML frontmatter first
  const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  if (fmMatch) {
    const fmBlock = fmMatch[1]
    const descMatch = fmBlock.match(/^description:\s*(.+)$/m)
    if (descMatch) {
      const desc = descMatch[1].trim().replace(/^["']|["']$/g, '')
      if (desc) return desc.length > 200 ? desc.slice(0, 200) + '...' : desc
    }
  }

  // Fallback: first non-empty, non-heading, non-frontmatter line
  const lines = content.split('\n')
  let inFrontmatter = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '---') {
      inFrontmatter = !inFrontmatter
      continue
    }
    if (inFrontmatter) continue
    if (!trimmed) continue
    if (trimmed.startsWith('#')) continue
    return trimmed.length > 120 ? trimmed.slice(0, 120) + '...' : trimmed
  }
  return fallback
}

function findSkillManifestPath(dir: string): string | null {
  const manifests: string[] = []

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }

      const normalizedName = entry.name.toLowerCase()
      if (normalizedName === 'skill.md' || normalizedName === 'skills.md') {
        manifests.push(fullPath)
      }
    }
  }

  walk(dir)

  if (manifests.length === 0) {
    return null
  }

  manifests.sort((left, right) => {
    const leftDepth = path.relative(dir, left).split(path.sep).length
    const rightDepth = path.relative(dir, right).split(path.sep).length
    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth
    }
    return left.localeCompare(right)
  })

  return manifests[0]
}

function collectTextFiles(rootDir: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = []

  function walk(dir: string, prefix: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(fullPath, relativePath)
        continue
      }

      const extension = path.extname(entry.name).toLowerCase()
      const normalizedName = entry.name.toLowerCase()
      if (
        !TEXT_FILE_EXTENSIONS.has(extension) &&
        normalizedName !== 'skill.md' &&
        normalizedName !== 'skills.md'
      ) {
        continue
      }

      try {
        files.push({
          path: relativePath.replace(/\\/g, '/'),
          content: fs.readFileSync(fullPath, 'utf-8')
        })
      } catch {
        // Skip unreadable files
      }
    }
  }

  walk(rootDir, '')
  return files
}

async function extractZipArchive(zipPath: string, destinationDir: string): Promise<void> {
  if (process.platform === 'win32') {
    const escapePowerShellPath = (value: string): string => value.replace(/'/g, "''")
    const command = `Expand-Archive -LiteralPath '${escapePowerShellPath(zipPath)}' -DestinationPath '${escapePowerShellPath(destinationDir)}' -Force`

    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
    return
  }

  try {
    await execFileAsync('unzip', ['-o', zipPath, '-d', destinationDir])
  } catch {
    await execFileAsync('python3', ['-m', 'zipfile', '-e', zipPath, destinationDir])
  }
}

/**
 * Fallback: extract zip using only local file headers (ignores central directory).
 * Works even when the central directory is corrupted, as long as files are stored (no compression).
 */
function extractZipFromBuffer(zipBuf: Buffer, destDir: string): void {
  let offset = 0
  while (offset < zipBuf.length - 30) {
    const sig = zipBuf.readUInt32LE(offset)
    if (sig !== 0x04034b50) {
      // Not a local file header — done with files
      if (offset > 0) break
      offset++
      continue
    }

    const compressionMethod = zipBuf.readUInt16LE(offset + 8)
    const compressedSize = zipBuf.readUInt32LE(offset + 18)
    const uncompressedSize = zipBuf.readUInt32LE(offset + 22)
    const nameLen = zipBuf.readUInt16LE(offset + 26)
    const extraLen = zipBuf.readUInt16LE(offset + 28)

    const nameBytes = zipBuf.subarray(offset + 30, offset + 30 + nameLen)
    const fileName = new TextDecoder().decode(nameBytes)
    const dataStart = offset + 30 + nameLen + extraLen
    const data = zipBuf.subarray(dataStart, dataStart + compressedSize)

    // Only handle stored (no compression) files
    if (compressionMethod !== 0) {
      offset = dataStart + compressedSize
      continue
    }

    // Sanity check: skip implausibly large files (max 50MB)
    if (uncompressedSize > 50 * 1024 * 1024) {
      offset = dataStart + compressedSize
      continue
    }

    const outPath = path.join(destDir, fileName)
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true })
      fs.writeFileSync(outPath, data)
    } catch {
      // Skip files that can't be written (e.g. invalid paths)
    }

    offset = dataStart + compressedSize
  }
}

/** 启动迁移：递归加密 SKILLS_DIR 中需要保护的文件 */
function ensureSkillsEncrypted(): void {
  try {
    if (!fs.existsSync(SKILLS_DIR)) return
    function walk(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.name === '_meta.json') {
          continue
        } else if (shouldEncrypt(full)) {
          const content = fs.readFileSync(full, 'utf-8')
          if (!isEncrypted(content)) {
            fs.writeFileSync(full, encryptContent(content), 'utf-8')
          }
        }
      }
    }
    walk(SKILLS_DIR)
  } catch (err) {
    console.error('[Skills] Encryption migration failed:', err)
  }
}

export function registerSkillsHandlers(): void {
  // Initialize builtin skills on startup
  ensureBuiltinSkills()
  // 迁移：加密本地技能文件
  ensureSkillsEncrypted()

  ipcMain.handle(
    'skills:ensure-builtin',
    async (
      _event,
      args: { name: string }
    ): Promise<{ success: boolean; name?: string; error?: string }> => {
      return ensureBuiltinSkill(args.name)
    }
  )

  /**
   * skills:list — scan ~/.agents/skills/ and return all available skills.
   * Each subdirectory containing a SKILL.md is treated as a skill.
   */
  ipcMain.handle('skills:list', async (): Promise<SkillInfo[]> => {
    try {
      if (!fs.existsSync(SKILLS_DIR)) return []
      const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      const skills: SkillInfo[] = []
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const mdPath = path.join(SKILLS_DIR, entry.name, SKILLS_FILENAME)
        if (!fs.existsSync(mdPath)) continue
        try {
          // 解密 SKILL.md（如已加密）
          const rawContent = fs.readFileSync(mdPath, 'utf-8')
          const content = isEncrypted(rawContent) ? decryptContent(rawContent) : rawContent
          const ver = readSkillVersion(path.join(SKILLS_DIR, entry.name))
          const isBuiltin = ver !== null || fs.existsSync(path.join(SKILLS_DIR, entry.name, '_meta.json'))
          skills.push({
            name: entry.name,
            description: extractDescription(content, entry.name),
            version: ver ? ver.join('.') : undefined,
            builtin: isBuiltin
          })
        } catch {
          // Skip unreadable files
        }
      }
      return skills
    } catch {
      return []
    }
  })

  /**
   * skills:list-builtin — scan resources/skills/ (bundled source) for all enterprise skills.
   * These are NOT auto-installed; shown in the Enterprise tab as available for installation.
   * Returns SkillInfo with version (from _meta.json if present, otherwise undefined).
   */
  ipcMain.handle('skills:list-builtin', async (): Promise<SkillInfo[]> => {
    try {
      const bundledDir = getBundledSkillsDir()
      if (!fs.existsSync(bundledDir)) return []

      const entries = fs.readdirSync(bundledDir, { withFileTypes: true })
      const skills: SkillInfo[] = []

      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const mdPath = path.join(bundledDir, entry.name, SKILLS_FILENAME)
        if (!fs.existsSync(mdPath)) continue

        try {
          // 解密 SKILL.md（如已加密）
          const rawContent = fs.readFileSync(mdPath, 'utf-8')
          const content = isEncrypted(rawContent) ? decryptContent(rawContent) : rawContent
          const ver = readSkillVersion(path.join(bundledDir, entry.name))
          // Description: _meta.json > SKILL.md frontmatter > fallback
          const meta = readSkillMeta(path.join(bundledDir, entry.name))
          const desc =
            (meta?.description as string) ||
            extractDescription(content, entry.name)
          skills.push({
            name: entry.name,
            description: desc,
            version: ver ? ver.join('.') : undefined,
            builtin: true
          })
        } catch {
          // Skip unreadable files
        }
      }

      return skills
    } catch {
      return []
    }
  })

  /**
   * skills:load-builtin — read the SKILL.md content from the bundled resources/skills/ directory.
   */
  ipcMain.handle(
    'skills:load-builtin',
    async (_event, args: { name: string }): Promise<{ content: string } | { error: string }> => {
      try {
        const bundledDir = getBundledSkillsDir()
        const mdPath = path.join(bundledDir, args.name, SKILLS_FILENAME)
        if (!fs.existsSync(mdPath)) {
          return { error: `Built-in skill "${args.name}" not found` }
        }
        // 解密后去除 frontmatter
        const raw = fs.readFileSync(mdPath, 'utf-8')
        const decrypted = isEncrypted(raw) ? decryptContent(raw) : raw
        const content = decrypted.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/, '')
        return { content: content.trimStart() }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  /**
   * skills:load — read the SKILL.md content for a given skill name (strips frontmatter for AI use).
   */
  ipcMain.handle(
    'skills:load',
    async (
      _event,
      args: { name: string }
    ): Promise<{ content: string; workingDirectory: string } | { error: string }> => {
      try {
        const skillDir = path.join(SKILLS_DIR, args.name)
        const mdPath = path.join(skillDir, SKILLS_FILENAME)
        if (!fs.existsSync(mdPath)) {
          return { error: `Skill "${args.name}" not found at ${mdPath}` }
        }
        // 解密后去除 frontmatter
        const raw = fs.readFileSync(mdPath, 'utf-8')
        const decrypted = isEncrypted(raw) ? decryptContent(raw) : raw
        const content = decrypted.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/, '')
        return { content: content.trimStart(), workingDirectory: skillDir }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  /**
   * skills:read 鈥?read the full SKILL.md content (with frontmatter intact) for display.
   */
  ipcMain.handle(
    'skills:read',
    async (_event, args: { name: string }): Promise<{ content: string } | { error: string }> => {
      try {
        const mdPath = path.join(SKILLS_DIR, args.name, SKILLS_FILENAME)
        if (!fs.existsSync(mdPath)) {
          return { error: `Skill "${args.name}" not found` }
        }
        // 解密 SKILL.md（如已加密）
        const raw = fs.readFileSync(mdPath, 'utf-8')
        const content = isEncrypted(raw) ? decryptContent(raw) : raw
        return { content }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  /**
   * skills:list-files 鈥?list all files in a skill directory with sizes and types.
   */
  ipcMain.handle(
    'skills:list-files',
    async (
      _event,
      args: { name: string }
    ): Promise<{ files: ScanFileInfo[] } | { error: string }> => {
      try {
        const skillDir = path.join(SKILLS_DIR, args.name)
        if (!fs.existsSync(skillDir)) {
          return { error: `Skill "${args.name}" not found` }
        }
        const files: ScanFileInfo[] = []
        function walkDir(dir: string, prefix: string): void {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) {
              walkDir(fullPath, relPath)
            } else {
              const stat = fs.statSync(fullPath)
              files.push({
                name: relPath,
                size: stat.size,
                type: path.extname(entry.name).toLowerCase() || 'unknown'
              })
            }
          }
        }
        walkDir(skillDir, '')
        return { files }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  /**
   * skills:delete — remove a skill directory from ~/.agents/skills/.
   */
  ipcMain.handle(
    'skills:delete',
    async (_event, args: { name: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        const skillDir = path.join(SKILLS_DIR, args.name)
        if (!fs.existsSync(skillDir)) {
          return { success: false, error: `Skill "${args.name}" not found` }
        }
        fs.rmSync(skillDir, { recursive: true, force: true })
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  /**
   * skills:open-folder 鈥?open a skill's directory in the system file explorer.
   */
  ipcMain.handle(
    'skills:open-folder',
    async (_event, args: { name: string }): Promise<{ success: boolean; error?: string }> => {
      try {
        const skillDir = path.join(SKILLS_DIR, args.name)
        if (!fs.existsSync(skillDir)) {
          return { success: false, error: `Skill "${args.name}" not found` }
        }
        await shell.openPath(skillDir)
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  /**
   * skills:add-from-folder — copy a skill from a source folder into ~/.agents/skills/.
   * Expects the source folder to contain a SKILL.md file.
   */
  ipcMain.handle(
    'skills:add-from-folder',
    async (
      _event,
      args: { sourcePath: string }
    ): Promise<{ success: boolean; name?: string; error?: string }> => {
      try {
        const srcMd = path.join(args.sourcePath, SKILLS_FILENAME)
        if (!fs.existsSync(srcMd)) {
          return { success: false, error: `No ${SKILLS_FILENAME} found in the selected folder` }
        }
        const skillName = path.basename(args.sourcePath)
        const targetDir = path.join(SKILLS_DIR, skillName)
        if (fs.existsSync(targetDir)) {
          return { success: false, error: `Skill "${skillName}" already exists` }
        }
        if (!fs.existsSync(SKILLS_DIR)) {
          fs.mkdirSync(SKILLS_DIR, { recursive: true })
        }
        copyDirRecursive(args.sourcePath, targetDir)
        return { success: true, name: skillName }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  /**
   * skills:save 鈥?write updated SKILL.md content back to disk.
   */
  ipcMain.handle(
    'skills:save',
    async (
      _event,
      args: { name: string; content: string }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const mdPath = path.join(SKILLS_DIR, args.name, SKILLS_FILENAME)
        if (!fs.existsSync(path.dirname(mdPath))) {
          return { success: false, error: `Skill "${args.name}" not found` }
        }
        // 加密后写入磁盘
        const encrypted = encryptContent(args.content)
        fs.writeFileSync(mdPath, encrypted, 'utf-8')
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  /**
   * skills:scan 鈥?analyze a skill folder for security risks before installation.
   * Returns file listing, risk analysis, and content previews.
   */
  ipcMain.handle(
    'skills:scan',
    async (_event, args: { sourcePath: string }): Promise<ScanResult | { error: string }> => {
      try {
        const srcMd = path.join(args.sourcePath, SKILLS_FILENAME)
        if (!fs.existsSync(srcMd)) {
          return { error: `No ${SKILLS_FILENAME} found in the selected folder` }
        }

        const skillName = path.basename(args.sourcePath)
        // 解密 SKILL.md（如已加密）
        const rawMdContent = fs.readFileSync(srcMd, 'utf-8')
        const skillMdContent = isEncrypted(rawMdContent) ? decryptContent(rawMdContent) : rawMdContent
        const description = extractDescription(skillMdContent, skillName)

        // Collect all files recursively
        const files: ScanFileInfo[] = []
        const scriptContents: { file: string; content: string }[] = []
        function walkDir(dir: string, prefix: string): void {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
            if (entry.isDirectory()) {
              walkDir(fullPath, relPath)
            } else {
              const stat = fs.statSync(fullPath)
              const ext = path.extname(entry.name).toLowerCase()
              files.push({ name: relPath, size: stat.size, type: ext || 'unknown' })
              // Read script/code files for analysis
              const codeExts = new Set([
                '.py',
                '.js',
                '.ts',
                '.sh',
                '.bash',
                '.ps1',
                '.bat',
                '.cmd',
                '.rb',
                '.pl'
              ])
              if (codeExts.has(ext)) {
                try {
                  // 解密脚本文件（如已加密）
                  const rawScript = fs.readFileSync(fullPath, 'utf-8')
                  const scriptContent = isEncrypted(rawScript) ? decryptContent(rawScript) : rawScript
                  scriptContents.push({ file: relPath, content: scriptContent })
                } catch {
                  /* skip unreadable */
                }
              }
            }
          }
        }
        walkDir(args.sourcePath, '')

        // Analyze risks
        const risks: RiskItem[] = []
        const allContents = [{ file: SKILLS_FILENAME, content: skillMdContent }, ...scriptContents]

        const riskPatterns: {
          pattern: RegExp
          severity: 'warning' | 'danger'
          category: string
          label: string
        }[] = [
          // Dangerous shell commands
          { pattern: /\brm\s+-rf\b/g, severity: 'danger', category: 'shell', label: 'rm -rf' },
          { pattern: /\bdel\s+\/[fFsS]/g, severity: 'danger', category: 'shell', label: 'del /f' },
          {
            pattern: /\bformat\s+[A-Z]:/gi,
            severity: 'danger',
            category: 'shell',
            label: 'format drive'
          },
          { pattern: /\bmkfs\b/g, severity: 'danger', category: 'shell', label: 'mkfs' },
          { pattern: /\bdd\s+if=/g, severity: 'danger', category: 'shell', label: 'dd' },
          // Code execution
          { pattern: /\beval\s*\(/g, severity: 'danger', category: 'execution', label: 'eval()' },
          { pattern: /\bexec\s*\(/g, severity: 'warning', category: 'execution', label: 'exec()' },
          {
            pattern: /\bsubprocess\b/g,
            severity: 'warning',
            category: 'execution',
            label: 'subprocess'
          },
          {
            pattern: /\bos\.system\s*\(/g,
            severity: 'danger',
            category: 'execution',
            label: 'os.system()'
          },
          {
            pattern: /\bchild_process\b/g,
            severity: 'warning',
            category: 'execution',
            label: 'child_process'
          },
          {
            pattern: /\bos\.popen\s*\(/g,
            severity: 'danger',
            category: 'execution',
            label: 'os.popen()'
          },
          // Network access
          {
            pattern: /\brequests\.(get|post|put|delete|patch)\s*\(/g,
            severity: 'warning',
            category: 'network',
            label: 'requests HTTP call'
          },
          { pattern: /\burllib\b/g, severity: 'warning', category: 'network', label: 'urllib' },
          { pattern: /\bfetch\s*\(/g, severity: 'warning', category: 'network', label: 'fetch()' },
          { pattern: /\bcurl\s+/g, severity: 'warning', category: 'network', label: 'curl' },
          { pattern: /\bwget\s+/g, severity: 'warning', category: 'network', label: 'wget' },
          {
            pattern: /\bhttpx?\.\w+\s*\(/g,
            severity: 'warning',
            category: 'network',
            label: 'HTTP client'
          },
          // Credential access
          {
            pattern: /\b(api_key|apikey|api[-_]?secret)\b/gi,
            severity: 'warning',
            category: 'credential',
            label: 'API key reference'
          },
          {
            pattern: /\b(password|passwd)\s*[=:]/gi,
            severity: 'danger',
            category: 'credential',
            label: 'password assignment'
          },
          {
            pattern: /\b(access_token|auth_token|bearer)\b/gi,
            severity: 'warning',
            category: 'credential',
            label: 'token reference'
          },
          // File system destructive
          {
            pattern: /\bshutil\.rmtree\s*\(/g,
            severity: 'danger',
            category: 'filesystem',
            label: 'shutil.rmtree()'
          },
          {
            pattern: /\bos\.remove\s*\(/g,
            severity: 'warning',
            category: 'filesystem',
            label: 'os.remove()'
          },
          {
            pattern: /\bfs\.(unlinkSync|rmSync)\s*\(/g,
            severity: 'danger',
            category: 'filesystem',
            label: 'fs delete'
          },
          // Data exfiltration patterns
          {
            pattern: /\bbase64\b.*\b(send|post|upload)\b/gi,
            severity: 'danger',
            category: 'exfiltration',
            label: 'base64 + send'
          }
        ]

        for (const { file, content } of allContents) {
          const lines = content.split('\n')
          for (const rp of riskPatterns) {
            // Reset regex lastIndex for global patterns
            rp.pattern.lastIndex = 0
            for (let i = 0; i < lines.length; i++) {
              rp.pattern.lastIndex = 0
              if (rp.pattern.test(lines[i])) {
                // Avoid duplicate risks for same file+line+category
                const exists = risks.some(
                  (r) => r.file === file && r.line === i + 1 && r.category === rp.category
                )
                if (!exists) {
                  risks.push({
                    severity: rp.severity,
                    category: rp.category,
                    detail: rp.label,
                    file,
                    line: i + 1
                  })
                }
              }
            }
          }
        }

        return { name: skillName, description, files, risks, skillMdContent, scriptContents }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  /**
   * Normalise a raw skill object from the Cocoloop Skills Marketplace API into MarketSkillInfo.
   */
  function normaliseMarketSkillItem(s: Record<string, unknown>, index: number): MarketSkillInfo {
    const id = String(s['id'] ?? `skill-${index}`)
    const name = String(s['name'] ?? '')
    // Sanitize name for filesystem: replace path separators and other invalid chars
    const slug = (name || id).replace(/[/\\:*?"<>|]/g, '-').trim()
    const description = String(s['brief'] ?? s['subtitle'] ?? '')
    const category = s['category'] != null ? String(s['category']) : undefined
    const tags: string[] = []
    if (s['security_level'] != null) tags.push(String(s['security_level']))
    if (s['source_credibility'] != null) tags.push(String(s['source_credibility']))
    const rawDownloads = String(s['downloads'] ?? '0')
    const downloads = parseShortNumber(rawDownloads)
    const downloadUrl = s['download_url'] != null ? String(s['download_url']) : ''
    const icon = s['icon'] != null ? String(s['icon']) : undefined
    const author = s['author'] != null ? String(s['author']) : undefined
    const subtitle = s['subtitle'] != null ? String(s['subtitle']) : undefined
    const favorites = parseShortNumber(String(s['favorites'] ?? '0'))
    const githubStars = parseShortNumber(String(s['github_stars'] ?? '0'))
    const securityLevel = s['security_level'] != null ? String(s['security_level']) : undefined
    const sourceCredibility = s['source_credibility'] != null ? String(s['source_credibility']) : undefined

    return {
      id,
      slug,
      name,
      description,
      subtitle,
      category,
      tags,
      downloads,
      favorites: favorites > 0 ? favorites : undefined,
      githubStars: githubStars > 0 ? githubStars : undefined,
      securityLevel,
      sourceCredibility,
      updatedAt: undefined,
      filePath: undefined,
      url: `${SKILLS_MARKET_BASE_URL}/skills/${id}`,
      downloadUrl,
      installCommand: `npx skills add ${slug}`,
      icon,
      author
    }
  }

  /**
   * Parse short-form numbers like "418.2k", "9.4k", "1.2M" into integers.
   */
  function parseShortNumber(value: string): number {
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) return 0
    const num = parseFloat(trimmed)
    if (Number.isNaN(num)) return 0
    if (trimmed.endsWith('k')) return Math.round(num * 1000)
    if (trimmed.endsWith('m')) return Math.round(num * 1000000)
    return Math.round(num)
  }

  function parseSkillsMarketResponse(json: Record<string, unknown>): {
    total: number
    skills: MarketSkillInfo[]
  } {
    if (json['code'] !== 0) {
      const message = String(json['message'] ?? 'Skills marketplace API returned failure')
      throw new Error(message)
    }

    const data = json['data'] as Record<string, unknown> | undefined
    const rawSkills = Array.isArray(data?.['items']) ? (data!['items'] as Record<string, unknown>[]) : []
    const total = Number(data?.['total'] ?? rawSkills.length)

    return {
      total: Number.isFinite(total) ? total : rawSkills.length,
      skills: rawSkills.map((skill, index) => normaliseMarketSkillItem(skill, index))
    }
  }

  /**
   * Fetch skills from the Cocoloop Skills Marketplace API.
   */
  async function fetchSkillsMarketList(args: {
    query?: string
    offset?: number
    limit?: number
    apiKey?: string
    tab?: string
  }): Promise<{ total: number; skills: MarketSkillInfo[] }> {
    const query = (args.query ?? '').trim()
    const pageSize = Math.min(args.limit ?? 20, 100)
    const page = Math.floor((args.offset ?? 0) / pageSize) + 1
    const tab = args.tab || 'overall'
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort: 'downloads',
      tab
    })

    if (query) {
      params.set('keyword', query)
    }

    const res = await fetch(`${SKILLS_MARKET_API_BASE_URL}/skills?${params.toString()}`, {
      headers: {
        ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
        Accept: 'application/json',
        'User-Agent': getDefaultApiUserAgent(),
        Origin: SKILLS_MARKET_BASE_URL,
        Referer: `${SKILLS_MARKET_BASE_URL}/`
      }
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Skills marketplace API ${res.status}: ${body || 'Unknown error'}`)
    }

    const json = (await res.json()) as Record<string, unknown>
    return parseSkillsMarketResponse(json)
  }

  /**
   * skills:market-list — return paginated market skills with optional search.
   * Uses a Skills Marketplace API key when provided.
   */
  ipcMain.handle(
    'skills:market-list',
    async (
      _event,
      args: {
        offset?: number
        limit?: number
        query?: string
        provider?: 'skillsmp' | 'cocoloop'
        apiKey?: string
        tab?: string
      }
    ): Promise<{
      total: number
      skills: MarketSkillInfo[]
    }> => {
      if (args.provider && args.provider !== 'skillsmp' && args.provider !== 'cocoloop')
        return { total: 0, skills: [] }

      try {
        return await fetchSkillsMarketList({
          query: args.query,
          offset: args.offset,
          limit: args.limit,
          apiKey: args.apiKey,
          tab: args.tab
        })
      } catch (err) {
        console.error('[Skills] Skills marketplace API error:', err)
        return { total: 0, skills: [] }
      }
    }
  )

  /**
   * skills:market-detail — fetch a single skill's full detail from the marketplace.
   */
  ipcMain.handle(
    'skills:market-detail',
    async (
      _event,
      args: { skillId: string }
    ): Promise<{ detail: MarketSkillDetail } | { error: string }> => {
      try {
        const res = await fetch(`${SKILLS_MARKET_API_BASE_URL}/skills/${encodeURIComponent(args.skillId)}`, {
          headers: {
            Accept: 'application/json',
            'User-Agent': getDefaultApiUserAgent(),
            Origin: SKILLS_MARKET_BASE_URL,
            Referer: `${SKILLS_MARKET_BASE_URL}/`
          }
        })

        if (!res.ok) {
          return { error: `API ${res.status}: ${await res.text().catch(() => 'Unknown error')}` }
        }

        const json = (await res.json()) as Record<string, unknown>
        if (json['code'] !== 0) {
          return { error: String(json['message'] ?? 'API returned failure') }
        }

        const data = json['data'] as Record<string, unknown> | undefined
        if (!data) {
          return { error: 'No data returned from API' }
        }

        const detail: MarketSkillDetail = {
          id: String(data['id'] ?? ''),
          slug: String(data['id'] ?? ''),
          name: String(data['name'] ?? ''),
          description: String(data['brief'] ?? data['subtitle'] ?? ''),
          subtitle: data['subtitle'] != null ? String(data['subtitle']) : undefined,
          category: data['category'] != null ? String(data['category']) : undefined,
          tags: Array.isArray(data['tags']) ? data['tags'].map(String) : [],
          downloads: parseShortNumber(String(data['downloads'] ?? '0')),
          favorites: parseShortNumber(String(data['favorites'] ?? '0')),
          githubStars: parseShortNumber(String(data['github_stars'] ?? '0')),
          securityLevel: data['security_level'] != null ? String(data['security_level']) : undefined,
          sourceCredibility: data['source_credibility'] != null ? String(data['source_credibility']) : undefined,
          downloadUrl: data['download_url'] != null ? String(data['download_url']) : '',
          icon: data['icon'] != null ? String(data['icon']) : undefined,
          author: data['author'] != null ? String(data['author']) : undefined,
          version: String(data['version'] ?? ''),
          views: parseShortNumber(String(data['views'] ?? '0')),
          fileSize: Number(data['file_size'] ?? 0),
          ratingCount: Number(data['rating_user_count'] ?? 0),
          inLeaderboard: Boolean(data['in_leaderboard']),
          leaderboardRank: Number(data['leaderboard_rank'] ?? 0),
          summary: String(data['summary'] ?? ''),
          url: `${SKILLS_MARKET_BASE_URL}/skills/${data['id']}`,
          installCommand: `npx skills add ${data['id']}`
        }

        return { detail }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  async function downloadFromSkillsMarket(args: {
    slug: string
    downloadUrl?: string
  }): Promise<{ tempPath: string; files: { path: string; content: string }[] }> {
    const tempBase = path.join(os.tmpdir(), 'opencowork-skills', `download-${Date.now()}`)
    const tempDir = path.join(tempBase, args.slug)

    if (!args.downloadUrl) {
      throw new Error('No download URL provided for skill')
    }

    fs.mkdirSync(tempBase, { recursive: true })

    const response = await fetch(args.downloadUrl, {
      headers: {
        Accept: 'application/zip, text/markdown;q=0.9, */*;q=0.8',
        'User-Agent': getDefaultApiUserAgent()
      }
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(
        `Skills marketplace download failed ${response.status}: ${body || 'Unknown error'}`
      )
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    const contentDisposition = response.headers.get('content-disposition')?.toLowerCase() ?? ''
    const isZip = contentType.includes('application/zip') || contentDisposition.includes('.zip')

    if (isZip) {
      const archivePath = path.join(tempBase, `${args.slug}.zip`)
      const extractDir = path.join(tempBase, '_archive')
      const archiveBuffer = Buffer.from(await response.arrayBuffer())

      fs.writeFileSync(archivePath, archiveBuffer)
      fs.mkdirSync(extractDir, { recursive: true })
      await extractZipArchive(archivePath, extractDir)

      const manifestPath = findSkillManifestPath(extractDir)
      let finalManifestPath = manifestPath
      if (!finalManifestPath) {
        console.warn('[skills] System unzip produced empty dir — trying fallback extraction from buffer')
        try {
          extractZipFromBuffer(archiveBuffer, extractDir)
          finalManifestPath = findSkillManifestPath(extractDir)
        } catch (fallbackErr) {
          console.error('[skills] Fallback extraction also failed:', fallbackErr)
        }
      }

      if (!finalManifestPath) {
        throw new Error(`No SKILL.md found in downloaded archive for ${args.slug}`)
      }

      const sourceDir = path.dirname(finalManifestPath)
      copyDirRecursive(sourceDir, tempDir)

      const manifestFileName = path.basename(finalManifestPath)
      if (manifestFileName !== SKILLS_FILENAME) {
        const currentManifestPath = path.join(tempDir, manifestFileName)
        const normalizedManifestPath = path.join(tempDir, SKILLS_FILENAME)
        if (fs.existsSync(currentManifestPath)) {
          if (fs.existsSync(normalizedManifestPath)) {
            fs.rmSync(normalizedManifestPath, { force: true })
          }
          fs.renameSync(currentManifestPath, normalizedManifestPath)
        }
      }
    } else {
      fs.mkdirSync(tempDir, { recursive: true })
      fs.writeFileSync(path.join(tempDir, SKILLS_FILENAME), await response.text(), 'utf-8')
    }

    const files = collectTextFiles(tempDir)
    if (!files.some((file) => file.path === SKILLS_FILENAME)) {
      throw new Error(`Downloaded skill ${args.slug} is missing SKILL.md`)
    }

    return { tempPath: tempDir, files }
  }

  /**
   * skills:download-remote — download a skill from the remote marketplace to a temp directory.
   * Returns the temp path and text file contents for agent review.
   */
  ipcMain.handle(
    'skills:download-remote',
    async (
      _event,
      args: {
        slug?: string
        name: string
        provider?: 'skillsmp' | 'cocoloop'
        apiKey?: string
        skillId?: string
        url?: string
        downloadUrl?: string
      }
    ): Promise<{
      tempPath?: string
      files?: { path: string; content: string }[]
      error?: string
    }> => {
      try {
        const slug = (args.slug ?? args.skillId ?? args.name).trim()
        if (!slug) {
          return { error: 'Missing skill slug for marketplace download' }
        }

        if (!args.downloadUrl) {
          return { error: 'Missing download URL for skill' }
        }

        const result = await downloadFromSkillsMarket({
          slug,
          downloadUrl: args.downloadUrl
        })

        return result
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  /**
   * skills:cleanup-temp 鈥?remove a temporary skill directory after installation or cancellation.
   */
  ipcMain.handle(
    'skills:cleanup-temp',
    async (_event, args: { tempPath: string }): Promise<{ success: boolean }> => {
      try {
        // Safety check: only delete paths in the temp directory
        if (!args.tempPath.includes('opencowork-skills')) {
          console.warn('[Skills] Refusing to delete non-temp path:', args.tempPath)
          return { success: false }
        }

        // Find the base temp directory (parent of the skill directory)
        // tempPath is like: /tmp/opencowork-skills/download-123456/skill-name
        // We want to delete: /tmp/opencowork-skills/download-123456
        const parts = args.tempPath.split(path.sep)
        const skillsIndex = parts.findIndex((p) => p === 'opencowork-skills')
        if (skillsIndex >= 0 && skillsIndex + 1 < parts.length) {
          const baseTempDir = parts.slice(0, skillsIndex + 2).join(path.sep)
          if (fs.existsSync(baseTempDir)) {
            fs.rmSync(baseTempDir, { recursive: true, force: true })
          }
        } else if (fs.existsSync(args.tempPath)) {
          // Fallback: just delete the provided path
          fs.rmSync(args.tempPath, { recursive: true, force: true })
        }
        return { success: true }
      } catch (err) {
        console.error('[Skills] Cleanup failed:', err)
        return { success: false }
      }
    }
  )

  // ── Enterprise Remote Skills ──

  /**
   * skills:enterprise-remote-list — fetch manifest.json directly from OSS.
   */
  ipcMain.handle('skills:enterprise-remote-list', async (): Promise<{
    success: boolean
    skills?: EnterpriseRemoteSkill[]
    error?: string
  }> => {
    try {
      // Try CDN domain first, then OSS direct endpoint
      const manifestUrls = [
        `https://sma-hk-test.oss-accelerate.aliyuncs.com/cocowork/enterprise-skills/manifest.json`,
        `https://dev-oss.iot-solution.net/cocowork/enterprise-skills/manifest.json`
      ]

      let data: { skills?: EnterpriseRemoteSkill[] } | null = null
      for (const url of manifestUrls) {
        try {
          const response = await fetch(url, {
            headers: { 'User-Agent': getDefaultApiUserAgent() }
          })
          if (response.status === 404) continue
          if (!response.ok) continue
          data = await response.json() as { skills?: EnterpriseRemoteSkill[] }
          if (data) break
        } catch { continue }
      }

      if (!data) {
        return { success: true, skills: [] }
      }

      return { success: true, skills: data.skills ?? (Array.isArray(data) ? data as EnterpriseRemoteSkill[] : []) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  /**
   * skills:enterprise-remote-download — download an enterprise skill from OSS and install it.
   */
  ipcMain.handle(
    'skills:enterprise-remote-download',
    async (_event, args: { name: string; downloadUrl: string }): Promise<{
      success: boolean
      error?: string
    }> => {
      try {
        // Download from OSS — try direct URL first, then with STS auth
        let response: Response | null = null

        // Attempt 1: direct public URL
        for (const url of [args.downloadUrl]) {
          try {
            const resp = await fetch(url, { headers: { 'User-Agent': getDefaultApiUserAgent() } })
            if (resp.ok) { response = resp; break }
          } catch { continue }
        }

        // Attempt 2: with STS credentials (for private bucket)
        if (!response) {
          try {
            const settings = readSettings()
            const token = settings.authToken as string | undefined
            if (!token) throw new Error('no auth')

            const stsResp = await fetch('https://dev.iot-solution.net/kotlinweb/ali/getStsRam', {
              headers: { Authorization: `Bearer ${token}`, 'User-Agent': getDefaultApiUserAgent() }
            })
            const stsJson = await stsResp.json() as { code: number; data?: StsResponse }
            if (stsJson.code === 0 && stsJson.data) {
              const cred = stsJson.data.response.credentials
              const bucket = stsJson.data.bucket
              const ep = stsJson.data.endPoint
              // Try OSS direct endpoint with STS auth
              const key = new URL(args.downloadUrl).pathname.slice(1) // strip leading /
              const ossUrl = `https://${bucket}.${ep}/${key}`
              const date = new Date().toUTCString()
              const signStr = `GET\n\n\n${date}\nx-oss-security-token:${cred.securityToken}\n/${bucket}/${key}`
              const sig = crypto.createHmac('sha1', cred.accessKeySecret).update(signStr).digest('base64')
              response = await fetch(ossUrl, {
                headers: {
                  'Date': date,
                  'Authorization': `OSS ${cred.accessKeyId}:${sig}`,
                  'x-oss-security-token': cred.securityToken,
                  'User-Agent': getDefaultApiUserAgent()
                }
              })
            }
          } catch { /* STS download failed */ }
        }

        if (!response) {
          return { success: false, error: 'Download failed: OSS file not accessible (check bucket public-read permission)' }
        }

        // Verify it's actually a zip file
        const archiveBuffer = Buffer.from(await response.arrayBuffer())
        const isZip = archiveBuffer.length >= 4 &&
          archiveBuffer[0] === 0x50 && archiveBuffer[1] === 0x4B &&
          archiveBuffer[2] === 0x03 && archiveBuffer[3] === 0x04

        if (!isZip) {
          const preview = archiveBuffer.toString('utf-8').slice(0, 300)
          return { success: false, error: `Downloaded file is not a valid zip (size=${archiveBuffer.length}). First bytes: ${preview}` }
        }

        // Extract to temp
        const tempBase = path.join(os.tmpdir(), 'opencowork-skills', `enterprise-${Date.now()}`)
        fs.mkdirSync(tempBase, { recursive: true })

        const archivePath = path.join(tempBase, `${args.name}.zip`)
        fs.writeFileSync(archivePath, archiveBuffer)

        const extractDir = path.join(tempBase, '_archive')
        fs.mkdirSync(extractDir, { recursive: true })
        await extractZipArchive(archivePath, extractDir)

        // Fallback: if system unzip produced nothing (e.g. corrupt central directory on Windows),
        // manually extract using local file headers from the buffer.
        const manifestPath = findSkillManifestPath(extractDir)
        if (!manifestPath) {
          console.warn('[skills] System unzip produced empty dir — trying fallback extraction from buffer')
          try {
            extractZipFromBuffer(archiveBuffer, extractDir)
          } catch (fallbackErr) {
            console.error('[skills] Fallback extraction also failed:', fallbackErr)
          }
        }

        const finalManifestPath = findSkillManifestPath(extractDir)
        if (!finalManifestPath) {
          const extractedFiles = listExtractedFiles(extractDir)
          return { success: false, error: `No SKILL.md in archive (zip OK). Extracted: ${extractedFiles.join(', ')}` }
        }

        // Copy to installed skills dir
        const sourceDir = path.dirname(finalManifestPath)
        if (!fs.existsSync(SKILLS_DIR)) {
          fs.mkdirSync(SKILLS_DIR, { recursive: true })
        }

        const targetDir = path.join(SKILLS_DIR, args.name)
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }
        copyDirRecursive(sourceDir, targetDir)

        // Cleanup temp
        try { fs.rmSync(tempBase, { recursive: true, force: true }) } catch { /* ignore */ }

        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  // ── Enterprise Skill Upload via OSS STS ──

  interface StsCredentials {
    accessKeyId: string
    accessKeySecret: string
    securityToken: string
    expiration: string
  }

  interface StsResponse {
    bucket: string
    endPoint: string
    domain?: string
    response: {
      credentials: StsCredentials
    }
  }

  /**
   * skills:enterprise-sts-token — fetch STS credentials for OSS upload.
   */
  ipcMain.handle('skills:enterprise-sts-token', async (): Promise<{
    success: boolean
    credentials?: StsCredentials
    bucket?: string
    endPoint?: string
    domain?: string
    error?: string
  }> => {
    try {
      const settings = readSettings()
      const token = settings.authToken as string | undefined
      if (!token) {
        return { success: false, error: 'Login required' }
      }

      const stsUrl = 'https://dev.iot-solution.net/kotlinweb/ali/getStsRam'
      const resp = await fetch(stsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': getDefaultApiUserAgent()
        }
      })

      const json = await resp.json() as {
        code: number
        data?: StsResponse
        mesg?: string
      }

      if (json.code !== 0 || !json.data) {
        return { success: false, error: json.mesg || `STS failed: code ${json.code}` }
      }

      return {
        success: true,
        credentials: json.data.response.credentials,
        bucket: json.data.bucket,
        endPoint: json.data.endPoint,
        domain: json.data.domain
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  /**
   * skills:enterprise-upload — zip a skill directory and upload to OSS via STS.
   */
  ipcMain.handle(
    'skills:enterprise-upload',
    async (_event, args: {
      sourceDir: string
      skillName: string
      description: string
      version: string
      author: string
      isProtected?: boolean
      isAdmin?: boolean
      visibility?: 'all' | 'department'
      departmentId?: string
    }): Promise<{ success: boolean; downloadUrl?: string; error?: string }> => {
      // 加密临时目录（上传后清理）
      let tempEncryptDir: string | null = null
      try {
        // 0. Pre-check: source directory must contain SKILL.md
        const sourceSkillMd = path.join(args.sourceDir, SKILLS_FILENAME)
        if (!fs.existsSync(sourceSkillMd)) {
          return { success: false, error: `Source directory must contain a ${SKILLS_FILENAME} file` }
        }

        const skillContent = fs.readFileSync(sourceSkillMd, 'utf-8')
        const frontMatterMatch = skillContent.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
        if (!frontMatterMatch) {
          return { success: false, error: `${SKILLS_FILENAME} must have YAML frontmatter with name and description` }
        }

        // Basic validation
        if (!args.skillName || args.skillName.length < 2) {
          return { success: false, error: 'Skill name is required (min 2 characters)' }
        }
        if (!args.description || args.description.length < 10) {
          return { success: false, error: 'Description is required (min 10 characters)' }
        }
        if (!args.version || !/^\d+\.\d+\.\d+$/.test(args.version)) {
          return { success: false, error: 'Version must be in semver format (e.g. 1.0.0)' }
        }

        // 创建临时目录，复制并加密文件后打包上传
        tempEncryptDir = path.join(os.tmpdir(), 'opencowork-skills', 'encrypt-' + Date.now())
        copyDirRecursive(args.sourceDir, tempEncryptDir)
        // 递归加密临时目录中的文档文件
        function encryptWalk(dir: string): void {
          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isDirectory()) {
              encryptWalk(full)
            } else if (shouldEncrypt(full)) {
              const content = fs.readFileSync(full, 'utf-8')
              if (!isEncrypted(content)) {
                fs.writeFileSync(full, encryptContent(content), 'utf-8')
              }
            }
          }
        }
        encryptWalk(tempEncryptDir)

        // 1. Get STS credentials
        const settings = readSettings()
        const authToken = settings.authToken as string | undefined
        if (!authToken) {
          return { success: false, error: 'Login required to upload' }
        }

        const stsUrl = 'https://dev.iot-solution.net/kotlinweb/ali/getStsRam'
        const stsResp = await fetch(stsUrl, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'User-Agent': getDefaultApiUserAgent()
          }
        })
        const stsJson = await stsResp.json() as { code: number; data?: StsResponse; mesg?: string }
        if (stsJson.code !== 0 || !stsJson.data) {
          return { success: false, error: stsJson.mesg || `STS failed (code ${stsJson.code})` }
        }

        const credentials = stsJson.data.response.credentials
        const bucket = stsJson.data.bucket
        const endPoint = stsJson.data.endPoint
        const domain = stsJson.data.domain

        // 2. 从加密临时目录创建 zip
        const zipName = `${args.skillName}-${args.version}.zip`
        const zipBuf = createSimpleZip(tempEncryptDir)

        // 3. Upload to OSS
        const key = `cocowork/enterprise-skills/${zipName}`
        const date = new Date().toUTCString()
        const contentType = 'application/zip'

        // Build OSS signature
        const stringToSign = `PUT\n\n${contentType}\n${date}\nx-oss-security-token:${credentials.securityToken}\n/${bucket}/${key}`
        const signature = crypto
          .createHmac('sha1', credentials.accessKeySecret)
          .update(stringToSign)
          .digest('base64')

        const uploadUrl = `https://${bucket}.${endPoint}/${key}`

        const uploadResp = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Date': date,
            'Authorization': `OSS ${credentials.accessKeyId}:${signature}`,
            'x-oss-security-token': credentials.securityToken
          },
          body: zipBuf as any
        })

        if (!uploadResp.ok) {
          const body = await uploadResp.text().catch(() => '')
          return { success: false, error: `Upload failed: HTTP ${uploadResp.status} ${body}` }
        }

        // 4. Update manifest.json on OSS
        const downloadUrl = domain
          ? `https://${domain}/${key}`
          : `https://${bucket}.${endPoint}/${key}`

        const manifestKey = 'cocowork/enterprise-skills/manifest.json'
        const manifestUrl = `https://${bucket}.${endPoint}/${manifestKey}`

        // Download existing manifest
        let manifest: { skills: EnterpriseRemoteSkill[] } = { skills: [] }
        try {
          const mResp = await fetch(manifestUrl)
          if (mResp.ok) {
            manifest = await mResp.json() as { skills: EnterpriseRemoteSkill[] }
          }
        } catch { /* start fresh */ }

        // Upsert skill entry (protected skills cannot be overwritten)
        const existingIdx = manifest.skills.findIndex((s) => s.name === args.skillName)
        // Protected skills can only be overwritten by author or admin
        if (existingIdx >= 0 && manifest.skills[existingIdx].protected && manifest.skills[existingIdx].author !== args.author && !args.isAdmin) {
          return { success: false, error: `Skill "${args.skillName}" is protected and cannot be overwritten by others` }
        }
        // Non-admin cannot overwrite other people's skills
        if (existingIdx >= 0 && !manifest.skills[existingIdx].protected && manifest.skills[existingIdx].author !== args.author && !args.isAdmin) {
          return { success: false, error: `Skill "${args.skillName}" was uploaded by ${manifest.skills[existingIdx].author}, only they or admin can update it` }
        }

        const newEntry: EnterpriseRemoteSkill = {
          name: args.skillName,
          description: args.description,
          version: args.version,
          author: args.author,
          downloadUrl,
          ...(args.isProtected ? { protected: true } : {})
        }
        if (existingIdx >= 0) {
          manifest.skills[existingIdx] = newEntry
        } else {
          manifest.skills.push(newEntry)
        }

        // Upload updated manifest
        const manifestBody = JSON.stringify(manifest, null, 2)
        const mDate = new Date().toUTCString()
        const mStringToSign = `PUT\n\napplication/json\n${mDate}\nx-oss-security-token:${credentials.securityToken}\n/${bucket}/${manifestKey}`
        const mSignature = crypto
          .createHmac('sha1', credentials.accessKeySecret)
          .update(mStringToSign)
          .digest('base64')

        const mUploadResp = await fetch(manifestUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Date': mDate,
            'Authorization': `OSS ${credentials.accessKeyId}:${mSignature}`,
            'x-oss-security-token': credentials.securityToken
          },
          body: manifestBody as any
        })

        if (!mUploadResp.ok) {
          return { success: false, error: `Manifest upload failed: HTTP ${mUploadResp.status}` }
        }

        // Also upload index.html (best effort)
        try {
          const indexHtmlPath = path.join(getBundledSkillsDir(), '..', 'enterprise-skills-index.html')
          if (fs.existsSync(indexHtmlPath)) {
            const indexBody = fs.readFileSync(indexHtmlPath)
            const indexKey = 'cocowork/enterprise-skills/index.html'
            const iDate = new Date().toUTCString()
            const iSignStr = `PUT\n\ntext/html\n${iDate}\nx-oss-security-token:${credentials.securityToken}\n/${bucket}/${indexKey}`
            const iSig = crypto.createHmac('sha1', credentials.accessKeySecret).update(iSignStr).digest('base64')
            await fetch(`https://${bucket}.${endPoint}/${indexKey}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'text/html',
                'Date': iDate,
                'Authorization': `OSS ${credentials.accessKeyId}:${iSig}`,
                'x-oss-security-token': credentials.securityToken
              },
              body: indexBody as any
            })
          }
        } catch { /* best effort */ }

        return { success: true, downloadUrl }
      } catch (err) {
        return { success: false, error: String(err) }
      } finally {
        // 清理加密临时目录
        if (tempEncryptDir) {
          try {
            fs.rmSync(tempEncryptDir, { recursive: true, force: true })
          } catch { /* ignore cleanup errors */ }
        }
      }
    }
  )

  /**
   * skills:enterprise-remove — remove a skill from the remote manifest.
   * Only the author (or anyone if not protected) can remove.
   */
  ipcMain.handle(
    'skills:enterprise-remove',
    async (_event, args: { name: string; author: string; isAdmin?: boolean }): Promise<{ success: boolean; error?: string }> => {
      try {
        const stsResult = await getStsCredentials()
        if (!stsResult.success || !stsResult.credentials) {
          return { success: false, error: stsResult.error || 'Failed to get STS credentials' }
        }

        const { credentials, bucket, endPoint } = stsResult
        const manifestKey = 'cocowork/enterprise-skills/manifest.json'
        const manifestUrl = `https://${bucket}.${endPoint}/${manifestKey}`

        // Download manifest
        const mResp = await fetch(manifestUrl)
        if (!mResp.ok) return { success: false, error: `Failed to fetch manifest: HTTP ${mResp.status}` }
        const manifest = await mResp.json() as { skills: EnterpriseRemoteSkill[] }

        const idx = manifest.skills.findIndex((s) => s.name === args.name)
        if (idx === -1) return { success: false, error: 'Skill not found in manifest' }

        const skill = manifest.skills[idx]
        // Only the author or admin can remove
        const isAuthorOrAdmin = skill.author === args.author || args.isAdmin
        if (!isAuthorOrAdmin) {
          return { success: false, error: 'Only the author or admin can remove this skill' }
        }

        manifest.skills.splice(idx, 1)

        // Upload updated manifest
        const manifestBody = JSON.stringify(manifest, null, 2)
        const date = new Date().toUTCString()
        const signStr = `PUT\n\napplication/json\n${date}\nx-oss-security-token:${credentials.securityToken}\n/${bucket}/${manifestKey}`
        const signature = crypto.createHmac('sha1', credentials.accessKeySecret).update(signStr).digest('base64')

        const uploadResp = await fetch(manifestUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Date': date,
            'Authorization': `OSS ${credentials.accessKeyId}:${signature}`,
            'x-oss-security-token': credentials.securityToken
          },
          body: manifestBody as any
        })

        if (!uploadResp.ok) return { success: false, error: `Manifest update failed: HTTP ${uploadResp.status}` }
        return { success: true }
      } catch (err) {
        return { success: false, error: String(err) }
      }
    }
  )

  /** Helper: get STS credentials for OSS operations */
  async function getStsCredentials(): Promise<{
    success: boolean
    credentials?: StsCredentials
    bucket?: string
    endPoint?: string
    error?: string
  }> {
    const settings = readSettings()
    const token = settings.authToken as string | undefined
    if (!token) return { success: false, error: 'Login required' }

    const stsUrl = 'https://dev.iot-solution.net/kotlinweb/ali/getStsRam'
    const resp = await fetch(stsUrl, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': getDefaultApiUserAgent() }
    })
    const json = await resp.json() as { code: number; data?: StsResponse; mesg?: string }
    if (json.code !== 0 || !json.data) return { success: false, error: json.mesg || 'STS failed' }

    return {
      success: true,
      credentials: json.data.response.credentials,
      bucket: json.data.bucket,
      endPoint: json.data.endPoint
    }
  }
}

/** Simple zip creator for skill directories */
function createSimpleZip(sourceDir: string): Buffer {
  const files = collectAllFiles(sourceDir)
  const chunks: Buffer[] = []
  const encoder = new TextEncoder()
  let currentOffset = 0

  // Track offset and size for each file (for central directory)
  const cdEntries: Buffer[] = []

  for (const { relativePath, data } of files) {
    const cleanPath = relativePath.replace(/\\/g, '/')
    if (cleanPath.endsWith('/')) continue // 跳过纯目录条目

    const nameBytes = encoder.encode(cleanPath)
    const crc = crc32(data)

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBytes.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(0, 8) // store
    localHeader.writeUInt16LE(0, 10) // mod time
    localHeader.writeUInt16LE(0, 12) // mod date
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(data.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)
    Buffer.from(nameBytes).copy(localHeader, 30)

    chunks.push(localHeader, data)

    // Central directory entry
    const cdEntry = Buffer.alloc(46 + nameBytes.length)
    cdEntry.writeUInt32LE(0x02014b50, 0)
    cdEntry.writeUInt16LE(20, 4) // version made by
    cdEntry.writeUInt16LE(20, 6) // version needed
    cdEntry.writeUInt16LE(0, 8) // flags
    cdEntry.writeUInt16LE(0, 10) // store
    cdEntry.writeUInt16LE(0, 12) // time
    cdEntry.writeUInt16LE(0, 14) // date
    cdEntry.writeUInt32LE(crc, 16)
    cdEntry.writeUInt32LE(data.length, 20)
    cdEntry.writeUInt32LE(data.length, 24)
    cdEntry.writeUInt16LE(nameBytes.length, 28)
    cdEntry.writeUInt16LE(0, 30)
    cdEntry.writeUInt16LE(0, 32)
    cdEntry.writeUInt32LE(0, 34) // external attrs
    cdEntry.writeUInt32LE(currentOffset, 38) // local header offset ← correct!
    Buffer.from(nameBytes).copy(cdEntry, 46)
    cdEntries.push(cdEntry)

    currentOffset += 30 + nameBytes.length + data.length
  }

  const cdOffset = currentOffset
  const allCd = Buffer.concat(cdEntries)
  chunks.push(allCd)

  // End of central directory
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(cdEntries.length, 8)   // total entries in central directory
  eocd.writeUInt16LE(cdEntries.length, 10)  // total entries in central directory
  eocd.writeUInt32LE(allCd.length, 12)
  eocd.writeUInt32LE(cdOffset, 16) // ← correct offset!
  eocd.writeUInt16LE(0, 20)
  chunks.push(eocd)

  return Buffer.concat(chunks)
}

function listExtractedFiles(dir: string, maxFiles = 20): string[] {
  const results: string[] = []
  try {
    walkDirFlat(dir, '', results, maxFiles)
  } catch { /* ignore */ }
  return results
}

function walkDirFlat(dir: string, prefix: string, results: string[], max: number): void {
  if (results.length >= max) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (results.length >= max) return
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      walkDirFlat(path.join(dir, entry.name), relPath, results, max)
    } else {
      results.push(relPath)
    }
  }
}

function collectAllFiles(dir: string): { relativePath: string; data: Buffer }[] {
  const results: { relativePath: string; data: Buffer }[] = []
  walkDir(dir, '', results)
  return results
}

function walkDir(dir: string, prefix: string, results: { relativePath: string; data: Buffer }[]): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = path.join(dir, entry.name)
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      // Add directory entry
      results.push({ relativePath: relPath + '/', data: Buffer.alloc(0) })
      walkDir(fullPath, relPath, results)
    } else {
      results.push({ relativePath: relPath, data: fs.readFileSync(fullPath) })
    }
  }
}

/** CRC32 for zip */
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320
      } else {
        crc >>>= 1
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
