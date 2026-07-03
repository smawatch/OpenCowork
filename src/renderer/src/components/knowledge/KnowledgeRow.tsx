import { BookOpen, MoreHorizontal, Pencil, Shield, Trash2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import { type DatasetItem, SYSTEM_TAG_CONFIG } from '@renderer/lib/knowledge/kb-api-client'
import { useAuthStore } from '@renderer/stores/auth-store'

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

function formatNumber(n?: number): string {
  if (n == null) return '-'
  return n.toLocaleString()
}

// --------------- avatar placeholder ---------------

function Avatar({ name, url }: { name?: string; url?: string }): React.JSX.Element {
  if (url) {
    return <img src={url} alt={name} className="size-6 rounded-full object-cover shrink-0" />
  }
  const initial = name?.charAt(0) || '?'
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-green-100 text-green-700',
    'bg-purple-100 text-purple-700',
    'bg-amber-100 text-amber-700',
    'bg-rose-100 text-rose-700',
    'bg-cyan-100 text-cyan-700'
  ]
  const hash = name ? name.split('').reduce((s, c) => s + c.charCodeAt(0), 0) : 0
  const palette = colors[hash % colors.length]
  return (
    <div
      className={cn(
        'size-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0',
        palette
      )}
    >
      {initial}
    </div>
  )
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
  onDelete,
  onPermissions
}: KnowledgeRowProps): React.JSX.Element {
  const user = useAuthStore((s) => s.user)
  const sysCfg = kb.systemTag ? SYSTEM_TAG_CONFIG[kb.systemTag] : null
  const tags = kb.tags || []
  const visibleTags = tags.slice(0, 3)
  const extraCount = tags.length - visibleTags.length

  // 创建人：个人知识库显示当前用户，企业知识库显示 admin
  const isEnterprise = kb.systemTag === '企业'
  const displayCreator = isEnterprise ? 'admin' : (user?.displayName || user?.username || '-')

  return (
    <tr
      className="group cursor-pointer border-b border-border/60 transition-colors hover:bg-accent/40"
      onClick={() => onEnter(kb)}
    >
      {/* Name */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            <BookOpen className="size-4 text-primary" />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-medium truncate">{kb.name}</span>
            {sysCfg && (
              <span
                className="inline-flex items-center shrink-0 rounded-full px-2 h-[22px] text-[11px] font-medium leading-none"
                style={{ backgroundColor: sysCfg.bg, color: sysCfg.color }}
              >
                {kb.systemTag}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Category Tags */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 flex-wrap">
          {tags.length > 0 ? (
            <>
              {visibleTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className="text-[11px] px-1.5 py-0 h-5 font-normal text-muted-foreground"
                >
                  {tag}
                </Badge>
              ))}
              {extraCount > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[11px] text-muted-foreground cursor-default ml-0.5">
                      +{extraCount}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-48">
                    <div className="flex flex-wrap gap-1">
                      {tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="text-[11px] px-1.5 py-0 h-5">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground/50">无</span>
          )}
        </div>
      </td>

      {/* Creator */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Avatar name={displayCreator} url={isEnterprise ? undefined : (user?.avatarUrl)} />
          <span className="text-sm text-muted-foreground">{displayCreator}</span>
        </div>
      </td>

      {/* Doc Count */}
      <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
        {formatNumber(kb.docCount)}
      </td>

      {/* Update Time */}
      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
        {relativeTime(kb.updateTime)}
      </td>

      {/* Actions — visible on row hover via group-hover */}
      <td className="px-4 py-3">
        <div
          className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <Button variant="ghost" size="icon" className="size-7" onClick={() => onEdit(kb)}>
              <Pencil className="size-3.5" />
            </Button>
          )}
          {onPermissions && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onPermissions(kb)}
            >
              <Shield className="size-3.5" />
            </Button>
          )}
          {onDelete && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreHorizontal className="size-3.5" />
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
