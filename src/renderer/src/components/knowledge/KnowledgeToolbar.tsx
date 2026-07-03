import { ArrowUpDown, Import, Plus, Search, X } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@renderer/components/ui/dropdown-menu'
import { Badge } from '@renderer/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'
import type { SystemTag } from '@renderer/lib/knowledge/kb-api-client'
import { SYSTEM_TAG_FILTERS } from '@renderer/lib/knowledge/kb-api-client'

export type SortField = 'name' | 'docCount' | 'updateTime'
export type SortDir = 'asc' | 'desc'

interface KnowledgeToolbarProps {
  search: string
  onSearchChange: (v: string) => void
  activeTags: string[]
  onTagsChange: (tags: string[]) => void
  allTags: string[]
  sortField: SortField
  sortDir: SortDir
  onSortChange: (field: SortField, dir: SortDir) => void
  onCreate: () => void
  onImport?: () => void
  systemTagFilter: SystemTag | '全部'
  onSystemTagFilterChange: (tag: SystemTag | '全部') => void
}

const SORT_LABELS: Record<SortField, string> = {
  name: '名称',
  docCount: '文档数',
  updateTime: '更新时间'
}

export function KnowledgeToolbar({
  search,
  onSearchChange,
  activeTags,
  onTagsChange,
  allTags,
  sortField,
  sortDir,
  onSortChange,
  onCreate,
  onImport,
  systemTagFilter,
  onSystemTagFilterChange
}: KnowledgeToolbarProps): React.JSX.Element {
  return (
    <div className="border-b">
      {/* System tag filter bar */}
      <div className="flex items-center gap-1 px-6 py-2 border-b">
        {SYSTEM_TAG_FILTERS.map((tag) => (
          <button
            key={tag}
            className={cn(
              'inline-flex items-center rounded-full px-3 h-7 text-xs font-medium transition-colors',
              systemTagFilter === tag
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
            onClick={() => onSystemTagFilterChange(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Search / filter / sort / actions */}
      <div className="flex items-center gap-3 px-6 py-2.5">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="搜索知识库名称..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {search && (
            <button
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => onSearchChange('')}
            >
              <X className="size-3.5 text-muted-foreground hover:text-foreground" />
            </button>
          )}
        </div>

        {/* Tag filter */}
        {allTags.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                标签
                {activeTags.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {activeTags.length}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="start">
              <div className="flex flex-wrap gap-1">
                {allTags.map((tag) => {
                  const active = activeTags.includes(tag)
                  return (
                    <button
                      key={tag}
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] border transition-colors ${
                        active
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      }`}
                      onClick={() =>
                        onTagsChange(
                          active ? activeTags.filter((t) => t !== tag) : [...activeTags, tag]
                        )
                      }
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
              {activeTags.length > 0 && (
                <button
                  className="mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => onTagsChange([])}
                >
                  清除筛选
                </button>
              )}
            </PopoverContent>
          </Popover>
        )}

        <div className="flex-1" />

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
              <ArrowUpDown className="size-3" />
              {SORT_LABELS[sortField]}
              {sortDir === 'asc' ? ' ↑' : ' ↓'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            {(Object.entries(SORT_LABELS) as [SortField, string][]).map(([field, label]) => (
              <DropdownMenuItem
                key={field}
                className="text-xs"
                onClick={() =>
                  onSortChange(field, sortField === field && sortDir === 'asc' ? 'desc' : 'asc')
                }
              >
                {label}
                {sortField === field && (sortDir === 'asc' ? ' ↑' : ' ↓')}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onClick={() => onSortChange('updateTime', 'desc')}
            >
              默认排序
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Create */}
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={onCreate}>
          <Plus className="size-3.5" />
          创建知识库
        </Button>

        {/* Import */}
        {onImport && (
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={onImport}>
            <Import className="size-3.5" />
            导入
          </Button>
        )}
      </div>
    </div>
  )
}
