import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Search,
  FolderOpen,
  Trash2,
  Plus,
  Wand2,
  ArrowLeft,
  Pencil,
  Eye,
  Save,
  Download,
  FileText,
  FileCode,
  CheckCircle2,
  Loader2,
  Star,
  Flame,
  Clock,
  Bot,
  Code2,
  Briefcase,
  Zap,
  Palette,
  FileEdit,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  Heart,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  useSkillsStore,
  type ScanFileInfo,
  type MarketSkillInfo
} from '@renderer/stores/skills-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { SkillInstallDialog } from './SkillInstallDialog'

const MARKET_TABS: { key: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'overall', label: '综合', icon: Flame },
  { key: 'trending', label: '近期热门', icon: Star },
  { key: 'latest', label: '最新', icon: Clock },
  { key: 'ai_enhancement', label: 'AI增强', icon: Bot },
  { key: 'development', label: '开发工具', icon: Code2 },
  { key: 'office', label: '办公效率', icon: Briefcase },
  { key: 'efficiency', label: '效率提升', icon: Zap },
  { key: 'design', label: '设计创意', icon: Palette },
  { key: 'content_creation', label: '内容创作', icon: FileEdit },
  { key: 'professional', label: '专业技能', icon: GraduationCap }
]

function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileIcon({ type }: { type: string }): React.JSX.Element {
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
  if (type === '.md') return <FileText className="size-3.5 text-blue-500" />
  if (codeExts.has(type)) return <FileCode className="size-3.5 text-amber-500" />
  return <FileText className="size-3.5 text-muted-foreground" />
}

