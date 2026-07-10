import { BookOpen, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { type DatasetItem } from '@renderer/lib/knowledge/kb-api-client'
import { useAuthStore } from '@renderer/stores/auth-store'
import { cn } from '@renderer/lib/utils'

// --------------- relative time ---------------

function relativeTime(iso?: string): string {
  if (!iso) return '-'
  try {
    const now = Date.now()
    const then = new Date(iso).getTime()
    if (Number.isNaN(then)) return iso.slice(0, 10)
    const diff = Math.floor((now - then) / 1000)
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
    if (diff < 172800) return '昨天'
    if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
    return iso.slice(0, 10)
  } catch {
    return iso.slice(0, 10)
  }
}

// --------------- tag colors ---------------

const TAG_PALETTE = [
  { bg: '#ecfdf3', color: '#16a34a', border: '#bbf7d0' },
  { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  { bg: '#fff7ed', color: '#ea580c', border: '#fed7aa' },
  { bg: '#faf5ff', color: '#9333ea', border: '#e9d5ff' },
  { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  { bg: '#f0fdf4', color: '#059669', border: '#bbf7d0' },
  { bg: '#fefce8', color: '#ca8a04', border: '#fef08a' },
  { bg: '#fdf2f8', color: '#db2777', border: '#fbcfe8' },
  { bg: '#ecfeff', color: '#0891b2', border: '#a5f3fc' },
  { bg: '#f5f3ff', color: '#7c3aed', border: '#ddd6fe' }
]

function tagStyle(tag: string): React.CSSProperties {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) | 0
  const p = TAG_PALETTE[Math.abs(hash) % TAG_PALETTE.length]
  return {
    backgroundColor: p.bg,
    color: p.color,
    border: `1px solid ${p.border}`,
    borderRadius: '6px',
    fontSize: '12px',
    padding: '1px 8px',
    fontWeight: 500
  }
}

// --------------- KnowledgeRow ---------------

interface KnowledgeRowProps {
  kb: DatasetItem
  onEnter: (kb: DatasetItem) => void
  onEdit?: (kb: DatasetItem) => void
  onDelete?: (kb: DatasetItem) => void
  onPermissions?: (kb: DatasetItem) => void
}

export function KnowledgeRow({
  kb,
  onEnter,
  onEdit,
  onDelete
}: KnowledgeRowProps): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  const isEnterprise = kb.systemTag === '企业'
  const displayCreator = kb.creator || (isEnterprise ? 'admin' : (user?.displayName || user?.username || '-'))
  const tags = kb.tags || []
  const visibleTags = tags.slice(0, 3)
  const extraCount = tags.length - visibleTags.length

  return (
    <tr
      className="group cursor-pointer border-b transition-shadow duration-150 border-border"
      onClick={() => onEnter(kb)}
    >
      {/* Name */}
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-10 items-center justify-center rounded-[10px] bg-primary/10 shrink-0">
            <BookOpen className="size-[18px] text-primary" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[15px] font-semibold truncate transition-colors duration-150 text-foreground group-hover:text-primary">
              {kb.name}
            </span>
            {kb.systemTag && (
              <span
                className={cn(
                  'inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
                  kb.systemTag === '企业' && 'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
                  kb.systemTag === '部门' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400',
                  kb.systemTag === '个人' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                )}
              >
                {kb.systemTag}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Tags */}
      <td className="px-6 py-3.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          {tags.length > 0 ? (
            <>
              {visibleTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center"
                  style={tagStyle(tag)}
                >
                  {tag}
                </span>
              ))}
              {extraCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-xs cursor-default text-muted-foreground">
                      +{extraCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-48">
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <span
                          key={tag}
                          className="inline-flex items-center"
                          style={tagStyle(tag)}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground/40">无</span>
          )}
        </div>
      </td>

      {/* Creator */}
      <td className="px-6 py-3.5">
        <span className="text-sm font-medium text-muted-foreground">
          {displayCreator}
        </span>
      </td>

      {/* Update Time */}
      <td className="px-6 py-3.5 text-[13px] whitespace-nowrap text-muted-foreground">
        {relativeTime(kb.updateTime)}
      </td>

      {/* Actions */}
      <td className="px-6 py-3.5">
        <div
          className="flex items-center gap-1 justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={() => onEdit(kb)}
              title="编辑知识库"
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          {onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:bg-accent" title="更多操作">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem className="text-xs text-destructive" onClick={() => onDelete(kb)}>
                  <Trash2 className="size-3.5 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </td>
    </tr>
  )
}
