import { useState, useCallback, useEffect, useMemo } from 'react'
import { BookOpen, ChevronDown, Loader2, Check, FolderClosed, FolderOpen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@renderer/components/ui/popover'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import {
  listDatasets,
  listCollections,
  importFileToDataset,
  type DatasetItem,
  type CollectionItem
} from '@renderer/lib/knowledge/kb-api-client'
import { useAuthStore } from '@renderer/stores/auth-store'

interface Props {
  messageContent: string
  sessionTitle?: string
  userQuestion?: string
  msgId: string
}

// 本地存储已保存的消息记录，key: msgId, value: { kbId, collectionId }
const SAVED_KEY = 'kb-saved-messages'

function getSavedMessages(): Record<string, { kbId: string; collectionId: string }> {
  try {
    const raw = localStorage.getItem(SAVED_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function setSavedMessage(msgId: string, kbId: string, collectionId: string): void {
  const map = getSavedMessages()
  map[msgId] = { kbId, collectionId }
  localStorage.setItem(SAVED_KEY, JSON.stringify(map))
}

function generateTitle(sessionTitle?: string, userQuestion?: string): string {
  if (sessionTitle && sessionTitle.trim()) {
    return sessionTitle.trim().slice(0, 50)
  }
  if (userQuestion && userQuestion.trim()) {
    return userQuestion.trim().slice(0, 50)
  }
  return `AI对话记录-${new Date().toISOString().slice(0, 10)}`
}

function buildMarkdown(sessionTitle: string, userQuestion: string, aiAnswer: string): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  return [
    `# ${sessionTitle || 'AI对话记录'}`,
    '',
    `创建时间：${now}`,
    '',
    '来源：AI对话',
    '',
    '---',
    '',
    userQuestion ? `## 用户问题\n\n${userQuestion}\n` : '',
    '---',
    '',
    '## AI回答',
    '',
    aiAnswer
  ].filter(Boolean).join('\n')
}

export function SaveToKnowledgePopover({
  messageContent,
  sessionTitle,
  userQuestion,
  msgId
}: Props): React.JSX.Element | null {
  const token = useAuthStore((s) => s.token)
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<{ kbId: string; collectionId: string } | null>(() => {
    const map = getSavedMessages()
    return map[msgId] || null
  })

  // KB list
  const [kbs, setKbs] = useState<DatasetItem[]>([])
  const [kbsLoading, setKbsLoading] = useState(false)
  const [selectedKb, setSelectedKb] = useState<DatasetItem | null>(null)

  // Directory tree
  const [dirs, setDirs] = useState<CollectionItem[]>([])
  const [dirsLoading, setDirsLoading] = useState(false)
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  // Title
  const [title, setTitle] = useState(() => generateTitle(sessionTitle, userQuestion))

  // Saving
  const [saving, setSaving] = useState(false)

  // Load KB list when popover opens
  const loadKbs = useCallback(async () => {
    if (!token) return
    setKbsLoading(true)
    try {
      const r = await listDatasets(ipcClient)
      if (r.success) {
        // 只显示个人知识库
        const personal = (r.data ?? []).filter(
          (kb) => !kb.systemTag || kb.systemTag === '个人'
        )
        setKbs(personal)
      }
    } catch { /* silent */ }
    setKbsLoading(false)
  }, [token])

  useEffect(() => {
    if (open && token) loadKbs()
  }, [open, token, loadKbs])

  // Load directory tree when KB selected
  useEffect(() => {
    if (!selectedKb) { setDirs([]); return }
    setDirsLoading(true)
    listCollections(ipcClient, selectedKb.id).then((r) => {
      if (r.success) setDirs(r.data ?? [])
      setDirsLoading(false)
    }).catch(() => setDirsLoading(false))
  }, [selectedKb])

  // Build tree
  const folderTree = useMemo(() => {
    const nodeMap = new Map<string, CollectionItem>()
    const roots: CollectionItem[] = []
    for (const d of dirs) {
      nodeMap.set(d.id, { ...d, children: [] })
    }
    for (const d of nodeMap.values()) {
      if (d.parentId && nodeMap.has(d.parentId)) {
        nodeMap.get(d.parentId)!.children!.push(d)
      } else {
        roots.push(d)
      }
    }
    return roots.filter((d) => d.type === 'folder')
  }, [dirs])

  // Save
  const handleSave = useCallback(async () => {
    if (!selectedKb) { toast.error('请选择知识库'); return }
    if (!token) { toast.error('请先登录'); return }

    setSaving(true)
    try {
      const md = buildMarkdown(
        title,
        userQuestion || '',
        messageContent
      )
      const encoder = new TextEncoder()
      const buffer = encoder.encode(md).buffer as ArrayBuffer

      const result = await importFileToDataset(ipcClient, {
        datasetId: selectedKb.id,
        fileName: `${title}.md`,
        fileBuffer: buffer,
        trainingType: 'qa',
        parentId: selectedParentId || undefined
      })

      if (!result.success) {
        toast.error(result.error || '保存失败，请稍后重试')
        return
      }

      const collectionId = result.data?.collectionId || ''
      setSavedMessage(msgId, selectedKb.id, collectionId)
      setSaved({ kbId: selectedKb.id, collectionId })
      toast.success('文档已保存到知识库')
      setOpen(false)
    } catch {
      toast.error('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }, [selectedKb, selectedParentId, title, userQuestion, messageContent, msgId, token])

  // Already saved - show "查看文档" and open detail when clicked
  if (saved) {
    return (
      <button
        type="button"
        className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/90 text-emerald-500 transition-colors hover:bg-accent"
        title="已保存到知识库，点击查看"
        onClick={() => {
          // Navigate to the KB detail
          const { goToKnowledgeDetail } = require('@renderer/lib/knowledge-route')
          goToKnowledgeDetail(saved.kbId)
        }}
      >
        <Check className="size-3.5" />
      </button>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          title="保存到知识库"
        >
          <BookOpen className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4" align="start">
        <div className="text-sm font-semibold mb-3">保存到知识库</div>

        {/* KB Selector */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">知识库</label>
          {kbsLoading ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground py-1">
              <Loader2 className="size-3 animate-spin" />加载中...
            </div>
          ) : (
            <select
              className="w-full h-8 text-xs border rounded-md px-2 bg-background"
              value={selectedKb?.id || ''}
              onChange={(e) => {
                const kb = kbs.find((k) => k.id === e.target.value) || null
                setSelectedKb(kb)
                setSelectedParentId(null)
              }}
            >
              <option value="">选择知识库...</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>{kb.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Directory Selector */}
        {selectedKb && (
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">目录</label>
            {dirsLoading ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground py-1">
                <Loader2 className="size-3 animate-spin" />加载中...
              </div>
            ) : (
              <div className="border rounded-md max-h-32 overflow-y-auto">
                {/* Root */}
                <button
                  className={cn(
                    'flex items-center gap-1.5 w-full px-2 py-1 text-xs text-left hover:bg-accent/50',
                    !selectedParentId && 'bg-accent text-accent-foreground font-medium'
                  )}
                  onClick={() => setSelectedParentId(null)}
                >
                  <BookOpen className="size-3 shrink-0" />
                  <span>根目录</span>
                </button>
                {/* Folders */}
                {folderTree.map((node) => (
                  <DirTreeNode
                    key={node.id}
                    node={node}
                    depth={0}
                    selectedParentId={selectedParentId}
                    onSelect={setSelectedParentId}
                    expanded={expandedDirs}
                    onToggle={(id) => setExpandedDirs((prev) => {
                      const next = new Set(prev)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Title */}
        <div className="mb-3">
          <label className="text-xs text-muted-foreground mb-1 block">文档标题</label>
          <Input
            className="h-7 text-xs"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            size="sm"
            className="text-xs h-7"
            onClick={handleSave}
            disabled={saving || !selectedKb || !title.trim()}
          >
            {saving && <Loader2 className="size-3 mr-1 animate-spin" />}
            保存
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Recursive directory tree node for the popover
function DirTreeNode({
  node,
  depth,
  selectedParentId,
  onSelect,
  expanded,
  onToggle
}: {
  node: CollectionItem
  depth: number
  selectedParentId: string | null
  onSelect: (id: string | null) => void
  expanded: Set<string>
  onToggle: (id: string) => void
}): React.JSX.Element {
  const isExpanded = expanded.has(node.id)
  const isSelected = selectedParentId === node.id
  const hasChildren = (node.children?.length ?? 0) > 0

  return (
    <div>
      <button
        className={cn(
          'flex items-center gap-1 w-full px-2 py-1 text-xs text-left hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
        onClick={() => {
          if (hasChildren) onToggle(node.id)
          onSelect(node.id)
        }}
      >
        {hasChildren ? (
          isExpanded ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            : <span className="w-3 shrink-0" />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="size-3 shrink-0 text-amber-500" />
        ) : (
          <FolderClosed className="size-3 shrink-0 text-amber-500" />
        )}
        <span className="truncate">{node.name}</span>
      </button>
      {isExpanded && hasChildren && node.children!.map((child) => (
        <DirTreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedParentId={selectedParentId}
          onSelect={onSelect}
          expanded={expanded}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
