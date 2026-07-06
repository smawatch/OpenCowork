import { ArrowUpDown, Plus, Search, X } from 'lucide-react'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Badge } from '@renderer/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

export type SortField = 'name' | 'updateTime'
export type SortDir = 'asc' | 'desc'

interface SortOption {
  label: string
  field: SortField
  dir: SortDir
}

const SORT_OPTIONS: SortOption[] = [
  { label: '最近更新', field: 'updateTime', dir: 'desc' },
  { label: '最早更新', field: 'updateTime', dir: 'asc' },
  { label: '名称 A-Z', field: 'name', dir: 'asc' },
  { label: '名称 Z-A', field: 'name', dir: 'desc' }
]

function sortLabel(field: SortField, dir: SortDir): string {
  const opt = SORT_OPTIONS.find((o) => o.field === field && o.dir === dir)
  return opt?.label || '排序'
}

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
  onCreate
}: KnowledgeToolbarProps): React.JSX.Element {
  return (
    <div className="border-b" style={{ borderColor: '#f1f3f5' }}>
      <div className="flex items-center gap-3 px-6 py-3.5">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            className="pl-8 h-8 text-xs"
            placeholder="搜索知识库..."
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
                      className={cn(
                        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] border transition-colors',
                        active
                          ? 'bg-primary/10 border-primary text-primary'
                          : 'border-border text-muted-foreground hover:bg-accent'
                      )}
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

        {/* Create */}
        <Button size="sm" className="h-10 px-[18px] text-sm gap-1.5 rounded-[10px] font-semibold" onClick={onCreate}>
          <Plus className="size-3.5" />
          创建知识库
        </Button>

        {/* Sort */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 rounded-lg hover:bg-[#f5f5f5]" title={sortLabel(sortField, sortDir)}>
              <ArrowUpDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-28">
            {SORT_OPTIONS.map((opt) => (
              <DropdownMenuItem
                key={`${opt.field}-${opt.dir}`}
                className="text-xs"
                onClick={() => onSortChange(opt.field, opt.dir)}
              >
                {opt.label}
                {sortField === opt.field && sortDir === opt.dir && ' ✓'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
