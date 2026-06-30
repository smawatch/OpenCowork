import { execFile } from 'child_process'
import { ipcMain, shell, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { promisify } from 'util'
import { getDefaultApiUserAgent } from '../lib/api-user-agent'

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
 * Copy built-in skills from resources/skills/ to ~/.agents/skills/.
 * Only copies a skill if it does not already exist in the target,
 * so user modifications are preserved.
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
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sourceDir = path.join(bundledDir, entry.name)
      const targetDir = path.join(SKILLS_DIR, entry.name)
      if (fs.existsSync(targetDir)) continue

      copyDirRecursive(sourceDir, targetDir)
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
    if (!fs.existsSync(targetManifest)) {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true })
      }
      copyDirRecursive(sourceDir, targetDir)
    }

    return { success: true, name: normalizedName }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export interface SkillInfo {
  name: string
  description: string
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

export function registerSkillsHandlers(): void {
  // Initialize builtin skills on startup
  ensureBuiltinSkills()

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
          const content = fs.readFileSync(mdPath, 'utf-8')
          skills.push({
            name: entry.name,
            description: extractDescription(content, entry.name)
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
   * skills:load 鈥?read the SKILL.md content for a given skill name (strips frontmatter for AI use).
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
        const raw = fs.readFileSync(mdPath, 'utf-8')
        // Strip YAML frontmatter so AI only sees actionable instructions
        // Use \r?\n to handle both LF and CRLF line endings
        const content = raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?/, '')
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
        return { content: fs.readFileSync(mdPath, 'utf-8') }
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
        fs.writeFileSync(mdPath, args.content, 'utf-8')
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
        const skillMdContent = fs.readFileSync(srcMd, 'utf-8')
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
                  scriptContents.push({
                    file: relPath,
                    content: fs.readFileSync(fullPath, 'utf-8')
                  })
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
      if (!manifestPath) {
        throw new Error(`No SKILL.md found in downloaded archive for ${args.slug}`)
      }

      const sourceDir = path.dirname(manifestPath)
      copyDirRecursive(sourceDir, tempDir)

      const manifestFileName = path.basename(manifestPath)
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
}
