import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OutputData } from '@editorjs/editorjs'
import type EditorJS from '@editorjs/editorjs'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  FolderClosed,
  FolderOpen,
  Loader2,
  Pencil,
  Search,
  Trash2
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Skeleton } from '@renderer/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { useAuthStore } from '@renderer/stores/auth-store'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import {
  listCollections,
  listChunks,
  deleteCollections,
  importFileToDataset,
  createFolder,
  downloadFile,
  listStoredFiles,
  readStoredFile,
  renameCollection,
  updateDataset,
  type DatasetItem,
  type CollectionItem,
  type ChunkItem,
  type StoredFile,
  SYSTEM_TAG_CONFIG
} from '@renderer/lib/knowledge/kb-api-client'
import { goToKnowledgeList } from '@renderer/lib/knowledge-route'
import { EditorJsRichText } from '@renderer/components/editorjs/EditorJsRichText'
import { TOOLBAR_ACTIONS } from '@renderer/components/editorjs/EditorJsRichText'
import { editorJsToMarkdown, markdownToEditorData } from '@renderer/lib/editorjs/editorjs-to-markdown'
import {
  MARKDOWN_REMARK_PLUGINS,
  MARKDOWN_REHYPE_PLUGINS,
  createMarkdownComponents
} from '@renderer/lib/preview/viewers/markdown-components'
import './knowledge-detail-dark.css'

const MARKDOWN_COMPONENTS = createMarkdownComponents()

// --------------- helpers ---------------

function typeIcon(type: string): React.ReactNode {
  if (type === 'folder') return <FolderClosed className="size-4 text-amber-500" />
  return <FileText className="size-4 text-muted-foreground" />
}

function typeLabel(type: string): string {
  switch (type) {
    case 'virtual':
      return '手动录入'
    case 'link':
      return '网页链接'
    case 'folder':
      return '文件夹'
    default:
      return type
  }
}

// Draft storage key prefix
const DRAFT_STORAGE_PREFIX = 'kb-draft-'
const EDIT_DRAFT_STORAGE_PREFIX = 'kb-edit-draft-'

interface DraftState {
  title: string
  content: string
  editorData: OutputData
  parentId?: string
  collectionId?: string
}

// --------------- Tree ---------------

interface TreeNodeProps {
  item: CollectionItem
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  onSelect: (item: CollectionItem) => void
  selectedId: string | null
  onDelete?: (item: CollectionItem) => void
  onRename?: (item: CollectionItem) => void
  onContextMenu?: (e: React.MouseEvent, item: CollectionItem) => void
  onDoubleClick?: (item: CollectionItem) => void
}