function FileListSection({
  files,
  t
}: {
  files: ScanFileInfo[]
  t: (key: string) => string
}): React.JSX.Element {
  if (files.length === 0) {
    return <p className="text-xs text-muted-foreground px-1">{t('skillsPage.noFiles')}</p>
  }
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  return (
    <div className="space-y-1">
      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
        {t('skillsPage.skillFiles')} ({files.length}, {formatSize(totalSize)})
      </h4>
      <div className="space-y-0 max-h-48 overflow-y-auto">
        {files.map((file) => (
          <div
            key={file.name}
            className="flex items-center gap-2 text-xs px-1 py-0.5 rounded hover:bg-muted/50"
          >
            <FileIcon type={file.type} />
            <span className="flex-1 truncate font-mono text-[11px]">{file.name}</span>
            <span className="text-muted-foreground text-[10px] shrink-0">
              {formatSize(file.size)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Market skill card ──────────────────────────────────────────────

function MarketSkillCard({
  skill,
  installed,
  onDetail
}: {
  skill: MarketSkillInfo
  installed: boolean
  onDetail: () => void
}): React.JSX.Element {
  const { t } = useTranslation('layout')
  return (
    <div
      className="rounded-lg border bg-card p-4 hover:shadow-md transition-shadow flex flex-col h-full group cursor-pointer"
      onClick={onDetail}
    >
      {/* Header: icon + name */}
      <div className="flex items-start gap-2.5 mb-2.5">
        <div className="shrink-0 size-9 rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 border border-border/50 flex items-center justify-center text-base">
          {skill.icon || <Wand2 className="size-4 text-primary/60" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate leading-tight">{skill.name}</h3>
          {skill.author && (
            <p className="text-[10px] text-muted-foreground/70">by {skill.author}</p>
          )}
        </div>
      </div>

      {/* Subtitle */}
      {skill.subtitle && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
          {skill.subtitle}
        </p>
      )}

      {/* Tags */}
      {(skill.tags.length > 0 || skill.category) && (
        <div className="mb-2 flex flex-wrap gap-1">
          {skill.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] font-normal px-1.5">
              {tag}
            </Badge>
          ))}
          {skill.category ? (
            <Badge variant="outline" className="text-[10px] px-1.5">
              {skill.category}
            </Badge>
          ) : null}
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto pt-2.5 border-t">
        <div className="flex items-center gap-1">
          <Download className="size-3" />
          <span>{formatDownloads(skill.downloads)}</span>
        </div>
        {skill.favorites != null && skill.favorites > 0 && (
          <div className="flex items-center gap-1">
            <Heart className="size-3" />
            <span>{formatDownloads(skill.favorites)}</span>
          </div>
        )}
        <div className="flex-1" />
        {installed && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
            <CheckCircle2 className="size-2.5" />
            {t('skillsPage.alreadyInstalled')}
          </span>
        )}
      </div>
    </div>
  )
}

function generatePageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | null)[] = [1]
  if (current > 3) pages.push(null)
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let p = start; p <= end; p++) pages.push(p)
  if (current < total - 2) pages.push(null)
  pages.push(total)
  return pages
}

// ── Simple markdown renderer for skill summary ──────────────────────

function SkillSummary({ text }: { text: string }): React.JSX.Element {
  if (!text) return <p className="text-sm text-muted-foreground">—</p>

  const lines = text.split('\n')
  const elements: React.JSX.Element[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // ## heading
    if (/^##\s+/.test(line)) {
      elements.push(
        <h3 key={i} className="text-sm font-bold mt-4 mb-2 text-foreground">
          {line.replace(/^##\s+/, '')}
        </h3>
      )
      i++
      continue
    }

    // ### heading
    if (/^###\s+/.test(line)) {
      elements.push(
        <h4 key={i} className="text-xs font-semibold mt-3 mb-1.5 text-foreground">
          {line.replace(/^###\s+/, '')}
        </h4>
      )
      i++
      continue
    }

    // --- separator
    if (/^---\s*$/.test(line)) {
      elements.push(<hr key={i} className="my-3 border-border/60" />)
      i++
      continue
    }

    // Bullet list
    if (/^-\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''))
        i++
      }
      elements.push(
        <ul key={i} className="list-disc list-inside space-y-1 text-sm text-muted-foreground mb-2">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    // Numbered list
    if (/^\d+[.)]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+[.)]\s+/, ''))
        i++
      }
      elements.push(
        <ol key={i} className="list-decimal list-inside space-y-1 text-sm text-muted-foreground mb-2">
          {items.map((item, idx) => (
            <li key={idx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    // Table rows (skip, render as text)
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[-:| ]+\|$/.test(lines[i + 1])) {
      i += 2 // skip header and separator
      const rows: string[][] = []
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
        rows.push(lines[i].split('|').filter(Boolean).map(s => s.trim()))
        i++
      }
      if (rows.length > 0) {
        elements.push(
          <div key={i} className="overflow-x-auto my-2 rounded-lg border">
            <table className="w-full text-xs">
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-muted/30' : ''}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="px-2.5 py-1.5 border-r last:border-r-0">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      continue
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={i} className="h-2" />)
      i++
      continue
    }

    // Bold text on its own line
    if (/^\*\*.*\*\*$/.test(line.trim())) {
      elements.push(
        <p key={i} className="text-xs font-semibold text-foreground mt-2 mb-1">
          {line.trim().replace(/\*\*/g, '')}
        </p>
      )
      i++
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-1">
        {renderInlineMarkdown(line)}
      </p>
    )
    i++
  }

  return <div>{elements}</div>
}

function renderInlineMarkdown(text: string): React.ReactNode {
  // Bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
    }
    // Inline code `text`
    const codeParts = part.split(/(`[^`]+`)/g)
    return codeParts.map((cp, j) => {
      if (cp.startsWith('`') && cp.endsWith('`')) {
        return <code key={j} className="bg-muted px-1 py-0.5 rounded text-[11px] font-mono">{cp.slice(1, -1)}</code>
      }
      return cp
    })
  })
}

// ── Full MarketSkillDetail type (local, matching IPC return) ────────

interface SkillDetail {
  id: string
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
  downloadUrl: string
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Skill Detail Dialog ────────────────────────────────────────────

function SkillDetailDialog({
  skill,
  installed,
  open,
  onClose,
  onInstall
}: {
  skill: MarketSkillInfo | null
  installed: boolean
  open: boolean
  onClose: () => void
  onInstall: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation('layout')
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !skill) {
      setDetail(null)
      return
    }
    // Fetch full detail from API
    let cancelled = false
    setLoading(true)
    ipcClient.invoke('skills:market-detail', { skillId: skill.id })
      .then((result) => {
        if (cancelled) return
        const data = result as { detail?: SkillDetail; error?: string }
        if (data.detail) {
          setDetail(data.detail)
        }
      })
      .catch((err) => {
        if (!cancelled) console.error('[Skills] Detail fetch error:', err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [open, skill?.id])

  if (!open || !skill) return null

  const display = (detail || skill) as SkillDetail

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border bg-card shadow-2xl mx-4">
        {/* Header */}
        <div className="sticky top-0 bg-card border-b px-6 py-5 rounded-t-xl z-10">
          <div className="flex items-start gap-4">
            <div className="shrink-0 size-12 rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border flex items-center justify-center text-2xl">
              {skill.icon || <Wand2 className="size-6 text-primary/60" />}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold leading-tight">{display.name}</h2>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                {display.author && (
                  <span className="text-sm text-muted-foreground">by {display.author}</span>
                )}
                {display.version && (
                  <Badge variant="outline" className="text-[10px]">v{display.version}</Badge>
                )}
                {display.inLeaderboard && (
                  <Badge variant="default" className="text-[10px]">🏆 #{display.leaderboardRank}</Badge>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="shrink-0 size-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t('skillsPage.loading', { defaultValue: 'Loading...' })}</span>
            </div>
          )}

          {/* Meta grid */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-lg border p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('skillsPage.downloads', { defaultValue: 'Downloads' })}</p>
              <p className="text-sm font-bold mt-0.5">{formatDownloads(display.downloads)}</p>
            </div>
            {display.favorites != null && display.favorites > 0 && (
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('skillsPage.favorites', { defaultValue: 'Favorites' })}</p>
                <p className="text-sm font-bold mt-0.5">{formatDownloads(display.favorites)}</p>
              </div>
            )}
            {display.githubStars != null && display.githubStars > 0 && (
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">GitHub ⭐</p>
                <p className="text-sm font-bold mt-0.5">{formatDownloads(display.githubStars)}</p>
              </div>
            )}
            {display.views != null && display.views > 0 && (
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('skillsPage.views', { defaultValue: 'Views' })}</p>
                <p className="text-sm font-bold mt-0.5">{formatDownloads(display.views)}</p>
              </div>
            )}
            {display.fileSize != null && display.fileSize > 0 && (
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('skillsPage.size', { defaultValue: 'Size' })}</p>
                <p className="text-sm font-bold mt-0.5">{formatFileSize(display.fileSize)}</p>
              </div>
            )}
            {display.securityLevel && (
              <div className="rounded-lg border p-2.5 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('skillsPage.security', { defaultValue: 'Security' })}</p>
                <Badge variant={display.securityLevel.startsWith('S') ? 'default' : 'secondary'} className="mt-1 text-[11px]">
                  {display.securityLevel}
                </Badge>
              </div>
            )}
          </div>

          {/* Tags */}
          {display.tags && display.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {display.tags.map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-[11px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Summary — rich markdown from API */}
          {display.summary ? (
            <div className="border-t pt-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t('skillsPage.detail', { defaultValue: 'Detail' })}
              </h3>
              <SkillSummary text={display.summary} />
            </div>
          ) : (
            <div className="border-t pt-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {t('skillsPage.description', { defaultValue: 'Description' })}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{display.description || '—'}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t px-6 py-4 rounded-b-xl">
          {installed ? (
            <Badge variant="secondary" className="w-full justify-center gap-1.5 text-sm py-2.5">
              <CheckCircle2 className="size-4" />
              {t('skillsPage.alreadyInstalled')}
            </Badge>
          ) : (
            <Button
              size="default"
              className="w-full gap-2"
              onClick={() => { onInstall(); onClose(); }}
            >
              <Download className="size-4" />
              {t('skillsPage.install')}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Market Provider Config Popover ──────────────────────────────────────────
export function SkillsPage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const skills = useSkillsStore((s) => s.skills)
  const loading = useSkillsStore((s) => s.loading)
  const selectedSkill = useSkillsStore((s) => s.selectedSkill)
  const skillContent = useSkillsStore((s) => s.skillContent)
  const skillFiles = useSkillsStore((s) => s.skillFiles)
  const activeTab = useSkillsStore((s) => s.activeTab)
  const editing = useSkillsStore((s) => s.editing)
  const editContent = useSkillsStore((s) => s.editContent)
  const marketSkills = useSkillsStore((s) => s.marketSkills)
  const marketLoading = useSkillsStore((s) => s.marketLoading)
  const marketTotal = useSkillsStore((s) => s.marketTotal)
  const marketPage = useSkillsStore((s) => s.marketPage)
  const marketPageSize = useSkillsStore((s) => s.marketPageSize)
  const marketTab = useSkillsStore((s) => s.marketTab)
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const loadMarketSkills = useSkillsStore((s) => s.loadMarketSkills)
  const goToPage = useSkillsStore((s) => s.goToPage)
  const selectSkill = useSkillsStore((s) => s.selectSkill)
  const setActiveTab = useSkillsStore((s) => s.setActiveTab)
  const setEditing = useSkillsStore((s) => s.setEditing)
  const setEditContent = useSkillsStore((s) => s.setEditContent)
  const setMarketQuery = useSkillsStore((s) => s.setMarketQuery)
  const setMarketTab = useSkillsStore((s) => s.setMarketTab)

  const totalPages = Math.max(1, Math.ceil(marketTotal / marketPageSize))

  // Local search state with debounce
  const [searchText, setSearchText] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchText(value)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setMarketQuery(value)
      }, 300)
    },
    [setMarketQuery]
  )

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Skill detail dialog state
  const [detailSkill, setDetailSkill] = useState<MarketSkillInfo | null>(null)

  // Installed tab search
  const [installedQuery, setInstalledQuery] = useState('')

  useEffect(() => {
    void loadSkills()
    void loadMarketSkills('', 1)
  }, [loadSkills, loadMarketSkills])

  const installedNames = useMemo(() => new Set(skills.map((s) => s.name.toLowerCase())), [skills])

  const filteredInstalled = useMemo(() => {
    if (!installedQuery.trim()) return skills
    const q = installedQuery.toLowerCase()
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    )
  }, [skills, installedQuery])

  const handleAddSkill = async (): Promise<void> => {
    const result = (await ipcClient.invoke('fs:select-folder')) as {
      canceled?: boolean
      path?: string
    }
    if (result.canceled || !result.path) return
    useSkillsStore.getState().openInstallDialog(result.path)
  }

  const handleInstallMarket = (skill: MarketSkillInfo): void => {
    void useSkillsStore.getState().downloadAndReviewMarketSkill(skill)
  }

  const handleDelete = async (name: string): Promise<void> => {
    const ok = await confirm({
      title: t('skillsPage.deleteConfirm', { name }),
      variant: 'destructive'
    })
    if (!ok) return
    const success = await useSkillsStore.getState().deleteSkill(name)
    toast[success ? 'success' : 'error'](
      success ? t('skillsPage.deleted', { name }) : t('skillsPage.deleteFailed')
    )
  }

  const handleSave = async (): Promise<void> => {
    if (!selectedSkill || !editContent) return
    const success = await useSkillsStore.getState().saveSkill(selectedSkill, editContent)
    toast[success ? 'success' : 'error'](
      success ? t('skillsPage.saved') : t('skillsPage.saveFailed')
    )
  }

  const handleBack = (): void => useUIStore.getState().closeSkillsPage()

  // ── Shared top bar ──────────────────────────────────────────────────────────
  const TopBar = (
    <div className="flex items-center gap-3 border-b px-4 py-2.5 shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleBack}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Back</TooltipContent>
      </Tooltip>

      {/* Tab switcher */}
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        {(['market', 'installed'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-md px-3 py-1 text-xs font-medium transition-all',
              activeTab === tab
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`skillsPage.${tab}`)}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {activeTab === 'installed' && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => void handleAddSkill()}
        >
          <Plus className="size-3.5" />
          {t('skillsPage.addSkill')}
        </Button>
      )}
    </div>
  )

  // ── MARKET TAB — full-width grid ─────────────────────────────────────
  if (activeTab === 'market') {
    return (
      <div className="flex h-full flex-col">
        {TopBar}

        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Hero + Category Tabs */}
          <div className="px-8 pt-6 pb-3 border-b shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-end gap-3 mb-1">
                  <h1 className="text-2xl font-bold tracking-tight">SKILLS</h1>
                  <span className="text-sm text-muted-foreground mb-0.5">
                    {t('skillsPage.skillCount', { count: marketTotal })}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{t('skillsPage.marketDescription')}</p>
              </div>
              {/* Search — top right */}
              <div className="relative w-64 shrink-0">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchText}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder={t('skillsPage.searchPlaceholder')}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            {/* Category tabs */}
            <div className="flex items-center gap-0.5 mt-3 overflow-x-auto pb-1 scrollbar-none">
              {MARKET_TABS.map((tab) => {
                const Icon = tab.icon
                const active = marketTab === tab.key
                return (
                  <button
                    key={tab.key}
                    onClick={() => setMarketTab(tab.key)}
                    className={cn(
                      'flex items-center gap-1.5 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                      active
                        ? 'bg-primary/10 text-primary shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                  >
                    <Icon className="size-3.5" />
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto p-6">
            {marketLoading && marketSkills.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                <Loader2 className="size-5 mr-2 animate-spin" /> Loading...
              </div>
            ) : marketSkills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Wand2 className="size-10 text-muted-foreground/20" />
                <p className="text-sm text-muted-foreground">{t('skillsPage.noResults')}</p>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {marketSkills.map((ms) => (
                    <MarketSkillCard
                      key={ms.id}
                      skill={ms}
                      installed={
                        installedNames.has(ms.slug.toLowerCase()) ||
                        installedNames.has(ms.name.toLowerCase())
                      }
                      onDetail={() => setDetailSkill(ms)}
                    />
                  ))}
                </div>

                {/* Page pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-1.5 py-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={marketPage <= 1 || marketLoading}
                      onClick={() => goToPage(marketPage - 1)}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>

                    {generatePageNumbers(marketPage, totalPages).map((page, idx) =>
                      page === null ? (
                        <span key={`ellipsis-${idx}`} className="text-[11px] text-muted-foreground px-0.5">...</span>
                      ) : (
                        <Button
                          key={page}
                          size="sm"
                          variant={page === marketPage ? 'default' : 'outline'}
                          className="h-7 min-w-[1.75rem] p-0 text-xs"
                          disabled={marketLoading}
                          onClick={() => goToPage(page)}
                        >
                          {page}
                        </Button>
                      )
                    )}

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={marketPage >= totalPages || marketLoading}
                      onClick={() => goToPage(marketPage + 1)}
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>

                    <span className="text-[11px] text-muted-foreground ml-2">
                      {marketPage} / {totalPages} · {marketTotal} total
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <SkillInstallDialog />
        <SkillDetailDialog
          skill={detailSkill}
          installed={
            detailSkill
              ? installedNames.has(detailSkill.slug.toLowerCase()) ||
                installedNames.has(detailSkill.name.toLowerCase())
              : false
          }
          open={detailSkill !== null}
          onClose={() => setDetailSkill(null)}
          onInstall={() => detailSkill && handleInstallMarket(detailSkill)}
        />
      </div>
    )
  }

  // ── INSTALLED TAB — split panel ─────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {TopBar}

      {/* Cleanup warning */}
      {skills.length > 0 && (
        <div className="flex items-start gap-2.5 mx-4 mt-3 px-3 py-2.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium">
              {t('skillsPage.cleanupWarning', {
                defaultValue:
                  'Installed skills consume system resources and may slow down the agent. Please remove unused skills promptly.'
              })}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left list */}
        <div className="flex w-64 shrink-0 flex-col border-r bg-muted/20 overflow-hidden">
          {/* Installed search */}
          <div className="px-2.5 pt-2.5 pb-1.5 shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={installedQuery}
                onChange={(e) => setInstalledQuery(e.target.value)}
                placeholder={t('skillsPage.searchPlaceholder')}
                className="h-7 pl-7 text-[11px]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                Loading...
              </div>
            ) : filteredInstalled.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
                <Wand2 className="size-8 text-muted-foreground/30" />
                <p className="text-xs text-muted-foreground">
                  {skills.length === 0 ? t('skillsPage.noSkills') : t('skillsPage.noResults')}
                </p>
                {skills.length === 0 && (
                  <p className="text-[10px] text-muted-foreground/60">
                    {t('skillsPage.noSkillsDesc')}
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredInstalled.map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => selectSkill(skill.name)}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors',
                      selectedSkill === skill.name
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground hover:bg-muted'
                    )}
                  >
                    <span className="text-xs font-medium truncate">{skill.name}</span>
                    <span className="text-[10px] text-muted-foreground line-clamp-2">
                      {skill.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right detail */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {selectedSkill ? (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-3 shrink-0">
                <Wand2 className="size-4 shrink-0 text-primary" />
                <h2 className="flex-1 text-sm font-semibold truncate">{selectedSkill}</h2>
                <div className="flex items-center gap-1">
                  {editing ? (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            onClick={() => setEditing(false)}
                          >
                            <Eye className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('skillsPage.previewMode')}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="default"
                            size="icon"
                            className="size-7"
                            onClick={() => void handleSave()}
                          >
                            <Save className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t('skillsPage.save')}</TooltipContent>
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => setEditing(true)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('skillsPage.editMode')}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() =>
                          void useSkillsStore.getState().openSkillFolder(selectedSkill)
                        }
                      >
                        <FolderOpen className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('skillsPage.openFolder')}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => void handleDelete(selectedSkill)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t('skillsPage.delete')}</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {editing && editContent !== null ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full h-full resize-none border-0 bg-transparent p-4 text-xs leading-relaxed font-mono focus:outline-none"
                    spellCheck={false}
                  />
                ) : skillContent ? (
                  <div className="p-4 space-y-4">
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90 font-mono">
                      {skillContent}
                    </pre>
                    {skillFiles.length > 0 && (
                      <div className="border-t pt-4">
                        <FileListSection files={skillFiles} t={t} />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                    Loading...
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <Wand2 className="size-10 text-muted-foreground/20" />
              <p className="text-sm text-muted-foreground">{t('skillsPage.selectSkill')}</p>
              <p className="text-xs text-muted-foreground/60">{t('skillsPage.selectSkillDesc')}</p>
            </div>
          )}
        </div>
      </div>

      <SkillInstallDialog />
    </div>
  )
}