function TreeNode({
  item,
  depth,
  expanded,
  onToggle,
  onSelect,
  selectedId,
  onDelete,
  onRename,
  onContextMenu,
  onDoubleClick
}: TreeNodeProps): React.JSX.Element {
  const isFolder = item.type === 'folder'
  const isExpanded = expanded.has(item.id)
  const isSelected = selectedId === item.id
  const isDraft = item.id.startsWith('draft-')
  // 只有明确有训练任务且没有数据时才认为是解析中
  const isParsing = !isFolder && (item.trainingAmount ?? 0) > 0 && (item.dataAmount ?? 0) === 0

  return (
    <div>
      <button
        className={cn(
          'flex items-center gap-1.5 w-full px-2 py-1.5 text-left text-xs rounded transition-colors kb-tree-node',
          isParsing ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent/50',
          isSelected && 'bg-accent text-accent-foreground font-medium'
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (isParsing) {
            toast.info('文件正在切片解析中，请稍后查看...')
            return
          }
          if (isFolder) onToggle(item.id)
          onSelect(item)
        }}
        onContextMenu={(e) => onContextMenu?.(e, item)}
        onDoubleClick={(e) => {
          e.preventDefault()
          onDoubleClick?.(item)
        }}
      >
        {isFolder ? (
          isExpanded ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isExpanded ? (
          <FolderOpen className="size-4 shrink-0 text-amber-500" />
        ) : isFolder ? (
          <FolderClosed className="size-4 shrink-0 text-amber-500" />
        ) : (
          <FileText className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate flex-1">
          {isDraft ? `📝 ${item.name}` : item.name}
        </span>
        {isParsing && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 parsing-badge">
            <Loader2 className="size-2.5 animate-spin" />
            解析中
          </span>
        )}
        {isFolder && item.children && item.children.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60">{item.children.length}</span>
        )}
        {isFolder && item.dataAmount > 0 && (
          <span className="text-[10px] text-muted-foreground/60">{item.dataAmount}</span>
        )}
        {!isDraft && (
          <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            {onRename && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer p-0.5 hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRename(item)
                    }}
                  >
                    <Pencil className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>重命名</TooltipContent>
              </Tooltip>
            )}
            {onDelete && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="cursor-pointer p-0.5 hover:text-red-500"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(item)
                    }}
                  >
                    <Trash2 className="size-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>删除</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
      </button>
      {isFolder && isExpanded && item.children && item.children.length > 0 && (
        <div className="group/tree">
          {item.children.map((child) => (
            <TreeNode
              key={child.id}
              item={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              selectedId={selectedId}
              onDelete={onDelete}
              onRename={onRename}
              onContextMenu={onContextMenu}
              onDoubleClick={onDoubleClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// --------------- document toolbar ---------------

function DocToolbar({
  onAction
}: {
  onAction: (action: (typeof TOOLBAR_ACTIONS)[number]) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-px">
      {TOOLBAR_ACTIONS.map((item) => (
        <Tooltip key={item.label}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center size-8 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              onMouseDown={(e) => {
                e.preventDefault()
                onAction(item)
              }}
            >
              {item.icon}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            {item.label}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

// --------------- main component ---------------

interface KnowledgeDetailProps {
  kbId: string
}

function DraftBanner({
  kbId,
  draftVersion,
  onResume,
  onDelete
}: {
  kbId: string
  draftVersion: number
  onResume: (draft: DraftState) => void
  onDelete: () => void
}): React.JSX.Element | null {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const saved = useMemo(() => {
    try {
      const raw = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
      if (!raw) return null
      const d = JSON.parse(raw) as DraftState
      if (d.title || d.content) return d
    } catch { /* ignore */ }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, draftVersion])

  if (!saved) return null

  return (
    <div className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 flex items-center gap-3">
      <FileText className="size-5 text-amber-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-amber-800 truncate">
          未完成的草稿：{saved.title || '未命名文档'}
        </div>
        <div className="text-xs text-amber-600 mt-0.5">上次编辑的内容已自动保存</div>
      </div>
      <Button
        size="sm"
        className="text-xs h-7 bg-amber-600 hover:bg-amber-700 text-white shrink-0"
        onClick={() => onResume(saved)}
      >
        恢复草稿
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-xs h-7 text-amber-700 hover:text-amber-800 shrink-0"
        onClick={onDelete}
      >
        删除
      </Button>
    </div>
  )
}

export function KnowledgeDetail({ kbId }: KnowledgeDetailProps): React.JSX.Element {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // KB info (derive from allKbs or fetch)
  const [kbInfo, setKbInfo] = useState<DatasetItem | null>(null)
  const [collections, setCollections] = useState<CollectionItem[]>([])
  const [loading, setLoading] = useState(true)

  // Tree state
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<CollectionItem | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [searchTree, setSearchTree] = useState('')

  // Content state
  const [chunks, setChunks] = useState<ChunkItem[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)

  // Stored files (for download)
  const [storedFiles, setStoredFiles] = useState<StoredFile[]>([])

  // Folder dialog
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [folderName, setFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number; item?: CollectionItem; isRoot?: boolean
  } | null>(null)

  // Import dialog
  const [showImport, setShowImport] = useState(false)
  const [importTrainingType, setImportTrainingType] = useState('chunk')
  const [importFileBuffer, setImportFileBuffer] = useState<ArrayBuffer | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [draftVersion, setDraftVersion] = useState(0)

  // Draft mode state
  const [draftMode, setDraftMode] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftEditorData, setDraftEditorData] = useState<OutputData>({ blocks: [], time: Date.now() })
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const draftTitleRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<EditorJS | null>(null)
  const handleEditorRef = useCallback((ed: EditorJS | null) => { docRef.current = ed }, [])

  // Edit mode for published documents
  const [editMode, setEditMode] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editEditorData, setEditEditorData] = useState<OutputData>({ blocks: [], time: Date.now() })
  const [editDirty, setEditDirty] = useState(false)
  const [editSaving, setEditSaving] = useState(false)
  const [editSaveError, setEditSaveError] = useState(false)

  // Delete confirmation dialog
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<CollectionItem | null>(null)

  // Rename dialog (文件/目录)
  const [renameItem, setRenameItem] = useState<CollectionItem | null>(null)
  const [renameName, setRenameName] = useState('')
  const [renaming, setRenaming] = useState(false)

  // Rename KB (知识库名称)
  const [editingKbName, setEditingKbName] = useState(false)
  const [kbNameInput, setKbNameInput] = useState('')
  const [savingKbName, setSavingKbName] = useState(false)
  const kbNameInputRef = useRef<HTMLInputElement>(null)

  // Refs for keyboard shortcut handler (avoid stale closures)
  const draftStateRef = useRef({ draftMode, draftDirty, draftTitle, draftContent, draftEditorData })
  draftStateRef.current = { draftMode, draftDirty, draftTitle, draftContent, draftEditorData }
  // 草稿创建时的 parentId，创建后冻结不变
  const draftParentIdRef = useRef<string | undefined>(undefined)
  const editStateRef = useRef({ editMode, editDirty })
  editStateRef.current = { editMode, editDirty }

  // ==================== data fetching ====================

  const loadedRef = useRef<Set<string>>(new Set())

  const fetchCollections = useCallback(async (datasetId: string) => {
    setLoading(true)
    try {
      const r = await listCollections(ipcClient, datasetId)
      if (r.success) {
        const fresh = r.data ?? []
        setCollections((prev) => {
          // 保留已加载的子目录节点，只替换根级节点
          const nonRoot = prev.filter((c) => c.parentId && c.parentId.trim())
          return [...nonRoot, ...fresh]
        })
      }
    } catch {
      /* silent */
    }
    setLoading(false)
  }, [])

  const fetchChildren = useCallback(
    async (datasetId: string, parentId: string) => {
      try {
        const r = await listCollections(ipcClient, datasetId, parentId)
        if (r.success) {
          const fresh = r.data ?? []
          setCollections((prev) => {
            // Remove all previous children of this parent, then add fresh ones
            const withoutOld = prev.filter((c) => c.parentId !== parentId)
            return [...withoutOld, ...fresh]
          })
          loadedRef.current.add(parentId)
        }
      } catch {
        /* silent */
      }
    },
    []
  )

  useEffect(() => {
    fetchCollections(kbId)
  }, [kbId, fetchCollections])

  // Check if any item is currently parsing
  const hasParsing = useMemo(
    () => collections.some((c) => (c.trainingAmount ?? 0) > 0),
    [collections]
  )

  // Poll for training status updates when items are being parsed
  // 使用独立状态，不干扰主列表渲染
  useEffect(() => {
    if (!hasParsing) return

    let cancelled = false

    const poll = async () => {
      try {
        const r = await listCollections(ipcClient, kbId)
        if (cancelled || !r.success) return

        // 检查当前选中的文档是否刚完成解析
        let parsingCompleted = false
        let completedItem: CollectionItem | null = null

        // 只更新训练状态，不替换整个列表
        setCollections((prev) =>
          prev.map((c) => {
            const fresh = r.data?.find((f) => f.id === c.id)
            if (!fresh) return c
            // 检查是否从解析中变为解析完成
            const wasParsing = (c.trainingAmount ?? 0) > 0 && (c.dataAmount ?? 0) === 0
            const isNowParsed = (fresh.dataAmount ?? 0) > 0
            if (wasParsing && isNowParsed) {
              parsingCompleted = true
              completedItem = { ...c, trainingAmount: fresh.trainingAmount, dataAmount: fresh.dataAmount }
            }
            return {
              ...c,
              trainingAmount: fresh.trainingAmount,
              dataAmount: fresh.dataAmount
            }
          })
        )

        // 同步更新 selectedItem 的状态
        setSelectedItem((prev) => {
          if (!prev) return prev
          const fresh = r.data?.find((f) => f.id === prev.id)
          if (!fresh) return prev
          // 检查当前选中的文档是否刚完成解析
          const wasParsing = (prev.trainingAmount ?? 0) > 0 && (prev.dataAmount ?? 0) === 0
          const isNowParsed = (fresh.dataAmount ?? 0) > 0
          if (wasParsing && isNowParsed) {
            parsingCompleted = true
            completedItem = { ...prev, trainingAmount: fresh.trainingAmount, dataAmount: fresh.dataAmount }
          }
          return {
            ...prev,
            trainingAmount: fresh.trainingAmount,
            dataAmount: fresh.dataAmount
          }
        })

        // 如果当前选中的文档刚完成解析，重新选中以进入编辑模式
        if (parsingCompleted && completedItem) {
          // 延迟一点让状态更新完成
          setTimeout(() => {
            handleSelectDocRef.current(completedItem!)
          }, 100)
        }

        // 更新已展开文件夹的子项
        for (const parentId of loadedRef.current) {
          if (!parentId) continue
          const childR = await listCollections(ipcClient, kbId, parentId)
          if (cancelled || !childR.success) continue
          setCollections((prev) => {
            const freshChildren = childR.data ?? []
            const withoutOld = prev.filter((c) => c.parentId !== parentId)
            return [...withoutOld, ...freshChildren]
          })
        }
      } catch {
        // silent
      }
    }

    const interval = setInterval(poll, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [hasParsing, kbId])

  // Fetch stored files for download
  const fetchStoredFiles = useCallback(async () => {
    try {
      const r = await listStoredFiles(ipcClient, kbId)
      if (r.success) setStoredFiles(r.data ?? [])
    } catch {
      /* silent */
    }
  }, [kbId])

  useEffect(() => {
    fetchStoredFiles()
  }, [fetchStoredFiles])

  // Check if current selected item has a stored file
  const currentStoredFile = useMemo(() => {
    if (!selectedItem || selectedItem.type === 'folder') return null
    return storedFiles.find((f) => f.collectionId === selectedItem.id) || null
  }, [selectedItem, storedFiles])

  // Check if current selected item is parsing
  const isCurrentItemParsing = useMemo(() => {
    if (!selectedItem || selectedItem.type === 'folder') return false
    return (selectedItem.trainingAmount ?? 0) > 0 && (selectedItem.dataAmount ?? 0) === 0
  }, [selectedItem])

  // Download handler — works for both uploaded files and new documents
  const handleDownloadFile = useCallback(async () => {
    if (!selectedItem) return

    // 上传文件：通过 storedFile 下载原始文件
    if (currentStoredFile) {
      try {
        const r = await downloadFile(ipcClient, {
          datasetId: kbId,
          collectionId: selectedItem.id,
          fileName: currentStoredFile.fileName
        })
        if (!r.success) {
          toast.error(r.error || '下载失败')
        } else {
          toast.success('文件已保存')
        }
      } catch {
        toast.error('下载失败')
      }
      return
    }

    // 新建文档：生成 .md 文件并弹出保存对话框
    try {
      const result = (await ipcClient.invoke(IPC.FS_SELECT_SAVE_FILE, {
        defaultPath: `${selectedItem.name}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      })) as { canceled?: boolean; filePath?: string }
      if (result.canceled || !result.filePath) return
      const chunks = await listChunks(ipcClient, selectedItem.id)
      const content = chunks.success && chunks.data
        ? chunks.data.map(c => c.content || '').join('\n\n')
        : ''
      await ipcClient.invoke(IPC.FS_WRITE_FILE, { filePath: result.filePath, content } as Record<string, unknown>)
      toast.success('文件已保存')
    } catch {
      toast.error('导出失败')
    }
  }, [kbId, selectedItem, currentStoredFile])

  // Fetch KB info from both personal and enterprise datasets
  useEffect(() => {
    const fetchInfo = async () => {
      try {
        const { listDatasets } = await import('@renderer/lib/knowledge/kb-api-client')
        // Try personal datasets first
        if (token) {
          try {
            const r = await listDatasets(ipcClient)
            if (r.success) {
              const found = (r.data ?? []).find((d) => d.id === kbId)
              if (found) {
                // Resolve systemTag: prefer source field (department), then API's systemTag, then default '个人'
                const sysTag = found.source === 'department'
                  ? '部门'
                  : (found.systemTag || '个人')
                setKbInfo({ ...found, systemTag: sysTag })
                return
              }
            }
          } catch {
            /* silent */
          }
        }
        // Try enterprise datasets
        try {
          const r = (await ipcClient.invoke(IPC.KNOWLEDGE_LIST_DATASETS)) as {
            success: boolean
            data?: DatasetItem[]
          }
          if (r.success) {
            const found = (r.data ?? []).find((d) => d.id === kbId)
            if (found) {
              // Resolve systemTag: prefer source field (department), then API's systemTag, then default '企业'
              const sysTag = found.source === 'department'
                ? '部门'
                : (found.systemTag || '企业')
              setKbInfo({ ...found, systemTag: sysTag })
            }
          }
        } catch {
          /* silent */
        }
      } catch {
        /* silent */
      }
    }
    fetchInfo()
  }, [kbId, token])

  // Determine if this KB is read-only (enterprise, read-only, or department KB not created by current user)
  const isReadOnly = useMemo(() => {
    if (!kbInfo?.systemTag) return false
    if (kbInfo.systemTag === '企业' || kbInfo.systemTag === '只读') return true
    // Department KB: only the creator can edit; everyone else is read-only
    if (kbInfo.systemTag === '部门') {
      if (!user) return true
      const isCreator =
        !!kbInfo.creator &&
        (kbInfo.creator === user.username || kbInfo.creator === user.displayName)
      return !isCreator
    }
    return false
  }, [kbInfo, user])

  // ==================== tree structure ====================

  const folderTree = useMemo(() => {
    // Build a tree from flat list using parentId
    const nodeMap = new Map<string, CollectionItem>()
    const roots: CollectionItem[] = []

    // First pass: clone items into map
    for (const c of collections) {
      nodeMap.set(c.id, { ...c, children: [] })
    }

    // Second pass: attach children to parents
    for (const c of nodeMap.values()) {
      const pid = c.parentId || null
      if (pid && nodeMap.has(pid)) {
        nodeMap.get(pid)!.children!.push(c)
      } else {
        roots.push(c)
      }
    }

    // Add draft item if saved draft exists in localStorage
    const savedDraft = (() => {
      try {
        const raw = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
        if (!raw) return null
        const d = JSON.parse(raw) as DraftState
        if (d.title || d.content) return d
      } catch { /* ignore */ }
      return null
    })()

    if (savedDraft || draftMode) {
      const treeDraftId = draftMode ? draftId : `draft-${Date.now()}`
      const treeDraftName = draftMode
        ? (draftTitle || '未命名文档')
        : (savedDraft?.title || '未命名文档')
      // parentId 优先级: localStorage 已保存 > 创建时冻结 > 当前目录
      const treeDraftParentId = savedDraft?.parentId ?? draftParentIdRef.current

      const draftItem: CollectionItem = {
        id: treeDraftId || `draft-${Date.now()}`,
        name: treeDraftName,
        type: 'virtual',
        trainingType: 'chunk',
        dataAmount: 0,
        tags: [],
        updateTime: new Date().toISOString(),
        parentId: treeDraftParentId
      }

      if (draftItem.parentId) {
        for (const c of nodeMap.values()) {
          if (c.id === draftItem.parentId) {
            c.children = c.children || []
            c.children.push(draftItem)
            break
          }
        }
      } else {
        roots.push(draftItem)
      }
    }

    // Sort: folders first, then by name
    const sortNode = (items: CollectionItem[]) => {
      items.sort((a, b) => {
        const aIsFolder = a.type === 'folder' ? 0 : 1
        const bIsFolder = b.type === 'folder' ? 0 : 1
        const aIsDraft = a.id.startsWith('draft-') ? 1 : 0
        const bIsDraft = b.id.startsWith('draft-') ? 1 : 0
        if (aIsFolder !== bIsFolder) return aIsFolder - bIsFolder
        if (aIsDraft !== bIsDraft) return bIsDraft - aIsDraft // Drafts at top
        return a.name.localeCompare(b.name, 'zh-Hans')
      })
      for (const item of items) {
        if (item.children && item.children.length > 0) sortNode(item.children)
      }
    }
    sortNode(roots)

    if (!searchTree.trim()) return roots
    // Filter tree by search
    const filterTree = (items: CollectionItem[]): CollectionItem[] => {
      const result: CollectionItem[] = []
      for (const item of items) {
        const match = item.name.toLowerCase().includes(searchTree.trim().toLowerCase())
        const filteredChildren = item.children ? filterTree(item.children) : []
        if (match || filteredChildren.length > 0) {
          result.push({ ...item, children: filteredChildren })
        }
      }
      return result
    }
    return filterTree(roots)
  }, [collections, searchTree, draftMode, draftId, draftTitle, currentFolderId, draftVersion, kbId])

  // Keep selectedItem in sync when tree changes (e.g. after lazy-load)
  useEffect(() => {
    if (!selectedId) return
    const find = (items: CollectionItem[]): CollectionItem | null => {
      for (const item of items) {
        if (item.id === selectedId) return item
        if (item.children) {
          const found = find(item.children)
          if (found) return found
        }
      }
      return null
    }
    const current = find(folderTree)
    if (current) setSelectedItem(current)
  }, [folderTree, selectedId])

  // ==================== actions ====================

  const handleSelectDoc = useCallback(async (item: CollectionItem) => {
    // Block while publish is in progress
    if (editSaving) return

    // 点击草稿节点 → 恢复草稿编辑模式
    if (item.type === 'virtual') {
      const saved = (() => {
        try {
          const raw = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
          if (!raw) return null
          return JSON.parse(raw) as DraftState
        } catch { return null }
      })()
      if (saved) {
        draftParentIdRef.current = saved.parentId
        setDraftTitle(saved.title || '未命名文档')
        setDraftContent(saved.content || '')
        setDraftEditorData(saved.editorData || { blocks: [], time: Date.now() })
        setDraftDirty(false)
        setDraftMode(true)
        setDraftId(item.id)
        setSelectedId(item.id)
        setSelectedItem(item)
        lastSavedRef.current = JSON.stringify({ title: saved.title || '', content: saved.content || '', editorData: saved.editorData || { blocks: [], time: Date.now() } })
      } else if (draftMode) {
        // 草稿从未保存过（localStorage 为空但 draftMode 是 true），不做任何事
        return
      }
      return
    }

    // Auto-save unsaved draft to localStorage before switching
    if (draftDirty) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      const data: DraftState = {
        title: draftTitle,
        content: draftContent,
        editorData: draftEditorData,
        parentId: draftParentIdRef.current
      }
      localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${kbId}`, JSON.stringify(data))
      lastSavedRef.current = JSON.stringify({ title: draftTitle, content: draftContent, editorData: draftEditorData })
      setDraftVersion((v) => v + 1)
    }
    if (editDirty && selectedItem) {
      if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
      const key = `${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${selectedItem.id}`
      const data: DraftState = {
        title: editTitle,
        content: editContent,
        editorData: editEditorData,
        collectionId: selectedItem.id
      }
      localStorage.setItem(key, JSON.stringify(data))
      lastAutoSavedEditSnapshotRef.current = JSON.stringify({ title: editTitle, content: editContent, editorData: editEditorData })
    }

    // Clear current mode
    if (draftMode) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      setDraftMode(false)
      setDraftDirty(false)
    }
    if (editMode) {
      if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
      setEditMode(false)
      setEditDirty(false)
    }

    setSelectedId(item.id)
    setSelectedItem(item)
    if (item.type === 'folder') {
      setCurrentFolderId(item.id)
      setChunks([])
      return
    }

    // 文档正在解析中：不进入编辑模式，直接显示解析中状态
    const isParsing = (item.trainingAmount ?? 0) > 0 && (item.dataAmount ?? 0) === 0
    if (isParsing) {
      setEditMode(false)
      setChunks([])
      return
    }

    // .md 文件：优先读取本地编辑草稿，否则从服务端读取
    const storedFile = storedFiles.find((f) => f.collectionId === item.id)
    if (item.name.endsWith('.md') && storedFile) {
      // 检查是否有本地编辑草稿
      const editDraftKey = `${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${item.id}`
      const savedEditDraft = (() => {
        try {
          const raw = localStorage.getItem(editDraftKey)
          if (!raw) return null
          return JSON.parse(raw) as DraftState
        } catch { return null }
      })()

      if (savedEditDraft?.content) {
        setEditTitle(item.name.replace(/\.md$/i, ''))
        setEditContent(savedEditDraft.content)
        setEditEditorData(savedEditDraft.editorData || { blocks: [], time: Date.now() })
        setEditMode(true)
        setEditDirty(false)
        setEditSaveError(false)
        lastAutoSavedEditSnapshotRef.current = JSON.stringify({
          title: savedEditDraft.title || '',
          content: savedEditDraft.content,
          editorData: savedEditDraft.editorData || { blocks: [], time: Date.now() }
        })
        setChunks([])
        return
      }

      try {
        const r = await readStoredFile(ipcClient, {
          datasetId: kbId,
          collectionId: item.id,
          fileName: storedFile.fileName
        })
        if (r.success && r.data?.content) {
          setEditTitle(item.name.replace(/\.md$/i, ''))
          setEditContent(r.data.content)
          setEditEditorData(markdownToEditorData(r.data.content))
          setEditMode(true)
          setEditDirty(false)
          setEditSaveError(false)
          lastAutoSavedEditSnapshotRef.current = ''
          setChunks([])
          return
        }
      } catch { /* fallback */ }
    }

    // 非 .md 文件：显示切片内容（只读）
    setEditMode(false)
    setChunksLoading(true)
    try {
      const r = await listChunks(ipcClient, item.id)
      if (r.success) setChunks(r.data ?? [])
    } catch { /* silent */ }
    setChunksLoading(false)
  }, [kbId, storedFiles, draftDirty, editDirty, editMode, draftMode, editSaving, draftTitle, draftContent, draftEditorData, editTitle, editContent, editEditorData, selectedItem, currentFolderId])

  // Always-up-to-date ref for polling loop (avoids stale closure)
  const handleSelectDocRef = useRef(handleSelectDoc)
  handleSelectDocRef.current = handleSelectDoc

  const handleDeleteItem = useCallback(async (item: CollectionItem) => {
    // 计算子项数量
    const countChildren = (parentId: string): { docs: number; folders: number } => {
      let docs = 0
      let folders = 0
      for (const c of collections) {
        if (c.parentId === parentId) {
          if (c.type === 'folder') {
            folders++
            const sub = countChildren(c.id)
            docs += sub.docs
            folders += sub.folders
          } else {
            docs++
          }
        }
      }
      return { docs, folders }
    }

    if (item.type === 'folder') {
      const childCounts = countChildren(item.id)
      // 注入子项计数供弹窗展示
      setDeleteConfirmItem({
        ...item,
        dataAmount: childCounts.docs,
        tags: [`${childCounts.folders} 个子目录`]
      })
    } else {
      setDeleteConfirmItem(item)
    }
  }, [collections])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirmItem) return
    const item = deleteConfirmItem
    setDeleteConfirmItem(null)

    try {
      const r = await deleteCollections(ipcClient, { datasetId: kbId, collectionIds: [item.id] })
      if (!r.success) {
        toast.error(r.error || '删除失败')
        return
      }
      toast.success('已删除')
      if (selectedId === item.id) {
        setSelectedId(null)
        setSelectedItem(null)
        setChunks([])
      }
      if (item.parentId && item.parentId.trim()) {
        loadedRef.current.delete(item.parentId)
        fetchChildren(kbId, item.parentId)
      } else {
        fetchCollections(kbId)
      }
    } catch {
      toast.error('删除失败')
    }
  }, [deleteConfirmItem, kbId, selectedId, fetchCollections, fetchChildren])

  const handleCreateFolder = useCallback(async () => {
    if (!folderName.trim()) return
    setCreatingFolder(true)
    try {
      const r = await createFolder(ipcClient, {
        datasetId: kbId,
        name: folderName.trim(),
        parentId: currentFolderId || undefined
      })
      if (!r.success) {
        toast.error(r.error || '创建失败')
        return
      }
      toast.success('目录已创建')
      setShowCreateFolder(false)
      setFolderName('')
      if (currentFolderId) {
        loadedRef.current.delete(currentFolderId)
        fetchChildren(kbId, currentFolderId)
      } else {
        fetchCollections(kbId)
      }
    } catch {
      /* silent */
    }
    setCreatingFolder(false)
  }, [kbId, folderName, currentFolderId, fetchCollections, fetchChildren])

  const handleImportFile = useCallback(async () => {
    if (!importFileBuffer) return
    setImporting(true)
    try {
      const r = await importFileToDataset(ipcClient, {
        datasetId: kbId,
        fileName: importFileName,
        fileBuffer: importFileBuffer,
        trainingType: importTrainingType,
        parentId: currentFolderId || undefined
      })
      if (!r.success) {
        toast.error(r.error || '导入失败')
        return
      }
      toast.success('导入成功')
      setShowImport(false)
      setImportFileBuffer(null)
      setImportFileName('')
      if (currentFolderId) {
        loadedRef.current.delete(currentFolderId)
        fetchChildren(kbId, currentFolderId)
      } else {
        fetchCollections(kbId)
      }
    } catch {
      /* silent */
    }
    setImporting(false)
  }, [
    kbId,
    importFileBuffer,
    importFileName,
    importTrainingType,
    currentFolderId,
    fetchCollections,
    fetchChildren
  ])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImportFileBuffer(reader.result as ArrayBuffer)
      setImportFileName(file.name)
    }
    reader.readAsArrayBuffer(file)
  }, [])

  // ==================== draft actions ====================

  const generateUniqueName = useCallback((baseName: string): string => {
    const existingNames = new Set(collections.map(c => c.name))
    if (!existingNames.has(baseName)) return baseName

    let counter = 1
    while (existingNames.has(`${baseName}(${counter})`)) {
      counter++
    }
    return `${baseName}(${counter})`
  }, [collections])

  const handleCreateDraft = useCallback((parentId?: string | null) => {
    const draftName = generateUniqueName('未命名文档')
    const newDraftId = `draft-${Date.now()}`

    // 使用传入的 parentId，否则用 currentFolderId
    const resolvedParentId = parentId !== undefined ? (parentId || undefined) : (currentFolderId || undefined)
    draftParentIdRef.current = resolvedParentId

    setDraftId(newDraftId)
    setDraftTitle(draftName)
    setDraftContent('')
    setDraftEditorData({ blocks: [], time: Date.now() })
    setDraftDirty(true)
    setDraftMode(true)
    setSelectedId(newDraftId)
    setSelectedItem({
      id: newDraftId,
      name: draftName,
      type: 'virtual',
      trainingType: 'chunk',
      dataAmount: 0,
      tags: [],
      updateTime: new Date().toISOString(),
      parentId: resolvedParentId
    })

    // Focus title input after render
    setTimeout(() => {
      draftTitleRef.current?.focus()
      draftTitleRef.current?.select()
    }, 100)
  }, [generateUniqueName, currentFolderId])

  const handlePublishDraft = useCallback(async () => {
    if (!draftTitle.trim() || !draftContent.trim()) {
      toast.error('请填写标题和内容')
      return
    }

    setDraftSaving(true)
    try {
      // 将 Markdown 编码为 .md 文件，通过文件导入接口上传
      const encoder = new TextEncoder()
      const buffer = encoder.encode(draftContent).buffer as ArrayBuffer

      const importResult = await importFileToDataset(ipcClient, {
        datasetId: kbId,
        fileName: `${draftTitle.trim()}.md`,
        fileBuffer: buffer,
        trainingType: 'chunk',
        parentId: draftParentIdRef.current
      })

      if (!importResult.success) {
        toast.error(importResult.error || '发布失败')
        return
      }

      toast.success('发布成功')
      setDraftMode(false)
      setDraftId(null)
      setDraftTitle('')
      setDraftContent('')
      setDraftEditorData({ blocks: [], time: Date.now() })
      setDraftDirty(false)

      // 清理 localStorage 中的草稿数据
      localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)

      const newDocId = importResult.data?.collectionId

      // Refresh collections and select the new document
      // 用草稿的实际 parentId（创建时冻结），不是 currentFolderId
      const draftParentId = draftParentIdRef.current
      let newCollections: CollectionItem[] = []
      if (draftParentId) {
        loadedRef.current.delete(draftParentId)
        const cr = await listCollections(ipcClient, kbId, draftParentId)
        if (cr.success) {
          newCollections = (cr.data ?? []).map((c) =>
            c.id === newDocId ? { ...c, name: `${draftTitle.trim()}.md` } : c
          )
          setCollections((prev) => {
            const withoutOld = prev.filter((c) => c.parentId !== draftParentId)
            return [...withoutOld, ...newCollections]
          })
        }
      } else {
        const cr = await listCollections(ipcClient, kbId)
        if (cr.success) {
          newCollections = (cr.data ?? []).map((c) =>
            c.id === newDocId ? { ...c, name: `${draftTitle.trim()}.md` } : c
          )
          // 函数式更新：保留已加载子目录节点，只替换根级
          setCollections((prev) => {
            const nonRoot = prev.filter((c) => c.parentId && c.parentId.trim())
            return [...nonRoot, ...newCollections]
          })
        }
      }

      // Select the newly created document
      const newDoc = newCollections.find((c) => c.id === newDocId)
      if (newDoc) {
        newDoc.name = `${draftTitle.trim()}.md`
        // 新文档发布后处于解析中，标记为正在解析
        newDoc.trainingAmount = 1
        newDoc.dataAmount = 0
        setSelectedId(newDoc.id)
        setSelectedItem(newDoc)
        setChunks([])
      }

      // 刷新本地文件列表，确保新文件发布后能找到本地副本
      fetchStoredFiles()
    } catch {
      toast.error('发布失败')
    }
    setDraftSaving(false)
  }, [kbId, draftTitle, draftContent, currentFolderId, fetchCollections, fetchChildren, fetchStoredFiles])

  const handleDiscardDraft = useCallback(() => {
    setDraftMode(false)
    setDraftId(null)
    setDraftTitle('')
    setDraftContent('')
    setDraftEditorData({ blocks: [], time: Date.now() })
    setDraftDirty(false)
    setSelectedId(null)
    setSelectedItem(null)

    // 清理 localStorage 中的草稿数据
    localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
    setDraftVersion((v) => v + 1)

    toast.success('草稿已放弃')
  }, [kbId])

  // Auto-save draft to localStorage with 3s debounce
  const lastSavedRef = useRef('')
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Hold latest values for the debounced save callback (avoid stale closure)
  const autoSaveDataRef = useRef<{ title: string; content: string; editorData: OutputData }>({ title: '', content: '', editorData: { blocks: [], time: Date.now() } })
  autoSaveDataRef.current = { title: draftTitle, content: draftContent, editorData: draftEditorData }

  useEffect(() => {
    if (!draftMode) return

    const snapshot = JSON.stringify(autoSaveDataRef.current)
    if (snapshot === lastSavedRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      console.log('[KnowledgeDetail] auto-save to localStorage')
      const { title, content, editorData } = autoSaveDataRef.current
      const data: DraftState = {
        title,
        content,
        editorData,
        parentId: draftParentIdRef.current
      }
      localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${kbId}`, JSON.stringify(data))
      lastSavedRef.current = JSON.stringify(autoSaveDataRef.current)
      setDraftDirty(false)
      setDraftVersion((v) => v + 1)
    }, 3000)

    return () => {
      // 卸载时立即保存草稿（页面切换/关闭）
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        const { title, content, editorData } = autoSaveDataRef.current
        if (title || content) {
          const data: DraftState = {
            title,
            content,
            editorData,
            parentId: draftParentIdRef.current
          }
          localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${kbId}`, JSON.stringify(data))
          lastSavedRef.current = JSON.stringify(autoSaveDataRef.current)
        }
      }
    }
  }, [draftMode, draftTitle, draftContent, draftEditorData])

  // Load draft on mount
  useEffect(() => {
    const saved = localStorage.getItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
    if (saved) {
      try {
        const data: DraftState = JSON.parse(saved)
        if (data.title && data.content) {
          draftParentIdRef.current = data.parentId
          setDraftTitle(data.title)
          setDraftContent(data.content)
          setDraftEditorData(data.editorData || { blocks: [], time: Date.now() })
          setDraftDirty(false)
          setDraftMode(true)
          setDraftId(`draft-${Date.now()}`)
          setSelectedId(`draft-${Date.now()}`)
        }
      } catch {
        localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
      }
    }
  }, [kbId])

  const handleExitEditMode = useCallback(() => {
    if (editSaving) return
    // 自动保存草稿后退出
    if (editDirty && selectedItem) {
      if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
      const key = `${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${selectedItem.id}`
      const data: DraftState = {
        title: editTitle,
        content: editContent,
        editorData: editEditorData,
        collectionId: selectedItem.id
      }
      localStorage.setItem(key, JSON.stringify(data))
      lastAutoSavedEditSnapshotRef.current = JSON.stringify({ title: editTitle, content: editContent, editorData: editEditorData })
    }
    setEditMode(false)
    setEditDirty(false)
  }, [editDirty, editSaving, selectedItem, editTitle, editContent, editEditorData, kbId])

  const lastAutoSavedEditSnapshotRef = useRef('')

  // Core save logic — used by both manual save and auto-save
  const doSaveEdit = useCallback(async (silent: boolean): Promise<boolean> => {
    if (!selectedItem || !editTitle.trim() || !editContent.trim()) return false

    setEditSaving(true)
    setEditSaveError(false)
    try {
      const encoder = new TextEncoder()
      const buffer = encoder.encode(editContent).buffer as ArrayBuffer

      const importResult = await importFileToDataset(ipcClient, {
        datasetId: kbId,
        fileName: `${editTitle.trim().replace(/\.md$/i, '')}.md`,
        fileBuffer: buffer,
        trainingType: 'chunk',
        parentId: selectedItem.parentId || undefined
      })

      if (!importResult.success) {
        setEditSaving(false)
        if (!silent) toast.error(importResult.error || '保存失败')
        else setEditSaveError(true)
        return false
      }

      const newCollectionId = importResult.data?.collectionId
      const oldCollectionId = selectedItem.id
      const oldParentId = selectedItem.parentId

      // 删除旧文档
      await deleteCollections(ipcClient, {
        datasetId: kbId,
        collectionIds: [oldCollectionId]
      })

      // 刷新列表并更新选中项
      let refreshed: CollectionItem[] = []
      if (oldParentId) {
        loadedRef.current.delete(oldParentId)
        const cr = await listCollections(ipcClient, kbId, oldParentId)
        if (cr.success) {
          refreshed = (cr.data ?? []).map((c) =>
            c.id === newCollectionId ? { ...c, name: `${editTitle.trim().replace(/\.md$/i, '')}.md` } : c
          )
          setCollections((prev) => {
            const withoutOld = prev.filter((c) => c.parentId !== oldParentId && c.id !== oldCollectionId)
            return [...withoutOld, ...refreshed]
          })
        }
      } else {
        const cr = await listCollections(ipcClient, kbId)
        if (cr.success) {
          refreshed = (cr.data ?? []).map((c) =>
            c.id === newCollectionId ? { ...c, name: `${editTitle.trim().replace(/\.md$/i, '')}.md` } : c
          )
          setCollections(refreshed)
        }
      }

      const newDoc = refreshed.find((c) => c.id === newCollectionId)
      if (newDoc) {
        // 保存后标记为解析中状态
        newDoc.trainingAmount = 1
        newDoc.dataAmount = 0
        setSelectedId(newDoc.id)
        setSelectedItem(newDoc)
        setEditMode(false)
        setChunks([])
      } else {
        setSelectedId(null)
        setSelectedItem(null)
        setChunks([])
      }

      setEditSaving(false)
      // 发布成功，清除本地编辑草稿
      localStorage.removeItem(`${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${oldCollectionId}`)
      lastAutoSavedEditSnapshotRef.current = ''
      // 刷新本地文件列表，确保新文件能被后续编辑正确找到
      fetchStoredFiles()
      if (!silent) toast.success('发布成功')
      return true
    } catch {
      setEditSaving(false)
      if (!silent) toast.error('保存失败')
      else setEditSaveError(true)
      return false
    }
  }, [kbId, selectedItem, editTitle, editContent, fetchStoredFiles])

  const handleSaveEdit = useCallback(async () => {
    if (!editTitle.trim() || !editContent.trim()) {
      toast.error('请填写标题和内容')
      return
    }
    const ok = await doSaveEdit(false)
    if (ok) {
      // .md 文件保存后保持在编辑模式
      setEditDirty(false)
    }
  }, [editTitle, editContent, doSaveEdit])

  // Auto-save edit draft to localStorage with 3s debounce
  const editAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editAutoSaveDataRef = useRef({ title: '', content: '', editorData: { blocks: [], time: Date.now() } as OutputData })
  editAutoSaveDataRef.current = { title: editTitle, content: editContent, editorData: editEditorData }

  const getEditDraftKey = useCallback(() => {
    return selectedItem ? `${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${selectedItem.id}` : ''
  }, [kbId, selectedItem])

  useEffect(() => {
    if (!editMode || !editDirty) return

    const snapshot = JSON.stringify(editAutoSaveDataRef.current)
    if (snapshot === lastAutoSavedEditSnapshotRef.current) return

    if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
    editAutoSaveTimerRef.current = setTimeout(() => {
      if (!editTitle.trim() || !editContent.trim()) return
      const key = getEditDraftKey()
      if (!key) return
      const data: DraftState = {
        title: editAutoSaveDataRef.current.title,
        content: editAutoSaveDataRef.current.content,
        editorData: editAutoSaveDataRef.current.editorData,
        collectionId: selectedItem?.id
      }
      localStorage.setItem(key, JSON.stringify(data))
      lastAutoSavedEditSnapshotRef.current = JSON.stringify(editAutoSaveDataRef.current)
      setEditDirty(false)
      setEditSaveError(false)
    }, 3000)

    return () => {
      if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
    }
  }, [editMode, editDirty, editTitle, editContent, editEditorData, getEditDraftKey])

  // Ctrl+S / Cmd+S — 立即保存草稿到本地 localStorage（跳过 debounce）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        const draft = draftStateRef.current
        const edit = editStateRef.current

        // 草稿模式
        if (draft.draftMode && draft.draftDirty) {
          e.preventDefault()
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
          const data: DraftState = {
            title: draft.draftTitle,
            content: draft.draftContent,
            editorData: draft.draftEditorData,
            parentId: draftParentIdRef.current
          }
          localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${kbId}`, JSON.stringify(data))
          lastSavedRef.current = JSON.stringify({
            title: draft.draftTitle,
            content: draft.draftContent,
            editorData: draft.draftEditorData
          })
          setDraftDirty(false)
          setDraftVersion((v) => v + 1)
          toast.success('草稿已保存')
          return
        }

        // 编辑模式 — 保存到本地草稿
        if (edit.editMode && edit.editDirty && selectedItem) {
          e.preventDefault()
          if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
          const key = `${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${selectedItem.id}`
          const data: DraftState = {
            title: editTitle,
            content: editContent,
            editorData: editEditorData,
            collectionId: selectedItem.id
          }
          localStorage.setItem(key, JSON.stringify(data))
          lastAutoSavedEditSnapshotRef.current = JSON.stringify({ title: editTitle, content: editContent, editorData: editEditorData })
          setEditDirty(false)
          setEditSaveError(false)
          toast.success('草稿已保存')
          return
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [kbId, currentFolderId, selectedItem, editTitle, editContent, editEditorData])

  // ==================== stats ====================

  const sysCfg = kbInfo?.systemTag ? SYSTEM_TAG_CONFIG[kbInfo.systemTag] : null

  // ==================== leave protection ====================

  // beforeunload — 自动保存草稿后允许关闭，不弹窗阻止
  useEffect(() => {
    const handler = () => {
      // 同步保存草稿到 localStorage
      const draft = autoSaveDataRef.current
      if (draftMode && draft.title && draft.content) {
        const data: DraftState = {
          title: draft.title,
          content: draft.content,
          editorData: draft.editorData,
          parentId: draftParentIdRef.current
        }
        localStorage.setItem(`${DRAFT_STORAGE_PREFIX}${kbId}`, JSON.stringify(data))
      }
      const editData = editAutoSaveDataRef.current
      if (editMode && editData.title && editData.content && selectedItem) {
        const key = `${EDIT_DRAFT_STORAGE_PREFIX}${kbId}-${selectedItem.id}`
        const data: DraftState = {
          title: editData.title,
          content: editData.content,
          editorData: editData.editorData,
          collectionId: selectedItem.id
        }
        localStorage.setItem(key, JSON.stringify(data))
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [kbId, draftMode, editMode, currentFolderId, selectedItem])

  const handleGoToRoot = useCallback(() => {
    if (draftMode) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      setDraftMode(false)
      setDraftDirty(false)
    }
    if (editMode) {
      if (editAutoSaveTimerRef.current) clearTimeout(editAutoSaveTimerRef.current)
      setEditMode(false)
      setEditDirty(false)
    }
    setCurrentFolderId(null)
    setSelectedId(null)
    setSelectedItem(null)
    setChunks([])
  }, [draftMode, editMode])

  // Context menu handlers
  const handleTreeContextMenu = useCallback(
    (e: React.MouseEvent, item?: CollectionItem, isRoot?: boolean) => {
      e.preventDefault()
      e.stopPropagation()
      setCtxMenu({ x: e.clientX, y: e.clientY, item, isRoot })
    }, [])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])

  const ctxMenuCreateDoc = useCallback(() => {
    closeCtxMenu()
    // 右键文件夹 → 在该文件夹内创建；右键空白 → 在根目录创建
    if (ctxMenu?.item?.type === 'folder') {
      setCurrentFolderId(ctxMenu.item.id)
      handleCreateDraft(ctxMenu.item.id)
    } else {
      setCurrentFolderId(null)
      handleCreateDraft(null)
    }
  }, [closeCtxMenu, handleCreateDraft, ctxMenu?.item])
  const ctxMenuCreateFolder = useCallback(() => {
    closeCtxMenu()
    if (ctxMenu?.item?.type === 'folder') {
      setCurrentFolderId(ctxMenu.item.id)
    } else if (!ctxMenu?.item) {
      setCurrentFolderId(null)
    }
    setFolderName('')
    setShowCreateFolder(true)
  }, [closeCtxMenu, ctxMenu?.item])
  const ctxMenuImport = useCallback(() => {
    closeCtxMenu()
    setImportFileBuffer(null)
    setImportFileName('')
    setShowImport(true)
  }, [closeCtxMenu])
  const ctxMenuDelete = useCallback(() => {
    if (!ctxMenu?.item) return
    closeCtxMenu()
    handleDeleteItem(ctxMenu.item)
  }, [closeCtxMenu, ctxMenu?.item, handleDeleteItem])
  const ctxMenuDownload = useCallback(async () => {
    if (!ctxMenu?.item) return
    closeCtxMenu()
    const sf = storedFiles.find((f) => f.collectionId === ctxMenu.item?.id)
    if (sf) {
      try {
        const r = await downloadFile(ipcClient, { datasetId: kbId, collectionId: ctxMenu.item.id, fileName: sf.fileName })
        if (r.success) toast.success('文件已保存')
        else toast.error(r.error || '下载失败')
      } catch { toast.error('下载失败') }
    }
  }, [closeCtxMenu, ctxMenu?.item, kbId, storedFiles])
  const ctxMenuEdit = useCallback(() => {
    if (!ctxMenu?.item) return
    closeCtxMenu()
    handleSelectDoc(ctxMenu.item)
  }, [closeCtxMenu, ctxMenu?.item, handleSelectDoc])

  const ctxMenuRename = useCallback(() => {
    if (!ctxMenu?.item) return
    closeCtxMenu()
    setRenameItem(ctxMenu.item)
    setRenameName(ctxMenu.item.name)
    setRenaming(false)
  }, [closeCtxMenu, ctxMenu?.item])

  const handleConfirmRename = useCallback(async () => {
    if (!renameItem || !renameName.trim()) return
    setRenaming(true)
    try {
      const r = await renameCollection(ipcClient, {
        datasetId: kbId,
        collectionId: renameItem.id,
        name: renameName.trim()
      })
      if (!r.success) {
        toast.error(r.error || '重命名失败')
        return
      }
      toast.success('重命名成功')
      // 更新列表中该项的 name
      setCollections((prev) =>
        prev.map((c) => (c.id === renameItem.id ? { ...c, name: renameName.trim() } : c))
      )
      if (selectedId === renameItem.id) {
        setSelectedItem((prev) => (prev ? { ...prev, name: renameName.trim() } : prev))
      }
      // 如果是文件夹且已加载过子节点，刷新
      if (renameItem.type === 'folder') {
        loadedRef.current.delete(renameItem.id)
      }
      setRenameItem(null)
    } catch {
      toast.error('重命名失败')
    }
    setRenaming(false)
  }, [renameItem, renameName, kbId, selectedId])

  const startEditKbName = useCallback(() => {
    if (isReadOnly) return
    setKbNameInput(kbInfo?.name || '')
    setEditingKbName(true)
    setTimeout(() => {
      kbNameInputRef.current?.focus()
      kbNameInputRef.current?.select()
    }, 50)
  }, [kbInfo?.name, isReadOnly])

  const handleSaveKbName = useCallback(async () => {
    if (!kbNameInput.trim() || kbNameInput.trim() === kbInfo?.name) {
      setEditingKbName(false)
      return
    }
    setSavingKbName(true)
    try {
      const r = await updateDataset(ipcClient, {
        id: kbId,
        name: kbNameInput.trim()
      })
      if (!r.success) {
        toast.error(r.error || '重命名失败')
        return
      }
      toast.success('知识库已重命名')
      // 立即更新本地状态
      setKbInfo((prev) => (prev ? { ...prev, name: kbNameInput.trim() } : prev))
      setEditingKbName(false)
    } catch {
      toast.error('重命名失败')
    }
    setSavingKbName(false)
  }, [kbNameInput, kbInfo?.name, kbId])

  const handleCancelKbName = useCallback(() => {
    setEditingKbName(false)
  }, [])

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const timer = setTimeout(() => document.addEventListener('click', close, { once: true }), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', close) }
  }, [ctxMenu])

  // Double-click handler for tree nodes
  const handleTreeDoubleClick = useCallback((item: CollectionItem) => {
    if (item.type === 'folder') {
      // Toggle expand/collapse
      const isOpening = !expanded.has(item.id)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (isOpening) next.add(item.id)
        else next.delete(item.id)
        return next
      })
      if (isOpening && !loadedRef.current.has(item.id)) {
        fetchChildren(kbId, item.id)
      }
    } else {
      handleSelectDoc(item)
    }
  }, [expanded, kbId, fetchChildren, handleSelectDoc])

  const handleDocToolbar = useCallback((action: (typeof TOOLBAR_ACTIONS)[number]) => {
    const editor = docRef.current
    if (!editor) return
    const api = editor as unknown as import('@editorjs/editorjs').API
    action.action(api)
  }, [])

  const handleDraftChange = useCallback((data: OutputData) => {
    setDraftEditorData(data)
    setDraftContent(editorJsToMarkdown(data))
    setDraftDirty(true)
  }, [])

  const handleEditChange = useCallback((data: OutputData) => {
    setEditEditorData(data)
    setEditContent(editorJsToMarkdown(data))
    setEditDirty(true)
  }, [])

  // ==================== JSX ====================

  return (
    <div className="flex h-full min-h-0 flex-col bg-background overflow-hidden kb-detail-container">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInputChange} />

      {/* ---- Header ---- */}
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={goToKnowledgeList}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 shrink-0">
            <BookOpen className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {editingKbName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={kbNameInputRef}
                    className="text-base font-semibold border-b-2 border-primary outline-none bg-transparent px-1 py-0.5 max-w-[300px]"
                    value={kbNameInput}
                    onChange={(e) => setKbNameInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveKbName()
                      if (e.key === 'Escape') handleCancelKbName()
                    }}
                  />
                  <Button
                    size="sm"
                    className="text-xs h-6 px-2"
                    onClick={handleSaveKbName}
                    disabled={savingKbName || !kbNameInput.trim()}
                  >
                    {savingKbName && <Loader2 className="size-3 mr-1 animate-spin" />}
                    保存
                  </Button>
                  <Button variant="ghost" size="sm" className="text-xs h-6 px-2" onClick={handleCancelKbName}>
                    取消
                  </Button>
                </div>
              ) : (
                <>
                  <button
                    className="text-base font-semibold truncate hover:text-primary transition-colors cursor-pointer kb-header-name"
                    onClick={handleGoToRoot}
                    title="点击回到根目录"
                  >
                    {kbInfo?.name || kbId}
                  </button>
                  {!isReadOnly && (
                    <button
                      className="inline-flex items-center justify-center size-6 rounded hover:bg-accent shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={startEditKbName}
                      title="重命名知识库"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                </>
              )}
              {sysCfg && (
                <span
                  className="inline-flex items-center shrink-0 rounded-full px-2 h-[22px] text-[11px] font-medium leading-none"
                  style={{ backgroundColor: sysCfg.bg, color: sysCfg.color }}
                >
                  {kbInfo?.systemTag}
                </span>
              )}
            </div>
            {kbInfo?.intro && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{kbInfo.intro}</p>
            )}
          </div>
        </div>
      </div>

      {/* ---- Body ---- */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar */}
        <div className="w-[260px] border-r flex flex-col shrink-0 kb-detail-sidebar">
          {/* Search */}
          <div className="px-3 py-2.5 border-b shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3 text-muted-foreground" />
              <Input
                className="pl-7 h-7 text-xs kb-detail-search"
                placeholder="搜索文档..."
                value={searchTree}
                onChange={(e) => setSearchTree(e.target.value)}
              />
            </div>
          </div>
          {/* Tree */}
          <div
            className="flex-1 min-h-0 overflow-y-auto py-1"
            onContextMenu={(e) => handleTreeContextMenu(e)}
          >
            {/* 根目录入口 */}
            {!isReadOnly && (
              <button
                className={cn(
                  'flex items-center gap-1.5 w-full px-2 py-1.5 text-left text-xs rounded transition-colors hover:bg-accent/50',
                  !currentFolderId && !selectedId && 'bg-accent text-accent-foreground font-medium'
                )}
                onClick={handleGoToRoot}
                onContextMenu={(e) => handleTreeContextMenu(e, undefined, true)}
              >
                <span className="size-4 shrink-0 flex items-center justify-center text-amber-500">
                  <BookOpen className="size-3.5" />
                </span>
                <span className="truncate flex-1">根目录</span>
              </button>
            )}
            {loading ? (
              <div className="space-y-1 px-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-7 w-full rounded" />
                ))}
              </div>
            ) : folderTree.length === 0 && !draftMode ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无内容</div>
            ) : (
              folderTree.map((item) => (
                <div key={item.id} className="group">
                  <TreeNode
                    item={item}
                    depth={0}
                    expanded={expanded}
                    onToggle={(id) => {
                      const isOpening = !expanded.has(id)
                      setExpanded((prev) => {
                        const next = new Set(prev)
                        if (isOpening) {
                          next.add(id)
                        } else {
                          next.delete(id)
                        }
                        return next
                      })
                      if (isOpening && !loadedRef.current.has(id)) {
                        console.log(`[KnowledgeDetail] 展开文件夹，加载子级: ${id}`)
                        fetchChildren(kbId, id)
                      }
                    }}
                    onSelect={handleSelectDoc}
                    selectedId={selectedId}
                    onDelete={isReadOnly ? undefined : handleDeleteItem}
                    onContextMenu={(e, item) => handleTreeContextMenu(e, item)}
                    onDoubleClick={handleTreeDoubleClick}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right content */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto flex flex-col bg-muted/40 kb-editor-outer">
          {/* Draft mode - immersive editor */}
          {draftMode ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 flex flex-col min-h-0 mx-auto w-full max-w-[900px]">
                <div className="flex flex-col flex-1 min-h-0 mt-6 mb-8 rounded-xl bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] kb-editor-card">
                  {/* Sticky toolbar */}
                  <div className="shrink-0 sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border kb-editor-toolbar px-10 py-2.5 flex items-center gap-3">
                    <DocToolbar onAction={handleDocToolbar} />
                    <div className="flex-1" />
                    <div className="flex items-center gap-2.5">
                      {draftSaving ? (
                        <span className="flex items-center gap-1 text-xs text-blue-500">
                          <Loader2 className="size-3 animate-spin" />
                          发布中...
                        </span>
                      ) : draftDirty ? (
                        <span className="text-xs text-amber-500">草稿未保存</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Check className="size-3" />
                          草稿已保存
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7 text-muted-foreground hover:text-foreground"
                        onClick={handleDiscardDraft}
                      >
                        放弃
                      </Button>
                      <Button
                        size="sm"
                        className="text-xs h-7 bg-primary hover:bg-primary/80 text-primary-foreground"
                        onClick={handlePublishDraft}
                        disabled={draftSaving || !draftTitle.trim() || !draftContent.trim()}
                      >
                        {draftSaving && <Loader2 className="size-3 mr-1 animate-spin" />}
                        发布
                      </Button>
                    </div>
                  </div>

                  {/* Scrollable content */}
                  <div className="flex-1 overflow-y-auto px-10 pt-8 pb-24">
                    {/* Document info */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs text-muted-foreground">📄 草稿</span>
                      <span className="text-muted-foreground/30">·</span>
                      {draftDirty ? (
                        <span className="text-xs text-amber-500">草稿未保存</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">草稿已自动保存</span>
                      )}
                    </div>

                    {/* Title */}
                    <input
                      ref={draftTitleRef}
                      type="text"
                      value={draftTitle}
                      onChange={(e) => {
                        setDraftTitle(e.target.value)
                        setDraftDirty(true)
                      }}
                      placeholder="输入文档标题..."
                      className="w-full border-0 outline-none bg-transparent mb-8 focus:ring-0 placeholder:text-muted-foreground dark:placeholder:text-slate-600 text-foreground kb-editor-title"
                      style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2 }}
                    />

                    {/* Editor — borderless document mode */}
                    <EditorJsRichText
                      key="draft-editor"
                      placeholder="开始创作..."
                      data={draftEditorData}
                      borderless
                      onEditorRef={handleEditorRef}
                      onChange={handleDraftChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : !selectedItem ? (
            /* ---- Root overview ---- */
            <div className="flex-1 overflow-y-auto">
              <div className="max-w-[900px] mx-auto p-8">
                {/* 恢复草稿入口 */}
                <DraftBanner
                  kbId={kbId}
                  draftVersion={draftVersion}
                  onResume={(d) => {
                    draftParentIdRef.current = d.parentId
                    setDraftTitle(d.title || '未命名文档')
                    setDraftContent(d.content || '')
                    setDraftEditorData(d.editorData || { blocks: [], time: Date.now() })
                    setDraftDirty(false)
                    setDraftMode(true)
                    setDraftId(`draft-${Date.now()}`)
                    setSelectedId(`draft-${Date.now()}`)
                    const item: CollectionItem = {
                      id: `draft-${Date.now()}`,
                      name: d.title || '未命名文档',
                      type: 'virtual',
                      trainingType: 'chunk',
                      dataAmount: 0,
                      tags: [],
                      updateTime: new Date().toISOString(),
                      parentId: d.parentId || undefined
                    }
                    setSelectedItem(item)
                    lastSavedRef.current = JSON.stringify({
                      title: d.title || '未命名文档',
                      content: d.content || '',
                      editorData: d.editorData || { blocks: [], time: Date.now() }
                    })
                  }}
                  onDelete={() => {
                    localStorage.removeItem(`${DRAFT_STORAGE_PREFIX}${kbId}`)
                    setDraftVersion((v) => v + 1)
                  }}
                />

                <div className="flex items-center gap-2 mb-6">
                  <BookOpen className="size-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {currentFolderId ? '当前目录' : '知识库根目录'}
                  </span>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <div className="rounded-lg border bg-card p-4 shadow-sm kb-stats-card">
                    <div className="text-2xl font-bold text-primary">
                      {collections.filter(c => c.type !== 'folder').length}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">文档数量</div>
                  </div>
                  <div className="rounded-lg border bg-card p-4 shadow-sm kb-stats-card">
                    <div className="text-2xl font-bold text-primary">
                      {collections.filter(c => c.type === 'folder').length}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">文件夹数量</div>
                  </div>
                  <div className="rounded-lg border bg-card p-4 shadow-sm kb-stats-card">
                    <div className="text-2xl font-bold text-primary">
                      {collections.reduce((s, c) => s + (c.dataAmount || 0), 0)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">数据总量</div>
                  </div>
                </div>

                {/* Recent updates */}
                <h3 className="text-sm font-semibold mb-3">最近更新</h3>
                {collections.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    {isReadOnly ? '暂无内容' : '暂无内容，点击「新建文档」或「导入」开始'}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[...collections]
                      .sort((a, b) => new Date(b.updateTime || '').getTime() - new Date(a.updateTime || '').getTime())
                      .slice(0, 10)
                      .map((c) => (
                        <button
                          key={c.id}
                          className="flex items-center gap-3 w-full px-3 py-2 text-left rounded-md hover:bg-accent/50 transition-colors"
                          onClick={() => handleSelectDoc(c)}
                        >
                          {typeIcon(c.type)}
                          <span className="text-sm truncate flex-1">{c.name}</span>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {c.type === 'folder' ? '文件夹' : c.dataAmount > 0 ? `${c.dataAmount} 条数据` : '解析中'}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ---- Folder / Document content ---- */
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 flex flex-col min-h-0 mx-auto w-full max-w-[900px]">
                <div className="flex flex-col flex-1 min-h-0 mt-6 mb-8 rounded-xl bg-card shadow-[0_1px_3px_rgba(0,0,0,0.04)] kb-editor-card">
                  {editMode ? (
                    <>
                      {/* Edit sticky toolbar */}
                      <div className="shrink-0 sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border kb-editor-toolbar px-10 py-2.5 flex items-center gap-3">
                        <DocToolbar onAction={handleDocToolbar} />
                        <div className="flex-1" />
                        <div className="flex items-center gap-2.5">
                          {editSaving ? (
                            <span className="flex items-center gap-1 text-xs text-blue-500">
                              <Loader2 className="size-3 animate-spin" />
                              发布中...
                            </span>
                          ) : editSaveError ? (
                            <span className="text-xs text-red-500">发布失败</span>
                          ) : editDirty ? (
                            <span className="text-xs text-amber-500">草稿未保存</span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Check className="size-3" />
                              草稿已保存
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs h-7 text-muted-foreground hover:text-foreground"
                            onClick={handleExitEditMode}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            className="text-xs h-7 bg-primary hover:bg-primary/80 text-primary-foreground"
                            onClick={handleSaveEdit}
                            disabled={editSaving || !editTitle.trim() || !editContent.trim()}
                          >
                            {editSaving && <Loader2 className="size-3 mr-1 animate-spin" />}
                            发布
                          </Button>
                        </div>
                      </div>

                      {/* Edit content */}
                      <div className="flex-1 overflow-y-auto px-10 pt-8 pb-24">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => {
                            setEditTitle(e.target.value)
                            setEditDirty(true)
                          }}
                          placeholder="输入文档标题..."
                          className="w-full border-0 outline-none bg-transparent mb-8 focus:ring-0 placeholder:text-muted-foreground dark:placeholder:text-slate-600 text-foreground kb-editor-title"
                          style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2 }}
                        />
                        <EditorJsRichText
                          key={`edit-editor-${selectedItem?.id ?? 'none'}`}
                          placeholder="开始编辑..."
                          data={editEditorData}
                          borderless
                          onEditorRef={handleEditorRef}
                          onChange={handleEditChange}
                        />
                      </div>
                    </>
                  ) : (
                /* View mode */
                <>
                  {/* Document header bar */}
                  <div className="shrink-0 sticky top-0 z-10 bg-card/95 backdrop-blur-sm border-b border-border kb-editor-toolbar px-10 py-2.5 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {selectedItem.type === 'folder' ? '📁' : '📄'} {typeLabel(selectedItem.type)}
                    </span>
                    <div className="flex-1" />
                    {!isReadOnly && selectedItem.type !== 'folder' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            onClick={handleDownloadFile}
                          >
                            <Download className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>下载原始文件</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  {/* View content */}
                  <div className="flex-1 overflow-y-auto px-10 pt-8 pb-24">
                    <h1
                      className="mb-8 text-foreground kb-editor-title"
                      style={{ fontSize: '36px', fontWeight: 700, lineHeight: 1.2 }}
                    >
                      {selectedItem.name}
                    </h1>

                  {selectedItem.type === 'folder' ? (
                    /* Folder overview */
                    selectedItem.children && selectedItem.children.length > 0 ? (
                      <div className="space-y-1">
                        {selectedItem.children.map((child) => (
                          <button
                            key={child.id}
                            className="flex items-center gap-3 w-full px-3 py-2 text-left rounded-md hover:bg-accent/50 transition-colors"
                            onClick={() => handleSelectDoc(child)}
                          >
                            {typeIcon(child.type)}
                            <span className="text-sm truncate flex-1">{child.name}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {child.type === 'folder' ? '文件夹' : `${child.dataAmount} 条数据`}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground py-16 text-center">
                        {isReadOnly ? '空目录' : '空目录，点击「新建文档」或「导入」添加内容'}
                      </div>
                    )
                  ) : chunksLoading ? (
                    <div className="flex justify-center py-16">
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : isCurrentItemParsing ? (
                    <div className="flex flex-col items-center justify-center py-16">
                      <Loader2 className="size-8 animate-spin text-blue-500 mb-4" />
                      <div className="text-sm text-muted-foreground">文档正在切片解析中...</div>
                      <div className="text-xs text-muted-foreground/60 mt-2">解析完成后可编辑</div>
                    </div>
                  ) : chunks.length === 0 ? (
                    <div className="text-sm text-muted-foreground py-16 text-center">暂无内容</div>
                  ) : (
                    <div className="space-y-6">
                      {chunks.map((chunk) => (
                        <div key={chunk.id} className="border-b border-border pb-6 last:border-0">
                          {chunk.content && (
                            <div className="prose prose-sm dark:prose-invert max-w-none leading-[1.8] text-foreground kb-prose-content">
                              <ReactMarkdown
                                remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                                components={MARKDOWN_COMPONENTS}
                              >
                                {chunk.content}
                              </ReactMarkdown>
                            </div>
                          )}
                          {chunk.answer && (
                            <div className="mt-3 rounded-lg bg-muted px-4 py-3 prose prose-sm dark:prose-invert max-w-none">
                              <span className="text-xs text-muted-foreground">答案：</span>
                              <ReactMarkdown
                                remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                                rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                                components={MARKDOWN_COMPONENTS}
                              >
                                {chunk.answer}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                </>
              )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==================== Context Menu ==================== */}
      {!isReadOnly && ctxMenu && (
        <div
          className="fixed z-50 min-w-[160px] bg-popover border rounded-md shadow-md py-1"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 170), top: Math.min(ctxMenu.y, window.innerHeight - 200) }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.item ? (
            ctxMenu.item.type === 'folder' ? (
              <>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuCreateDoc}>新建文档</button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuCreateFolder}>新建目录</button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuImport}>导入文件</button>
                <div className="border-t my-1" />
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuRename}>重命名</button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-destructive" onClick={ctxMenuDelete}>删除</button>
              </>
            ) : (
              <>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={() => { closeCtxMenu(); handleSelectDoc(ctxMenu.item!) }}>打开</button>
                {ctxMenu.item.name.endsWith('.md') && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuEdit}>编辑</button>
                )}
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuDownload}>下载</button>
                <div className="border-t my-1" />
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuRename}>重命名</button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent text-destructive" onClick={ctxMenuDelete}>删除</button>
              </>
            )
          ) : (
            <>
              <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuCreateDoc}>新建文档</button>
              <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuCreateFolder}>新建目录</button>
              <button className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent" onClick={ctxMenuImport}>导入文件</button>
            </>
          )}
        </div>
      )}

      {/* ==================== Create Folder Dialog ==================== */}
      <Dialog
        open={showCreateFolder}
        onOpenChange={(o) => {
          if (!o) {
            setShowCreateFolder(false)
            setFolderName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">新建目录</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                目录名称 <span className="text-red-400">*</span>
              </label>
              <Input
                className="mt-1"
                placeholder="输入目录名称"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowCreateFolder(false)
                setFolderName('')
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCreateFolder}
              disabled={creatingFolder || !folderName.trim()}
            >
              {creatingFolder && <Loader2 className="size-3.5 mr-1 animate-spin" />}创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Import Dialog ==================== */}
      <Dialog
        open={showImport}
        onOpenChange={(o) => {
          if (!o) {
            setShowImport(false)
            setImportFileBuffer(null)
            setImportFileName('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">导入文件</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">
                选择文件 <span className="text-red-400">*</span>
              </label>
              <div className="mt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const input = fileInputRef.current
                    if (input) {
                      input.value = ''
                      input.click()
                    }
                  }}
                  className="w-full justify-start"
                >
                  <FileText className="size-3.5 mr-2" />
                  {importFileName || '点击选择文件'}
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">训练模式</label>
              <select
                className="mt-1 w-full h-8 text-xs border rounded-md px-2 bg-background"
                value={importTrainingType}
                onChange={(e) => setImportTrainingType(e.target.value)}
              >
                <option value="chunk">分段 (chunk)</option>
                <option value="qa">问答 (qa)</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowImport(false)
                setImportFileBuffer(null)
                setImportFileName('')
              }}
            >
              取消
            </Button>
            <Button size="sm" onClick={handleImportFile} disabled={importing || !importFileBuffer}>
              {importing && <Loader2 className="size-3.5 mr-1 animate-spin" />}导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Rename Dialog ==================== */}
      <Dialog open={!!renameItem} onOpenChange={(open) => { if (!open) setRenameItem(null) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">重命名</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="输入新名称"
              className="text-sm"
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmRename() }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameItem(null)}>
              取消
            </Button>
            <Button size="sm" onClick={handleConfirmRename} disabled={renaming || !renameName.trim()}>
              {renaming && <Loader2 className="size-3 mr-1 animate-spin" />}
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ==================== Delete Confirmation Dialog ==================== */}
      <Dialog
        open={deleteConfirmItem !== null}
        onOpenChange={(o) => { if (!o) setDeleteConfirmItem(null) }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm space-y-2">
                {deleteConfirmItem?.type === 'folder' ? (
                  <>
                    <p>删除目录后将同时删除其下所有内容。</p>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="font-medium">目录：{deleteConfirmItem.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        包含：{deleteConfirmItem.dataAmount ?? 0} 个文档
                        {deleteConfirmItem.tags?.[0] && ` · ${deleteConfirmItem.tags[0]}`}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <p>确认删除此文档？</p>
                    <div className="rounded-md bg-muted/50 p-3">
                      <p className="font-medium">{deleteConfirmItem?.name}</p>
                    </div>
                  </>
                )}
                <p className="text-xs text-muted-foreground">此操作不可恢复。</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteConfirmItem(null)}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={handleConfirmDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  )
}
